import * as bin from '@isopodlabs/binary';
import * as lzma from './lzma';
import * as codecs from './7z_codecs';
import { Hierarchy, UnixMode, WindowsFileAttributes, Cancellation } from './common';

const SIGNATURE = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]); // "7z¼¶"

//-----------------------------------------------------------------------------
// 7Z Format Constants
//-----------------------------------------------------------------------------

const PROPERTY = {
	END:						0x00,
	HEADER:						0x01,
	ARCHIVE_PROPERTIES:			0x02,

	// Top-level main header property types
	ADDITIONAL_STREAMS_INFO:	0x03,
	MAIN_STREAMS_INFO:			0x04,
	FILES_INFO:					0x05,

	// Sub-properties of MAIN_STREAMS_INFO
	PACK_INFO:					0x06,
	CODERS_INFO:				0x07,
	SUBSTREAMS_INFO:			0x08,

	// Sub-properties of PACK_INFO
	SIZE:						0x09,
	DIGEST:						0x0a,

	FOLDER:						0x0b,
	CODERS_UNPACKSIZE:			0x0C,

	NUM_UNPACKSTREAM:			0x0D,

	EMPTY_STREAM:				0x0E,
	EMPTY_FILE:					0x0F,
	ANTI:						0x10,

	// Sub-properties of FILES_INFO
	NAME:						0x11,
	CTIME:						0x12,
	ATIME:						0x13,
	MTIME:						0x14,
	WINATTRIBUTES:				0x15,
	COMMENT:					0x16,

	ENCODED_HEADER:				0x17,
	STARTPOS:					0x18,
	DUMMY:						0x19,
} as const;

const BITARRAY	= bin.typedArray.Uint(1, true);
const UINT64b	= bin.as(bin.UINT8, (x, s) => {
	const extra = 7 - bin.highestSetIndex(x ^ 0xff);
	return BigInt(bin.UINT(extra * 8).get(s as any)) + (BigInt(x & (0x7f >> extra)) << BigInt(extra * 8));
});

const UINT64	= bin.as(UINT64b, x => Number(x));
const TIME		= bin.as(bin.UINT64_LE, x => new Date(Number(x / 10000n - 11644473600000n)));
const BITS		= bin.as(bin.Buffer(UINT64), b => new BITARRAY(b));

function Defined<T extends bin.Type>(spec: T, count: string | number | ((s: any) => number)) {
	return bin.Optional(bin.UINT8,
		bin.Array(count, spec),
		bin.as({
			defined:	bin.Buffer(count, BITARRAY),
			values:		bin.Array(count, bin.Optional(s => s.obj.defined[s.obj.index] !== 0, spec)),
		}, x => x.values)
	);
}

function External<T extends bin.Type>(spec: T) {
	return bin.Optional(bin.UINT8,
		bin.as(UINT64, async (i, s) => {
			const streams	= s.lookupObj('additionalStreams') as StreamsInfo;
			const data		= await streams.decode(s.lookupObj('packed')!, i);
			return new bin.stream(data!).read(spec);
		}),
		spec
	);
}

function DefinedExternal<T extends bin.Type>(spec: T, count: string | number | ((s: any) => number)) {
	return bin.Optional(bin.UINT8,
		External(bin.Array(count, spec)),
		bin.as({
			defined:	bin.Buffer(count, BITARRAY),
			values:		External(bin.Array(count, bin.Optional(s => s.obj.defined[s.obj.index] !== 0, spec)))
		}, x => x.values)
	);
}

type CodecHandler = (inputs: Uint8Array[], props: Uint8Array, outSizes: number[]) => Uint8Array[] | Promise<Uint8Array[]>;

function singleStream(handler: (input: Uint8Array, props: Uint8Array, outSize: number) => Uint8Array | Promise<Uint8Array>): CodecHandler {
	return async (inputs, props, outSizes) => {
		if (inputs.length !== 1 || outSizes.length !== 1)
			throw new Error(`Unsupported 7z codec arity: in=${inputs.length}, out=${outSizes.length}`);
		return [await handler(inputs[0], props, outSizes[0])];
	};
}

const CODEC_ID: {id: Uint8Array, handler: CodecHandler;}[] = [
/*COPY*/	{id: new Uint8Array([0x00]),					handler: singleStream(input => input)},
/*DELTA*/	{id: new Uint8Array([0x03]),					handler: singleStream((input, props) => codecs.decodeDelta(props, input))},
/*BCJ*/		{id: new Uint8Array([0x03, 0x03, 0x01, 0x03]),	handler: singleStream(input => codecs.branchX86(input))},
/*PPC*/		{id: new Uint8Array([0x03, 0x03, 0x02, 0x05]),	handler: singleStream(input => codecs.branchPPC(input))},
/*ARM*/		{id: new Uint8Array([0x03, 0x03, 0x05, 0x01]),	handler: singleStream(input => codecs.branchARM(input))},
/*ARMT*/	{id: new Uint8Array([0x03, 0x03, 0x07, 0x01]),	handler: singleStream(input => codecs.branchARMT(input))},
/*SPARC*/	{id: new Uint8Array([0x03, 0x03, 0x08, 0x05]),	handler: singleStream(input => codecs.branchSPARC(input))},
/*SWAP2*/	{id: new Uint8Array([0x03, 0x03, 0x01, 0x02]),	handler: singleStream(input => codecs.swap2(input))},
/*SWAP4*/	{id: new Uint8Array([0x03, 0x03, 0x01, 0x04]),	handler: singleStream(input => codecs.swap4(input))},
/*BCJ2*/	{id: new Uint8Array([0x03, 0x03, 0x01, 0x1b]),	handler: inputs => [codecs.decodeBCJ2(inputs)]},
/*DEFLATE*/	{id: new Uint8Array([0x01, 0x01, 0x00, 0x01]),	handler: singleStream(input => bin.decompress('deflate-raw')(input))},
/*BZIP2*/	{id: new Uint8Array([0x02, 0x02, 0x42, 0x32]),	handler: singleStream(input => bin.decompress('bzip2')(input))},
/*LZMA*/	{id: new Uint8Array([0x03, 0x01, 0x01]),		handler: singleStream((input, props, outSize) => lzma.decompress(props, input, outSize))},
/*LZMA2*/	{id: new Uint8Array([0x21]),					handler: singleStream((input, props) => lzma.decompress2(props, new lzma.BufferReader(input)))},
//*PPMD*/	{id: new Uint8Array([0x04, 0x02, 0x05]),		handler: singleStream((input, props, outSize) => input)},
//*AES*/	{id: new Uint8Array([0x06, 0xf1, 0x07, 0x01]),	handler: singleStream((input, props, outSize) => input)},
] as const;

class Coder extends bin.Class({
	flags:		bin.UINT8,
	codecId:	bin.Buffer(s => s.obj.flags & 0xf, Uint8Array),
	complex:	bin.Optional(s => s.obj.flags & 0x10, {numIn: UINT64, numOut: UINT64}),
	props:		bin.Optional(s => s.obj.flags & 0x20, bin.Buffer(UINT64, Uint8Array), bin.Const(new Uint8Array))
}) {
	get numIn()		{ return this.complex?.numIn ?? 1; }
	get numOut()	{ return this.complex?.numOut ?? 1; }

	decode(inputs: Uint8Array[], outSizes: number[]) {
		for (const codec of CODEC_ID) {
			if (codec.id.length === this.codecId.length && codec.id.every((v, i) => v === this.codecId[i]))
				return codec.handler(inputs, this.props, outSizes);
		}
		throw new Error(`Unsupported 7z codec: ${Array.from(this.codecId).map(x => x.toString(16).padStart(2, '0')).join('')}`);
	}
}

function totalInStreams(coders: Coder[]) {
	return coders.reduce((a, coder) => a + coder.numIn, 0);
}

function totalOutStreams(coders: Coder[]) {
	return coders.reduce((a, coder) => a + coder.numOut, 0);
}

class Folder extends bin.Class({
	coders:			bin.Array(UINT64, Coder),
	bindPairs:		bin.Array(s => Math.max(0, totalOutStreams(s.obj.coders) - 1), {inIndex: UINT64, outIndex: UINT64}),
	packedStreams:	bin.Optional(s => totalInStreams(s.obj.coders) > s.obj.bindPairs.length + 1,
		bin.Array(s => totalInStreams(s.obj.coders) - s.obj.bindPairs.length, UINT64)
	)
}) {
	decoded?:	Uint8Array|null;

	numPackedStreams() {
		return Math.max(1, totalInStreams(this.coders) - this.bindPairs.length);
	}

	async decode(inputs: Uint8Array[], outSizes: number[]) {
		if (this.decoded)
			return this.decoded;

		const inBase: number[] = [];
		const outBase: number[] = [];
		let inPos = 0;
		let outPos = 0;
		for (const coder of this.coders) {
			inBase.push(inPos);
			outBase.push(outPos);
			inPos	+= coder.numIn;
			outPos	+= coder.numOut;
		}

		const packIn = this.packedStreams ?? (() => {
			const bound = new Set(this.bindPairs.map(p => Number(p.inIndex)));
			for (let i = 0; i < totalInStreams(this.coders); i++) {
				if (!bound.has(i))
					return [i];
			}
			throw new Error('Invalid 7z folder: no packed input stream index found');
		})();

		if (packIn.length !== inputs.length)
			throw new Error(`Invalid 7z folder: expected ${packIn.length} packed stream(s), got ${inputs.length}`);

		const inputStreams:		(Uint8Array | undefined)[] = new Array(totalInStreams(this.coders)).fill(undefined);
		const outputStreams:	(Uint8Array | undefined)[] = new Array(totalOutStreams(this.coders)).fill(undefined);
		for (let i = 0; i < packIn.length; i++)
			inputStreams[packIn[i]] = inputs[i];

		const bindInByOut = new Map<number, number[]>();
		for (const p of this.bindPairs) {
			const ins = bindInByOut.get(p.outIndex) ?? [];
			ins.push(p.inIndex);
			bindInByOut.set(p.outIndex, ins);
		}

		for (let progress = true; progress; ) {
			progress = false;
			for (let i = 0; i < this.coders.length; i++) {
				const coder		= this.coders[i];
				const coderInputs = inputStreams.slice(inBase[i], inBase[i] + coder.numIn);
				const coderOutBase = outBase[i];

				if (coderInputs.every(Boolean) && !outputStreams.slice(coderOutBase, coderOutBase + coder.numOut).every(Boolean)) {
					const decoded = await coder.decode(coderInputs as Uint8Array[], outSizes.slice(coderOutBase, coderOutBase + coder.numOut));
					if (decoded.length !== coder.numOut)
						throw new Error(`Invalid 7z coder output count: expected ${coder.numOut}, got ${decoded.length}`);

					for (let j = 0; j < decoded.length; j++) {
						const outIndex = coderOutBase + j;
						outputStreams[outIndex] = decoded[j];
						for (const nextIn of bindInByOut.get(outIndex) ?? [])
							inputStreams[nextIn] = decoded[j];
					}
					progress = true;
				}
			}
		}

		const boundOutputs = new Set(this.bindPairs.map(p => Number(p.outIndex)));
		const finalOutputs = outputStreams.filter((_, i) => !boundOutputs.has(i));
		if (finalOutputs.length === 1 && finalOutputs[0])
			return this.decoded = finalOutputs[0];

		throw new Error('Invalid 7z folder graph: no final output stream produced');
	}
};

class StreamsInfo extends bin.Class(bin.RemainingRepeat(bin.Switch(bin.UINT8, {
	[PROPERTY.END]:				bin.Const(undefined),
	[PROPERTY.PACK_INFO]:		{
		pos:		UINT64,
		numStreams: UINT64,
		_: bin.Merge(bin.RemainingRepeat(bin.Switch(bin.UINT8, {
			[PROPERTY.END]:		bin.Const(undefined),
			[PROPERTY.SIZE]:	{size:	bin.Array("numStreams", UINT64)},
			[PROPERTY.DIGEST]:	{digest: bin.as({
				count:		UINT64,
				digests:	Defined(UINT64, 'count')
			}, x => x.digests)},
			default:			{buffer: bin.Buffer(UINT64)}
		})))
	},
	[PROPERTY.CODERS_INFO]:		bin.RemainingRepeat(bin.Switch(bin.UINT8, {
		[PROPERTY.END]:		bin.Const(undefined),
		[PROPERTY.FOLDER]:	{
			numFolders:		UINT64,
			folders:		bin.Optional(bin.UINT8,
				UINT64,
				bin.Array('numFolders', Folder)
			)
		},
		[PROPERTY.CODERS_UNPACKSIZE]:	{
			unpackSizes:	bin.Array('numFolders',
				bin.Array(s => totalOutStreams(s.lookupObj<Folder[]>('folders')![s.obj.length].coders), UINT64)
			)
		},
		[PROPERTY.DIGEST]:	{
			folderDigests: Defined(bin.UINT32_LE, 'numFolders')
		},
	})),
	[PROPERTY.SUBSTREAMS_INFO]:	bin.RemainingRepeat(bin.Switch(bin.UINT8, {
		[PROPERTY.END]:					bin.Const(undefined),
		[PROPERTY.NUM_UNPACKSTREAM]: {
			NumUnPackStreamsInFolders:	bin.Array('numFolders', UINT64)
		},
		[PROPERTY.SIZE]: {
			unpackSize:	bin.Array("numFolders", bin.Array(s => s.lookupObj<number[]>('NumUnPackStreamsInFolders')![s.obj.length] - 1, UINT64))
		},
		[PROPERTY.DIGEST]: {
			count:		bin.Func(s => {
				const numSub = s.lookupObj('NumUnPackStreamsInFolders') as number[];
				const folderDigests = s.lookupObj('folderDigests') as number[];
				let count = 0;
				for (let i = 0; i < numSub.length; i++) {
					const streams = Number(numSub?.[i] ?? 1);
					if (streams !== 1 || folderDigests?.[i] === undefined)
						count += streams;
				}
				return count;
			}),
			digests:	Defined(bin.UINT32_LE, 'count')
		},
		default:	{buffer: bin.Buffer(UINT64)}
	}), splitSubstreamsInfo),
	default: {buffer: bin.Buffer(UINT64)}
}, discrimStreamsInfo)/*, splitStreamsInfo*/)) {

	async decode(packed: Uint8Array, streamIndex: number) {
		const folders		= Array.isArray(this.folders) ? this.folders : [];

		let folderStartStream = 0;
		for (let i = 0; i < folders.length; i++) {
			const numPackedStreams = folders[i].numPackedStreams();
			if (folderStartStream + numPackedStreams > streamIndex) {
				const inputs: Uint8Array[] = [];
				for (let i = 0; i < numPackedStreams; i++) {
					const idx	= folderStartStream + i;
					const start	= this.size!.slice(0, idx).reduce((a, size) => a + size, this.pos!);
					inputs.push(packed.subarray(start, start + this.size![idx]));
				}
				return folders[i].decode(inputs, this.unpackSizes![i]);
			}
			folderStartStream += numPackedStreams;
		}
	}
};

function getFields(obj: any, fields: string[]) {
	const filtered = fields.filter(f => f in obj);
	return filtered.length
		? Object.fromEntries(filtered.map(f => [f, obj[f]]))
		: undefined;
}

function splitStreamsInfo(s: any, value: any) {
	return [
		getFields(value, ['pos', 'numStreams', 'size']),
		getFields(value, ['numFolders', 'folders', 'unpackSizes']),
		getFields(value, ['NumUnPackStreamsInFolders', 'unpackSize']),
	].filter(Boolean);
}
function splitSubstreamsInfo(s: any, value: any) {
	return [
		getFields(value, ['NumUnPackStreamsInFolders']),
		getFields(value, ['unpackSize']),
	].filter(Boolean) as any;
}

function discrimStreamsInfo(value: any): any {
	return 'pos' in value ? PROPERTY.PACK_INFO :
		'numFolders' in value ? PROPERTY.CODERS_INFO :
		'unpackSize' in value ? PROPERTY.SUBSTREAMS_INFO :
		undefined;
}

const FilesInfo = {
	numFiles:	UINT64,
	_: bin.Merge(bin.RemainingRepeat(bin.Switch(bin.UINT8, {
		[PROPERTY.END]:				bin.Const(undefined),

		[PROPERTY.EMPTY_STREAM]: 	{empty_stream:	BITS},
		[PROPERTY.EMPTY_FILE]: 		{empty_file:	BITS},
		[PROPERTY.ANTI]: 			{anti:			BITS},

		[PROPERTY.CTIME]:			{ctime:	bin.Size(UINT64, DefinedExternal(TIME, 'numFiles'))},
		[PROPERTY.ATIME]:			{atime:	bin.Size(UINT64, DefinedExternal(TIME, 'numFiles'))},
		[PROPERTY.MTIME]:			{mtime:	bin.Size(UINT64, DefinedExternal(TIME, 'numFiles'))},
		[PROPERTY.WINATTRIBUTES]:	{attr:	bin.Size(UINT64, DefinedExternal(bin.UINT32_LE, 'numFiles'))},
		[PROPERTY.STARTPOS]:		{pos:	bin.Size(UINT64, Defined(UINT64, 'numFiles'))},
		[PROPERTY.NAME]:			{names:	bin.Size(UINT64, External(bin.Array('numFiles', bin.NullTerminatedString('utf16le'))))},
		default: {buffer: bin.Buffer(UINT64)}
	}), splitFilesInfo))
};
function splitFilesInfo(s: any, value: any) {
	return [
		getFields(value, ['empty_stream']),
		getFields(value, ['empty_file']),
		getFields(value, ['anti']),
		getFields(value, ['ctime']),
		getFields(value, ['atime']),
		getFields(value, ['mtime']),
		getFields(value, ['attr']),
		getFields(value, ['pos']),
		getFields(value, ['names']),
	].filter(Boolean) as any;
}

const Header  = bin.RemainingRepeat(
	bin.Switch(bin.UINT8, {
		[PROPERTY.END]:						bin.Const(undefined),
		[PROPERTY.ARCHIVE_PROPERTIES]:		{properties: bin.RemainingArray({
			type:	bin.as(bin.UINT8, x => {
				if (x === 0)
					throw 'stop';
				 return x;
			}),
			data:	bin.Buffer(UINT64, Uint8Array)
		})},
		[PROPERTY.ADDITIONAL_STREAMS_INFO]:	{additionalStreams:	StreamsInfo},
		[PROPERTY.MAIN_STREAMS_INFO]:		{mainStreams:		StreamsInfo},
		[PROPERTY.FILES_INFO]:				{files:				FilesInfo},
		default: {buffer: bin.Buffer(UINT64)}
	}),
	splitHeader
);
export type Header = bin.ReadType<typeof Header>;

function splitHeader(_s: any, h: any): any[] {
	const header = h as Header;
	return [{mainStreams: header.mainStreams}, {files: header.files}];
}

const Seven7Header = {
	signature:			bin.Expect(bin.Buffer(6, Uint8Array), SIGNATURE),
	version:			{major: bin.UINT8, minor: bin.UINT8},
	startHeaderCRC:		bin.UINT32_LE,

	nextHeaderOffset:	bin.UINT64_LE,
	nextHeaderSize:		bin.UINT64_LE,
	nextHeaderCRC:		bin.UINT32_LE,

	packed:	bin.Buffer("nextHeaderOffset"),

	_: bin.Merge(bin.Size("nextHeaderSize", bin.RemainingRepeat(
		bin.Switch(bin.UINT8, {
			[PROPERTY.END]:				bin.Const(undefined),
			[PROPERTY.HEADER]:			Header,
			[PROPERTY.ENCODED_HEADER]:	bin.as(StreamsInfo, async (streams, s) => {
				const data = await streams.decode(s.lookupObj('packed'), 0);
				if (data) {
					return await bin.interop.stream(new bin.stream(data)).read(bin.RemainingRepeat(
						bin.Switch(bin.UINT8, {
							[PROPERTY.END]:		bin.Const(undefined),
							[PROPERTY.HEADER]:	Header,
							default: {buffer: bin.Buffer(UINT64)}
						})
					));
				}
			}),
			default: {buffer: bin.Buffer(UINT64)}
		}, () => PROPERTY.HEADER)
	)))
} as const;

export type FilesInfo = bin.ReadType<typeof FilesInfo>;
//export type StreamsInfo = bin.ReadType<typeof StreamsInfo>;
export type Seven7Header = bin.ReadType<typeof Seven7Header>;

//-----------------------------------------------------------------------------
// Entry - represents a file/folder in the 7Z archive
//-----------------------------------------------------------------------------

export class Entry {
	children?: 			Map<string, Entry>;
	uncompressed_size: 	number;
	compressed_size: 	number;
	mtime?: 			Date;
	atime?: 			Date;
	ctime?: 			Date;
	attributes?: 		number;
	data?: 				Uint8Array;
	extractor?: () => Promise<Uint8Array | null>;

	constructor(public filename: string, isDirectory = false, size = 0) {
		this.uncompressed_size = size;
		this.compressed_size = 0;
		if (isDirectory || filename.endsWith('/'))
			this.children = new Map<string, Entry>();
	}

	get isDirectory() {
		return !!this.children;
	}

	get isSymbolicLink() {
		if (this.attributes && this.attributes & WindowsFileAttributes.UNIX_EXTENSION)
			return ((this.attributes >> 16) & UnixMode.TYPEMASK) === UnixMode.SYMLINK;

		return !!this.attributes && !!(this.attributes & WindowsFileAttributes.REPARSE_POINT);
	}

	get linkTarget() {
		if (this.data?.length)
			return bin.text.decodeToNull(this.data, 'unknown');
	}

	async extract(): Promise<Uint8Array | null> {
		if (!this.data && this.extractor)
			this.data = await this.extractor() ?? undefined;
		return this.data ?? null;
	}

	static make(filename: string, isDir = false, data?: Uint8Array): Entry {
		const entry = new Entry(filename, isDir, data?.length ?? 0);
		if (data)
			entry.data = data;
		return entry;
	}
}

//-----------------------------------------------------------------------------
// Document - represents a 7Z archive
//-----------------------------------------------------------------------------

interface FileData {
	streamIndex:	number;
	offset:			number;
	size:			number;
}

export class Document extends Hierarchy<Entry> {
	entries: Entry[] = [];
	parsed?: Seven7Header;
	ready: Promise<void>;

	constructor(file?: bin._stream | bin.async._stream) {
		super(
			Entry.make('root/', true),
			filename	=> Entry.make(filename),
			entry		=> this.entries.splice(this.entries.indexOf(entry), 1)
		);
		this.ready = file ? this.readAll(file) : Promise.resolve();
	}

	private async readAll(file0: bin._stream | bin.async._stream) {
		try {
			const parsed	= this.parsed = await bin.interop.stream(file0).read(Seven7Header);
			const packed	= parsed.packed;
			const streams	= parsed.mainStreams;
			const files		= parsed.files;
			
			if (streams && files && files.numFiles > 0) {

				if (!Array.isArray(streams.folders)) {
					const file2		= new bin.stream((await parsed.additionalStreams!.decode(packed, streams.folders!))!);
					streams.folders	= Array.from({length: Number(streams.numFolders ?? 0)}, () => new Folder(file2));
				}

				const folders	= Array.isArray(streams.folders) ? streams.folders : [];

				const plans: FileData[] = [];
				let streamIndex = 0;
				for (let f = 0; f < folders.length; f++) {
					const total		= Number(streams.unpackSizes?.[f]?.[0] ?? 0);
					const numSub	= Number(streams.NumUnPackStreamsInFolders?.[f] ?? 1);
					const explicit	= streams.unpackSize?.[f] ?? [];
					
					let	offset = 0, consumed = 0;
					for (let i = 0; i < numSub; i++) {
						const size = i < explicit.length ? Number(explicit[i]) : Math.max(0, total - consumed);
						plans.push({streamIndex, offset, size});
						offset		+= size;
						consumed	+= size;
					}
					streamIndex += folders[f].numPackedStreams();
				}

				let substream = 0, empty = 0;

				for (let i = 0; i < files.numFiles; i++) {
					const empty_stream	= files.empty_stream && !!files.empty_stream[i];
					let dir = false;
					if (empty_stream) {
						dir	= !!files.empty_file && !!files.empty_file[empty];
						if (files.anti && files.anti[empty++])
							continue; // anti-file, skip
					}

					const e = new Entry(files.names![i], dir);
					e.mtime			= files.mtime?.[i];
					e.atime			= files.atime?.[i];
					e.ctime			= files.ctime?.[i];
					e.attributes	= files.attr?.[i];

					if (!empty_stream) {
						const plan			= plans[substream++];
						e.uncompressed_size = plan.size;
						e.extractor			= async () => {
							return (await streams.decode(packed, plan.streamIndex))!.subarray(plan.offset, plan.offset + plan.size);
						};
					}

					this.entries.push(e);
				}
			}

			// Build hierarchy
			for (const entry of this.entries)
				this.add(entry);
		} catch (e) {
			console.error('Error reading 7z archive:', e);
		}
	}

	async writeAll(file0: bin._stream | bin.async._stream, _cancel?: Cancellation): Promise<boolean> {
		/*
		const parsed: Seven7Header = {
			version: { major: 0, minor: 0 },
			startHeaderCRC: 0,

			nextHeaderOffset: 0n,
			nextHeaderSize: 0n,
			nextHeaderCRC: 0,
			packed: new Uint8Array(0),

			mainStreams: {
				pos: 0,
				numStreams: 0,
				numFolders: 0,
				folders: [],
				NumUnPackStreamsInFolders: [],
				unpackSize: [],
			},
			files: {
				numFiles: this.entries.length,
				names: this.entries.map(e => e.filename),
				mtime: this.entries.map(e => e.mtime),
				attr: this.entries.map(e => e.attributes),
			}

		};
*/
		if (!this.parsed)
			return false;
		await bin.interop.stream(file0).write(Seven7Header, this.parsed);
		return true;
	}
	
}
