import * as assert from 'assert';
import * as path from 'path';
import { promises as fs } from 'fs';
import {bitmap} from '../dist/index';

async function testJPEG() {
	const jpegData = await fs.readFile(path.join(__dirname, 'test.jpg'));
	const jpeg = bitmap.loadJPEG(new Uint8Array(jpegData));

	assert.ok(jpeg.width > 0);
	assert.ok(jpeg.height > 0);
	assert.equal(jpeg.pixels.length, jpeg.width * jpeg.height * 3);
	assert.ok(jpeg.pixels.every(i => Number.isFinite(i) && i >= 0 && i <= 255));

	console.log(`JPEG decode ok (test.jpg: ${jpeg.width}x${jpeg.height})`);
}
testJPEG();
/*
// Test with real controller.gif
async function testGIF() {
	const gif = Uint8Array.from([
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
		0x01, 0x00, 0x01, 0x00,
		0x80, 0x00, 0x00,
		0x00, 0x00, 0x00,
		0xFF, 0xFF, 0xFF,
		0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
		0x2C,
		0x00, 0x00, 0x00, 0x00,
		0x01, 0x00, 0x01, 0x00,
		0x00,
		0x02,
		0x02, 0x44, 0x01,
		0x00,
		0x3B,
	]);

	const decoded = bitmap.loadGIF(gif);
	const frames = decoded.blocks.filter(i => i.token === 0x2C);
	const frame = frames[0];

	assert.equal(decoded.width, 1);
	assert.equal(decoded.height, 1);
	assert.equal(frames.length, 1);
	assert.equal(frame.lzwMinCodeSize, 2);
	assert.deepEqual(Array.from(frame.indices), [0]);
	assert.equal(decoded.globalPalette?.length, 6);

	console.log('GIF decode ok');
	try {
		const controllerData = await fs.readFile('E:\\samples\\XboxOne\\system\\HelpTester\\HelpTester\\images\\controller.gif');
		const controller = bitmap.loadGIF(new Uint8Array(controllerData));
		const ctrlFrames = controller.blocks.filter(i => i.token === 0x2C) as any[];
		
		console.log(`  Loaded controller.gif: ${controller.width}x${controller.height}, ${ctrlFrames.length} frame(s)`);
		
		if (controller.width <= 0)
			throw new Error(`controller.gif width should be > 0, got ${controller.width}`);
		if (controller.height <= 0)
			throw new Error(`controller.gif height should be > 0, got ${controller.height}`);
		if (ctrlFrames.length <= 0)
			throw new Error(`controller.gif should have at least 1 frame, got ${ctrlFrames.length}`);
		
		for (let i = 0; i < ctrlFrames.length; i++) {
			const frame = ctrlFrames[i];
			const framePixels = frame.width * frame.height;
			if (frame.indices.length !== framePixels)
				throw new Error(`frame ${i} indices length mismatch: ${frame.indices.length} !== ${framePixels}`);
			if (!frame.indices.every((i:number) => typeof i === 'number'))
				throw new Error(`frame ${i}: all indices should be numbers`);
		}
		
		console.log(`controller.gif decode ok (animated GIF with ${ctrlFrames.length} frames)`);
	} catch (e) {
		console.error(`controller.gif test: ${(e as Error).message}`);
	}
}
testGIF();
*/