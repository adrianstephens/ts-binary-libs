import * as bin from '@isopodlabs/binary';
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

const time_bits = bin.BitFields({seconds2:5, minute:6, hour:5,day:5, month:4, years1980:7});
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

const extra = bin.Size('extra_length', bin.RemainingArray({
	id: bin.UINT16_LE,
	_: bin.Size(bin.UINT16_LE, bin.Switch('id', {
		[EXTENSION.ZIP64]: 			{
			uncompressed_size:	bin.Optional(s => s.obj.uncompressed_size 	=== 0xffffffff, bin.UINT64_LE),
			compressed_size:	bin.Optional(s => s.obj.compressed_size 	=== 0xffffffff, bin.UINT64_LE),
			offset:				bin.Optional(s => s.obj.offset 				=== 0xffffffff, bin.UINT64_LE),
			disk:				bin.Optional(s => s.obj.disk 				=== 0xffffffff, bin.UINT32_LE),
		},
		[EXTENSION.EXTENDED_TIMESTAMP]: bin.Try({
			flags:	bin.UINT8,
			mtime:	bin.Optional(s => !!(s.obj.flags & 1), UnixTime),
			atime:	bin.Optional(s => !!(s.obj.flags & 2), UnixTime),
			ctime:	bin.Optional(s => !!(s.obj.flags & 4), UnixTime),
		}),
		[EXTENSION.UNIX_UID_GID]: 		{
			uid:	bin.UINT16_LE,
			gid:	bin.UINT16_LE,
		},
		[EXTENSION.UNIX_UID_GID_NEW]: 	{
			version:	bin.UINT8,
			uid:		bin.Buffer(bin.UINT8),
			gid:		bin.Buffer(bin.UINT8),
		},
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
	}))
}));


const header = {
	version:			bin.UINT16_LE,
	flags:				bin.UINT16_LE,//bin.as(bin.UINT16_LE, bin.Flags(FLAGS, false)),
	method:				bin.UINT16_LE,//bin.asEnum(bin.UINT16_LE, METHOD),
	mtime:				ZipTime,
	crc:				bin.UINT32_LE,
	compressed_size:	bin.UINT32_LE,
	uncompressed_size:	bin.UINT32_LE,
	filename_length:	bin.UINT16_LE,
	extra_length:		bin.UINT16_LE,
};

const SIG = {
	PK:					0x4b50,
	FILE_HEADER:		0x04034b50,
	DATADESCRIPTOR:		0x08074b50,
	CENTRALDIR_ENTRY:	0x02014b50,
	CENTRALDIR_END:		0x06054b50,
	CENTRALDIR_PTR64:	0x07064b50,
	CENTRALDIR_END64:	0x06064b50,
} as const;

const Chunk = {
	sig:	bin.UINT32_LE,
	_:		bin.Switch('sig', {
		[SIG.FILE_HEADER]: {
			...header,
			filename:			bin.String('filename_length'),
			extra,
		},
		[SIG.DATADESCRIPTOR]: {
			crc:				bin.UINT32_LE,
			compressed_size:	bin.UINT32_LE,
			uncompressed_size:	bin.UINT32_LE,
		},
		[SIG.CENTRALDIR_ENTRY]:	{
			madeby:	bin.UINT16_LE,
			...header,
			comment_length:		bin.UINT16_LE,
			disk_number_start:	bin.UINT16_LE,
			attributes_int:		bin.UINT16_LE,
			attributes_ext:		bin.UINT32_LE,
			offset:				bin.UINT32_LE,
			filename:			bin.String('filename_length'),
			extra,
			comment:			bin.String('comment_length'),
		},
		[SIG.CENTRALDIR_END]:	{
			disk_no:			bin.UINT16_LE,
			dir_disk:			bin.UINT16_LE,
			total_disk:			bin.UINT16_LE,
			total_entries: 		bin.UINT16_LE,
			dir_size:			bin.UINT32_LE,
			dir_offset:			bin.UINT32_LE,
			comment:			bin.String(bin.UINT16_LE),
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

const CRC32_table = new Uint32Array(Array.from({length: 256}, (_, crc) => {
	for (let k = 0; k < 8; k++)
		crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	return crc >>> 0;
}));


function CRC32_calc(crc: number, i: number) {
	return (CRC32_table[(crc ^ i) & 0xff] ^ (crc >>> 8)) >>> 0;
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

function get_central_dir(r: bin._stream): { offset: number; length: number } | null {
	const len = r.remaining();
	if (len === undefined)
		return null;
	for (let pos = len; (pos -= 256) > 0; ) {
		const buffer = r.view_at(DataView, pos, Math.min(256, len - pos));
		for (let j = buffer.byteLength - 4; j >= 0; j--) {
			if (buffer.getUint16(j, true) === SIG.PK) {
				r.seek(pos + j);

				const chunk = bin.read(r, Chunk);
				switch (chunk.sig) {
					case SIG.CENTRALDIR_END:
						if (chunk.dir_offset !== 0xffffffff)
							return { offset: chunk.dir_offset, length: chunk.dir_size };
						break;

					case SIG.CENTRALDIR_PTR64: {
						r.seek(Number(chunk.offset));
						const end = bin.read(r, Chunk);
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

async function get_central_dir_async(r: bin.async._stream): Promise<{ offset: number; length: number } | null> {
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

//-----------------------------------------------------------------------------
// ZIPfile
//-----------------------------------------------------------------------------

const _header2 = {...header, extra };
type ZIPheader = Pick<bin.ReadType<typeof _header2>, 'flags'|'method'|'compressed_size'|'uncompressed_size'|'mtime'|'crc'|'extra'>
	& {
		filename:	string,
		offset:		number,
		comment?:	string,
	};

export class ZIPfile {
	filename:			string;
	compressed_size:	number;
	uncompressed_size:	number;
	flags:				number;
	method:				number;
	crc:				number;
	offset:				number;
	comment:			string;
	mtime:				Date;
	atime?:				Date;
	ctime?:				Date;

	children?:			Map<string, ZIPfile>;

	constructor(h: ZIPheader) {
		this.filename			= h.filename;
		this.compressed_size	= h.compressed_size;
		this.uncompressed_size	= h.uncompressed_size;
		this.flags				= h.flags;
		this.method				= h.method;
		this.crc				= h.crc;
		this.mtime				= h.mtime;
		this.offset				= h.offset;
		this.comment			= h.comment ?? '';

		for (const i of h.extra) {
			switch (i.id) {
				case EXTENSION.ZIP64:
					if (i.uncompressed_size !== undefined)
						this.uncompressed_size	= Number(i.uncompressed_size);
					if (i.compressed_size !== undefined)
						this.compressed_size	= Number(i.compressed_size);
					if (i.offset !== undefined)
						this.offset				= Number(i.offset);
					break;

				case EXTENSION.EXTENDED_TIMESTAMP:
					if (i.mtime !== undefined)
						this.mtime = i.mtime;
					if (i.atime !== undefined)
						this.atime = i.atime;
					if (i.ctime !== undefined)
						this.ctime = i.ctime;
					break;

				case EXTENSION.NTFS:
					switch (i.tag) {
						case 1:
							this.mtime = i.mtime;
							this.atime = i.atime;
							this.ctime = i.ctime;
							break;
					}
					break;

				case EXTENSION.UNICODE_COMMENT:
					this.comment = i.text;
					break;

			}
		}
		if (this.filename.endsWith('/'))
			this.children = new Map<string, ZIPfile>();
	}

	get isDirectory() {
		return this.filename.endsWith('/');
	}

	async reader(r: bin.stream, password?: string): Promise<bin.stream | undefined> {
		r.seek(this.offset);
		let r2;
		switch (this.method) {
			case METHOD.NO_COMPRESSION:
				r2 = r.offsetStream(this.offset, this.compressed_size);
				break;
			case METHOD.DEFLATED:
				r2 = new bin.stream(await new Promise((resolve, reject) => 
					zlib.inflateRaw(r.view(Uint8Array, this.compressed_size), (err, result) =>
						err ? reject(err) : resolve(result)
					)
				));
				break;
		}
		
		if (r2 && (this.flags & FLAGS.ENCRYPTION) && password) {
			const ze 		= new encryption(password);
			const buffer	= r2.view(Uint8Array, 12);
			for (const i of buffer)
				ze.update_keys(buffer[i] ^= ze.decrypt_byte());

			if (buffer[11] == this.crc >> 24) {
				// this assumes sequential reads, which is likely but not guaranteed
				let encryption_pos = 0;
				return new bin._stream((view, offset, size) => {
					if (offset !== encryption_pos)
						throw new Error('encrypted stream: non-sequential read');

					encryption_pos += size;
					const chunk = r2.view_at(Uint8Array, offset, size);
					ze.decrypt(chunk);
					return new view(chunk.buffer, chunk.byteOffset, chunk.byteLength);
				});
			}
		}
		return r2;
	}

	async extract(r: bin._stream | bin.async._stream): Promise<Uint8Array | null> {
		r.seek(this.offset);
		const raw = await r.view(Uint8Array, this.compressed_size);
		switch (this.method) {
			case METHOD.NO_COMPRESSION:
				return raw;
			case METHOD.DEFLATED:
				return await new Promise((resolve, reject) => zlib.inflateRaw(raw, (err, result) => err ? reject(err) : resolve(result)));
			default:
				return null;
		}
	}

	async compress(data: Uint8Array) : Promise<Uint8Array | null> {
		switch (this.method) {
			case METHOD.NO_COMPRESSION:
				return data;
			case METHOD.DEFLATED:
				return new Promise((resolve, reject) => zlib.deflateRaw(data, (err, result) => err ? reject(err) : resolve(result)));
			default:
				return null;
		}
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

	static createFake(filename: string): ZIPfile {
		return new this({
			filename,
			method: 0, flags: 0, crc: 0, compressed_size: 0, uncompressed_size: 0, mtime: new Date(0), offset: 0, extra: [],
		});
	}

}

//-----------------------------------------------------------------------------
// ZIPreader - reads local file headers (sequntially)
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

	constructor(private file: bin._stream) {
	}

	Next(): ZIPfile | null {
		this.file.seek(this.next);
		if (this.datadesc) {
			const tell	= this.file.tell();
			const chunk = this.file.read(Chunk);
			if (chunk.sig !== SIG.DATADESCRIPTOR)
				this.file.seek(tell + 12);
		}

		const chunk = this.file.read(Chunk);
		if (chunk.sig === SIG.FILE_HEADER) {
			const zf		= new ZIPfile({...chunk, offset: this.file.tell() });
			this.next		= this.file.tell() + zf.compressed_size;
			this.datadesc	= (chunk.flags & FLAGS.HAS_DATADESCRIPTOR) !== 0;
			return zf;
		}
		return null;
	}

	*[Symbol.iterator]() {
		this.next = 0;
		let zf;
		while ((zf = this.Next()))
			yield zf;
	}

}

export class ZIPreaderCD {
	entries:	ZIPfile[] = [];
	root	= ZIPfile.createFake('root/');
	ready	= Promise.resolve();

	constructor(file: bin._stream | bin.async._stream) {
		if (file.kind === 'async') {
			this.ready = get_central_dir_async(file).then(async cd => {
				if (!cd)
					return;

				file.seek(cd.offset);
				for (;;) {
					try {
						const chunk = await file.read(Chunk);
						if (chunk.sig != SIG.CENTRALDIR_ENTRY)
							break;
						const zf = new ZIPfile(chunk);
						// skip local header
						const local = file.offsetStream(zf.offset);
						const chunk2 = await local.read(Chunk);
						if (chunk2.sig === SIG.FILE_HEADER)
							zf.offset += local.tell();
						this.addEntry(zf);
					} catch (e) {
						console.error('Error reading central directory entry', e);
						break;
					}

				}
			});

		} else {
			const cd = get_central_dir(file);
			if (!cd)
				return;

			file.seek(cd.offset);
			for (;;) {
				const chunk = file.read(Chunk);
				if (chunk.sig != SIG.CENTRALDIR_ENTRY)
					break;
				const zf = new ZIPfile(chunk);
				// skip local header
				const local = file.offsetStream(zf.offset);
				const chunk2 = local.read(Chunk);
				if (chunk2.sig === SIG.FILE_HEADER)
					zf.offset += local.tell();
				this.addEntry(zf);
			}
		}
	}

	addEntry(entry: ZIPfile) {
		this.entries.push(entry);
		const parts = entry.filename.split('/');
		let last = parts.pop()!;
		if (last === '') // directory
			last = parts.pop()!;
		
		const current = parts.reduce((current, part, i) => {
			if (!current.children!.has(part)) {
				const fake = ZIPfile.createFake(parts.slice(0, i + 1).join('/') + '/');
				current.children!.set(part, fake);
			}
			return current.children!.get(part)!;
		}, this.root);
		current.children!.set(last, entry);
	}

	find(filename: string): ZIPfile | undefined {
		//for (const entry of this.entries) {
		//	if (entry.filename === filename)
		//		return entry;
		//}
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
		return current.children!.get(last);
	}

	*[Symbol.iterator]() {
		for (const entry of this.entries)
			yield entry;
	}
}

export class ZIPwriter {
	private entries: ZIPfile[] = [];
	private pending = Promise.resolve();

	constructor(private file: bin.stream | bin.async._stream) {
	}

	private writeChunk(chunk: bin.ReadType<typeof Chunk>) {
		return this.file.kind === 'async'
			? this.file.write(Chunk, chunk)
			: this.file.write(Chunk, chunk);
	}

	make(filename: string, method: number = METHOD.DEFLATED, mtime = new Date()): ZIPfile {
		const zf = new ZIPfile({
			filename,
			method,
			mtime,
			crc:				0,
			flags:				0,
			compressed_size:	0,
			uncompressed_size:	0,
			extra:				[],
			offset:				0,
		});
		this.entries.push(zf);
		return zf;
	}

	async write(filename: string, data: Uint8Array, method: number = METHOD.DEFLATED, mtime = new Date()): Promise<ZIPfile | undefined> {
		// Calculate CRC
		let crc = 0xffffffff;
		for (const byte of data)
			crc = CRC32_calc(crc, byte);
		crc = (crc ^ 0xffffffff) >>> 0;

		const h = {
			filename,
			method,
			mtime,
			crc,
			flags:				0,
			compressed_size:	data.length,
			uncompressed_size:	data.length,
			extra:				[],
			offset:				0,
		};

		const zf = new ZIPfile(h);
		const comp	= await zf.compress(data);
		if (!comp)
			return;

		zf.compressed_size	= comp.length;
		zf.offset			= this.file.tell();

		await this.pending;

		// Write local header
		await this.writeChunk({
			sig: SIG.FILE_HEADER,
			...zf,
			version:			0x14,
			filename_length:	filename.length,
			extra_length:		0,
			extra:				[],
		});

		this.pending = this.file.write_view(comp) ?? Promise.resolve();
		this.entries.push(zf);
		return zf;
	}

	async writeCD(): Promise<void> {
		await this.pending;
		const cdOffset = this.file.tell();

		// Write central directory
		for (const entry of this.entries) {
			await this.writeChunk({
				sig: SIG.CENTRALDIR_ENTRY,
				...entry,
				madeby:				0x315f,
				version:			0x14,
				filename_length:	entry.filename.length,
				extra_length:		0,
				comment_length:		0,
				disk_number_start:	0,
				attributes_int:		0,
				attributes_ext:		0,
				extra:				[]
			});
		}

		const cdSize = this.file.tell() - cdOffset;

		// Write end of central directory
		await this.writeChunk({
			sig: SIG.CENTRALDIR_END,
			disk_no:		0,
			dir_disk:		0,
			total_disk:		this.entries.length,
			total_entries:	this.entries.length,
			dir_size:		cdSize,
			dir_offset:		cdOffset,
			comment:		'',
		});
	}
}
