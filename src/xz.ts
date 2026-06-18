import * as bin from '@isopodlabs/binary';
import * as lzma from './lzma';
import * as crypto from 'crypto';
import * as codecs from './7z_codecs';

const CRC32 = bin.crc(0xedb88320, 0xffffffff, 0xffffffff);
const CRC64 = bin.crc(0x42f0e1eba9ea3693n, 0xffffffffffffffffn, 0xffffffffffffffffn);
const XZVLI = bin.ULEB128;

const XZ_FILTER = {
	COPY:	0x00,
	DELTA:	0x03,
	BCJ:	0x04,
	PPC:	0x05,
	ARM:	0x07,
	ARMT:	0x08,
	SPARC:	0x09,
	LZMA:	0x4000000000000001n,
	LZMA2:	0x21,
} as const;

const CODEC_ID: {id: number|bigint, handler: (input: Uint8Array, props: Uint8Array, outSize: number) => Uint8Array}[] = [
/*COPY*/	{ id: XZ_FILTER.COPY, 	handler: input => input },
/*DELTA*/	{ id: XZ_FILTER.DELTA, 	handler: (input, props) => codecs.decodeDelta(props, input)},
/*BCJ*/		{ id: XZ_FILTER.BCJ, 	handler: input => codecs.branchX86(input)},
/*PPC*/		{ id: XZ_FILTER.PPC, 	handler: input => codecs.branchPPC(input)},
/*ARM*/		{ id: XZ_FILTER.ARM, 	handler: input => codecs.branchARM(input)},
/*ARMT*/	{ id: XZ_FILTER.ARMT, 	handler: input => codecs.branchARMT(input)},
/*SPARC*/	{ id: XZ_FILTER.SPARC, 	handler: input => codecs.branchSPARC(input)},
/*LZMA*/	{ id: XZ_FILTER.LZMA, 	handler: (input, props, outSize) => lzma.decompress(props, input, outSize)},
/*LZMA2*/	{ id: XZ_FILTER.LZMA2, 	handler: (input, props) => lzma.decompress2(props, new lzma.BufferReader(input))},
];

function decodeFilter(id: number|bigint, props: Uint8Array, input: Uint8Array, outSize = 0) {
	for (const codec of CODEC_ID) {
		if (codec.id === id)
			return codec.handler(input, props, outSize);
	}
	throw new Error(`Unsupported XZ filter id: 0x${id.toString(16)}`);
}

const checks: {size: number, handle?: (x: Uint8Array) => number|bigint}[] = [
	{size: 0,	handle: () => 0},
	{size: 4,	handle: x => CRC32.buffer(x)},
	{size: 4,	},
	{size: 4,	},
	{size: 8,	handle: x => CRC64.buffer(x)},
	{size: 8,	},
	{size: 8,	},
	{size: 16,	},
	{size: 16,	},
	{size: 16,	},
	{size: 32,	handle: x => {
		const hash = crypto.createHash('sha256').update(x).digest();
		return bin.getBigUint(new DataView(hash.buffer, hash.byteOffset, hash.byteLength), 0, 32, true);
	}},
	{size: 32,	},
	{size: 32,	},
	{size: 64,	},
	{size: 64,	},
	{size: 64,	},
];

class XZBlock extends bin.Class({
	flags:				bin.UINT8,
	compressedSize:		bin.Optional(s => s.obj.flags & 0x40, XZVLI),
	uncompressedSize:	bin.Optional(s => s.obj.flags & 0x80, XZVLI),
	filters: bin.Array(s => (s.obj.flags & 3) + 1, {
		id:			XZVLI,
		props:		bin.Buffer(bin.UINT8)
	})
}) {
	decode(s: bin.stream) {
		const outSize = Number(this.uncompressedSize ?? 0n);
		let data: Uint8Array;
		let i = this.filters.length;

		if (this.compressedSize) {
			data = s.view(Uint8Array, Number(this.compressedSize));
		} else {
			const last = this.filters[--i];
			if (last.id !== XZ_FILTER.LZMA2)
				throw new Error('Cannot decode XZ block without compressedSize unless last filter is LZMA2');

			const input = new lzma.BufferReader(s.remainder());
			data = lzma.decompress2(last.props, input);
			s.skip(-input.remaining);
		}

		while (i--) {
			const f = this.filters[i];
			data = decodeFilter(f.id, f.props, data, outSize);
		}
		return data;
	}
}

export const XZHeader = {
	magic:		bin.Expect(bin.Buffer(6), new Uint8Array([0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])),
	flags:		bin.UINT16_LE,
	headerCRC:	bin.UINT32_LE,

	blocks: bin.RemainingArray(bin.Aligned(4, bin.FuncType(s => {
		const size = bin.UINT8.get(s);
		return size === 0 ? undefined : {
			header: bin.Size(size * 4 - 1, XZBlock),
			crc:	bin.UINT32_LE,
			data:	bin.Func(s => (s.obj.header as XZBlock).decode(s)),
			check:	bin.Aligned(4, bin.UINT(s => checks[(s.lookupObj<number>('flags')! >> 8) & 15].size * 8))
		};
	}))),

	index: bin.Array(bin.as(XZVLI, x => Number(x)), {
		size:				XZVLI,
		uncompressedSize:	XZVLI,
	}),
	indexCRC:	bin.Aligned(4, bin.UINT32_LE),

	footerCRC:	bin.UINT32_LE,
	indexSize:	bin.UINT32_LE,
	flagsEnd:	bin.UINT16_LE,
	magicEnd:	bin.Expect(bin.UINT16_LE, 0x5a59),
};

export class XZ extends bin.Class(XZHeader) {
	constructor(data: Uint8Array) {
		super(new bin.stream(data));
	}
	data() {
		return bin.typedArray.concatenate(this.blocks.map(b => b.data));
	}
}
