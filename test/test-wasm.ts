import assert from 'assert';
import * as wasm from '../dist/wasm';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
	try {
		assert.deepStrictEqual(actual, expected);
		console.log(`ok - ${name}`);
	} catch (e) {
		++failures;
		console.error(`FAIL - ${name}:`, e instanceof Error ? e.message : e);
	}
}

function run(mod: wasm.WasmModule) {
	const bytes = mod.toBytes();
	const instance = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(bytes)));
	return { bytes, exports: instance.exports as Record<string, (...args: any[]) => any> };
}

// round-trips through the writer then the reader, and checks the two structures match --
// exercises the reader independently of whether the module happens to be executable.
function roundTrip(name: string, mod: wasm.WasmModule) {
	const bytes = mod.toBytes();
	const back = new wasm.WasmModule(bytes);
	check(`round-trip: ${name}`, back, mod);
}

const F64 = 'f64' as const;
const I32 = 'i32' as const;
function func(params: wasm.ValType[], results: wasm.ValType[]): wasm.CompType {
	return { kind: 'func', params, results };
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
				{ op: 'local.get', index: 0 },
				{ op: 'local.get', index: 1 },
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
			locals: [{ count: 1, type: F64 }],	// local 1: result
			body: [
				{ op: 'f64.const', imm: 1 },
				{ op: 'local.set', index: 1 },
				{
					op: 'block', imm: undefined, body: [{
						op: 'loop', imm: undefined, body: [
							{ op: 'local.get', index: 0 },
							{ op: 'f64.const', imm: 1 },
							{ op: 'f64.le' },
							{ op: 'br_if', index: 1 },
							{ op: 'local.get', index: 1 },
							{ op: 'local.get', index: 0 },
							{ op: 'f64.mul' },
							{ op: 'local.set', index: 1 },
							{ op: 'local.get', index: 0 },
							{ op: 'f64.const', imm: 1 },
							{ op: 'f64.sub' },
							{ op: 'local.set', index: 0 },
							{ op: 'br', index: 0 },
						],
					}],
				},
				{ op: 'local.get', index: 1 },
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
	const pointStruct: wasm.CompType = {
		kind: 'struct',
		fields: [{ type: F64, mut: true }, { type: F64, mut: true }],
	};
	const pointRef: wasm.ValType = { ref: 0, nullable: false };

	const mod = new wasm.WasmModule({
		types: {
			types: [
				{ final: true, supertypes: [], type: pointStruct },					// type 0: $Point
				{ final: true, supertypes: [], type: func([F64, F64], [pointRef]) },	// type 1: Point_new
				{ final: true, supertypes: [], type: func([pointRef, pointRef], [F64]) },	// type 2: distance
			],
			groupSizes: [1, 1, 1],
		},
		functionTypes: [1, 2],
		code: [
			{
				// Point_new(x, y)
				locals: [{ count: 1, type: pointRef }],
				body: [
					{ op: 'struct.new_default', imm: 0 },
					{ op: 'local.set', index: 2 },
					{ op: 'local.get', index: 2 },
					{ op: 'local.get', index: 0 },
					{ op: 'struct.set', typeIndex: 0, field: 0 },
					{ op: 'local.get', index: 2 },
					{ op: 'local.get', index: 1 },
					{ op: 'struct.set', typeIndex: 0, field: 1 },
					{ op: 'local.get', index: 2 },
				],
			},
			{
				// distance(p, q) = sqrt((p.x-q.x)^2 + (p.y-q.y)^2)
				locals: [],
				body: [
					{ op: 'local.get', index: 0 }, { op: 'struct.get', typeIndex: 0, field: 0 },
					{ op: 'local.get', index: 1 }, { op: 'struct.get', typeIndex: 0, field: 0 },
					{ op: 'f64.sub' },
					{ op: 'local.get', index: 0 }, { op: 'struct.get', typeIndex: 0, field: 0 },
					{ op: 'local.get', index: 1 }, { op: 'struct.get', typeIndex: 0, field: 0 },
					{ op: 'f64.sub' },
					{ op: 'f64.mul' },
					{ op: 'local.get', index: 0 }, { op: 'struct.get', typeIndex: 0, field: 1 },
					{ op: 'local.get', index: 1 }, { op: 'struct.get', typeIndex: 0, field: 1 },
					{ op: 'f64.sub' },
					{ op: 'local.get', index: 0 }, { op: 'struct.get', typeIndex: 0, field: 1 },
					{ op: 'local.get', index: 1 }, { op: 'struct.get', typeIndex: 0, field: 1 },
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
		code: [{ locals: [], body: [{ op: 'local.get', index: 0 }] }],
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

if (failures) {
	console.error(`${failures} failure(s)`);
	process.exit(1);
}
console.log('all wasm tests passed');
