import * as bin from '@isopodlabs/binary';
import {Cancellation, compress, decompress, Hierarchy, UnixMode} from './common';

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

export const METHOD = {
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

// ZIP Central Directory - 'Made By' OS values (high byte)
export const OS = {
	MSDOS:	0,
	UNIX:	3,
	NTFS:	10,
	MACOS:	19,
} as const;

// ZIP Central Directory - 'Made By' spec versions (low byte, version * 10)
export const Version = {
	V1_0:	10,
	V1_1:	11,
	V2_0:	20,
	V4_5:	45,
} as const;

export const InternalAttr = {
	BINARY:	0x0000,
	TEXT:	0x0001,
} as const;

export const DosAttr = {
	READONLY:	0x01,
	HIDDEN:		0x02,
	SYSTEM:		0x04,
	DIRECTORY:	0x10,
	ARCHIVE:	0x20,
} as const;

function madeBy(os: number, ver: number) {
	return {ver, os};
}

const time_bits = bin.utils.BitFields(32, {seconds2:5, minute:6, hour:5,day:5, month:4, years1980:7} as const);
const ZipTime = bin.as(bin.UINT32_LE,
	x => {
		const t = time_bits.to(x);
		return new Date(t.years1980 + 1980, Math.max(0, t.month - 1), Math.max(1, t.day), t.hour, t.minute, t.seconds2 * 2);
	},
	t => time_bits.from({years1980: t.getFullYear() - 1980, month: t.getMonth() + 1, day: t.getDate(), hour: t.getHours(), minute: t.getMinutes(), seconds2: t.getSeconds() >> 1})
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
}, (s, _v) => makeExtra(s.obj)));

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

function makeBuffer<T extends bin.Type>(type: T, data: bin.ReadType<T>): Uint8Array {
	const s = new bin.growingStream();
	s.write(type, data);
	return s.terminate();
}

const file_header = {
	...common_header,
	filename:			bin.String('filename_length'),
	extra,
	_: bin.If(s => s.obj.flags.HAS_DATADESCRIPTOR || (s.obj.size === 0 && s.obj.method === METHOD.DEFLATED), {
		compressed_size:	bin.Search(makeBuffer(bin.UINT32_LE, SIG.DATADESCRIPTOR)),
	}),
	data:				bin.Size('compressed_size',
		bin.Defered(bin.RemainingBuffer(Uint8Array))
	),
};

const MadeBy = {ver: bin.UINT8, os: bin.asEnum2(bin.UINT8, OS)};

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
			madeby:				MadeBy,	
			...common_header,
			comment_length:		bin.UINT16_LE,
			disk_number_start:	bin.UINT16_LE,
			attributes_int:		bin.UINT16_LE,
			attributes_ext:		bin.UINT32_LE,
			offset:				bin.UINT32_LE,
			filename:			bin.String('filename_length'),
			extra,
			comment:			bin.String('comment_length'),
			data:				bin.ReadOnly(bin.Offset('offset', bin.Defered(bin.as(bin.Struct({
				sig:				bin.Expect(bin.UINT32_LE,SIG.FILE_HEADER),
				...common_header,
				filename:			bin.String('filename_length'),
				extra,
				data:				bin.Buffer(s=>
					s.obj.obj.compressed_size,
					Uint8Array
				),
			}), x => x.data)))),
		},
		[SIG.CENTRALDIR_END]:	{
			disk_no:			bin.UINT16_LE,
			dir_disk:			bin.UINT16_LE,
			total_disk:			bin.UINT16_LE,
			total_entries: 		bin.UINT16_LE,
			dir_size:			bin.UINT32_LE,
			dir_offset:			bin.UINT32_LE,
			comment_length:		bin.UINT16_LE,
			comment:			bin.String('comment_length')
		},
		[SIG.CENTRALDIR_PTR64]:	{
			disk:				bin.UINT32_LE,
			offset:				bin.UINT64_LE,
			num_disks:			bin.UINT32_LE,
		},
		[SIG.CENTRALDIR_END64]:	bin.Size(bin.as(bin.UINT64_LE, x => Number(x)), {
			madeby:				MadeBy,
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

const CRC32 = bin.utils.CRC(0xedb88320, 0xffffffff, 0xffffffff);

class encryption {
	K0	= 0x12345678;
	K1	= 0x23456789;
	K2	= 0x34567890;
	constructor(password: string) {
		for (const i of password)
			this.update_keys(i.charCodeAt(0));
	}
	update_keys(i: number) {
		this.K0	= CRC32.byte(this.K0, i);
		this.K1	= (this.K1 + (this.K0 & 0xff)) * 134775813 + 1;
		this.K2	= CRC32.byte(this.K2, this.K1 >> 24);
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
// Entry - represents an entry in the ZIP archive
//-----------------------------------------------------------------------------

type ZIPheader = Pick<bin.ReadType<typeof file_header>,
	'version'|'flags'|'method'|'compressed_size'|'uncompressed_size'|'mtime'|'atime'|'ctime'|'uid'|'gid'|'crc'|'filename'|'data'
> & {
	offset?:			number|bigint,
	attributes_ext?:	number,
	comment?:			string,
};

function makeExtra(_v: any) {
	const v = _v as ZIPheader;// & {compressed_size: number|bigint};
	const extra: any[] = [];

	if (v.uncompressed_size >= 0xffffffff || v.compressed_size >= 0xffffffff || (v.offset && v.offset >= 0xffffffff))
		extra.push({id: EXTENSION.ZIP64, uncompressed_size: v.uncompressed_size, compressed_size: v.compressed_size, offset: v.offset});

	v.uncompressed_size = fix32(v.uncompressed_size);
	v.compressed_size   = fix32(v.compressed_size);
	if (v.offset !== undefined)
		v.offset = fix32(v.offset);

	if (v.atime || v.ctime || v.mtime.getSeconds() % 2)
		extra.push({id: EXTENSION.EXTENDED_TIMESTAMP, xflags: 1, mtime: v.mtime, atime: v.atime, ctime: v.ctime});

	if (v.uid || v.gid)
		extra.push({id: EXTENSION.UNIX_UID_GID, uid: v.uid, gid: v.gid});

	return extra;

	function fix32(n: number | bigint) {
		return Number(n >= 0xffffffffn ? 0xffffffffn : n);
	}
}


export class Entry {
	filename:			string;
	children?:			Map<string, Entry>;

	uncompressed_size:	number;
	version:			number;
	flags:				ZIPheader['flags'];
	method:				ZIPheader['method'];
	crc:				number;
	comment:			string;
	mtime:				Date;
	atime?:				Date;
	ctime?:				Date;
	attributes?:		number;
	data:				bin.DeferedType<Uint8Array>;
	compressed_size:	Promise<number | bigint>;

	constructor(h: ZIPheader) {
		this.filename			= h.filename;
		this.uncompressed_size	= Number(h.uncompressed_size);
		this.version			= h.version;
		this.flags				= h.flags;
		this.method				= h.method;
		this.crc				= h.crc;
		this.mtime				= h.mtime!;
		this.comment			= h.comment ?? '';
		this.data				= h.data;
		this.attributes			= h.attributes_ext;
		this.compressed_size	= h.compressed_size < 0 ? (async () => (await h.data.get()).length)() : Promise.resolve(h.compressed_size);

		if (this.filename.endsWith('/'))
			this.children = new Map<string, Entry>();
	}

	get isDirectory() {
		return !!this.children;
	}
	get isSymbolicLink() {
		return !!this.attributes && ((this.attributes >> 16) & UnixMode.TYPEMASK) === UnixMode.SYMLINK;
	}

	async extract(password?: string): Promise<Uint8Array | null> {
		let data = await this.data.get();

		switch (this.method) {
			case METHOD.NO_COMPRESSION:
				break;
			case METHOD.DEFLATED:
				try {
					data = await decompress('deflate-raw')(data);
				} catch (e) {
					console.error('Decompression failed', e);
				}
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

		const crc = CRC32.buffer(data);
		if (crc !== this.crc) {
			console.log(`CRC mismatch: expected ${this.crc.toString(16)}, got ${crc.toString(16)}`);
			return false;
		}
		return true;
	}

	set(data: Uint8Array) {
		let compressed: Promise<Uint8Array>;
		switch (this.method) {
			case METHOD.NO_COMPRESSION:
				compressed = Promise.resolve(data);
				break;
			case METHOD.DEFLATED:
				compressed = compress('deflate-raw')(data);
				break;
			default:
				throw new Error(`Unsupported compression method: ${this.method}`);
		}

		this.mtime 				= new Date();
		this.uncompressed_size	= data.length;
		this.crc				= CRC32.buffer(data);
		this.data				= bin.resolved(compressed);
		this.compressed_size	= compressed.then(c => c.length);
	}

	static make(filename: string, method: METHOD = METHOD.NO_COMPRESSION, data?: Uint8Array): Entry {
		const file = new this({
			filename,
			method,
			version:			0x14,
			flags:				{},
			crc:				0,
			compressed_size:	0,
			uncompressed_size:	0,
			mtime:				new Date(),
			data:				bin.resolved(new Uint8Array()),
		});
		if (data)
			file.set(data);
		return file;
	}

}

//-----------------------------------------------------------------------------
// Central Directory
//-----------------------------------------------------------------------------

interface region {
	offset: number;
	length: number;
}

async function get_central_dir_async(r: bin.interop.stream): Promise<region | null> {
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
// Document - represents a ZIP archive, containing multiple entries and a hierarchy
//-----------------------------------------------------------------------------

export class Document extends Hierarchy<Entry> {
	entries:	Entry[] = [];
	ready:		Promise<void>;

	constructor(file?: bin._stream | bin.async._stream, cd = true) {
		super(Entry.make('root/'), 
			filename => Entry.make(filename),
			entry => this.entries.splice(this.entries.indexOf(entry), 1)
		);
		this.ready = file ? this.readAll(file, cd) : Promise.resolve();
	}

	async readAll(file0: bin._stream | bin.async._stream, cd: boolean) {
		const file = bin.interop.stream(file0);
		const centralDir = cd ? await get_central_dir_async(file) : null;
		if (centralDir) {
			file.seek(centralDir!.offset);
			for (;;) {
				try {
					//console.log(`read central dir entry at ${file.tell()}`);
					const chunk = await file.read(Chunk);
					if (chunk.sig != SIG.CENTRALDIR_ENTRY)
						break;

					this.entries.push(new Entry(chunk));

				} catch (e) {
					console.error('Error reading central directory entry', e);
					break;
				}
			}

		} else {
			for (;;) {
				const chunk = await file.read(Chunk);
				if (chunk.sig !== SIG.FILE_HEADER)
					break;

				try {
					const zf		= new Entry(chunk);
					if (chunk.flags.HAS_DATADESCRIPTOR) {
						await zf.data.get();	//wait for seek to complete before reading datadescriptor
						const tell	= file.tell();
						const chunk = await file.read(Chunk);
						if (chunk.sig !== SIG.DATADESCRIPTOR)
							file.seek(tell + 12);
					}
					this.entries.push(zf);
				} catch (e) {
					console.error('Error reading file header', e);
					break;
				}
			}
		}

		for (const entry of this.entries)
			this.add(entry);

		for (const entry of this.entries) {
			if (entry.isSymbolicLink) {
				const data = await entry.data.get();
				this.fixLink(entry, bin.utils.decodeText(data));
			}
		}

	}

	async writeAll(file0: bin._stream | bin.async._stream, cd = true, cancel?: Cancellation): Promise<boolean> {
		const file = bin.interop.stream(file0);
		const offsets: number[] = [];

		// Write local headers and file data
		for (const zf of this.entries) {
			const offset = file.tell();
			offsets.push(offset);

			await file.write(Chunk, {
				sig: SIG.FILE_HEADER,
				...zf,
				compressed_size:	await zf.compressed_size,
				filename_length:	zf.filename.length,
				extra_length:		0,
			});

			if (cancel?.cancel)
				return false;
		}

		if (cd) {
			const start = file.tell();

			// Write central directory
			let i = 0;
			for (const zf of this.entries) {
				await file.write(Chunk, {
					sig: SIG.CENTRALDIR_ENTRY,
					...zf,
					compressed_size:	await zf.compressed_size,
					madeby:				madeBy(OS.MSDOS, Version.V2_0),
					filename_length:	zf.filename.length,
					extra_length:		0,
					comment_length:		0,
					disk_number_start:	0,
					attributes_int:		0,
					attributes_ext:		zf.isDirectory ? DosAttr.DIRECTORY : DosAttr.ARCHIVE,
					offset:				offsets[i++],
				});

				if (cancel?.cancel)
					return false;
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
				comment_length:	0,
				comment:		'',
			});
		}
		return true;
	}

	findEntry(filename: string): Entry | undefined {
		return super.findEntry(filename);
	}

	addEntry(filename: string, data?: Uint8Array, method: METHOD = METHOD.DEFLATED) {
		const file = Entry.make(filename, method, data);
		this.entries.push(file);
		this.add(file);
		return file;
	}

	copyEntry(filename: string, data: Entry) {
		if (data.isDirectory && !filename.endsWith('/'))
			filename += '/';

		const file = new Entry({...data, compressed_size: -1, filename});
		this.entries.push(file);
		this.add(file);
		return file;
	}

	*[Symbol.iterator]() {
		for (const entry of this.entries)
			yield entry;
	}
}
