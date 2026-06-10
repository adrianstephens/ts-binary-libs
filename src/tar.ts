import * as bin from '@isopodlabs/binary';
import {Hierarchy, Cancellation, UnixMode} from './common';

function Octal(n: number) {
	return bin.as(bin.String(n),
		s => {
			let i = 0;
			while (i < s.length && (s[i] === ' ' || s[i] === '\0'))
				i++;
			return parseInt(s.substring(i), 8);
		},
		v => v.toString(8).padStart(n - 1, '0') + '\0'
	);
}

function TrimNull0(s: string) {
	let i = 0;
	while (i < s.length && s[i] !== '\0')
		i++;
	return s.substring(0, i).trimEnd();
}
function TrimNull(n: number) {
	return bin.as(bin.String(n),
		s => TrimNull0(s),
		s => s.substring(0, n).padEnd(n, '\0')
	);
}

const TypeFlag = {
	REG: 			'0', 	//regular file (or '\0')
	HARDLINK: 		'1', 	//hard link',
	SYMLINK: 		'2', 	//symbolic link',
	CHARDEV: 		'3', 	//character device',
	BLOCKDEV: 		'4', 	//block device',
	DIR: 			'5', 	//directory',
	FIFO: 			'6', 	//FIFO (named pipe)',
	RES: 			'7', 	//reserved/contiguous file (rare)',
	PAX_EXTENDED: 	'x', 	//PAX extended header (per-file metadata)',
	PAX_GLOBAL: 	'g', 	//PAX global extended header',
	GNU_LONG_NAME: 	'L', 	//GNU long name entry',
	GNU_LONG_LINK: 	'K', 	//GNU long link entry',
	GNU_SPARSE: 	'S', 	//GNU sparse file'
} as const;
type TypeFlag = typeof TypeFlag[keyof typeof TypeFlag];

const TarHeader = bin.Aligned(512, {
/*0*/	name: 		TrimNull(100),
/*100*/	mode: 		bin.as(Octal(8), bin.FlagsV(UnixMode)),
/*108*/	uid: 		Octal(8),
/*116*/	gid: 		Octal(8),
/*124*/	size: 		Octal(12),
/*136*/	mtime: 		bin.as(Octal(12), n => new Date(n * 1000), d => d.getTime() / 1000),
/*148*/	checksum: 	Octal(8),
/*156*/	typeflag: 	bin.String(1),
/*157*/	linkpath: 	TrimNull(100),
/*257*/	magic: 		TrimNull(6),// "ustar\0"
/*263*/	version: 	TrimNull(2),
/*265*/	uname: 		TrimNull(32),
/*297*/	gname: 		TrimNull(32),
/*329*/	devmajor: 	Octal(8),
/*337*/	devminor: 	Octal(8),
	_: bin.If(s => s.obj.typeflag === TypeFlag.GNU_SPARSE, {
/*345*/		prefix: 	TrimNull(41),
/*386*/		sparsemap:	bin.Array(4, {
				offset:		Octal(12),
				numbytes:	Octal(12),
			}),
/*482*/		unknown:	bin.UINT8,
/*483*/		realSize:	Octal(12),
	}, {
/*345*/		prefix: 	TrimNull(155),
	}),
	pad: 		bin.Aligned(512, bin.Const(undefined)),
	data:		bin.Buffer('size'),
});

export type TarHeader = bin.ReadType<typeof TarHeader>;

function makeHeader(partial: Partial<TarHeader> & Required<Pick<TarHeader, 'name' | 'typeflag' | 'data'>>): TarHeader {
	const h = {
		size:		partial.data.length,
		mode:    	UnixMode.NONE,
		uid:     	0,
		gid:     	0,
		mtime:		new Date(0),
		checksum:	0,
		linkpath:	'',
		magic:   	'ustar',
		version: 	'00',
		uname:   	'',
		gname:   	'',
		devmajor:	0,
		devminor:	0,
		prefix:  	'',

		...partial,
	};
	h.checksum = getChecksum(h);
	return h;
}

function bufferChecksum(buffer: Uint8Array): number {
	let sum = 0;
	for (let i = 0; i < 512; i++)
		sum += i >= 148 && i < 156 ? 32 : buffer[i];
	return sum;
}

function getChecksum(h: TarHeader): number {
	const tmp = new bin.growingStream();
	bin.write(tmp, TarHeader, h);
	return bufferChecksum(tmp.terminate().subarray(0, 512));
}

function checkHeader(buffer: Uint8Array): boolean {
	return bufferChecksum(buffer) === parseInt(new TextDecoder().decode(buffer.subarray(148, 156)).trim(), 8);
}

function isZeroBlock(buffer: Uint8Array): boolean {
	return buffer.every(b => b === 0);
}

function numChunks(data?: Uint8Array) {
	return data ? (data.byteLength + 511) >> 9 : 0;
}

interface ChunkRegion {
	offset: number;
	chunks: number;
}
function chunkEnd(r: ChunkRegion) {
	return r.offset + r.chunks;
}

function parsePax(pax: Record<string, string>, data: Uint8Array) {
	for (let i = 0; i < data.length;) {
		const	start = i;
		let		len = 0;
		while (data[i] >= 48 && data[i] <= 57)
			len = len * 10 + (data[i++] - 48);

		if (i === start || i >= data.length || data[i] !== 32 || start + len > data.length)
			break;

		const line	= bin.text.decode(data.subarray(i + 1, start + len));
		const eq	= line.indexOf('=');
		if (eq !== -1 && line.endsWith('\n'))
			pax[line.substring(0, eq)] = line.substring(eq + 1, line.length - 1);

		i = start + len;
	}
	return pax;
}

function parseSparseMap(mapText: string) {
	const parts = mapText.trim().split(',');
	const sparseMap: {offset: number, numbytes: number}[] = [];
	for (let i = 0; i + 1 < parts.length; i += 2) {
		const offset	= Number(parts[i]);
		const numbytes	= Number(parts[i + 1]);
		if (Number.isFinite(offset) && Number.isFinite(numbytes) && numbytes > 0)
			sparseMap.push({offset, numbytes});
	}
	return sparseMap;
}

function makePax(pax: Record<string, string>, h: TarHeader, filename: string) {
	h.prefix		= '';
	if (filename.length <= 100) {
		h.name	= filename;
	} else {
		if (filename.length <= 255) {
			const slash = filename.lastIndexOf('/', 155);
			if (slash > 0 && filename.length - slash <= 100) {
				h.prefix = filename.substring(0, slash);
				h.name	= filename.substring(slash + 1);
			}
		}
		if (!h.prefix)
			pax.path = filename;
	}

	const fields = {
		//numeric
		mode: 		8,
		uid: 		8,
		gid: 		8,
		size: 		12,
		devmajor: 	8,
		devminor: 	8,
		//string
		linkpath: 	100,
		uname: 		32,
		gname: 		32,
	} as const satisfies Partial<Record<keyof TarHeader, number>>;

	for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
		const val	= h[key];
		const max	= fields[key];
		if (typeof val === 'number'
			? val >= 8 ** (max - 1)
			: val.length > max
		)
			pax[key] = val.toString();
	}

	if (h.mtime.getTime() % 1000)
		pax.mtime = (h.mtime.getTime() / 1000).toString();

	return pax;
}


export class Entry extends bin.Class(TarHeader) {
	filename:	string;
	children?:	Map<string, Entry>;
	extra:		Record<string, string> = {};

	constructor(public offset: number, public chunks: number, header: TarHeader, filename?: string) {
		super(header);
		this.filename = filename || (this.prefix ? `${this.prefix}/${this.name}` : this.name);
		if (this.typeflag === TypeFlag.DIR)
			this.children = new Map();
	}

	get isDirectory() {
		return !!this.children;
	}
	get isSymbolicLink() {
		return this.typeflag === TypeFlag.SYMLINK;
	}

	async extract(): Promise<Uint8Array | null> {
		const sparsemap = this.extra['GNU.sparse.map'];
		if (sparsemap) {
			const map = parseSparseMap(sparsemap);
			const size = this.extra['GNU.sparse.realsize'] ?? this.extra['GNU.sparse.size'] ?? this.size;
			const result = new Uint8Array(+size);
			let dataOffset = 0;
			for (const {offset, numbytes} of map) {
				result.set(this.data.subarray(dataOffset, dataOffset + numbytes), offset);
				dataOffset += numbytes;
			}
			return result;
		}
		return this.data;
	}
	set(data: Uint8Array) {
		const now	= Date.now();
		this.data	= data;
		this.mtime 	= new Date(this.mtime.getTime() % 1000 ? now : Math.floor(now / 1000) * 1000);
	}

	async write(s: bin._stream | bin.async._stream) {
		this.size			= this.data?.length ?? 0;
		const pax			= makePax({...this.extra}, this, this.filename);
		const paxEntries	= Object.entries(pax);
		if (paxEntries.length > 0) {
			const paxData	= paxEntries.map(([key, value]) => `${key}=${value}`).map(s => `${s.length} ${s}`).join('\n');
			bin.interop.stream(s).write(TarHeader, makeHeader({
				name:		'.pax_extended',
				typeflag:	TypeFlag.PAX_EXTENDED,
				data:		bin.text.encode(paxData),
				mtime:		this.mtime
			}));
		}

		this.checksum	= getChecksum(this);
		await super.write(s);
	}

	static make(name: string, data?: Uint8Array) {
		return new Entry(0, numChunks(data) + 1, makeHeader({
			name,
			typeflag:	name.endsWith('/') ? TypeFlag.DIR : TypeFlag.REG,
			data:		data ?? new Uint8Array(0),
			mtime:		new Date(Math.floor(Date.now() / 1000) * 1000)
		}), name);
	}

}

export class Document extends Hierarchy<Entry> {
	entries:	Entry[] = [];
	ready:		Promise<void>;
	private free: ChunkRegion[] = [];
	private lastChunk = 0;
	private dirty = new Set<Entry>();

	constructor(file?: bin._stream | bin.async._stream) {
		super(Entry.make('root/'), 
			filename => Entry.make(filename),
			entry => {
				this.freeChunks(entry.offset, entry.chunks);
				this.entries.splice(this.entries.indexOf(entry), 1);
				this.dirty.delete(entry);
			}
		);
		this.ready = file ? this.readAll(file) : Promise.resolve();
	}

	async readAll(file0: bin._stream | bin.async._stream) {
		this.free		= [];
		this.dirty.clear();
		const file = bin.interop.stream(file0);
		const globalPax: Record<string, string> = {};

		for (let cont1 = true; cont1;) {
			file.align(512);
			const offset = file.tell() >> 9;
			const pax: Record<string, string> = {};

			let h: TarHeader;

			for (;;) {
				const header = await file.peek(512);
				if (header.length < 512 || isZeroBlock(header)) {
					cont1 = false;
					break;
				}

				if (!checkHeader(header))
					throw new Error(`Invalid tar checksum at block ${file.tell() >> 9}`);

				h = await file.read(TarHeader);
				if (h.name.startsWith('.blib_pad/')) {
					this.freeChunks(offset, numChunks(h.data) + 1);
					continue;
				}

				switch (h.typeflag) {
					case TypeFlag.PAX_EXTENDED:
						parsePax(pax, h.data);
						continue;

					case TypeFlag.PAX_GLOBAL:
						parsePax(globalPax, h.data);
						continue;

					case TypeFlag.GNU_LONG_NAME:
						pax.path = TrimNull0(bin.text.decode(h.data));
						continue;

					case TypeFlag.GNU_LONG_LINK:
						pax.linkpath = TrimNull0(bin.text.decode(h.data));
						continue;

					case TypeFlag.GNU_SPARSE:
						pax['GNU.sparse.map']		= h.sparsemap!.map(({offset, numbytes}) => `${offset},${numbytes}`).join(',');
						pax['GNU.sparse.realsize']	= h.realSize!.toString();

					//fallthrough
					default: {
						const combined = {...globalPax, ...pax};
						for (const key in combined) {
							if (key in h) {
								switch (typeof (h as any)[key]) {
									case 'string':
										(h as any)[key] = combined[key];
										break;
										
									case 'number': {
										const n = Number(combined[key]);
										if (Number.isFinite(n) && Number.isInteger(n))
											(h as any)[key] = n;
										break;
									}
									default:
										if (key === 'mtime')
											h.mtime = new Date(+combined[key] * 1000);
										break;
								}
								delete pax[key];
							}
						}

						const entry = new Entry(offset, ((file.tell() + 511) >> 9) - offset, h, combined.path);
						entry.extra	= combined;
						this.entries.push(entry);
						this.add(entry);
						break;
					}
				}
				break;
			}
		}

		this.lastChunk	= file.tell() >> 9;

		for (const entry of this.entries) {
			if (entry.isSymbolicLink)
				this.fixLink(entry, entry.linkpath);
		}

	}
	async writeAll(file0: bin._stream | bin.async._stream, cancel?: Cancellation): Promise<boolean> {
		const file = bin.interop.stream(file0);

		for (const e of this.entries) {
			if (cancel?.cancel)
				return false;
			await e.write(file);
		}


		file.align(512);
		this.lastChunk = file.tell() >> 9;
		this.free		= [];
		this.dirty.clear();

		(await file.view(Uint8Array, 1024)).fill(0);
		return true;
	}

	async flush(file0: bin._stream | bin.async._stream): Promise<void> {
		const file = bin.interop.stream(file0);

		for (const entry of this.dirty) {
			file.seek(entry.offset << 9);
			await entry.write(file);
		}

		for (const region of this.free) {
			file.seek(region.offset << 9);
			await Entry.make(
				`.blib_pad/${region.offset.toString(16).padStart(8, '0')}`,
				new Uint8Array(Math.max(0, (region.chunks - 1) << 9))
			).write(file);
		}

		file.seek(this.lastChunk << 9);
		const end = await file.view(Uint8Array, 1024);
		end.fill(0);

		this.dirty.clear();
		this.free = [];
	}

	freeChunks(offset: number, chunks: number) {
		if (chunks <= 0)
			return;

		let i = 0;
		while (i < this.free.length && this.free[i].offset < offset)
			i++;

		if (i > 0 && chunkEnd(this.free[i - 1]) === offset)
			this.free[--i].chunks += chunks;
		else
			this.free.splice(i, 0, {offset, chunks});

		if (i === this.free.length - 1) {
			if (chunkEnd(this.free[i]) === this.lastChunk) {
				this.lastChunk = this.free[i].offset;
				this.free.pop();
			}
		} else if (chunkEnd(this.free[i]) === this.free[i + 1].offset) {
			this.free[i].chunks += this.free[i + 1].chunks;
			this.free.splice(i + 1, 1);
		}
	}
	allocChunks(chunks: number) : number {
		for (const region of this.free) {
			if (region.chunks >= chunks) {
				const offset = region.offset;
				region.offset += chunks;
				region.chunks -= chunks;
				if (region.chunks === 0)
					this.free.splice(this.free.indexOf(region), 1);
				return offset;
			}
		}
		const offset = this.lastChunk;
		this.lastChunk += chunks;
		return offset;
	}

	addEntry(filename: string, data?: Uint8Array) {
		const e = Entry.make(filename);
		e.data = data || new Uint8Array(0);
		e.offset = this.allocChunks(numChunks(e.data) + 1);
		this.entries.push(e);
		this.add(e);
		this.dirty.add(e);
		return e;
	}
	copyEntry(filename: string, source: Entry) {
		if (source.isDirectory && !filename.endsWith('/'))
			filename += '/';

		const chunks		= numChunks(source.data) + 1;
		const entry 		= new Entry(this.allocChunks(chunks), chunks, source, filename);
		entry.filename		= filename;

		this.entries.push(entry);
		this.add(entry);
		this.dirty.add(entry);
		return entry;
	}

	renameEntry(oldFilename: string, newFilename: string) {
		const renamed = super.renameEntry(oldFilename, newFilename);
		if (!renamed)
			return;

		const recurse = (node: Entry) => {
			this.dirty.add(node);
			if (node.isDirectory)
				node.children!.forEach(child => recurse(child));
		};
		recurse(renamed);
		return renamed;
	}

	setEntry(filename: string, data: Uint8Array) {
		const entry = this.findEntry(filename);
		if (entry) {
			const needed	= numChunks(data);
			const space		= numChunks(entry.data);
			const offset 	= entry.offset;
			if (needed > space) {
				entry.offset = this.allocChunks(needed + 1);
				this.freeChunks(offset, space + 1);
			} else {
				this.freeChunks(offset + needed + 1, space - needed);
			}
			entry.set(data);
			this.dirty.add(entry);
		}
	}

	*[Symbol.iterator]() {
		for (const e of this.entries)
			yield e;
	}

	static async loadCompress(comp: string, data: Uint8Array) {
		return new this(new bin.stream(await bin.decompress(comp)(data)));
	}

	async saveCompress(comp: string, cancel?: Cancellation) {
		const out = new bin.growingStream();
		if (await this.writeAll(out, cancel))
			return bin.compress(comp)(out.terminate());
	}
}
