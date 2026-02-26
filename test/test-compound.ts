import { Reader, DirEntry } from 'src/CompoundDocument';

import https from 'https';

function dumpDirectory(r: Reader, dir: DirEntry, indent: number) {
	for (const entry of r.list(dir)) {
		console.log(' '.repeat(indent) + entry.name);
		if (entry.is_directory())
			dumpDirectory(r, entry, indent + 2);
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


(async () => {

	const reader = Reader.create();
	await reader.flush('test-compound.doc');
	console.log('File written successfully');

	const reader1 = await Reader.load('test-compound.doc');


	// List of OLE test files from oletools
	const files = await listGithubFiles('https://api.github.com/repos/decalage2/oletools/contents/tests/test-data');
	for (const file of files) {
		const url = file.download_url;
		try {
			const data = await downloadFile(url);
			const reader = await Reader.loadBuffer(data);
			if (reader) {
				console.log(`\n=== Directory tree for ${file.name} ===`);
				dumpDirectory(reader, reader.root, 0);
			} else {
				console.log(`\nCould not parse ${file.name} as a compound document.`);
			}
		} catch (e) {
			console.log(`\nFailed to process ${file.name}:`, e);
		}
	}

	const reader0 = await Reader.load('C:\\Program Files (x86)\\Windows Kits\\10\\Debuggers\\arm\\adplus.doc');
	if (reader0)
		dumpDirectory(reader0, reader0.root, 0);


})().catch(err => {
	console.error('Error:', err);
	process.exit(1);
});
