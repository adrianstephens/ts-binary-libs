import * as bin from '@isopodlabs/binary';
import {decompress} from './common';

const u8 = bin.UINT8;
const u16 = bin.UINT16_LE;
const u32 = bin.UINT32_LE;
const s32 = bin.INT32_LE;
const u16be = bin.UINT16_BE;

function concatenateBuffers(buffers: Uint8Array[]): Uint8Array {
	const totalLen	= buffers.reduce((sum, buf) => sum + buf.length, 0);
	const out 		= new Uint8Array(totalLen);
	let offset = 0;
	for (const buf of buffers) {
		out.set(buf, offset);
		offset += buf.length;
	}
	return out;
}

function clamp8(x: number) {
	return x < 0 ? 0 : x > 255 ? 255 : x;
}

function ycbcrToRgb(pixels: Uint8Array, p2: number, Y: number, Cb: number, Cr: number) {
	pixels[p2 + 0] = clamp8((Y + 1.402 * Cr + 0.5) | 0);
	pixels[p2 + 1] = clamp8((Y - 0.344136 * Cb - 0.714136 * Cr + 0.5) | 0);
	pixels[p2 + 2] = clamp8((Y + 1.772 * Cb + 0.5) | 0);
}
function greyToRgb(pixels: Uint8Array, p2: number, Y: number) {
	pixels[p2 + 0] = Y;
	pixels[p2 + 1] = Y;
	pixels[p2 + 2] = Y;
}

//-----------------------------------------------------------------------------
// BMP
//-----------------------------------------------------------------------------

const Channel5Bit 	= bin.BitField(5, {to: i => i << 3, from: v => v >> 3});
const Pixel16Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: Channel5Bit, g: Channel5Bit, r: Channel5Bit, x: 1 } as const));
const Pixel24Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: 8, g: 8, r: 8 } as const));
const Pixel32Array	= bin.utils.BitAdapterTypedArray(bin.utils.BitFields(0, { b: 8, g: 8, r: 8, a: 8 } as const));
const Uint1Array	= bin.utils.UintTypedArray(1);
const Uint4Array	= bin.utils.UintTypedArray(4);

const BMPheader = {
	width:			s32,
	height:			s32,
	planes:			u16,
	bitsPerPixel:	u16,
	compression:	u32,
	imageSize:		u32,
	xPPM:			s32,
	yPPM:			s32,
	colorsUsed:		u32,
	colorsImportant:u32,
};

const BMPSpec = {
	magic:			bin.Expect(bin.String(2), 'BM'),
	fileSize:		u32,
	reserved:		u32,
	dataOffset:		u32,
	dibSize:		u32,
	header:			BMPheader,

	palette: bin.Optional(
		s => s.obj.bitsPerPixel <= 8,
		bin.Buffer(
			s => s.obj.colorsUsed || (1 << s.obj.bitsPerPixel),
			Pixel32Array
		)
	),

	pixels: bin.Offset(s => s.obj.dataOffset, bin.Array(s => Math.abs(s.obj.header.height),
		bin.Aligned(2, bin.Switch(s => s.obj.header.bitsPerPixel, {
			1:	bin.Buffer(s => s.obj.header.width, Uint1Array),
			4:	bin.Buffer(s => s.obj.header.width, Uint4Array),
			8:	bin.Buffer(s => s.obj.header.width, Uint8Array),
			16: bin.Buffer(s => s.obj.header.width, Pixel16Array),
			24: bin.Buffer(s => s.obj.header.width, Pixel24Array),
			32: bin.Buffer(s => s.obj.header.width, Pixel32Array),
		}))
	)),
};

export function loadBMP(data: Uint8Array) {
	return bin.read(new bin.stream(data), BMPSpec);
}
//-----------------------------------------------------------------------------
// PNG
//-----------------------------------------------------------------------------

// bytes per pixel for each PNG color type
const channelCount = [1, 0, 3, 1, 2, 0, 4];

const PNGChunk = {
	length: u32,
	type:	bin.String(4),
	data:	bin.Merge(bin.Size('length', bin.Switch('type', {
		IHDR: {
			width:		u32,
			height:		u32,
			bitDepth:	u8,
			colorType:	u8,
			compression: u8,
			filter:		u8,
			interlace:	u8,
		},
		PLTE: { palette: bin.RemainingArray(bin.Buffer(3)) },
		IDAT: { data:	bin.Remainder },
		tEXt: { text:	bin.RemainingString() },
		gAMA: { gamma:	bin.as(u32, v => v / 100000) },
		tIME: { year: u16, month: u8, day: u8, hour: u8, minute: u8, second: u8 },
		default: { data: bin.Remainder },
	}))),
	crc: u32,
};

const PNGSpec = {
	sig:	bin.Expect(bin.String(8), "\x89PNG\r\n\x1A\n"),
	chunks: bin.RemainingArray(PNGChunk),
};

function unfilter(raw: Uint8Array, width: number, bpp: number): Uint8Array {
	const stride = width * bpp;
	const out = new Uint8Array(stride * ((raw.length / (stride + 1)) | 0));

	for (let y = 0, src = 0, dst = 0; dst < out.length; y++, dst += stride) {
		const filter = raw[src++];
		const row	= raw.subarray(src, src += stride);
		const prev	= y > 0 ? out.subarray(dst - stride, dst) : null;
		const cur	= out.subarray(dst, dst + stride);

		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? cur[x - bpp] : 0;
			const b = prev ? prev[x] : 0;
			const c = prev && x >= bpp ? prev[x - bpp] : 0;
			cur[x] = filter === 0 ? row[x]
					: filter === 1 ? (row[x] + a) & 0xFF
					: filter === 2 ? (row[x] + b) & 0xFF
					: filter === 3 ? (row[x] + ((a + b) >> 1)) & 0xFF
					: (row[x] + paethPredictor(a, b, c)) & 0xFF; // filter 4
		}
	}
	return out;
}

function paethPredictor(a: number, b: number, c: number) {
	const p = a + b - c;
	const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export async function loadPNG(data: Uint8Array) {
	type PNGChunk	= bin.ReadType<typeof PNGChunk>;
	type PNGtag		= PNGChunk['merge']['type'];

	function findChunk<T extends PNGtag>(chunks: PNGChunk[], type: T): Extract<PNGChunk['merge'], {type: T}> | undefined {
		return chunks.find(c => c.type === type) as any;
	}
	function filterChunks<T extends PNGtag>(chunks: PNGChunk[], type: T): Extract<PNGChunk['merge'], {type: T}>[] {
		return chunks.filter(c => c.type === type) as any;
	}

	const png	= bin.read(new bin.stream(data), PNGSpec);
	
	const ihdr	= findChunk(png.chunks, 'IHDR');// as any;
	if (!ihdr)
		throw new Error('PNG missing IHDR chunk');
	
	const {width, height, bitDepth, colorType} = ihdr;
	const bpp = (channelCount[colorType] * bitDepth) >> 3;
	
	// Concatenate all IDAT chunks
	const compressed = concatenateBuffers(filterChunks(png.chunks, 'IDAT').map(c => c.data));
	
	// Decompress and unfilter
	const raw		= await decompress('deflate-raw')(compressed);
	const pixels	= unfilter(raw, width, bpp);
	
	return {
		width, height,
		bitDepth, colorType, bpp,
		pixels,
		palette: findChunk(png.chunks, 'PLTE')?.palette,
	};
}

//-----------------------------------------------------------------------------
// GIF
//-----------------------------------------------------------------------------

function decompressGIFLZW(minCodeSize: number, data: Uint8Array, out: Uint8Array) {
	const clear		= 1 << minCodeSize;
	const end		= clear + 1;
	const prefix	= new Int32Array(4096);
	const suffix	= new Uint8Array(4096);
	const stack		= new Uint8Array(4096);

	const reset = () => {
		for (let i = 0; i < clear; i++) {
			prefix[i] = -1;
			suffix[i] = i;
		}
		return {next: end + 1, codeSize: minCodeSize + 1};
	};

	let {next, codeSize} = reset();
	let bit = 0;
	let length = 0;
	let prev = -1;
	let first = 0;

	const push = (value: number) => {
		if (length >= out.length) {
			const grown = new Uint8Array(out.length << 1);
			grown.set(out);
			out = grown;
		}
		out[length++] = value;
	};

	const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

	while (bit + codeSize <= data.length * 8) {
		const code = bin.utils.getUintBits(dv, bit, codeSize, true);
		bit += codeSize;

		if (code === clear) {
			({next, codeSize} = reset());
			prev = -1;
			continue;
		}
		if (code === end)
			break;

		let cur = code;
		let top = 0;

		if (cur >= next) {
			if (prev < 0)
				throw new Error('Invalid GIF LZW stream');
			stack[top++] = first;
			cur = prev;
		}

		while (cur >= clear) {
			stack[top++] = suffix[cur];
			cur = prefix[cur];
		}

		first = suffix[cur];
		stack[top++] = first;
		while (top)
			push(stack[--top]);

		if (prev >= 0 && next < 4096) {
			prefix[next] = prev;
			suffix[next] = first;
			next++;
			if (next === 1 << codeSize && codeSize < 12)
				codeSize++;
		}
		prev = code;
	}

	return length;
}

const GIFSubBlocks = bin.as(bin.RemainingArray(bin.FuncType(s => {
	const blockSize = bin.read(s, u8);
	return blockSize ? bin.Buffer(blockSize) : undefined;
})), concatenateBuffers);

const GIFImage = {
	left:			u16,
	top:			u16,
	width:			u16,
	height:			u16,
	packed:			bin.BitFields({
		localColorTableSize:	3, // 2^(n+1) entries
		reserved:				2,
		sortFlag:				1,
		interlaceFlag:			1,
		localColorTableFlag:	1,
	} as const),

	localPalette: 	bin.Optional(s => s.obj.packed.localColorTableFlag, bin.Buffer(s => 3 * (1 << (s.obj.packed.localColorTableSize + 1)))),
	lzwMinCodeSize:	u8,
	indices:		bin.as(GIFSubBlocks, (lzwData, s) => {
		const {width, height, packed, lzwMinCodeSize } = s.obj as any;
		const indices 	= new Uint8Array(width * height);
		const len		= decompressGIFLZW(lzwMinCodeSize, lzwData, indices);
		if (len !== width * height)
			throw new Error(`Invalid GIF LZW output length ${len}, expected ${width * height}`);

		if (packed.interlaceFlag) {
			const out = new Uint8Array(width * height);
			let offset = 0;
			for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
				for (let y = start; y < height && offset < indices.length; y += step, offset += width) 
					out.set(indices.subarray(offset, offset + width), y * width);
			}
			return out;
		}
		return indices;
	}),
};

const GIFExtension = {
	label:	u8,
	data:	GIFSubBlocks,
};

const GIFblockType = {
	image:		0x2C,
	extension:	0x21,
	eof:		0x3B,
} as const;

const GIFSpec = {
	signature:		bin.Expect(bin.String(3), 'GIF'),
	version:		bin.String(3), // '87a' or '89a'

	width:			u16,
	height:			u16,
	packed:			bin.BitFields({
		globalColorTableSize:	3, // 2^(n+1) entries
		sortFlag:				1,
		colorResolution:		3,
		globalColorTableFlag:	1,
	} as const),
	bgColorIndex:	u8,
	pixelAspect:	u8,
	globalPalette:	bin.Optional(s => s.obj.packed.globalColorTableFlag, bin.Buffer(s => 3 * (1 << (s.obj.packed.globalColorTableSize + 1)))),

	blocks:		bin.RemainingArray({
		token: bin.as(u8, bin.EnumV(GIFblockType)), _: bin.Switch('token', {
		[GIFblockType.image]:		GIFImage,
		[GIFblockType.extension]:	GIFExtension,
		[GIFblockType.eof]:			bin.Const(undefined),
	})}),
};

export function loadGIF(data: Uint8Array) {
	return bin.read(new bin.stream(data), GIFSpec);
}

//-----------------------------------------------------------------------------
// JPEG
//-----------------------------------------------------------------------------

const JPEGMarker = {
	SOI:	0xD8,
	EOI:	0xD9,
	APP0:	0xE0,
	APP1:	0xE1,
	COM:	0xFE,
	DQT:	0xDB,
	DHT:	0xC4,
	SOF0:	0xC0,
	SOF2:	0xC2,
	SOS:	0xDA,
	DRI:	0xDD,
	RST0:	0xD0,
	RST1:	0xD1,
	RST2:	0xD2,
	RST3:	0xD3,
	RST4:	0xD4,
	RST5:	0xD5,
	RST6:	0xD6,
	RST7:	0xD7,
} as const;

const DQTTable = {
	packed:	bin.Merge(bin.BitFields({id: 4, size: 4} as const)),
	values:	bin.Optional(s => s.obj.size,
		bin.Buffer(64, bin.utils.Uint16beArray),
		bin.Buffer(64, Uint8Array)
	),
};

class HuffTable extends bin.Class({
	packed:	bin.Merge(bin.BitFields({id: 4, cls: 4} as const)),
	counts:	bin.Buffer(16),
	values:	bin.Buffer(s => s.obj.counts.reduce((a: number, b: number) => a + b, 0)),
}) {
	table: number[][] = [];

	constructor(s: bin.stream) {
		super(s);

		for (let len = 0, code = 0, k = 0; len < 16; len++) {
			const table = [];
			for (let i = 0; i < this.counts[len]; i++)
				table[code++] = this.values[k++];
			this.table[len] = table;
			code <<= 1;
		}
	}

	read(readBits: (n: number) => number) {
		let code = 0;
		for (let len = 0; len < 16; len++) {
			code = (code << 1) | readBits(1);
			const v = this.table[len][code];
			if (v !== undefined)
				return v;
		}
		throw new Error('Invalid JPEG Huffman code');
	};

}

//-----------------------------------------------------------------------------
// frame
//-----------------------------------------------------------------------------

class FrameComponent extends bin.Class({
	id: 		u8,
	sampling:	bin.Merge(bin.BitFields({v: 4, h: 4} as const)),
	qtableId:	u8,
}) {
	n:		number;
	blocks = new Uint8Array();

	constructor(s: bin.stream) {
		super(s);
		this.n	= this.h * this.v;
	}

	sampler(mi: number, maxH: number, maxV: number) {
		const blocks = this.blocks.subarray(mi * this.n << 6);
		const h = this.h;
		const v = this.v;

		return (y: number) => {
			const sy = ((y * v) / maxV) | 0;
			const by = sy >> 3;
			const py = sy & 7;
			const blocksx = blocks.subarray(((by * h) << 6) + (py << 3));
			return (x: number) => {
				const sx = ((x * h) / maxH) | 0;
				const bx = sx >> 3;
				const px = sx & 7;
				return blocksx[(bx << 6) + px];
			};
		};
	}
}

class SOFData extends bin.Class({
	precision:	u8,
	height:		u16be,
	width:		u16be,
	components: bin.Array(u8, FrameComponent)
}) {
	get maxH()	{ return this.components.reduce((a, c) => Math.max(a, c.v), 1); }
	get maxV()	{ return this.components.reduce((a, c) => Math.max(a, c.h), 1); }
	get mcus()	{ return Math.ceil(this.width / (this.maxH * 8)) * Math.ceil(this.height / (this.maxV * 8)); }

	constructor(s: bin.stream) {
		super(s);
		const mcus = this.mcus;
		for (const c of this.components)
			c.blocks	= new Uint8Array(mcus * c.n * 64);
	}

	render() {
		const maxH = this.maxH;
		const maxV = this.maxV;

		const mcusX		= Math.ceil(this.width / (maxH * 8));
		const mcusY		= Math.ceil(this.height / (maxV * 8));
		const pixels	= new Uint8Array(this.width * this.height * 3);

		for (let my = 0, mi = 0; my < mcusY; my++) {
			const y0 = my * maxV * 8;
			const y1 = Math.min(this.height, y0 + maxV * 8);

			for (let mx = 0; mx < mcusX; mx++, mi++) {
				const x0 = mx * maxH * 8;
				const x1 = Math.min(this.width, x0 + maxH * 8);

				if (this.components.length === 1) {
					const s = this.components[0].sampler(mi, maxH, maxV);
					for (let y = y0; y < y1; y++) {
						const sx	= s(y - y0);
						const row	= y * this.width;
						for (let x = x0; x < x1; x++)
							greyToRgb(pixels, (row + x) * 3, sx(x - x0));
					}
				} else {
					const s0 = this.components[0].sampler(mi, maxH, maxV);
					const s1 = this.components[1].sampler(mi, maxH, maxV);
					const s2 = this.components[2].sampler(mi, maxH, maxV);
					for (let y = y0; y < y1; y++) {
						const sx0	= s0(y - y0);
						const sx1	= s1(y - y0);
						const sx2	= s2(y - y0);
						const row	= y * this.width;
						for (let x = x0; x < x1; x++)
							ycbcrToRgb(pixels, (row + x) * 3, sx0(x - x0), sx1(x - x0) - 128, sx2(x - x0) - 128);
					}
				}
			}
		}
		return pixels;
	}
};

//-----------------------------------------------------------------------------
// decoding
//-----------------------------------------------------------------------------

const zigzag = new Uint8Array([
	0, 1, 8, 16, 9, 2, 3, 10,
	17, 24, 32, 25, 18, 11, 4, 5,
	12, 19, 26, 33, 40, 48, 41, 34,
	27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36,
	29, 22, 15, 23, 30, 37, 44, 51,
	58, 59, 52, 45, 38, 31, 39, 46,
	53, 60, 61, 54, 47, 55, 62, 63,
]);

const cosTable = (() => {
	const t = new Float64Array(64);
	for (let u = 0; u < 8; u++)
		for (let x = 0; x < 8; x++)
			t[(u << 3) + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
	return t;
})();

function idctBlock(coeff: Int32Array, out: Uint8Array) {
	const tmp = new Float64Array(64);
	for (let y = 0; y < 8; y++) {
		for (let x = 0; x < 8; x++) {
			let sum = 0;
			for (let u = 0; u < 8; u++) {
				const cu = u === 0 ? 0.7071067811865476 : 1;
				sum += cu * coeff[(y << 3) + u] * cosTable[(u << 3) + x];
			}
			tmp[(y << 3) + x] = sum * 0.5;
		}
	}

	for (let x = 0; x < 8; x++) {
		for (let y = 0; y < 8; y++) {
			let sum = 0;
			for (let v = 0; v < 8; v++) {
				const cv = v === 0 ? 0.7071067811865476 : 1;
				sum += cv * tmp[(v << 3) + x] * cosTable[(v << 3) + y];
			}
			out[(y << 3) + x] = clamp8((sum * 0.5 + 128 + 0.5) | 0);
		}
	}
}

interface DecodeComponent {
	n: number;
	q: ArrayLike<number>;
	dc: HuffTable;
	ac: HuffTable;
	pred: number;
	blocks: Uint8Array;
}

function decodeScan(components: DecodeComponent[], scan: Uint8Array, mcus: number, restartInterval: number) {
	let p			= 0;
	let bitBuf		= 0;
	let bitLen		= 0;

	const readByte = () => {
		while (p < scan.length) {
			const b = scan[p++];
			if (b !== 0xFF)
				return b;

			if (p >= scan.length)
				return -1;

			const m = scan[p++];
			if (m === 0x00)
				return 0xFF;

			throw new Error(`Unexpected JPEG marker in entropy data 0x${m.toString(16)}`);
		}
		return -1;
	};

	const readBits = (n: number) => {
		while (bitLen < n) {
			const b = readByte();
			if (b < 0)
				throw new Error('Unexpected end of JPEG scan data');
			bitBuf = (bitBuf << 8) | b;
			bitLen += 8;
		}
		bitLen -= n;
		return (bitBuf >> bitLen) & ((1 << n) - 1);
	};

	function receiveExtend(v: number, n: number) {
		if (!n)
			return 0;
		const m = 1 << (n - 1);
		return v < m ? v - ((1 << n) - 1) : v;
	}

	const block = new Int32Array(64);
	for (let mi = 0; mi < mcus; mi++) {
		for (const c of components) {
			for (let i = 0; i < c.n; i++) {
				block.fill(0);
				const dcLen = c.dc.read(readBits);
				const dcDiff = receiveExtend(readBits(dcLen), dcLen);
				c.pred += dcDiff;
				block[0] = c.pred * c.q[0];

				for (let k = 1, rs; k < 64 && (rs = c.ac.read(readBits));) {
					if (rs === 0xF0) {
						k += 16;
					} else {
						k += rs >> 4;
						if (k < 64) {
							const acLen = rs & 0x0F;
							const ac = receiveExtend(readBits(acLen), acLen);
							block[zigzag[k]] = ac * c.q[k];
							k++;
						}
					}
				}

				idctBlock(block, c.blocks.subarray((mi * c.n + i) << 6));
			}
		}

		if (restartInterval && (mi + 1) < mcus && (mi + 1) % restartInterval === 0) {
			bitBuf = 0;
			bitLen = 0;
			for (const c of components)
				c.pred = 0;

			const p0 = p;
			while (p < scan.length && scan[p] === 0xFF)
				p++;
			if (p0 === p || p >= scan.length)
				throw new Error('Missing JPEG restart marker');

			const marker	= scan[p++];
			const expected	= JPEGMarker.RST0 + ((mi / restartInterval) & 7);
			if (marker !== expected)
				throw new Error(`Expected JPEG restart marker 0x${expected.toString(16)}, got 0x${marker.toString(16)}`);
		}
	}
}

class SOS extends bin.Class(JPGblock({
	components: bin.Array(u8, {
		id:		u8,
		tables: bin.Merge(bin.BitFields({ac: 4, dc: 4} as const)),
	}),
	specStart:	u8,
	specEnd:	u8,
	approx:		u8,
})) {
	constructor(s: bin.stream) {
		super(s);

		let restartInterval = 0;
		let sof;
		const dqtMap	= new Map<number, ArrayLike<number>>();
		const dcMap		= new Map<number, HuffTable>();
		const acMap		= new Map<number, HuffTable>();

		const segments	= s.obj.obj.array as bin.ReadType<typeof JPEGSegment>[];
		for (const seg of segments) {
			switch (seg.marker) {
				case JPEGMarker.SOF0:
				case JPEGMarker.SOF2:
					sof = seg;
					break;

				case JPEGMarker.DQT:
					for (const t of seg.array)
						dqtMap.set(t.id, t.values);
					break;

				case JPEGMarker.DHT:
					for (const t of seg.array) {
						if (t.cls)
							acMap.set(t.id, t);
						else
							dcMap.set(t.id, t);
					}
					break;

				case JPEGMarker.DRI:
					restartInterval = seg;
					break;
			}
		}
		if (!sof)
			throw new Error('JPEG missing SOF');

		const scanTables = new Map<number, {dc: number, ac: number}>();
		for (const c of this.components)
			scanTables.set(c.id, c);

		const components = sof.components.map(c => {
			const sc = scanTables.get(c.id);
			if (!sc)
				throw new Error(`JPEG missing SOS component ${c.id}`);

			const q		= dqtMap.get(c.qtableId);
			const dc	= dcMap.get(sc.dc);
			const ac	= acMap.get(sc.ac);
			if (!q || !dc || !ac)
				throw new Error('JPEG missing DQT/DHT table');

			return {n: c.n, q, dc, ac, pred: 0, blocks: c.blocks};
		});

		decodeScan(components, s.remainder(), sof.mcus, restartInterval);
	}
};

//-----------------------------------------------------------------------------
// parsing
//-----------------------------------------------------------------------------

function JPGblock<T extends bin.Type>(type: T) {
	return bin.Size(s => u16be.get(s) - 2, type);
}

const JPEGSegment = {
	ff:		bin.Expect(u8, 0xFF),
	marker: bin.as(u8, bin.EnumV(JPEGMarker)),
	_:	bin.Switch('marker', {
		[JPEGMarker.SOI]:	{},
		[JPEGMarker.EOI]:	{},
		[JPEGMarker.RST0]:	{}, [JPEGMarker.RST1]: {}, [JPEGMarker.RST2]: {}, [JPEGMarker.RST3]: {}, [JPEGMarker.RST4]: {}, [JPEGMarker.RST5]: {}, [JPEGMarker.RST6]: {}, [JPEGMarker.RST7]: {},
		[JPEGMarker.DRI]:	JPGblock(u16be),
		[JPEGMarker.APP0]:	JPGblock(bin.Remainder),
		[JPEGMarker.APP1]:	JPGblock(bin.Remainder),
		[JPEGMarker.COM]:	JPGblock(bin.RemainingString()),
		[JPEGMarker.DQT]:	{array: JPGblock(bin.RemainingArray(DQTTable))},
		[JPEGMarker.DHT]:	{array: JPGblock(bin.RemainingArray(HuffTable))},
		[JPEGMarker.SOF0]:	JPGblock(SOFData),
		[JPEGMarker.SOF2]:	JPGblock(SOFData),
		[JPEGMarker.SOS]:	SOS,
		default:			JPGblock(bin.Remainder),
	}),
};


export function loadJPEG(data: Uint8Array) {
	const segments = bin.read(new bin.stream(data), bin.RemainingArray(JPEGSegment));// as any[];
	const sof = segments.find(s => s.marker === JPEGMarker.SOF0);
	if (!sof)
		throw new Error('JPEG missing SOF0');

	return {
		width:	sof.width,
		height:	sof.height,
		pixels:	sof.render()
	};
}