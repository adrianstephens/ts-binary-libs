import { Directory, Reader, DirEntry, Backing, TYPE } from '../dist/CompoundDocument';
import * as ole from '../dist/ole';
import * as bin from '@isopodlabs/binary';
import { promises as fs } from 'fs';
import https from 'https';

function dumpDirectory(dir: Directory, indent: number) {
	for (const entry of dir.entries()) {
		console.log(' '.repeat(indent) + entry.name);
		if (entry.is(TYPE.Property))
			console.log(' '.repeat(indent + 2) + `property!`);
		if (entry.is_directory())
			dumpDirectory(entry, indent + 2);
	}
}

async function listGithubFiles(apiUrl: string): Promise<{name: string, download_url: string}[]> {
	return new Promise((resolve, reject) => {
		https
			.get(apiUrl, {headers: {'User-Agent': 'node'}},
				 res => {
					 let data = '';
					 res.on('data', chunk => data += chunk);
					 res.on('end', async () => {
						 try {
							 const files = JSON.parse(data);
							 if (!Array.isArray(files))
								 return reject(new Error('Unexpected API response: ' + data));
							 const subs = await Promise.all(files.filter((f: any) => f.type === 'dir').map((dir: any) => listGithubFiles(dir.url)));
							 resolve([...subs.flat(), ...files.filter((f: any) => f.type === 'file')]);
						 } catch (e) {
							 reject(e);
						 }
					 });
				 })
			.on('error', reject);
	});
}

function downloadFile(url: string) {
	return new Promise<Buffer>((resolve, reject) => https.get(url,
		response => {
			if (response.statusCode !== 200)
				return reject(new Error('Failed to download: ' + url));
			const data: Buffer[] = [];
			response.on('data', chunk => data.push(chunk));
			response.on('end', async () => { resolve(Buffer.concat(data)); });
		})
		.on('error', reject)
	);
}

function print(x: any, depth = 0) : string {
	if (x === undefined)
		return 'undefined';

	if (typeof x === 'object') {
		if (Array.isArray(x))
			return x.map(i => print(i, depth + 1)).join(', ');

		if (x.toString !== Object.prototype.toString)
			return x.toString();

		return Object.entries(x).map(([k, v]) => v !== undefined && `${' '.repeat(depth * 2)}${k}: ${print(v, depth + 1)}`).filter(Boolean).join('\n');
	}
	return x.toString();
}

async function summary(x?: DirEntry) {
	if (x?.is_data()) {
		const data = await x.read();
		const summary = bin.read(new bin.stream(data), ole.PropertySetStream);
		const text = print(summary);
		console.log(text);
	}
}

class FileBacking implements Backing {
	private fd;

	constructor(filename: string) {
		this.fd = fs.open(filename, fs.constants.O_RDWR | fs.constants.O_CREAT);
	}
	async readAt(offset: number, size: number) {
		const data = new Uint8Array(size);
		const fd = await this.fd;
		const _read = await fd.read(data, 0, size, offset);
		return data;
	}
	async writeAt(offset: number, data: Uint8Array) {
		const fd = await this.fd;
		await fd.write(data, 0, data.length, offset);
	}

	async close() {
		const fd = await this.fd;
		await fd.close();
	}
}

function BufferBacking(buffer: Uint8Array): Backing {
	return {
		readAt:		async (offset, size) => { return offset + size <= buffer.length ? buffer.subarray(offset, offset + size) : new Uint8Array(size); },
		writeAt:	async (offset, data) => { buffer.set(data, offset); }
	};
}

(async () => {
	const reader0 = await Reader.load(new FileBacking('D:\\dev\\shared\\.vs\\shared\\v17\\.suo'));
	dumpDirectory(reader0.root, 0);
	const configStream0 = reader0.find("SolutionConfiguration");
	if (configStream0?.is_data()) {
		const data = await configStream0.read();
		console.log('Read data:', data);
	}
	const sourceStream0 = reader0.find("DebuggerFindSource");
	if (sourceStream0?.is_data()) {
		const data = await sourceStream0.read();
		console.log('Read data:', data);
	}

	const reader = await Reader.load(new FileBacking('test-compound.doc'));
	let configStream = reader.find("SolutionConfiguration");
	if (!configStream) {
		await reader.root.addStream("SolutionConfiguration", new Uint8Array([1, 2, 3, 4]));
		configStream = reader.find("SolutionConfiguration");
		console.log('Created stream:', configStream?.name);
		//
	} else {
		//if (configStream?.is_data()) {
		//	const data = await configStream?.read();
		//	console.log('Read data:', data);
		//}
	}
	await reader.flush();
	console.log('File written successfully');

//	const reader1 = await fs.readFile('test-compound.doc').then(bytes => Reader.loadBuffer(bytes));
	const reader1 = await Reader.load(BufferBacking(await fs.readFile('test-compound.doc')));
	if (reader1) {
		const configStream1 = reader1.find("SolutionConfiguration");
		if (configStream1?.is_data()) {
			const data = await configStream1?.read();
			console.log('Read data:', data);
		}
	}

	// List of OLE test files from oletools
	const files = await listGithubFiles('https://api.github.com/repos/decalage2/oletools/contents/tests/test-data');
	for (const file of files) {
		const url = file.download_url;
		try {
			const data = await downloadFile(url);
			const reader = await Reader.load(BufferBacking(data));
			if (reader) {
				console.log(`\n=== Directory tree for ${file.name} ===`);
				dumpDirectory(reader.root, 0);

				await summary(reader.find("\x05SummaryInformation"));
				await summary(reader.find("\x05DocumentSummaryInformation"));

			} else {
				console.log(`\nCould not parse ${file.name} as a compound document.`);
			}
		} catch (e) {
			console.log(`\nFailed to process ${file.name}:`, e);
		}
	}

})().catch(err => {
	console.error('Error:', err);
	process.exit(1);
});
