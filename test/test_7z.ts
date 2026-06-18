import * as bin from '@isopodlabs/binary';
import {sevenZ} from '../dist/index.js';
import { strict as assert } from 'assert';

process.on('unhandledRejection', error => console.error('unhandledRejection', error));
process.on('uncaughtException', error => console.error('uncaughtException', error));

function encodeUtf16Null(value: string) {
	const bytes: number[] = [];
	for (const char of value) {
		const code = char.charCodeAt(0);
		bytes.push(code & 0xff, code >>> 8);
	}
	bytes.push(0, 0);
	return bytes;
}

function concat(parts: number[][]) {
	return new Uint8Array(parts.flat());
}

function buildFixture() {
	const bcjPacked = [0xe8, 0x05, 0x00, 0x00, 0x00, 0xc3];
	const bcjExpected = [0xe8, 0x00, 0x00, 0x00, 0x00, 0xc3];
	const bcj2Main = Array.from(new TextEncoder().encode('plain-text'));
	const bcj2Rc = [0, 0, 0, 0, 0];

	// Test data for Swap2 and Swap4 filters
	const swap2Data = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
	const swap2Expected = [0x22, 0x11, 0x44, 0x33, 0x66, 0x55]; // bytes swapped in pairs
	
	const swap4Data = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
	const swap4Expected = [0x44, 0x33, 0x22, 0x11, 0x88, 0x77, 0x66, 0x55]; // bytes swapped in groups of 4

	const packed = concat([
		bcjPacked,
		bcj2Main,
		[],
		[],
		bcj2Rc,
		swap2Data,
		swap4Data,
	]);

	const packInfo = [
		0x00,	//pos
		0x07,	//num streams
		0x09,
			bcjPacked.length,
			bcj2Main.length,
			0x00,
			0x00,
			bcj2Rc.length,
			swap2Data.length, // additional packed stream for swap2
			swap4Data.length, // additional packed stream for swap4
		0x00
	];

	const folderBcj = [
		0x01,	//num coders
		0x04,
		0x03, 0x03, 0x01, 0x03,
	];
	const folderBcj2 = [
		0x01,
		0x14,
		0x03, 0x03, 0x01, 0x1b,
		0x04,
		0x01,
		0x00,
		0x01,
		0x02,
		0x03,
	];
	
	// Folder with Swap2 filter
	const folderSwap2 = [
		0x01,
		0x04,
		0x03, 0x03, 0x01, 0x02, // Swap2 filter ID
	];
	
	// Folder with Swap4 filter
	const folderSwap4 = [
		0x01,
		0x04,
		0x03, 0x03, 0x01, 0x04, // Swap4 filter ID
	];

	const codersInfo = [
		0x0b,	//folder
			0x04,	//num folders
			0x00,	//external
			...folderBcj,
			...folderBcj2,
			...folderSwap2,
			...folderSwap4,
		0x0c,	//CODERS_UNPACKSIZE
			bcjExpected.length,
			bcj2Main.length,
			swap2Data.length,
			swap4Data.length,
		0x00,
	];

	const streamsInfo = [
		0x06,	...packInfo,
		0x07,	...codersInfo,
		0x00,
	];

	const names = [
		0x00,	//external
		...encodeUtf16Null('bcj.bin'),
		...encodeUtf16Null('bcj2.txt'),
		...encodeUtf16Null('swap2.bin'),
		...encodeUtf16Null('swap4.bin'),
	];
	const filesInfo = [
		0x04, // 4 files
		0x19,	0x01, 0x00,	//dummy
		0x11,	names.length, ...names,
		0x00,
	];

	const header = [
		0x01,
			0x04, ...streamsInfo,
			0x05,	...filesInfo,
		0x00,
	];

	const archive = new Uint8Array(32 + packed.length + header.length);
	archive.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]);
	archive[12] = packed.length;
	archive[20] = header.length;
	archive.set(packed, 32);
	archive.set(header, 32 + packed.length);

	return {
		archive,
		bcjExpected: new Uint8Array(bcjExpected),
		bcj2Expected: new TextEncoder().encode('plain-text'),
		swap2Expected: new Uint8Array(swap2Expected),
		swap4Expected: new Uint8Array(swap4Expected),
	};
}

(async () => {
	const fixture = buildFixture();
	const doc = new sevenZ.Document(new bin.stream(fixture.archive));
	await doc.ready;
	assert.equal(doc.entries.length, 4);
	assert.deepEqual(await doc.entries[0].extract(), fixture.bcjExpected);
	assert.deepEqual(await doc.entries[1].extract(), fixture.bcj2Expected);
	// Verify Swap2 and Swap4 filters work
	assert.deepEqual(await doc.entries[2].extract(), fixture.swap2Expected);
	assert.deepEqual(await doc.entries[3].extract(), fixture.swap4Expected);
	console.log('7z test passed');

	const out = new bin.growingStream();
	doc.writeAll(out);
	const out1 = out.terminate();
	console.log(out1.length);

})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
