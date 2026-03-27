import * as bin from '@isopodlabs/binary';
import { MaybePromise } from '@isopodlabs/binary/dist/utils';
import zlib from 'zlib';

const FLAGS = {
	NONE:					0,
	ENCRYPTION:				1 << 0,
	OPTION1: 				1 << 1,
	OPTION2: 				1 << 2,
	HAS_DATADESCRIPTOR:		1 << 3,
	ENHANCED_DEFLATION:		1 << 4,
	COMPRESSED_PATCHED_DATA:1 << 5,
	STRONG_ENCRYPTION:		1 << 6,
	LANGUAGE_ENCODING:		1 << 11,
	MASK_HEADER_VALUES:		1 << 13,
} as const;

const METHOD = {
	NO_COMPRESSION:			0,
	SHRUNK:					1,
	FACTOR1:				2,
	FACTOR2:				3,
	FACTOR3:				4,
	FACTOR4:				5,
	IMPLODED:				6,
	DEFLATED:				8,
	ENHANCED_DEFLATED:		9,
	PKWARE_DCL_IMPLODED:	10,
	BZIP2:					12,
	LZMA:					14,
	IBM_TERSE:				18,
	IBM_LZ77Z:				19,
	PPMD_I1:				98,
} as const;
type METHOD = typeof METHOD[keyof typeof METHOD];

const time_bits = bin.BitFields(32, {seconds2:5, minute:6, hour:5,day:5, month:4, years1980:7} as const);
const ZipTime = bin.as(bin.UINT32_LE,
	x => { const t = time_bits.to(x); return new Date(t.years1980 + 1980, t.month, t.day, t.hour, t.minute, t.seconds2 * 2);},
	t => time_bits.from({years1980: t.getFullYear() - 1980, month: t.getMonth(), day: t.getDate(), hour: t.getHours(), minute: t.getMinutes(), seconds2: t.getSeconds() >> 1})
);

const UnixTime = bin.as(bin.UINT32_LE,
	x => new Date(x * 1000),
	t => Math.floor(t.getTime() / 1000)
);

const WinTime = bin.as(bin.UINT64_LE,
	x => new Date(Number(x) / 10000 - 11644473600000),
	t => BigInt(t.getTime() + 11644473600000) * 10000n
);

const EXTENSION = {
	ZIP64:				1,
	NTFS:				0x000a,
	UNICODE_COMMENT:	0x6375,
	UNICODE_PATH:		0x7075,
	UNIX_UID_GID:		0x7855,
	UNIX_UID_GID_NEW:	0x7875,
	EXTENDED_TIMESTAMP:	0x5455,
} as const;

const extension_unicode = {
	version:	bin.UINT8,
	crc32:		bin.UINT32_LE,
	text:		bin.RemainingString('utf8'),
};

const extra = bin.Size('extra_length', bin.RemainingRepeat({
	id: bin.UINT16_LE,
	_: bin.Merge(bin.Size(bin.UINT16_LE, bin.Switch(s => s.obj.id, {
		[EXTENSION.ZIP64]: 			{
			uncompressed_size:	bin.Optional(s => s.obj.uncompressed_size 	=== 0xffffffff, bin.UINT64_LE),
			compressed_size:	bin.Optional(s => s.obj.compressed_size 	=== 0xffffffff, bin.UINT64_LE),
			offset:				bin.Optional(s => s.obj.offset 				=== 0xffffffff, bin.UINT64_LE),
			disk:				bin.Optional(s => s.obj.disk 				=== 0xffffffff, bin.UINT32_LE),
		},
		[EXTENSION.EXTENDED_TIMESTAMP]: bin.Try({
			xflags:	bin.UINT8,
			mtime:	bin.Optional(s => !!(s.obj.xflags & 1), UnixTime),
			atime:	bin.Optional(s => !!(s.obj.xflags & 2), UnixTime),
			ctime:	bin.Optional(s => !!(s.obj.xflags & 4), UnixTime),
		}),
		[EXTENSION.UNIX_UID_GID]: 		bin.Try({
			uid:	bin.UINT16_LE,
			gid:	bin.UINT16_LE,
		}),
		[EXTENSION.UNIX_UID_GID_NEW]: 	bin.Try({
			version:	bin.UINT8,
			uid:		bin.Buffer(bin.UINT8),
			gid:		bin.Buffer(bin.UINT8),
		}),
		[EXTENSION.UNICODE_PATH]: 		extension_unicode,
		[EXTENSION.UNICODE_COMMENT]: 	extension_unicode,
		[EXTENSION.NTFS]: 				{
			tag:	bin.UINT16_LE,
			data:	bin.Size(bin.UINT16_LE, bin.Switch('tag', {
				1: {
					mtime:	WinTime,
					atime:	WinTime,
					ctime:	WinTime,
				}
			})),
		},
	})))
}, v => makeExtra(v)));

type extra = bin.ReadType<typeof extra>;

const SIG = {
	PK:					0x4b50,
	FILE_HEADER:		0x04034b50,
	DATADESCRIPTOR:		0x08074b50,
	CENTRALDIR_ENTRY:	0x02014b50,
	CENTRALDIR_END:		0x06054b50,
	CENTRALDIR_PTR64:	0x07064b50,
	CENTRALDIR_END64:	0x06064b50,
} as const;

const common_header = {
	version:			bin.UINT16_LE,
	flags:				bin.as(bin.UINT16_LE, bin.Flags(FLAGS, true)),
	method:				bin.as(bin.UINT16_LE, i => i as METHOD),
	mtime:				ZipTime,
	crc:				bin.UINT32_LE,
	compressed_size:	bin.UINT32_LE,
	uncompressed_size:	bin.UINT32_LE,
	filename_length:	bin.UINT16_LE,
	extra_length:		bin.UINT16_LE,
};

function at<T, S extends bin._stream | bin.async._stream>(s: S, offset: number, callback: (s: S) => MaybePromise<T>) {
	const current = s.tell();
	s.skip(offset);
	return bin.utils.after(callback(s), result => (s.seek(current), result));
}

const file_header = {
	...common_header,
	filename:			bin.String('filename_length'),
	extra,
	_: bin.If(s => s.obj.flags.HAS_DATADESCRIPTOR || (s.obj.size === 0 && s.obj.method === METHOD.DEFLATED), {
		compressed_size:	bin.Func(s => at(s, 0, get_deflated_size)),
	}),
	data:				bin.Size('compressed_size',
		bin.Defered(bin.RemainingBuffer(Uint8Array))
	),
};

const Chunk = {
	sig:	bin.UINT32_LE,
	_:		bin.Switch('sig', {
		[SIG.FILE_HEADER]:		file_header,
		[SIG.DATADESCRIPTOR]: {
			crc:				bin.UINT32_LE,
			compressed_size:	bin.UINT32_LE,
			uncompressed_size:	bin.UINT32_LE,
		},
		[SIG.CENTRALDIR_ENTRY]:	{
			madeby:	bin.UINT16_LE,
			...common_header,
			comment_length:		bin.UINT16_LE,
			disk_number_start:	bin.UINT16_LE,
			attributes_int:		bin.UINT16_LE,
			attributes_ext:		bin.UINT32_LE,
			offset:				bin.UINT32_LE,
			filename:			bin.String('filename_length'),
			extra,
			comment:			bin.String('comment_length'),
			data:				bin.Offset('offset', bin.Defered(bin.as(bin.Struct({
				sig:				bin.Expect(bin.UINT32_LE,SIG.FILE_HEADER),
				...common_header,
				filename:			bin.String('filename_length'),
				extra,
				data:				bin.Buffer(s=>
					s.obj.obj.compressed_size,
					Uint8Array
				),
			}), x => x.data))),
		},
		[SIG.CENTRALDIR_END]:	{
			disk_no:			bin.UINT16_LE,
			dir_disk:			bin.UINT16_LE,
			total_disk:			bin.UINT16_LE,
			total_entries: 		bin.UINT16_LE,
			dir_size:			bin.UINT32_LE,
			dir_offset:			bin.UINT32_LE,
			comment:			bin.String('comment_length'),
		},
		[SIG.CENTRALDIR_PTR64]:	{
			disk:				bin.UINT32_LE,
			offset:				bin.UINT64_LE,
			num_disks:			bin.UINT32_LE,
		},
		[SIG.CENTRALDIR_END64]:	bin.Size(bin.as(bin.UINT64_LE, x => Number(x)), {
			madeby:				bin.UINT16_LE,
			version:			bin.UINT16_LE,
			disk_no:			bin.UINT32_LE,
			dir_disk:			bin.UINT32_LE,
			total_disk:			bin.UINT64_LE,
			total_entries:		bin.UINT64_LE,
			dir_size:			bin.UINT64_LE,
			dir_offset:			bin.UINT64_LE,
			comment:			bin.RemainingString()
		}),
	}),
};

//export type Chunk = bin.ReadType<typeof Chunk>;

const CRC32_table = new Uint32Array(Array.from({length: 256}, (_, crc) => {
	for (let k = 0; k < 8; k++)
		crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	return crc >>> 0;
}));

function CRC32_calc(crc: number, i: number) {
	return (CRC32_table[(crc ^ i) & 0xff] ^ (crc >>> 8)) >>> 0;
}

type InflateRawInternal = zlib.InflateRaw & {
	_processChunk(chunk: Uint8Array, flushFlag: number): Uint8Array;
	bytesWritten: number;
	close(): void;
};

// Uses Node zlib internals: bytesWritten is compressed input consumed (total_in).
function get_deflated_size(r: bin._stream | bin.async._stream): number {
	if (r.kind === 'async')
		throw new Error('ZIP local deflated size probing requires sync stream');

	const remain = r.remaining();
	if (remain === undefined || remain <= 0)
		return 0;

	const inflater = zlib.createInflateRaw() as InflateRawInternal;
	try {
		inflater._processChunk(r.view_at(Uint8Array, r.tell(), remain), zlib.constants.Z_SYNC_FLUSH);
		const compressed_size = inflater.bytesWritten;
		return compressed_size > 0 ? compressed_size : 0;
	} catch {
		return 0;
	} finally {
		inflater.close();
	}
}

class encryption {
	K0	= 0x12345678;
	K1	= 0x23456789;
	K2	= 0x34567890;
	constructor(password: string) {
		for (const i of password)
			this.update_keys(i.charCodeAt(0));
	}
	update_keys(i: number) {
		this.K0	= CRC32_calc(this.K0, i);
		this.K1	= (this.K1 + (this.K0 & 0xff)) * 134775813 + 1;
		this.K2	= CRC32_calc(this.K2, this.K1 >> 24);
	}
	decrypt_byte() {
		const temp = this.K2 | 2;
		return (temp * (temp ^ 1)) >> 8;
	}
	decrypt(r: Uint8Array) {
		for (let i = 0; i < r.length; i++) {
			const c	= r[i];
			r[i]	= c ^ this.decrypt_byte();
			this.update_keys(c);
		}
	}
}

//-----------------------------------------------------------------------------
// ZIPfile - represents a file in the ZIP archive, with metadata and methods to extract and check integrity
//-----------------------------------------------------------------------------

//type file_header = bin.ReadType<typeof file_header>;

type ZIPheader = Pick<bin.ReadType<typeof file_header>, 'flags'|'method'|'compressed_size'|'uncompressed_size'|'mtime'|'atime'|'ctime'|'uid'|'gid'|'crc'|'filename'|'data'> & {
	offset?:      number|bigint,
	comment?:     string,
};

function makeExtra(_v: any) {
	const v = _v as ZIPheader;
	const extra: any[] = [];

	if (v.uncompressed_size >= 0xffffffff || v.compressed_size >= 0xffffffff || (v.offset && v.offset >= 0xffffffff))
		extra.push({id: EXTENSION.ZIP64, uncompressed_size: v.uncompressed_size, compressed_size: v.compressed_size, offset: v.offset});

	if (v.atime || v.ctime || v.mtime.getSeconds() % 2)
		extra.push({id: EXTENSION.EXTENDED_TIMESTAMP, flags: 1, mtime: v.mtime, atime: v.atime, ctime: v.ctime});

	if (v.uid || v.gid)
		extra.push({id: EXTENSION.UNIX_UID_GID, uid: v.uid, gid: v.gid});

	return extra;
}


export class ZIPfile {
	filename:			string;
	compressed_size:	number;
	uncompressed_size:	number;
	flags:				ZIPheader['flags'];
	method:				ZIPheader['method'];
	crc:				number;
	offset?:			number;
	comment:			string;
	mtime:				Date;
	atime?:				Date;
	ctime?:				Date;
	data:				bin.DeferedType<Uint8Array>;

	children?:			Map<string, ZIPfile>;

	constructor(h: ZIPheader) {
		this.filename			= h.filename;
		this.uncompressed_size	= Number(h.uncompressed_size);
		this.compressed_size	= Number(h.compressed_size);
		this.flags				= h.flags;
		this.method				= h.method;
		this.crc				= h.crc;
		this.mtime				= h.mtime!;
		this.offset				= h.offset ? Number(h.offset) : undefined;
		this.comment			= h.comment ?? '';
		this.data				= h.data;

		if (this.filename.endsWith('/'))
			this.children = new Map<string, ZIPfile>();
	}

	get isDirectory() {
		return this.filename.endsWith('/');
	}

	async extract(_r: bin._stream | bin.async._stream, password?: string): Promise<Uint8Array | null> {
		let data = await this.data.get();
		switch (this.method) {
			case METHOD.NO_COMPRESSION:
				break;
			case METHOD.DEFLATED:
				data = await new Promise((resolve, reject) => zlib.inflateRaw(data, (err, result) => err ? reject(err) : bin.resolved(new Uint8Array(result))));
				break;
			default:
				return null;
		}
		if (this.flags.ENCRYPTION && password) {
			const ze 		= new encryption(password);
			for (let i = 0; i < 12; i++)
				ze.update_keys(data[i] ^= ze.decrypt_byte());

			if (data[11] !== this.crc >> 24)
				return null;
			data = data.subarray(12);
			ze.decrypt(data);
		}
		return data;
	}

	check(data: Uint8Array) {
		if (data.length !== this.uncompressed_size) {
			console.log(`uncompressed_size mismatch: expected ${this.uncompressed_size}, got ${data.length}`);
			return false;
		}

		let crc = 0xffffffff;
		for (const byte of data)
			crc = CRC32_calc(crc, byte);
		crc = (crc ^ 0xffffffff) >>> 0;

		if (crc !== this.crc) {
			console.log(`CRC mismatch: expected ${this.crc.toString(16)}, got ${crc.toString(16)}`);
			return false;
		}
		return true;
	}

	static make(filename: string): ZIPfile {
		return new this({
			filename,
			method: METHOD.NO_COMPRESSION,
			flags: {},
			crc: 0,
			uncompressed_size: 0,
			compressed_size: 0,
			mtime: new Date(),
			data: bin.resolved(new Uint8Array()),
		});
	}

}

//-----------------------------------------------------------------------------
// ZIPreader - reads local file headers (sequentially)
// ZIPreaderCD - reads central directory and allows random access to files
// ZIPwriter - writes files and central directory
//-----------------------------------------------------------------------------

export class ZIPreader {
	static check(data: Uint8Array): boolean {
		const header = bin.read(new bin.stream(data), Chunk);
		return header.sig === SIG.FILE_HEADER;
	}

	private next = 0;
	private datadesc = false;

	constructor(private file: bin.stream2) {
	}

	async Next(): Promise<ZIPfile | null> {
		const file = this.file;
		file.seek(this.next);
		if (this.datadesc) {
			const tell	= file.tell();
			const chunk = await file.read(Chunk);
			if (chunk.sig !== SIG.DATADESCRIPTOR)
				file.seek(tell + 12);
		}

		const chunk = await file.read(Chunk);
		if (chunk.sig === SIG.FILE_HEADER) {
			const zf		= new ZIPfile(chunk);
			if (chunk.flags.HAS_DATADESCRIPTOR)
				await zf.data.get();	//wait for seek to complete before reading datadescriptor
			this.next		= file.tell();
			this.datadesc	= !!chunk.flags.HAS_DATADESCRIPTOR;
			return zf;
		}
		return null;
	}

	async *[Symbol.asyncIterator]() {
		this.next = 0;
		let zf;
		while ((zf = await this.Next()))
			yield zf;
	}

}

async function get_central_dir_async(r: bin.stream2): Promise<{ offset: number; length: number } | null> {
	const len = r.remaining();
	if (len === undefined)
		return null;
	for (let pos = len; (pos -= 256) > 0; ) {
		const buffer = await r.view_at(DataView, pos, Math.min(256, len - pos));
		for (let j = buffer.byteLength - 4; j >= 0; j--) {
			if (buffer.getUint16(j, true) === SIG.PK) {
				r.seek(pos + j);

				const chunk = await r.read(Chunk);
				switch (chunk.sig) {
					case SIG.CENTRALDIR_END:
						if (chunk.dir_offset !== 0xffffffff)
							return { offset: chunk.dir_offset, length: chunk.dir_size };
						break;

					case SIG.CENTRALDIR_PTR64: {
						r.seek(Number(chunk.offset));
						const end = await r.read(Chunk);
						if (end.sig === SIG.CENTRALDIR_END64)
							return { offset: Number(end.dir_offset), length: Number(end.dir_size) };
						break;
					}
				}
			}
		}
	}
	return null;
}

export class ZIPreaderCD {
	entries:	ZIPfile[] = [];
	root	= ZIPfile.make('root/');
	ready	= Promise.resolve<ZIPfile[] | void>([]);

	constructor(file0: bin._stream | bin.async._stream) {
		const file = file0 as bin.stream2;
		this.ready = (async () => {
			const cd = await get_central_dir_async(file);
			if (!cd)
				return;

			file.seek(cd.offset);
			for (;;) {
				try {
					console.log(`read central dir entry at ${file.tell()}`);
					const chunk = await file.read(Chunk);
					if (chunk.sig != SIG.CENTRALDIR_ENTRY)
						break;
					const zf = new ZIPfile(chunk);
					this.addEntry(zf);

				} catch (e) {
					console.error('Error reading central directory entry', e);
					break;
				}

			}
			return this.entries;
		})();
	}

	addEntry(entry: ZIPfile) {
		this.entries.push(entry);
		const parts = entry.filename.split('/');
		let last = parts.pop()!;
		if (last === '') // directory
			last = parts.pop()!;
		
		const current = parts.reduce((current, part, i) => {
			if (!current.children!.has(part)) {
				const fake = ZIPfile.make(parts.slice(0, i + 1).join('/') + '/');
				current.children!.set(part, fake);
			}
			return current.children!.get(part)!;
		}, this.root);
		current.children!.set(last, entry);
	}

	find(filename: string): ZIPfile | undefined {
		let current	= this.root;
		if (!filename)
			return current;
		const parts	= filename.split('/');
		const last	= parts.pop()!;
		for (const part of parts) {
			const next = current.children!.get(part);
			if (!next || !next.children)
				return undefined;
			current = next;
		}
		return last ? current.children!.get(last) : current;
	}

	*[Symbol.iterator]() {
		for (const entry of this.entries)
			yield entry;
	}
}

async function compress(data: Uint8Array, method: METHOD) : Promise<Uint8Array | null> {
	switch (method) {
		case METHOD.NO_COMPRESSION:
			return data;
		case METHOD.DEFLATED:
			return new Promise((resolve, reject) => zlib.deflateRaw(data, (err, result) => err ? reject(err) : resolve(result)));
		default:
			return null;
	}
}

export class ZIPwriter {
	private entries: ZIPfile[] = [];
	private pending = Promise.resolve();

	constructor(private file: bin._stream|bin.async._stream) {
	}

	async write(filename: string, data: Uint8Array, method: METHOD = METHOD.DEFLATED): Promise<ZIPfile | undefined> {
		const file = this.file as bin.stream2;

		const comp	= await compress(data, method);
		if (!comp)
			return;

		// Calculate CRC
		let crc = 0xffffffff;
		for (const byte of data)
			crc = CRC32_calc(crc, byte);
		crc = (crc ^ 0xffffffff) >>> 0;

		const h = {
			filename,
			method,
			mtime: new Date(),
			crc,
			flags: {},
			offset: this.file.tell(),
			uncompressed_size: data.length,
			compressed_size: comp.length,
			extra: {id: 0},
			data: bin.resolved(comp as Uint8Array<ArrayBuffer>),
		};

		const zf	= new ZIPfile(h);

		await this.pending;

		// Write local header
		await file.write(Chunk, {
			sig: SIG.FILE_HEADER,
			...h,
			offset: BigInt(h.offset),
			version:			0x14,
			filename_length:	filename.length,
			extra_length:		0,
			compressed_size:	comp.length,
		});

		this.pending = file.write_view(comp) ?? Promise.resolve();
		this.entries.push(zf);
		return zf;
	}

	async writeCD(): Promise<void> {
		await this.pending;

		const file = this.file as bin.stream2;
		const start = file.tell();

		// Write central directory
		for (const zf of this.entries) {
			const comp = new Uint8Array(0);

			await file.write(Chunk, {
				sig: SIG.CENTRALDIR_ENTRY,
				...zf,
				madeby:				0x315f,
				version:			0x14,
				filename_length:	zf.filename.length,
				extra_length:		0,
				comment_length:		0,
				disk_number_start:	0,
				attributes_int:		0,
				attributes_ext:		0,
				//extra:				{id: 0},
				offset:				zf.offset!,
				compressed_size:	comp.length,
				data:				bin.resolved(comp),
			});
		}

		// Write end of central directory
		await file.write(Chunk, {
			sig: SIG.CENTRALDIR_END,
			disk_no:		0,
			dir_disk:		0,
			total_disk:		this.entries.length,
			total_entries:	this.entries.length,
			dir_size:		file.tell() - start,
			dir_offset:		start,
			comment:		'',
		});
	}
}
