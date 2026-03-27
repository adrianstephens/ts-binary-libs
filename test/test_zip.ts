import * as bin from '@isopodlabs/binary';
import * as zip from '../dist/zip';
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
	{//async test
		await using fileIn = await openReadFile(path.join(__dirname, 'test.zip'));
		const zipFile = new zip.ZIPreaderCD(fileIn);
		await zipFile.ready;
		console.log(`got ${zipFile.entries.length}`);
	}
	{
		const data = await fs.readFile(path.join(__dirname, 'test.zip'));
		const fileIn = new bin.stream(data);
		const zipFile = new zip.ZIPreaderCD(fileIn);
		await zipFile.ready;
		console.log(`got ${zipFile.entries.length}`);
	}
	/*
	{
		const fileIn = new bin.stream(await fs.readFile('D:\\dev\\ActionFace\\AF_Batch\\AF_Figs.zip'));
		const zipFile = new zip.ZIPreaderCD(fileIn);
		const zf4 = zipFile.find("AF_Figs/textures/Baseball_Boy_Generic_Low.jpg");
		if (zf4) {
			const data = await zf4.extract(fileIn);
			console.log(`extracted ${data?.length} bytes`);
		}
	}
	{
		const fileIn = new bin.stream(await fs.readFile('D:\\dev\\ActionFace\\AF_Batch\\AF_Figs.zip'));
		const zipFile = new zip.ZIPreader(fileIn);
		for await(const i of zipFile)
			console.log(i.filename);
	}
	{
		const file = new bin.stream(await fs.readFile('C:\\ProgramData\\IDrive.zip'));
		const time = Date.now();
		const zipFile = new zip.ZIPreaderCD(file);
		const duration = Date.now() - time;
		console.log(`got ${zipFile.entries.length} in ${duration}ms`);
	}
	{
		await using file = await openReadFile('C:\\ProgramData\\IDrive.zip');
		const time = Date.now();
		const zipFile = new zip.ZIPreaderCD(file);
		await zipFile.ready;
		const duration = Date.now() - time;
		console.log(`got ${zipFile.entries.length} in ${duration}ms`);
		for (const zf of zipFile) {
			console.log(zf.filename);
			const data = await zf.extract(file);
			if (data) {
				console.log(`  compressed: ${zf.compressed_size} bytes`);
				console.log(`  uncompressed: ${data.length} bytes`);
				zf.check(data);
			} else {
				console.log('  no data');
			}
		}
	}
	{
		await using fileIn = await openReadFile('D:\\dev\\ActionFace\\AF_Batch\\AF_Figs.zip');
		await using fileOut = await openWriteFile('D:\\dev\\ActionFace\\AF_Batch\\AF_Figs2.zip');
		using fileOutSync = new bin.growingStream();

		const zipIn			= new zip.ZIPreaderCD(fileIn);
		const zipOut		= new zip.ZIPwriter(fileOut);
		const zipOutSync	= new zip.ZIPwriter(fileOutSync);
		await zipIn.ready;

		const zf0 = zipIn.find("AF_Figs/textures/Baseball_Boy_Generic_Low.jpg");
		const data0 = await zf0?.extract(fileIn);

		console.log(`got ${zipIn.entries.length}`);
		for (const zf of zipIn) {
			console.log(zf.filename);
			const data = await zf.extract(fileIn);
			if (data) {
				console.log(`  compressed: ${zf.compressed_size} bytes`);
				console.log(`  uncompressed: ${data.length} bytes`);
				zf.check(data);
				const zf2 = await zipOut.write(zf.filename, data, zf.method);
				const _zf3 = await zipOutSync.write(zf.filename, data, zf.method);
				console.log(`  recompressed: ${zf2?.compressed_size} bytes`);
			} else {
				console.log('  no data');
			}
		}
		await zipOut.writeCD();
		await zipOutSync.writeCD();

		const _dataSync = fileOutSync.terminate();


		{
			await using file3 = await openReadFile('D:\\dev\\ActionFace\\AF_Batch\\AF_Figs2.zip');
			const zipFile3	= new zip.ZIPreaderCD(file3);
			await zipFile3.ready;
			const zf = zipFile3.find("AF_Figs/textures/Baseball_Boy_Generic_Low.jpg");
			if (zf) {
				const data = await zf.extract(file3);
				console.log(`extracted ${data?.length} bytes`);
				if (data0 && data)
					console.log(`data matches: ${data0.length === data?.length && data0.every((v, i) => v === data[i])}`);
			}
		}
	}
	*/
})();