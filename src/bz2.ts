/**
 * BZ2 Decompressor
 * Based on the bz2 package (C) 2019-present SheetJS LLC
 * Licensed under Apache 2.0

.magic:16                       = 'BZ' signature/magic number
.version:8                      = 'h' for Bzip2 ('H'uffman coding), '0' for Bzip1 (deprecated)
.hundred_k_blocksize:8          = '1'..'9' block-size 100 kB-900 kB (uncompressed)

.compressed_magic:48            = 0x314159265359 (BCD (pi))
.crc:32                         = checksum for this block
.randomised:1                   = 0=>normal, 1=>randomised (deprecated)
.origPtr:24                     = starting pointer into BWT for after untransform
.huffman_used_map:16            = bitmap, of ranges of 16 bytes, present/not present
.huffman_used_bitmaps:0..256    = bitmap, of symbols used, present/not present (multiples of 16)
.huffman_groups:3               = 2..6 number of different Huffman tables in use
.selectors_used:15              = number of times that the Huffman tables are swapped (each 50 symbols)
*.selector_list:1..6            = zero-terminated bit runs (0..62) of MTF'ed Huffman table (*selectors_used)
.start_huffman_length:5         = 0..20 starting bit length for Huffman deltas
*.delta_bit_length:1..40        = 0=>next symbol; 1=>alter length { 1=>decrement length;  0=>increment length } (*(symbols+2)*groups)
.contents:2..∞                  = Huffman encoded data stream until end of block (max. 7372800 bit)

.eos_magic:48                   = 0x177245385090 (BCD sqrt(pi))
.crc:32                         = checksum for whole stream
.padding:0..7                   = align to whole byte

 */

import * as bin from '@isopodlabs/binary';

const CRC = bin.crc(0xedb88320, 0xffffffff, 0xffffffff, false);

const BLOCK_TYPE = {
	COMPRESSED:	0x314159265359,
	EOS:		0x177245385090
} as const;


type HuffmanTable = number[][];

function createOrderedHuffmanTable(lengths: number[]): HuffmanTable {
	const z = lengths.map((len, i) => [i, len] as const);
	z.push([lengths.length, -1] as const);

	const table: {code: number; bits: number}[] = [];
	let [start, bits] = z[0];
	for (const [finish, endbits] of z) {
		if (bits > 0)
			for (let code = start; code < finish; code++)
				table.push({code, bits});
		[start, bits] = [finish, endbits];
		if (endbits === -1)
            break;
	}

	table.sort((a, b) => (a.bits - b.bits) || (a.code - b.code));
	
	const fastAccess: HuffmanTable = [];
	let symbol = -1;
	bits = 0;

	for (const t of table) {
		symbol++;
		if (t.bits !== bits) {
			symbol <<= t.bits - bits;
			bits = t.bits;
			fastAccess[bits] = [];
		}
		fastAccess[bits][symbol] = t.code;
	}

	return fastAccess;
}

//BWT: Burrows–Wheeler transform
function BTWreverse(src: number[], primary: number) {
	const unsorted = src.slice();
	src.sort((a, b) => a - b);

	const start: number[] = [];
	for (let i = src.length; i--;)
		start[src[i]] = i;

	const links = unsorted.map(x => start[x]++);

	const ret = new Uint8Array(src.length);
	let i = primary;
    ret[0] = src[i];
    for (let j = src.length; --j; )
        ret[j] = src[i = links[i]] ?? 255;
    return ret;
}

//MTF: Move-to-front transform
function MTF(array: number[], idx: number): number {
	const v = array[idx];
	for (let i = idx; i > 0; i--)
		array[i] = array[i - 1];
	array[0] = v;
	return v;
}

export function decompress(bytes: Uint8Array): Uint8Array {
	let index = 0, bitfield = 0, bits = 0;

	const peekBits = (n: number): number => {
		while (bits < n) {
			bitfield = (bitfield << 8) + bytes[index++];
			bits += 8;
		}
		return (bitfield >> (bits - n)) & ((1 << n) - 1);
	};
	const readBits = (n: number): number => {
		if (n >= 32) {
			const nd = n >> 1;
			return readBits(nd) * (1 << nd) + readBits(n - nd);
		}
		while (bits < n) {
			bitfield = (bitfield << 8) + bytes[index++];
			bits += 8;
		}
		bits -= n;
		return (bitfield >> bits) & ((1 << n) - 1);
	};

	const readHuff = (huff: HuffmanTable): number => {
		for (const b in huff) {
			const n = Number(b);
			const entry = huff[n][peekBits(n)];
			if (entry !== undefined) {
				bits -= n;
				return entry;//.code;
			}
		}
		return 0;
	};

	if (readBits(16) !== 0x425a)
        throw new Error('Invalid magic');
	if (readBits(8) !== 0x68)
        throw new Error('Invalid method');

	const blocksize = readBits(8) - 48;
	if (blocksize < 1 || blocksize > 9)
		throw new Error('Invalid blocksize');

	const block		= new Uint8Array(blocksize * 102400);
	let out			= new Uint8Array();
	let outIndex	= 0;

	while (true) {
		const blocktype = readBits(48);
		const blockCRC	= readBits(32) >>> 0;

		if (blocktype === BLOCK_TYPE.COMPRESSED) {
			if (readBits(1))
                throw new Error('Randomised blocks not supported');

			const pointer		= readBits(24);
			const usedGroups	= readBits(16);
			const used: boolean[] = [];

			for (let i = 1 << 15; i > 0; i >>= 1) {
				const usedChars = usedGroups & i ? readBits(16) : 0;
				for (let j = 1 << 15; j > 0; j >>= 1)
					used.push(!!(usedChars & j));
			}

			const groups = readBits(3);
			if (groups < 2 || groups > 6)
                throw new Error('Invalid number of huffman groups');

			const mtf = Array.from({length: groups}, (_, i) => i);
			const selectors = Array.from({length: readBits(15)}, () => {
				let c = 0;
				while (readBits(1)) {
					c++;
					if (c >= groups)
                        throw new Error('MTF table out of range');
				}
				return MTF(mtf, c);
			});

			const symbolsInUse = used.filter(Boolean).length + 2;
			const tables: HuffmanTable[] = [];

			for (let i = 0; i < groups; i++) {
				let length = readBits(5);
				const lengths: number[] = [];
				for (let j = 0; j < symbolsInUse; j++) {
					if (length < 0 || length > 20)
                        throw new Error('Huffman group length outside range');
					while (readBits(1))
                        length -= (readBits(1) * 2) - 1;
					lengths.push(length);
				}
				tables.push(createOrderedHuffmanTable(lengths));
			}

			const favourites = used.map((u, i) => u ? i : -1).filter(i => i >= 0);
			const buffer: number[] = [];
			let decoded = 50, selectorPointer = 0, repeat = 0, repeatPower = 1;
			let huff = tables[selectors[selectorPointer++]];

			while (true) {
				const r = readHuff(huff);
				if (r <= 1) {
					repeat += repeatPower << r;
					repeatPower <<= 1;
				} else {
					const v = favourites[0];
					for (; repeat > 0; repeat--)
                        buffer.push(v);
					if (r === symbolsInUse - 1)
                        break;
					buffer.push(MTF(favourites, r - 1));
                    repeatPower = 1;
				}
				if (--decoded <= 0) {
					decoded = 50;
					if (selectorPointer < selectors.length)
						huff = tables[selectors[selectorPointer++]];
				}
			}

			const nt = BTWreverse(buffer, pointer);
			let blockIndex = 0;
			for (let i = 0; i < nt.length; ) {
				const c = nt[i++];
				if (i < nt.length - 4 && nt[i + 0] === c && nt[i + 1] === c && nt[i + 2] === c) {
					const count = nt[i + 3] + 4;
					i += 4;
					for (let j = 0; j < count; j++)
						block[blockIndex++] = c;
				} else {
					block[blockIndex++] = c;
				}
			}

			const gotCRC = CRC.buffer(block.subarray(0, blockIndex));
			if (gotCRC !== blockCRC)
				throw new Error(`CRC mismatch`);

			// Copy to output
			const outEnd = outIndex + blockIndex;
			if (outEnd >= out.length) {
				const old = out;
				out = new Uint8Array(Math.max((old.length || bytes.length) * 2, outEnd));
				out.set(old);
			}
			out.set(block.subarray(0, blockIndex), outIndex);
			outIndex = outEnd;

		} else if (blocktype === BLOCK_TYPE.EOS) {
			//const gotCRC = CRC.buffer(out.subarray(0, outIndex));
			//if (gotCRC !== blockCRC)
			//	throw new Error(`CRC mismatch`);

			//readBits(bits & 0x07);	// align to byte
			return out.subarray(0, outIndex);

		} else {
			throw new Error('Invalid bz2 blocktype');
		}
	}

}
