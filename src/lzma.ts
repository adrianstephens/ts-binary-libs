/**
 * LZMA Decompressor (Modernized TypeScript)
 * Based on js-lzma (c) 2011 Juan Mellado, MIT licensed
 * References: LZMA SDK by Igor Pavlov
 */

export interface InStream {
	readByte(): number;
}

export interface OutStream {
	writeByte(b: number): void;
}

class OutWindow {
	private _buffer: number[] = [];
	private _windowSize = 0;
	private _pos = 0;
	private _streamPos = 0;
	private _stream?: OutStream;

	create(windowSize: number) {
		if (!this._buffer || this._windowSize !== windowSize)
			this._buffer = [];
		this._windowSize = windowSize;
		this._pos = 0;
		this._streamPos = 0;
	}

	flush() {
		const size = this._pos - this._streamPos;
		if (size !== 0) {
			for (let i = 0; i < size; i++)
				this._stream!.writeByte(this._buffer[this._streamPos++]);
			if (this._pos >= this._windowSize)
				this._pos = 0;
			this._streamPos = this._pos;
		}
	}

	releaseStream() {
		this.flush();
		this._stream = undefined;
	}

	setStream(stream: OutStream) {
		this.releaseStream();
		this._stream = stream;
	}

	init(solid: boolean) {
		if (!solid) {
			this._streamPos = 0;
			this._pos = 0;
		}
	}

	copyBlock(distance: number, len: number) {
		let pos = this._pos - distance - 1;
		if (pos < 0)
			pos += this._windowSize;
		for (let i = 0; i < len; i++) {
			if (pos >= this._windowSize)
				pos = 0;
			this._buffer[this._pos++] = this._buffer[pos++];
			if (this._pos >= this._windowSize)
				this.flush();
		}
	}

	putByte(b: number) {
		this._buffer[this._pos++] = b;
		if (this._pos >= this._windowSize)
			this.flush();
	}

	getByte(distance: number): number {
		let pos = this._pos - distance - 1;
		if (pos < 0)
			pos += this._windowSize;
		return this._buffer[pos];
	}
}

export class RangeDecoder {
	private stream?: InStream;
	private code = 0;
	private range = 0;

	setStream(stream: InStream) {
		this.stream = stream;
	}

	releaseStream() {
		this.stream = undefined;
	}

	init() {
		this.code = 0;
		this.range = -1;
		for (let i = 0; i < 5; i++)
			this.code = (this.code << 8) | this.stream!.readByte();
	}

	decodeDirectBits(numTotalBits: number): number {
		let result = 0;
		for (let i = numTotalBits - 1; i >= 0; i--) {
			this.range >>>= 1;
			const t = (this.code - this.range) >>> 31;
			this.code -= this.range & (t - 1);
			result = (result << 1) | (1 - t);

			if ((this.range & 0xff000000) === 0) {
				this.code = (this.code << 8) | this.stream!.readByte();
				this.range <<= 8;
			}
		}
		return result;
	}

	decodeBit(probs: number[], index: number): number {
		const prob = probs[index];
		const newBound = (this.range >>> 11) * prob;

		if ((this.code ^ 0x80000000) < (newBound ^ 0x80000000)) {
			this.range = newBound;
			probs[index] += (2048 - prob) >>> 5;
			if ((this.range & 0xff000000) === 0) {
				this.code = (this.code << 8) | this.stream!.readByte();
				this.range <<= 8;
			}
			return 0;
		}

		this.range -= newBound;
		this.code -= newBound;
		probs[index] -= prob >>> 5;
		if ((this.range & 0xff000000) === 0) {
			this.code = (this.code << 8) | this.stream!.readByte();
			this.range <<= 8;
		}
		return 1;
	}
}

function initBitModels(probs: number[], len: number) {
	for (let i = 0; i < len; i++)
		probs[i] = 1024;
}

class BitTreeDecoder {
	models: number[] = [];
	numBitLevels: number;

	constructor(numBitLevels: number) {
		this.numBitLevels = numBitLevels;
	}

	init() {
		initBitModels(this.models, 1 << this.numBitLevels);
	}

	decode(rangeDecoder: RangeDecoder): number {
		let m = 1;
		for (let i = 0; i < this.numBitLevels; i++)
			m = (m << 1) | rangeDecoder.decodeBit(this.models, m);
		return m - (1 << this.numBitLevels);
	}

	reverseDecode(rangeDecoder: RangeDecoder): number {
		let m = 1;
		let symbol = 0;
		for (let i = 0; i < this.numBitLevels; i++) {
			const bit = rangeDecoder.decodeBit(this.models, m);
			m = (m << 1) | bit;
			symbol |= bit << i;
		}
		return symbol;
	}
}

function reverseDecode2(models: number[], startIndex: number, rangeDecoder: RangeDecoder, numBitLevels: number): number {
	let m = 1;
	let symbol = 0;
	for (let i = 0; i < numBitLevels; i++) {
		const bit = rangeDecoder.decodeBit(models, startIndex + m);
		m = (m << 1) | bit;
		symbol |= bit << i;
	}
	return symbol;
}

class LenDecoder {
	choice: number[] = [];
	lowCoder: BitTreeDecoder[] = [];
	midCoder: BitTreeDecoder[] = [];
	highCoder = new BitTreeDecoder(8);
	numPosStates = 0;

	create(numPosStates: number) {
		for (; this.numPosStates < numPosStates; this.numPosStates++) {
			this.lowCoder[this.numPosStates] = new BitTreeDecoder(3);
			this.midCoder[this.numPosStates] = new BitTreeDecoder(3);
		}
	}

	init() {
		initBitModels(this.choice, 2);
		for (let i = 0; i < this.numPosStates; i++) {
			this.lowCoder[i].init();
			this.midCoder[i].init();
		}
		this.highCoder.init();
	}

	decode(rangeDecoder: RangeDecoder, posState: number): number {
		if (rangeDecoder.decodeBit(this.choice, 0) === 0)
			return this.lowCoder[posState].decode(rangeDecoder);
		if (rangeDecoder.decodeBit(this.choice, 1) === 0)
			return 8 + this.midCoder[posState].decode(rangeDecoder);
		return 16 + this.highCoder.decode(rangeDecoder);
	}
}

class Decoder2 {
	decoders: number[] = [];

	init() {
		initBitModels(this.decoders, 0x300);
	}

	decodeNormal(rangeDecoder: RangeDecoder): number {
		let symbol = 1;
		while (symbol < 0x100)
			symbol = (symbol << 1) | rangeDecoder.decodeBit(this.decoders, symbol);
		return symbol & 0xff;
	}

	decodeWithMatchByte(rangeDecoder: RangeDecoder, matchByte: number): number {
		let symbol = 1;
		while (symbol < 0x100) {
			const matchBit = (matchByte >> 7) & 1;
			matchByte <<= 1;
			const bit = rangeDecoder.decodeBit(this.decoders, ((1 + matchBit) << 8) + symbol);
			symbol = (symbol << 1) | bit;
			if (matchBit !== bit)
				while (symbol < 0x100)
					symbol = (symbol << 1) | rangeDecoder.decodeBit(this.decoders, symbol);
		}
		return symbol & 0xff;
	}
}

class LiteralDecoder {
	coders?: Decoder2[];
	numPrevBits?: number;
	numPosBits?: number;
	posMask?: number;

	create(numPosBits: number, numPrevBits: number) {
		if (this.coders && this.numPrevBits === numPrevBits && this.numPosBits === numPosBits)
			return;
		this.numPosBits = numPosBits;
		this.posMask = (1 << numPosBits) - 1;
		this.numPrevBits = numPrevBits;
		this.coders = [];

		const numCoders = 1 << (this.numPrevBits + this.numPosBits);
		for (let i = 0; i < numCoders; i++)
			this.coders[i] = new Decoder2();
	}

	init() {
		const numCoders = 1 << (this.numPrevBits! + this.numPosBits!);
		for (let i = 0; i < numCoders; i++)
			this.coders![i].init();
	}

	getDecoder(pos: number, prevByte: number): Decoder2 {
		return this.coders![((pos & this.posMask!) << this.numPrevBits!) + ((prevByte & 0xff) >>> (8 - this.numPrevBits!))];
	}
}

class Decoder {
	private _outWindow = new OutWindow();
	private _rangeDecoder = new RangeDecoder();
	private _isMatchDecoders: number[] = [];
	private _isRepDecoders: number[] = [];
	private _isRepG0Decoders: number[] = [];
	private _isRepG1Decoders: number[] = [];
	private _isRepG2Decoders: number[] = [];
	private _isRep0LongDecoders: number[] = [];
	private _posSlotDecoder: BitTreeDecoder[] = [
		new BitTreeDecoder(6),
		new BitTreeDecoder(6),
		new BitTreeDecoder(6),
		new BitTreeDecoder(6),
	];
	private _posDecoders: number[] = [];
	private _posAlignDecoder = new BitTreeDecoder(4);
	private _lenDecoder = new LenDecoder();
	private _repLenDecoder = new LenDecoder();
	private _literalDecoder = new LiteralDecoder();
	private _dictionarySize = -1;
	private _dictionarySizeCheck = -1;
	private _posStateMask = 0;
	private _state = 0;
	private _rep0 = 0;
	private _rep1 = 0;
	private _rep2 = 0;
	private _rep3 = 0;
	private _nowPos64 = 0;
	private _prevByte = 0;

	setDictionarySize(dictionarySize: number): boolean {
		if (dictionarySize < 0)
			return false;
		if (this._dictionarySize !== dictionarySize) {
			this._dictionarySize = dictionarySize;
			this._dictionarySizeCheck = Math.max(this._dictionarySize, 1);
			this._outWindow.create(Math.max(this._dictionarySizeCheck, 4096));
		}
		return true;
	}

	setLcLpPb(lc: number, lp: number, pb: number): boolean {
		const numPosStates = 1 << pb;
		if (lc > 8 || lp > 4 || pb > 4)
			return false;
		this._literalDecoder.create(lp, lc);
		this._lenDecoder.create(numPosStates);
		this._repLenDecoder.create(numPosStates);
		this._posStateMask = numPosStates - 1;
		return true;
	}

	setPropertiesByte(value: number): boolean {
		return this.setLcLpPb(value % 9, Math.floor(value / 9) % 5, Math.floor(value / 45));
	}

	resetDictionary() {
		this._outWindow.init(false);
		this._nowPos64 = 0;
		this._prevByte = 0;
	}

	appendUncompressed(outStream: OutStream, bytes: Uint8Array, resetDictionary = false) {
		if (resetDictionary)
			this.resetDictionary();
		this._outWindow.setStream(outStream);
		for (const b of bytes) {
			this._outWindow.putByte(b);
			this._nowPos64++;
			this._prevByte = b;
		}
		this._outWindow.flush();
		this._outWindow.releaseStream();
	}

	init(resetState = true, resetDictionary = true) {
		if (resetState) {
			this._state = 0;
			this._rep0 = 0;
			this._rep1 = 0;
			this._rep2 = 0;
			this._rep3 = 0;
			initBitModels(this._isMatchDecoders, 192);
			initBitModels(this._isRep0LongDecoders, 192);
			initBitModels(this._isRepDecoders, 12);
			initBitModels(this._isRepG0Decoders, 12);
			initBitModels(this._isRepG1Decoders, 12);
			initBitModels(this._isRepG2Decoders, 12);
			initBitModels(this._posDecoders, 114);
			this._literalDecoder.init();
			for (const decoder of this._posSlotDecoder)
				decoder.init();
			this._lenDecoder.init();
			this._repLenDecoder.init();
			this._posAlignDecoder.init();
		}
		if (resetDictionary) {
			this._outWindow.init(false);
			this._nowPos64 = 0;
			this._prevByte = 0;
		}
		this._rangeDecoder.init();
	}

	decode(inStream: InStream, outStream: OutStream, outSize: number, resetState = true, resetDictionary = true): boolean {
		let state = this._state;
		let rep0 = this._rep0;
		let rep1 = this._rep1;
		let rep2 = this._rep2;
		let rep3 = this._rep3;
		let nowPos64 = this._nowPos64;
		let prevByte = this._prevByte;

		if (resetState) {
			state = 0;
			rep0 = 0;
			rep1 = 0;
			rep2 = 0;
			rep3 = 0;
		}

		this._rangeDecoder.setStream(inStream);
		this._outWindow.setStream(outStream);
		this.init(resetState, resetDictionary);

		while (outSize < 0 || nowPos64 < outSize) {
			const posState = nowPos64 & this._posStateMask;

			if (this._rangeDecoder.decodeBit(this._isMatchDecoders, (state << 4) + posState) === 0) {
				const decoder2 = this._literalDecoder.getDecoder(nowPos64++, prevByte);
				prevByte = state >= 7
					? decoder2.decodeWithMatchByte(this._rangeDecoder, this._outWindow.getByte(rep0))
					: decoder2.decodeNormal(this._rangeDecoder);
				this._outWindow.putByte(prevByte);
				state = state < 4 ? 0 : state - (state < 10 ? 3 : 6);
			} else {
				let len = 0;
				let distance = 0;

				if (this._rangeDecoder.decodeBit(this._isRepDecoders, state) === 1) {
					if (this._rangeDecoder.decodeBit(this._isRepG0Decoders, state) === 0) {
						if (this._rangeDecoder.decodeBit(this._isRep0LongDecoders, (state << 4) + posState) === 0) {
							state = state < 7 ? 9 : 11;
							len = 1;
						}
					} else {
						if (this._rangeDecoder.decodeBit(this._isRepG1Decoders, state) === 0) {
							distance = rep1;
						} else {
							if (this._rangeDecoder.decodeBit(this._isRepG2Decoders, state) === 0) {
								distance = rep2;
							} else {
								distance = rep3;
								rep3 = rep2;
							}
							rep2 = rep1;
						}
						rep1 = rep0;
						rep0 = distance;
					}
					if (len === 0) {
						len = 2 + this._repLenDecoder.decode(this._rangeDecoder, posState);
						state = state < 7 ? 8 : 11;
					}
				} else {
					rep3 = rep2;
					rep2 = rep1;
					rep1 = rep0;
					len = 2 + this._lenDecoder.decode(this._rangeDecoder, posState);
					state = state < 7 ? 7 : 10;

					const posSlot = this._posSlotDecoder[len <= 5 ? len - 2 : 3].decode(this._rangeDecoder);
					if (posSlot >= 4) {
						const numDirectBits = (posSlot >> 1) - 1;
						rep0 = (2 | (posSlot & 1)) << numDirectBits;

						if (posSlot < 14) {
							rep0 += reverseDecode2(this._posDecoders, rep0 - posSlot - 1, this._rangeDecoder, numDirectBits);
						} else {
							rep0 += this._rangeDecoder.decodeDirectBits(numDirectBits - 4) << 4;
							rep0 += this._posAlignDecoder.reverseDecode(this._rangeDecoder);
							if (rep0 < 0) {
								if (rep0 === -1)
									break;
								return false;
							}
						}
					} else {
						rep0 = posSlot;
					}
				}

				if (rep0 >= nowPos64 || rep0 >= this._dictionarySizeCheck)
					return false;

				this._outWindow.copyBlock(rep0, len);
				nowPos64 += len;
				prevByte = this._outWindow.getByte(0);
			}
		}

		this._state = state;
		this._rep0 = rep0;
		this._rep1 = rep1;
		this._rep2 = rep2;
		this._rep3 = rep3;
		this._nowPos64 = nowPos64;
		this._prevByte = prevByte;
		this._outWindow.flush();
		this._outWindow.releaseStream();
		this._rangeDecoder.releaseStream();
		return true;
	}
}

//API
export class BufferReader implements InStream {
	private pos = 0;

	constructor(private bytes: Uint8Array) {}
	get remaining(): number {
		return this.bytes.length - this.pos;
	}
	readByte(): number {
		if (this.pos >= this.bytes.length)
			throw new Error('Unexpected end of input');
		return this.bytes[this.pos++];
	}
}

export class BufferWriter implements OutStream {
	private bytes: number[] = [];

	writeByte(b: number): void {
		this.bytes.push(b & 0xff);
	}
	toBytes(): Uint8Array {
		return Uint8Array.from(this.bytes);
	}
}

export function decompress(properties: Uint8Array, input: Uint8Array, outSize: number) {
	const decoder = new Decoder();

	const value = properties[0];
	if (!decoder.setLcLpPb(value % 9, Math.floor(value / 9) % 5, Math.floor(value / 45)))
		throw new Error('Incorrect LZMA properties');

	let dictionarySize = properties[1];
	dictionarySize |= properties[2] << 8;
	dictionarySize |= properties[3] << 16;
	dictionarySize += properties[4] * 16777216;

	if (!decoder.setDictionarySize(dictionarySize))
		throw new Error('Incorrect dictionary Size');

	const writer = new BufferWriter();
	if (!decoder.decode(new BufferReader(input), writer, outSize))
		throw new Error('Error in data stream');
	return writer.toBytes();
}

export function decompress2(properties: Uint8Array, inStream: InStream): Uint8Array {
	const decoder = new Decoder();

	const prop = properties[0];
	if ((prop & 0xc0) !== 0 || prop > 40)
		throw new Error('Incorrect LZMA2 properties');

	if (!decoder.setDictionarySize(prop === 40 ? 0xffffffff : (2 | (prop & 1)) << (Math.floor(prop / 2) + 11)))
		throw new Error('Incorrect LZMA2 properties');

	let needProperties = true;
	let needDictionaryReset = true;
	let outputSize = 0;
	const writer = new BufferWriter();

	for (;;) {
		const control = inStream.readByte();
		if (control === 0)
			break;

		if (control >= 0xe0 || control === 1) {
			needProperties = true;
			needDictionaryReset = true;
		} else if (needDictionaryReset) {
			throw new Error('Error in data stream');
		}

		if (control >= 0x80) {
			let uncompressedSize = (control & 0x1f) << 16;
			uncompressedSize += inStream.readByte() << 8;
			uncompressedSize += inStream.readByte() + 1;

			const compressedSize = (inStream.readByte() << 8) + inStream.readByte() + 1;

			if (control >= 0xc0) {
				if (!decoder.setPropertiesByte(inStream.readByte()))
					throw new Error('Incorrect LZMA2 properties');
				needProperties = false;
			} else if (needProperties) {
				throw new Error('Error in data stream');
			}

			if (control >= 0xe0)
				outputSize = 0;

			const chunkBytes = new Uint8Array(compressedSize);
			for (let i = 0; i < compressedSize; i++)
				chunkBytes[i] = inStream.readByte();
			const chunkInput = new BufferReader(chunkBytes);
			if (!decoder.decode(chunkInput, writer, outputSize + uncompressedSize, control >= 0xa0, control >= 0xe0))
				throw new Error('Error in data stream');
			if (chunkInput.remaining !== 0)
				throw new Error('Error in data stream');
			outputSize = control >= 0xe0 ? uncompressedSize : outputSize + uncompressedSize;
			needDictionaryReset = false;
			continue;
		}

		if (control > 2)
			throw new Error('Error in data stream');

		const size = (inStream.readByte() << 8) + inStream.readByte() + 1;
		const chunkBytes = new Uint8Array(size);
		for (let i = 0; i < size; i++)
			chunkBytes[i] = inStream.readByte();
		decoder.appendUncompressed(writer, chunkBytes, control === 1);
		if (control === 1)
			outputSize = 0;
		outputSize = control === 1 ? size : outputSize + size;
		needDictionaryReset = false;
	}

	return writer.toBytes();
}
