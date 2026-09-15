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
const wasm = __importStar(require("../dist/wasm"));
let failures = 0;
// like assert.deepStrictEqual, but a missing property and a property explicitly set to
// `undefined` are equivalent, and '_' properties are ignored; returns a description of
// the first mismatch found, or null if the values are equal
function diff(a, b, path = '') {
    if (Object.is(a, b))
        return null;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b))
            return `${path || '<root>'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
        for (let i = 0; i < Math.max(a.length, b.length); ++i) {
            const d = diff(a[i], b[i], `${path}[${i}]`);
            if (d)
                return d;
        }
        return null;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ar = a, br = b;
        const keys = new Set([...Object.keys(ar), ...Object.keys(br)]);
        for (const k of keys) {
            if (k === '_')
                continue;
            const d = diff(ar[k], br[k], `${path}.${k}`);
            if (d)
                return d;
        }
        return null;
    }
    return `${path || '<root>'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`;
}
function check(name, actual, expected) {
    const d = diff(actual, expected);
    if (d) {
        ++failures;
        console.error(`FAIL - ${name}: ${d}`);
    }
    else {
        console.log(`ok - ${name}`);
    }
}
function run(mod) {
    const bytes = mod.toBytes();
    const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(bytes)));
    return { bytes, exports: instance.exports };
}
// round-trips through the writer then the reader, and checks the two structures match --
// exercises the reader independently of whether the module happens to be executable.
function roundTrip(name, mod) {
    const bytes = mod.toBytes();
    const back = new wasm.WasmModule(bytes);
    check(`round-trip: ${name}`, back, mod);
}
const F64 = 'f64';
const I32 = 'i32';
function func(params, results) {
    return { kind: 'func', params: params.map(p => ({ type: p })), results };
}
//-----------------------------------------------------------------------------
// 1. add(i32,i32):i32 -- smallest possible sanity check
//-----------------------------------------------------------------------------
{
    const mod = new wasm.WasmModule({
        types: { types: [{ final: true, supertypes: [], type: func([I32, I32], [I32]) }], groupSizes: [1] },
        functionTypes: [0],
        code: [{
                locals: [],
                body: [
                    { op: 'local.get', localIndex: 0 },
                    { op: 'local.get', localIndex: 1 },
                    { op: 'i32.add' },
                ],
            }],
        exports: [{ name: 'add', kind: 'func', index: 0 }],
    });
    const { exports } = run(mod);
    check('add(3,4)', exports.add(3, 4), 7);
    roundTrip('add', mod);
}
//-----------------------------------------------------------------------------
// 2. factorial(f64):f64 -- while-loop control flow (block/loop/br_if), locals, comparisons
//-----------------------------------------------------------------------------
{
    const mod = new wasm.WasmModule({
        types: { types: [{ final: true, supertypes: [], type: func([F64], [F64]) }], groupSizes: [1] },
        functionTypes: [0],
        code: [{
                locals: [{ count: 1, type: F64 }], // local 1: result
                body: [
                    { op: 'f64.const', imm: 1 },
                    { op: 'local.set', localIndex: 1 },
                    {
                        op: 'block', blockType: undefined, body: [{
                                op: 'loop', blockType: undefined, body: [
                                    { op: 'local.get', localIndex: 0 },
                                    { op: 'f64.const', imm: 1 },
                                    { op: 'f64.le' },
                                    { op: 'br_if', label: 1 },
                                    { op: 'local.get', localIndex: 1 },
                                    { op: 'local.get', localIndex: 0 },
                                    { op: 'f64.mul' },
                                    { op: 'local.set', localIndex: 1 },
                                    { op: 'local.get', localIndex: 0 },
                                    { op: 'f64.const', imm: 1 },
                                    { op: 'f64.sub' },
                                    { op: 'local.set', localIndex: 0 },
                                    { op: 'br', label: 0 },
                                ],
                            }],
                    },
                    { op: 'local.get', localIndex: 1 },
                ],
            }],
        exports: [{ name: 'factorial', kind: 'func', index: 0 }],
    });
    const { exports } = run(mod);
    check('factorial(0)', exports.factorial(0), 1);
    check('factorial(5)', exports.factorial(5), 120);
    roundTrip('factorial', mod);
}
//-----------------------------------------------------------------------------
// 3. wasm-GC: a Point struct (struct.new_default/struct.get/struct.set), plus a distance
//    function combining two of them -- exercises reftype/heaptype encoding and the GC opcode table
//-----------------------------------------------------------------------------
{
    const pointStruct = {
        kind: 'struct',
        fields: [{ type: F64, mut: true }, { type: F64, mut: true }],
    };
    const pointRef = { ref: 0, nullable: false };
    const mod = new wasm.WasmModule({
        types: {
            types: [
                { final: true, supertypes: [], type: pointStruct }, // type 0: $Point
                { final: true, supertypes: [], type: func([F64, F64], [pointRef]) }, // type 1: Point_new
                { final: true, supertypes: [], type: func([pointRef, pointRef], [F64]) }, // type 2: distance
            ],
            groupSizes: [1, 1, 1],
        },
        functionTypes: [1, 2],
        code: [
            {
                // Point_new(x, y)
                locals: [{ count: 1, type: pointRef }],
                body: [
                    { op: 'struct.new_default', typeIndex: 0 },
                    { op: 'local.set', localIndex: 2 },
                    { op: 'local.get', localIndex: 2 },
                    { op: 'local.get', localIndex: 0 },
                    { op: 'struct.set', typeIndex: 0, field: 0 },
                    { op: 'local.get', localIndex: 2 },
                    { op: 'local.get', localIndex: 1 },
                    { op: 'struct.set', typeIndex: 0, field: 1 },
                    { op: 'local.get', localIndex: 2 },
                ],
            },
            {
                // distance(p, q) = sqrt((p.x-q.x)^2 + (p.y-q.y)^2)
                locals: [],
                body: [
                    { op: 'local.get', localIndex: 0 }, { op: 'struct.get', typeIndex: 0, field: 0 },
                    { op: 'local.get', localIndex: 1 }, { op: 'struct.get', typeIndex: 0, field: 0 },
                    { op: 'f64.sub' },
                    { op: 'local.get', localIndex: 0 }, { op: 'struct.get', typeIndex: 0, field: 0 },
                    { op: 'local.get', localIndex: 1 }, { op: 'struct.get', typeIndex: 0, field: 0 },
                    { op: 'f64.sub' },
                    { op: 'f64.mul' },
                    { op: 'local.get', localIndex: 0 }, { op: 'struct.get', typeIndex: 0, field: 1 },
                    { op: 'local.get', localIndex: 1 }, { op: 'struct.get', typeIndex: 0, field: 1 },
                    { op: 'f64.sub' },
                    { op: 'local.get', localIndex: 0 }, { op: 'struct.get', typeIndex: 0, field: 1 },
                    { op: 'local.get', localIndex: 1 }, { op: 'struct.get', typeIndex: 0, field: 1 },
                    { op: 'f64.sub' },
                    { op: 'f64.mul' },
                    { op: 'f64.add' },
                    { op: 'f64.sqrt' },
                ],
            },
        ],
        exports: [
            { name: 'Point_new', kind: 'func', index: 0 },
            { name: 'distance', kind: 'func', index: 1 },
        ],
    });
    const { exports } = run(mod);
    const p = exports.Point_new(0, 0);
    const q = exports.Point_new(3, 4);
    check('distance(0,0 -> 3,4)', exports.distance(p, q), 5);
    roundTrip('gc-point', mod);
}
//-----------------------------------------------------------------------------
// 4. memory: a data segment + i32.load/i32.store/memory.size
//-----------------------------------------------------------------------------
{
    const mod = new wasm.WasmModule({
        types: { types: [{ final: true, supertypes: [], type: func([], [I32]) }], groupSizes: [1] },
        functionTypes: [0],
        memories: [{ min: 1 }],
        datas: [{ mode: 'active', offset: [{ op: 'i32.const', imm: 0 }], bytes: Uint8Array.of(42, 0, 0, 0) }],
        dataCount: 1,
        code: [{
                locals: [],
                body: [
                    { op: 'i32.const', imm: 0 },
                    { op: 'i32.load', align: 2, offset: 0 },
                ],
            }],
        exports: [{ name: 'readFirst', kind: 'func', index: 0 }, { name: 'mem', kind: 'memory', index: 0 }],
    });
    const { exports } = run(mod);
    check('readFirst() reads the data segment', exports.readFirst(), 42);
    roundTrip('memory', mod);
}
//-----------------------------------------------------------------------------
// 5. structural round-trip only (not executed): import, table w/ explicit init, global,
//    element segments (all 3 modes), start section -- less common shapes, checked for
//    read(write(x)) === x rather than by running them.
//-----------------------------------------------------------------------------
{
    const mod = new wasm.WasmModule({
        types: {
            types: [
                { final: true, supertypes: [], type: func([], []) },
                { final: true, supertypes: [], type: func([I32], [I32]) },
            ],
            groupSizes: [1, 1],
        },
        imports: [{ module: 'env', name: 'log', desc: { kind: 'func', typeIndex: 0 } }],
        functionTypes: [1],
        code: [{ locals: [], body: [{ op: 'local.get', localIndex: 0 }] }],
        tables: [{ reftype: { ref: 'func', nullable: true }, limits: { min: 2, max: 2 } }],
        globals: [{ type: { type: I32, mut: true }, init: [{ op: 'i32.const', imm: 7 }] }],
        start: 1,
        elements: [
            { mode: 'active', table: 0, offset: [{ op: 'i32.const', imm: 0 }], reftype: { ref: 'func', nullable: true }, funcIndices: [1] },
            { mode: 'passive', reftype: { ref: 'func', nullable: true }, funcIndices: [1] },
            { mode: 'declarative', reftype: { ref: 'func', nullable: true }, funcIndices: [1] },
        ],
    });
    roundTrip('imports-table-globals-elements-start', mod);
}
//-----------------------------------------------------------------------------
// 6. I / fold helpers -- same add(i32,i32):i32 as test 1, built with I and fold
//-----------------------------------------------------------------------------
{
    const { I, fold } = wasm;
    const mod = new wasm.WasmModule({
        types: { types: [{ final: true, supertypes: [], type: func([I32, I32], [I32]) }], groupSizes: [1] },
        functionTypes: [0],
        code: [{
                locals: [],
                body: fold(I.i32.add, I.local.get(0), I.local.get(1)),
            }],
        exports: [{ name: 'add', kind: 'func', index: 0 }],
    });
    const { exports } = run(mod);
    check('I/fold: add(10,32)', exports.add(10, 32), 42);
    roundTrip('I/fold-add', mod);
}
//-----------------------------------------------------------------------------
// 7. I.struct typed factory -- Point struct built with I.struct<[f64,f64]>(0)
//    verifies get/set field inference and correct binary encoding
//-----------------------------------------------------------------------------
{
    const { I, fold } = wasm;
    const $Point = 0;
    const pointStruct = {
        kind: 'struct',
        fields: [{ type: F64, mut: true }, { type: F64, mut: true }],
    };
    const pointRef = { ref: $Point, nullable: false };
    const S = I.struct($Point);
    const mod = new wasm.WasmModule({
        types: {
            types: [
                { final: true, supertypes: [], type: pointStruct },
                { final: true, supertypes: [], type: func([F64, F64], [pointRef]) },
                { final: true, supertypes: [], type: func([pointRef], [F64]) },
                { final: true, supertypes: [], type: func([pointRef], [F64]) },
            ],
            groupSizes: [1, 1, 1, 1],
        },
        functionTypes: [1, 2, 3],
        code: [
            {
                // Point_new(x:f64, y:f64): pointRef
                locals: [{ count: 1, type: pointRef }],
                body: [
                    ...S.new_default(),
                    ...fold(I.local.set(2)),
                    ...S.set(I.local.get(2), 0, I.local.get(0)),
                    ...S.set(I.local.get(2), 1, I.local.get(1)),
                    ...fold(I.local.get(2)),
                ],
            },
            {
                // get_x(p: pointRef): f64
                locals: [],
                body: S.get(I.local.get(0), 0),
            },
            {
                // get_y(p: pointRef): f64
                locals: [],
                body: S.get(I.local.get(0), 1),
            },
        ],
        exports: [
            { name: 'Point_new', kind: 'func', index: 0 },
            { name: 'get_x', kind: 'func', index: 1 },
            { name: 'get_y', kind: 'func', index: 2 },
        ],
    });
    const { exports } = run(mod);
    const p = exports.Point_new(3.0, 4.0);
    check('I.struct: get_x', exports.get_x(p), 3.0);
    check('I.struct: get_y', exports.get_y(p), 4.0);
    roundTrip('I.struct-point', mod);
}
if (failures) {
    console.error(`${failures} failure(s)`);
    process.exit(1);
}
console.log('all wasm tests passed');
//# sourceMappingURL=test-wasm.js.map