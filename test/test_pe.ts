import * as pe from '../dist/pe';
import * as path from 'path';
import { promises as fs } from 'fs';

(async () => {
	const data = await fs.readFile(path.join(__dirname, 'isotouch.exe'));
	const peFile = new pe.PE(data);
	const dirs = peFile.directories2;
	console.log(peFile);
})();