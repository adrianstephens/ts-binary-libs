import * as bin from '@isopodlabs/binary';
import {tar} from '../dist/index';
import * as path from 'path';
import { promises as fs } from 'fs';

process.on('unhandledRejection', error => console.error('unhandledRejection', error));
process.on('uncaughtException', error => console.error('uncaughtException', error));

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
async function openWriteFile(filename: string) {
	const fd	= await fs.open(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC);

	return new bin.async.stream(
		async (_offset, _data) => 0,
		async (offset, data) => {fd.write(data, 0, data.length, offset);},
		_s => fd.close(),
	);
}

(async () => {
	{
		const data = await fs.readFile('E:\\dev\\WEVR\\depot\\swdev\\wb\\wb_vs2017\\WemoExternal\\tmp\\Cellar.tar');
		const fileIn = new bin.stream(data);
		const tarFile = new tar.Document(fileIn);
		console.log(`got ${tarFile.entries.length}`);
	}
//	{//async test
//		await using fileIn = await openReadFile('E:\\Assets\\3d models\\lucy.tar');
//		const tarFile = new tar.Document(fileIn);
//		console.log(`got ${tarFile.entries.length}`);
//	}
})().catch(e => 
	console.error(e)
);