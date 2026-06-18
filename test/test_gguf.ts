import * as bin from '@isopodlabs/binary';
import {gguf} from '../dist/index';
import {readOnnxModel} from '../dist/onnx';
import * as path from 'path';
import { promises as fs } from 'fs';

async function openReadFile(filename: string) {
	const fd	= await fs.open(filename, fs.constants.O_RDONLY);
	const stat	= await fs.stat(filename);

	return new bin.async.stream(
		(offset, data) => fd.read(data, 0, data.length, offset).then(r => r.bytesRead),
		undefined,
		_s => fd.close(),
		stat.size
	);
}

const fnonnx = '/Users/adrianstephens/Downloads/adv_inception_v3_Opset16.onnx';
//const fn = '/Volumes/threadripper/Users/adrian/.ollama/models/blobs/sha256-f5ee307a2982106a6eb82b62b2c00b575c9072145a759ae4660378acda8dcf2d';
const fn = '/Volumes/DevSSD/sha256-f5ee307a2982106a6eb82b62b2c00b575c9072145a759ae4660378acda8dcf2d';

(async () => {
	const data = await fs.readFile(fnonnx);
	const x = readOnnxModel(data);
	console.log(x);


	const stream = await openReadFile(fn);
//	const data = await stream.view_at(Uint8Array, 0x59284cd00, 1024);
//	const stream2 = new bin.stream(data);
//	const gg = await gguf.readGguf(stream2);
	const gg = await gguf.readGguf(stream);

	const tensor = gg.tensors.at(-1)!;//[1];
	for (let i = 0; i < tensor.parameterCount(); i++) {
		const v = await tensor.lookup(i);
		console.log(i, v);
	}
	const f = await gg.tensors[0].lookup(0);
	console.log(gg);
})();