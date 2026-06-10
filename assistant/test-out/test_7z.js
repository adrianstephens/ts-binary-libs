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
Object.defineProperty(exports, "__esModule", { value: true });
const bin = __importStar(require("@isopodlabs/binary"));
const index_1 = require("../dist/index");
const assert_1 = require("assert");
process.on('unhandledRejection', error => console.error('unhandledRejection', error));
process.on('uncaughtException', error => console.error('uncaughtException', error));
function encodeUtf16Null(value) {
    const bytes = [];
    for (const char of value) {
        const code = char.charCodeAt(0);
        bytes.push(code & 0xff, code >>> 8);
    }
    bytes.push(0, 0);
    return bytes;
}
function concat(parts) {
    return new Uint8Array(parts.flat());
}
function buildFixture() {
    const bcjPacked = [0xe8, 0x05, 0x00, 0x00, 0x00, 0xc3];
    const bcjExpected = [0xe8, 0x00, 0x00, 0x00, 0x00, 0xc3];
    const bcj2Main = Array.from(new TextEncoder().encode('plain-text'));
    const bcj2Rc = [0, 0, 0, 0, 0];
    const packed = concat([
        bcjPacked,
        bcj2Main,
        [],
        [],
        bcj2Rc,
    ]);
    const packInfo = [
        0x06,
        0x00,
        0x05,
        0x09,
        bcjPacked.length,
        bcj2Main.length,
        0x00,
        0x00,
        bcj2Rc.length,
        0x00,
    ];
    const folderBcj = [
        0x01,
        0x04,
        0x03, 0x03, 0x01, 0x03,
    ];
    const folderBcj2 = [
        0x01,
        0x14,
        0x03, 0x03, 0x01, 0x1b,
        0x04,
        0x01,
        0x00,
        0x01,
        0x02,
        0x03,
    ];
    const codersInfo = [
        0x07,
        0x0b,
        0x02,
        0x00,
        ...folderBcj,
        ...folderBcj2,
        0x0c,
        bcjExpected.length,
        bcj2Main.length,
        0x00,
    ];
    const streamsInfo = [
        0x04,
        ...packInfo,
        ...codersInfo,
        0x00,
    ];
    const names = [
        0x00,
        ...encodeUtf16Null('bcj.bin'),
        ...encodeUtf16Null('bcj2.txt'),
    ];
    const filesInfo = [
        0x05,
        0x02,
        0x11,
        names.length,
        ...names,
        0x00,
    ];
    const header = [
        0x01,
        ...streamsInfo,
        ...filesInfo,
        0x00,
        0x00,
    ];
    const archive = new Uint8Array(32 + packed.length + header.length);
    archive.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0x00, 0x04]);
    archive[12] = packed.length;
    archive[20] = header.length;
    archive.set(packed, 32);
    archive.set(header, 32 + packed.length);
    return {
        archive,
        bcjExpected: new Uint8Array(bcjExpected),
        bcj2Expected: new TextEncoder().encode('plain-text'),
    };
}
(async () => {
    const fixture = buildFixture();
    const doc = new index_1.sevenZ.Document(new bin.stream(fixture.archive));
    await doc.ready;
    assert_1.strict.equal(doc.entries.length, 2);
    assert_1.strict.deepEqual(await doc.entries[0].extract(), fixture.bcjExpected);
    assert_1.strict.deepEqual(await doc.entries[1].extract(), fixture.bcj2Expected);
    console.log('7z test passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=test_7z.js.map