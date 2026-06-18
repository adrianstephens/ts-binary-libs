/// <reference types="node" />

import * as zlib from 'zlib';
import * as bz2 from './bz2';
import * as xz from './xz';
import * as bin from '@isopodlabs/binary';

export * from './common';
export * as zip from './zip';
export * as tar from './tar';
export * as sevenZ from './7z';
export * as gguf from './gguf';

bin.configureDecompression('deflate', buffer => new Promise((resolve, reject) => {
	zlib.inflate(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureDecompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.inflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureDecompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gunzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureDecompression('bzip2', buffer => new Promise((resolve, reject) => {
	try {
		resolve(bz2.decompress(buffer));
	} catch (err) {
		reject(err);
	}
}));

bin.configureDecompression('xz', buffer => new Promise((resolve, reject) => {
	try {
		resolve(new xz.XZ(buffer).data());
	} catch (err) {
		reject(err);
	}
}));

bin.configureCompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.deflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureCompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));
