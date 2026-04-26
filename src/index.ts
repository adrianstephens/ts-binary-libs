/// <reference types="node" />

import * as zlib from 'zlib';
import * as bin from '@isopodlabs/binary';

export * from './common';
export * as zip from './zip';
export * as tar from './tar';

bin.configureDecompression('deflate', buffer => new Promise((resolve, reject) => {
	zlib.inflate(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureDecompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.inflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureDecompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gunzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureCompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.deflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

bin.configureCompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));
