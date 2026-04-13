/// <reference types="node" />

import * as zlib from 'zlib';
import { configureCompression, configureDecompression} from './common';
export * from './common';
export * as zip from './zip';
export * as bitmap from './bitmap';
export * as tar from './tar';

configureDecompression('deflate', buffer => new Promise((resolve, reject) => {
	zlib.inflate(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureDecompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.inflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureDecompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gunzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureCompression('deflate-raw', buffer => new Promise((resolve, reject) => {
	zlib.deflateRaw(buffer, (err, result) => err ? reject(err) : resolve(result));
}));

configureCompression('gzip', buffer => new Promise((resolve, reject) => {
	zlib.gzip(buffer, (err, result) => err ? reject(err) : resolve(result));
}));
