import * as bin from '@isopodlabs/binary';
import {RangeDecoder, BufferReader} from './lzma';

export function decodeDelta(props: Uint8Array, input: Uint8Array) {
	const distance	= (props[0] ?? 0) + 1;
	const output	= new Uint8Array(input.length);
	for (let i = 0; i < input.length; ++i)
		output[i] = i < distance ? input[i] : (input[i] + output[i - distance]) & 0xff;
	return output;
}

export function swap2(data: Uint8Array) {
	const out = data.slice();
	for (let i = 0; i < out.length - 1; i += 2)
		[out[i], out[i + 1]] = [out[i + 1], out[i]];
	return out;
}

export function swap4(data: Uint8Array) {
	const out = data.slice();
	for (let i = 0; i < out.length - 3; i += 4)
		[out[i], out[i + 1], out[i + 2], out[i + 3]] = [out[i + 3], out[i + 2], out[i + 1], out[i]];
	return out;
}

export function branchX86(data: Uint8Array, pc = 0) {
	const out	= data.slice();
	const dv	= new DataView(out.buffer, out.byteOffset, out.byteLength);
	for (let i = 0; i + 5 < out.length; i++) {
		if ((out[i] & 0xfe) === 0xe8 && (out[i + 4] === 0 || out[i + 4] === 0xff)) {
			dv.setUint32(i + 1, (dv.getUint32(i + 1, true) - (pc + i + 5)) >>> 0, true);
			i += 4;
		}
	}
	return out;
}

export function branchPPC(data: Uint8Array, pc = 0) {
	const out	= data.slice();
	const out4	= bin.typedArray.as(out, 'Uint32', true);
	for (let i = 0; i < out4.length; i++) {
		const instruction = out4[i];
		if ((instruction & 0xfc000003) === 0x48000001)
			out4[i] = (0x48000000 | ((instruction - (pc + i * 4)) & 0x03ffffff));
	}
	return out;
}

export function branchARM(data: Uint8Array, pc = 0) {
	const out	= data.slice();
	const out4	= bin.typedArray.as(out, 'Uint32', false);
	for (let i = 0; i < out4.length; i ++) {
		if ((out4[i] >>> 24) === 0xeb)
			out4[i] = ((out4[i] & 0xffffff) - ((pc + (i + 2) * 4) >>> 2)) | (0xeb << 24);
	}
	return out;
}

export function branchARMT(data: Uint8Array, pc = 0) {
	const out	= data.slice();
	for (let i = 0; i + 3 < out.length; i += 2) {
		if ((out[i + 1] & 0xf8) === 0xf0 && (out[i + 3] & 0xf8) === 0xf8) {
			const value = (((out[i + 1] & 0x7) << 19) | (out[i] << 11) | ((out[i + 3] & 0x7) << 8) | out[i + 2]) - ((pc + i + 4) >>> 1);
			out[i]		= (value >>> 11) & 0xff;
			out[i + 1]	= 0xf0 | ((value >>> 19) & 0x7);
			out[i + 2]	= value & 0xff;
			out[i + 3]	= 0xf8 | ((value >>> 8) & 0x7);
			i += 2;
		}
	}
	return out;
}

export function branchSPARC(data: Uint8Array, pc = 0) {
	const out	= data.slice();
	const out4	= bin.typedArray.as(out, 'Uint32', true);
	const pc4   = pc >>> 2;
	for (let i = 0; i < out4.length; i ++) {
		const instruction = out4[i];
		const tag = instruction >>> 22;
		if (tag === 0x100 || tag === 0x1ff)
			out4[i] = 0x40000000 | (instruction - (pc4 + i));
	}
	return out;
}

export function decodeBCJ2(inputs: Uint8Array[]) {
	if (inputs.length !== 4)
		throw new Error(`Invalid BCJ2 stream count: expected 4, got ${inputs.length}`);

	const main		= inputs[0];
	const call		= bin.typedArray.as(inputs[1], 'Uint32', true);
	const jump		= bin.typedArray.as(inputs[2], 'Uint32', true);
	const probs		= new Array<number>((0x100 + 2) * 2).fill(1024);
	const rc		= new RangeDecoder();
	rc.setStream(new BufferReader(inputs[3]));
	rc.init();

	let mainPos		= 0;
	let callPos		= 0;
	let jumpPos		= 0;
	let value		= 0;
	const out: number[] = [];

	while (mainPos < main.length) {
		const byte = main[mainPos++];
		out.push(byte & 0xff);
		value = ((value << 8) | byte) >>> 0;

		if ((byte !== 0xe8 && byte !== 0xe9) && (((value >>> 8) & 0xff) !== 0x0f || (byte & 0xf0) !== 0x80))
			continue;

		const c = ((byte + 0x17) >> 6) & 1;
		if (rc.decodeBit(probs, ((((0 - c) & (value >>> 24)) + c + ((value >>> 5) & 1)) & 0x1ff) >>> 0) !== 0) {
			const target = ((value + 0x57) >> 6) & 1 ? jump[jumpPos++] : call[callPos++];
			const branch = target - (out.length + 4);
			out.push(branch & 0xff, (branch >>> 8) & 0xff, (branch >>> 16) & 0xff, branch >>> 24);
			value = 0;
			for (let i = Math.max(0, out.length - 4); i < out.length; i++)
				value = ((value << 8) | out[i]) >>> 0;
		}
	}

	return new Uint8Array(out);
}
