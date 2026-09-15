"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const CompoundDocument_1 = require("../dist/CompoundDocument");
const ole = __importStar(require("../dist/ole"));
const bin = __importStar(require("@isopodlabs/binary"));
const fs_1 = require("fs");
const https_1 = __importDefault(require("https"));
function dumpDirectory(dir, indent) {
    for (const entry of dir.entries()) {
        console.log(' '.repeat(indent) + entry.name);
        if (entry.is(CompoundDocument_1.TYPE.Property))
            console.log(' '.repeat(indent + 2) + `property!`);
        if (entry.is_directory())
            dumpDirectory(entry, indent + 2);
    }
}
async function listGithubFiles(apiUrl) {
    return new Promise((resolve, reject) => {
        https_1.default
            .get(apiUrl, { headers: { 'User-Agent': 'node' } }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', async () => {
                try {
                    const files = JSON.parse(data);
                    if (!Array.isArray(files))
                        return reject(new Error('Unexpected API response: ' + data));
                    const subs = await Promise.all(files.filter((f) => f.type === 'dir').map((dir) => listGithubFiles(dir.url)));
                    resolve([...subs.flat(), ...files.filter((f) => f.type === 'file')]);
                }
                catch (e) {
                    reject(e);
                }
            });
        })
            .on('error', reject);
    });
}
function downloadFile(url) {
    return new Promise((resolve, reject) => https_1.default.get(url, response => {
        if (response.statusCode !== 200)
            return reject(new Error('Failed to download: ' + url));
        const data = [];
        response.on('data', chunk => data.push(chunk));
        response.on('end', async () => { resolve(Buffer.concat(data)); });
    })
        .on('error', reject));
}
function print(x, depth = 0) {
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
async function summary(x) {
    if (x?.is_data()) {
        const data = await x.read();
        const summary = bin.read(new bin.stream(data), ole.PropertySetStream);
        const text = print(summary);
        console.log(text);
    }
}
class FileBacking {
    fd;
    constructor(filename) {
        this.fd = fs_1.promises.open(filename, fs_1.promises.constants.O_RDWR | fs_1.promises.constants.O_CREAT);
    }
    async readAt(offset, size) {
        const data = new Uint8Array(size);
        const fd = await this.fd;
        const _read = await fd.read(data, 0, size, offset);
        return data;
    }
    async writeAt(offset, data) {
        const fd = await this.fd;
        await fd.write(data, 0, data.length, offset);
    }
    async close() {
        const fd = await this.fd;
        await fd.close();
    }
}
function BufferBacking(buffer) {
    return {
        readAt: async (offset, size) => { return offset + size <= buffer.length ? buffer.subarray(offset, offset + size) : new Uint8Array(size); },
        writeAt: async (offset, data) => { buffer.set(data, offset); }
    };
}
(async () => {
    const reader0 = await CompoundDocument_1.Reader.load(new FileBacking('D:\\dev\\shared\\.vs\\shared\\v17\\.suo'));
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
    const reader = await CompoundDocument_1.Reader.load(new FileBacking('test-compound.doc'));
    let configStream = reader.find("SolutionConfiguration");
    if (!configStream) {
        await reader.root.addStream("SolutionConfiguration", new Uint8Array([1, 2, 3, 4]));
        configStream = reader.find("SolutionConfiguration");
        console.log('Created stream:', configStream?.name);
        //
    }
    else {
        //if (configStream?.is_data()) {
        //	const data = await configStream?.read();
        //	console.log('Read data:', data);
        //}
    }
    await reader.flush();
    console.log('File written successfully');
    //	const reader1 = await fs.readFile('test-compound.doc').then(bytes => Reader.loadBuffer(bytes));
    const reader1 = await CompoundDocument_1.Reader.load(BufferBacking(await fs_1.promises.readFile('test-compound.doc')));
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
            const reader = await CompoundDocument_1.Reader.load(BufferBacking(data));
            if (reader) {
                console.log(`\n=== Directory tree for ${file.name} ===`);
                dumpDirectory(reader.root, 0);
                await summary(reader.find("\x05SummaryInformation"));
                await summary(reader.find("\x05DocumentSummaryInformation"));
            }
            else {
                console.log(`\nCould not parse ${file.name} as a compound document.`);
            }
        }
        catch (e) {
            console.log(`\nFailed to process ${file.name}:`, e);
        }
    }
})().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
//# sourceMappingURL=test-compound.js.map