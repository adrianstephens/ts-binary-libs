import * as bin from '@isopodlabs/binary';

// ===================================================================
//  WebAssembly binary format: core spec + GC, bulk-memory, reference-types,
//  multi-value, sign-extension, SIMD, threads/atomics (all stable in Wasm 2.0/3.0).
//
//  Not covered (throws rather than misparses): exception-handling (tag
//  section, try/catch instructions).
//
//  Sync-only, like elf.ts/mach.ts: the instruction stream needs genuine
//  recursive-descent (block/loop/if nest to a data-dependent depth, terminated
//  by 0x0B/0x05, not a length prefix) -- hand-written, not declarative.
// ===================================================================

type ValueOf<T> = T[keyof T];

function inverse<T extends string>(table: Record<number, T>) { return Object.fromEntries(Object.entries(table).map(([k, v]) => [v, Number(k)])) as Record<T, number>; }
function mapRecord<T extends Record<string, any>, R>(r: T, fn: (v: T[keyof T]) => R) {
	return Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), fn(v)])) as Record<keyof T, R>;
}

//-----------------------------------------------------------------------------
//	LEB128 (signed) -- the library only provides ULEB128
//-----------------------------------------------------------------------------

// Standard signed LEB128: 7 bits/byte, continuation in the top bit, sign bit is bit 6 of the last byte.
// Always decodes to `bigint` (i64.const needs the full 64-bit range); narrowed to `number` where it's known to fit.
export const SLEB128: bin.TypeT<bigint> = {
	get: s => {
		let result = 0n, shift = 0n, byte = 0;
		do {
			byte = bin.UINT8.get(s);
			result |= BigInt(byte & 0x7f) << shift;
			shift += 7n;
		} while (byte & 0x80);
		if (shift < 64n && (byte & 0x40))
			result |= -1n << shift;
		return result;
	},
	put: (s, v) => {
		for (let more = true; more;) {
			let byte = Number(v & 0x7fn);
			v >>= 7n;
			if ((v === 0n && !(byte & 0x40)) || (v === -1n && (byte & 0x40)))
				more = false;
			else
				byte |= 0x80;
			bin.UINT8.put(s, byte);
		}
	},
};

const S32: bin.TypeT<number> = bin.as(SLEB128, x => Number(x), x => BigInt(x));
// `bin.ULEB128` is typed `number|bigint` (values beyond 2^53 need the bigint case) -- narrowed to
// plain `number` here for vec-length/index/count fields, which never actually get that large.
const U32: bin.TypeT<number> = bin.as(bin.ULEB128, x => Number(x), x => BigInt(x));

//-----------------------------------------------------------------------------
//	value types
//-----------------------------------------------------------------------------

const ABSTRACT_HEAP = {
	[-16]: 'func',
	[-17]: 'extern',
	[-18]: 'any',
	[-19]: 'eq',
	[-20]: 'i31',
	[-21]: 'struct',
	[-22]: 'array',
	[-15]: 'none',
	[-14]: 'noextern',
	[-13]: 'nofunc',
	[-23]: 'exn',
	[-12]: 'noexn',
} as const;

export type AbstractHeapType = ValueOf<typeof ABSTRACT_HEAP>;
const ABSTRACT_HEAP_INV = inverse(ABSTRACT_HEAP);

const HeapType = bin.as(SLEB128,
	v => {
		if (v >= 0n)
			return Number(v);
		const abstract = ABSTRACT_HEAP[Number(v) as keyof typeof ABSTRACT_HEAP];
		if (abstract === undefined)
			throw new Error(`wasm: unknown abstract heap type ${v}`);
		return abstract;
	},
	v => BigInt(typeof v === 'number' ? v : ABSTRACT_HEAP_INV[v])
);
export type HeapType = bin.ReadType<typeof HeapType>;

// Every valtype-introducing byte as one `Switch`: numtype/vectype bytes are plain `Const`s, `0x63`/`0x64` defer to `HeapType` for `(ref null? ht)`.
// `Switch`'s default discriminator can't tell these apart (most values are bare strings, or all shaped alike as `{ref, nullable}`) -- hence `valTypeKey` below.
const VALTYPE_SWITCH = {
	0x7F: bin.Const('i32'),
	0x7E: bin.Const('i64'),
	0x7D: bin.Const('f32'),
	0x7C: bin.Const('f64'),
	0x7B: bin.Const('v128'),
	...Object.fromEntries(Object.entries(ABSTRACT_HEAP).map(([b, ref]) => [Number(b) + 0x80, bin.Const({ ref, nullable: true })])),
	0x64: bin.as(HeapType, ref => ({ ref, nullable: false }), v => v.ref),
	0x63: bin.as(HeapType, ref => ({ ref, nullable: true }), v => v.ref),
};

const ValType = bin.Switch(bin.UINT8, VALTYPE_SWITCH,
	v => {
		if (typeof v === 'string')
			return v === 'i32' ? 0x7F : v === 'i64' ? 0x7E : v === 'f32' ? 0x7D : v === 'f64' ? 0x7C : 0x7B;
		if (v.nullable && typeof v.ref === 'string')
			return ABSTRACT_HEAP_INV[v.ref as AbstractHeapType] + 0x80;
		return v.nullable ? 0x63 : 0x64;
	}
);
export type ValType = bin.ReadType<typeof ValType>;

const BlockType = bin.Switch(bin.UINT8, {
	0x40:		bin.Const(undefined),
	...VALTYPE_SWITCH,
	default:	bin.AfterSkip(-1, { typeIndex: S32 })
}, v => v === undefined ? 0x40: (typeof v === 'object' && 'typeIndex' in v) ? 0 : ValType.discriminator(v) as any);
export type BlockType = bin.ReadType<typeof BlockType>;

//-----------------------------------------------------------------------------
//	GC composite/sub/rec types (struct/array/func), for the type section
//-----------------------------------------------------------------------------

// `i8`/`i16` (packed struct/array element storage) share the byte space with `ValType` itself
// (0x78/0x77, just below the numtypes) -- reuses `VALTYPE_SWITCH` rather than duplicating it.
const StorageType = bin.Switch(bin.UINT8, {
	...VALTYPE_SWITCH,
	0x78: bin.Const('i8'),
	0x77: bin.Const('i16')
},	v => v === 'i8' ? 0x78 : v === 'i16' ? 0x77 : ValType.discriminator(v) as any);

const FieldType	= { type: StorageType, mut: bin.as(bin.UINT8, x => !!x, x => x ? 1 : 0) };

const COMPTYPE_SWITCH = {
	0x60: { kind: bin.Const('func'), 	params: bin.Array(U32, ValType), results: bin.Array(U32, ValType) },
	0x5F: { kind: bin.Const('struct'), 	fields: bin.Array(U32, FieldType) },
	0x5E: { kind: bin.Const('array'), 	field: FieldType },
};

const CompType = bin.Switch(bin.UINT8, COMPTYPE_SWITCH, v => v.kind === 'func' ? 0x60 : v.kind === 'struct' ? 0x5F : 0x5E);
export type CompType = bin.ReadType<typeof CompType>;

const SUBTYPE_SWITCH = {
	...COMPTYPE_SWITCH,
	0x50: { supertypes: bin.Array(U32, U32), type: CompType, final: bin.Const(false) },
	0x4F: { supertypes: bin.Array(U32, U32), type: CompType, final: bin.Const(true) },
};
const SubType = bin.Switch(bin.UINT8, SUBTYPE_SWITCH, v => 'supertypes' in v ? (v.final ? 0x4F : 0x50) : CompType.discriminator(v) as any);
export type SubType = bin.ReadType<typeof SubType>;

// A rec group of mutually-recursive subtypes (`0x4E vec(subtype)`, or -- typically -- one bare subtype as its own singleton group).
// Flattened into `TypeSection`'s single `types[]`; same reuse trick as `SubType`, wrapping bare entries as `[SubType]` so both round-trip identically.
const RecType = bin.Switch(bin.UINT8, {
	0x4E: bin.Array(U32, SubType),
	...Object.fromEntries(Object.entries(SUBTYPE_SWITCH).map(([b, t]) => [Number(b), bin.as(t, v => [v], arr => arr[0])])),
	},
	v => v.length > 1 ? 0x4E : 'supertypes' in v[0] ? (v[0].final ? 0x4F : 0x50) : CompType.discriminator(v[0]) as any
);

//-----------------------------------------------------------------------------
//	instructions
//-----------------------------------------------------------------------------

//const compI = ['eqz', 'eq', 'ne', 'lt_s', 'lt_u', 'gt_s', 'gt_u', 'le_s', 'le_u', 'ge_s', 'ge_u'] as const;
//const compF = ['eq', 'ne', 'lt', 'gt', 'le', 'ge'] as const;
//const opI	= ['clz', 'ctz', 'popcnt', 'add', 'sub', 'mul', 'div_s', 'div_u', 'rem_s', 'rem_u', 'and', 'or', 'xor', 'shl', 'shr_s', 'shr_u', 'rotl', 'rotr'] as const;
//const opF	= ['abs', 'neg', 'ceil', 'floor', 'trunc', 'nearest', 'sqrt', 'add', 'sub', 'mul', 'div', 'min', 'max', 'copysign'] as const;
//function map2Record<T extends string[], K, R>(r: T, fn: (v: T[keyof T], i: number) => [K, R]) {
//	return Object.fromEntries(r.map(fn as any)) as Record<keyof T, R>;
//}

// Opcodes with no immediate at all -- the bulk of the numeric instruction set.
export const ROOT_OPS = {
	NONE: {
		0x00: 'unreachable', 0x01: 'nop', 0x0F: 'return', 0x1A: 'drop',
		0xD1: 'ref.is_null', 0xD3: 'ref.eq', 0xD4: 'ref.as_non_null',
		//...map2Record(compI, 	(op, i) => [0x45 + i, `i32.${op}`]),
		//...map2Record(compI, 	(op, i) => [0x50 + i, `i64.${op}`]),
		//...map2Record(compF, 	(op, i) => [0x5B + i, `f32.${op}`]),
		//...map2Record(compF, 	(op, i) => [0x61 + i, `f64.${op}`]),
		//...map2Record(opI, 		(op, i) => [0x67 + i, `i32.${op}`]),
		//...map2Record(opI, 		(op, i) => [0x79 + i, `i64.${op}`]),
		//...map2Record(opF, 		(op, i) => [0x8b + i, `f32.${op}`]),
		//...map2Record(opF, 		(op, i) => [0x99 + i, `f64.${op}`]),
		0x45: 'i32.eqz', 0x46: 'i32.eq', 0x47: 'i32.ne', 0x48: 'i32.lt_s', 0x49: 'i32.lt_u', 0x4A: 'i32.gt_s', 0x4B: 'i32.gt_u', 0x4C: 'i32.le_s', 0x4D: 'i32.le_u', 0x4E: 'i32.ge_s', 0x4F: 'i32.ge_u',
		0x50: 'i64.eqz', 0x51: 'i64.eq', 0x52: 'i64.ne', 0x53: 'i64.lt_s', 0x54: 'i64.lt_u', 0x55: 'i64.gt_s', 0x56: 'i64.gt_u', 0x57: 'i64.le_s', 0x58: 'i64.le_u', 0x59: 'i64.ge_s', 0x5A: 'i64.ge_u',
		0x5B: 'f32.eq', 0x5C: 'f32.ne', 0x5D: 'f32.lt', 0x5E: 'f32.gt', 0x5F: 'f32.le', 0x60: 'f32.ge',
		0x61: 'f64.eq', 0x62: 'f64.ne', 0x63: 'f64.lt', 0x64: 'f64.gt', 0x65: 'f64.le', 0x66: 'f64.ge',
		0x67: 'i32.clz', 0x68: 'i32.ctz', 0x69: 'i32.popcnt', 0x6A: 'i32.add', 0x6B: 'i32.sub', 0x6C: 'i32.mul', 0x6D: 'i32.div_s', 0x6E: 'i32.div_u', 0x6F: 'i32.rem_s', 0x70: 'i32.rem_u', 0x71: 'i32.and', 0x72: 'i32.or', 0x73: 'i32.xor', 0x74: 'i32.shl', 0x75: 'i32.shr_s', 0x76: 'i32.shr_u', 0x77: 'i32.rotl', 0x78: 'i32.rotr',
		0x79: 'i64.clz', 0x7A: 'i64.ctz', 0x7B: 'i64.popcnt', 0x7C: 'i64.add', 0x7D: 'i64.sub', 0x7E: 'i64.mul', 0x7F: 'i64.div_s', 0x80: 'i64.div_u', 0x81: 'i64.rem_s', 0x82: 'i64.rem_u', 0x83: 'i64.and', 0x84: 'i64.or', 0x85: 'i64.xor', 0x86: 'i64.shl', 0x87: 'i64.shr_s', 0x88: 'i64.shr_u', 0x89: 'i64.rotl', 0x8A: 'i64.rotr',
		0x8B: 'f32.abs', 0x8C: 'f32.neg', 0x8D: 'f32.ceil', 0x8E: 'f32.floor', 0x8F: 'f32.trunc', 0x90: 'f32.nearest', 0x91: 'f32.sqrt', 0x92: 'f32.add', 0x93: 'f32.sub', 0x94: 'f32.mul', 0x95: 'f32.div', 0x96: 'f32.min', 0x97: 'f32.max', 0x98: 'f32.copysign',
		0x99: 'f64.abs', 0x9A: 'f64.neg', 0x9B: 'f64.ceil', 0x9C: 'f64.floor', 0x9D: 'f64.trunc', 0x9E: 'f64.nearest', 0x9F: 'f64.sqrt', 0xA0: 'f64.add', 0xA1: 'f64.sub', 0xA2: 'f64.mul', 0xA3: 'f64.div', 0xA4: 'f64.min', 0xA5: 'f64.max', 0xA6: 'f64.copysign',
		0xA7: 'i32.wrap_i64', 0xA8: 'i32.trunc_f32_s', 0xA9: 'i32.trunc_f32_u', 0xAA: 'i32.trunc_f64_s', 0xAB: 'i32.trunc_f64_u',
		0xAC: 'i64.extend_i32_s', 0xAD: 'i64.extend_i32_u', 0xAE: 'i64.trunc_f32_s', 0xAF: 'i64.trunc_f32_u', 0xB0: 'i64.trunc_f64_s', 0xB1: 'i64.trunc_f64_u',
		0xB2: 'f32.convert_i32_s', 0xB3: 'f32.convert_i32_u', 0xB4: 'f32.convert_i64_s', 0xB5: 'f32.convert_i64_u', 0xB6: 'f32.demote_f64',
		0xB7: 'f64.convert_i32_s', 0xB8: 'f64.convert_i32_u', 0xB9: 'f64.convert_i64_s', 0xBA: 'f64.convert_i64_u', 0xBB: 'f64.promote_f32',
		0xBC: 'i32.reinterpret_f32', 0xBD: 'i64.reinterpret_f64', 0xBE: 'f32.reinterpret_i32', 0xBF: 'f64.reinterpret_i64',
		0xC0: 'i32.extend8_s', 0xC1: 'i32.extend16_s', 0xC2: 'i64.extend8_s', 0xC3: 'i64.extend16_s', 0xC4: 'i64.extend32_s',
	},

	// Opcodes whose sole immediate is a single u32 index (local/global/table/label/func/type index --
	// the encoding is identical either way).
	INDEX: {
		0x0C: 'br', 0x0D: 'br_if', 0x10: 'call', 0x12: 'return_call', 0x14: 'call_ref', 0x15: 'return_call_ref',
		0x20: 'local.get', 0x21: 'local.set', 0x22: 'local.tee', 0x23: 'global.get', 0x24: 'global.set',
		0x25: 'table.get', 0x26: 'table.set', 0xD2: 'ref.func', 0xD5: 'br_on_null', 0xD6: 'br_on_non_null',
	},

	// Memory instructions (`memarg` immediate): loads 0x28-0x35, stores 0x36-0x3E.
	MEM: {
		0x28: 'i32.load', 0x29: 'i64.load', 0x2A: 'f32.load', 0x2B: 'f64.load',
		0x2C: 'i32.load8_s', 0x2D: 'i32.load8_u', 0x2E: 'i32.load16_s', 0x2F: 'i32.load16_u',
		0x30: 'i64.load8_s', 0x31: 'i64.load8_u', 0x32: 'i64.load16_s', 0x33: 'i64.load16_u', 0x34: 'i64.load32_s', 0x35: 'i64.load32_u',
		0x36: 'i32.store', 0x37: 'i64.store', 0x38: 'f32.store', 0x39: 'f64.store',
		0x3A: 'i32.store8', 0x3B: 'i32.store16', 0x3C: 'i64.store8', 0x3D: 'i64.store16', 0x3E: 'i64.store32',
	},
	OTHERS: {
		0x02: 'block', 0x03: 'loop', 0x04: 'if', 0x05: 'else_marker', 0x0b: 'end_block',
		0x0E: 'br_table', 0x11: 'call_indirect', 0x13: 'return_call_indirect', 0x1B: 'select', 0x1C: 'select.t', 0xD0: 'ref.null',
		0x3F: 'memory.size', 0x40: 'memory.grow',
		0x41: 'i32.const', 0x42: 'i64.const', 0x43: 'f32.const', 0x44: 'f64.const',
	}
} as const;

// 0xFB-prefixed (GC).
export const FB_OPS = {
	NONE: 			{ 15:'array.len',	26: 'any.convert_extern', 27: 'extern.convert_any', 28: 'ref.i31', 29: 'i31.get_s', 30: 'i31.get_u' },
	TYPE: 			{ 0: 'struct.new', 1: 'struct.new_default', 6: 'array.new', 7: 'array.new_default' },
	TYPE_FIELD: 	{ 2: 'struct.get', 3: 'struct.get_s', 4: 'struct.get_u', 5: 'struct.set' },
	ARRAY_NOTYPE: 	{ 11: 'array.get', 12: 'array.get_s', 13: 'array.get_u', 14: 'array.set' },
	TYPE_N: 		{ 8: 'array.new_fixed' },
	TYPE_SEG: 		{ 9: 'array.new_data', 10: 'array.new_elem', 18: 'array.init_data', 19: 'array.init_elem' },
	TYPE2: 			{ 17: 'array.copy' },
	ONETYPE_NOIDX: 	{ 16: 'array.fill' },
	REFTYPE: 		{ 20: 'ref.test', 21: 'ref.test.nullable', 22: 'ref.cast', 23: 'ref.cast.nullable' },
	OTHERS:			{ 24: 'br_on_cast', 25: 'br_on_cast_fail'},
} as const;

// 0xFC-prefixed: saturating float-to-int conversions (0-7), bulk memory (8-11), table ops (12-17).
export const FC_OPS = {
	NONE: {
		0: 'i32.trunc_sat_f32_s', 1: 'i32.trunc_sat_f32_u', 2: 'i32.trunc_sat_f64_s', 3: 'i32.trunc_sat_f64_u',
		4: 'i64.trunc_sat_f32_s', 5: 'i64.trunc_sat_f32_u', 6: 'i64.trunc_sat_f64_s', 7: 'i64.trunc_sat_f64_u',
	},
	INDEX: { 9: 'data.drop', 13: 'elem.drop', 15: 'table.grow', 16: 'table.size', 17: 'table.fill' },
	INDEX2: { 8: 'memory.init', 10: 'memory.copy', 11: 'memory.fill', 12: 'table.init', 14: 'table.copy' },
} as const;

// 0xFD-prefixed (SIMD, 128-bit vectors). Sub-opcode is ULEB128 (values run past 0x7f), unlike 0xFB/0xFC's single byte -- see `U32` used as the nested `Switch`'s test below.
export const SIMD_OPS = {
	MEM: {
		0x00: 'v128.load', 0x01: 'v128.load8x8_s', 0x02: 'v128.load8x8_u', 0x03: 'v128.load16x4_s', 0x04: 'v128.load16x4_u',
		0x05: 'v128.load32x2_s', 0x06: 'v128.load32x2_u', 0x07: 'v128.load8_splat', 0x08: 'v128.load16_splat',
		0x09: 'v128.load32_splat', 0x0a: 'v128.load64_splat', 0x0b: 'v128.store', 0x5c: 'v128.load32_zero', 0x5d: 'v128.load64_zero',
	},
	LANE: {
		0x15: 'i8x16.extract_lane_s', 0x16: 'i8x16.extract_lane_u', 0x17: 'i8x16.replace_lane',
		0x18: 'i16x8.extract_lane_s', 0x19: 'i16x8.extract_lane_u', 0x1a: 'i16x8.replace_lane',
		0x1b: 'i32x4.extract_lane', 0x1c: 'i32x4.replace_lane', 0x1d: 'i64x2.extract_lane', 0x1e: 'i64x2.replace_lane',
		0x1f: 'f32x4.extract_lane', 0x20: 'f32x4.replace_lane', 0x21: 'f64x2.extract_lane', 0x22: 'f64x2.replace_lane',
	},
	LANEMEM: {
		0x54: 'v128.load8_lane', 0x55: 'v128.load16_lane', 0x56: 'v128.load32_lane', 0x57: 'v128.load64_lane',
		0x58: 'v128.store8_lane', 0x59: 'v128.store16_lane', 0x5a: 'v128.store32_lane', 0x5b: 'v128.store64_lane',
	},
	// Everything else: arithmetic/comparison/bitwise/conversion ops with no immediate at all (shift amount comes from the stack, not an immediate).
	NONE: {
		0x0e: 'i8x16.swizzle', 0x0f: 'i8x16.splat', 0x10: 'i16x8.splat', 0x11: 'i32x4.splat', 0x12: 'i64x2.splat', 0x13: 'f32x4.splat', 0x14: 'f64x2.splat',
		0x23: 'i8x16.eq', 0x24: 'i8x16.ne', 0x25: 'i8x16.lt_s', 0x26: 'i8x16.lt_u', 0x27: 'i8x16.gt_s', 0x28: 'i8x16.gt_u', 0x29: 'i8x16.le_s', 0x2a: 'i8x16.le_u', 0x2b: 'i8x16.ge_s', 0x2c: 'i8x16.ge_u',
		0x2d: 'i16x8.eq', 0x2e: 'i16x8.ne', 0x2f: 'i16x8.lt_s', 0x30: 'i16x8.lt_u', 0x31: 'i16x8.gt_s', 0x32: 'i16x8.gt_u', 0x33: 'i16x8.le_s', 0x34: 'i16x8.le_u', 0x35: 'i16x8.ge_s', 0x36: 'i16x8.ge_u',
		0x37: 'i32x4.eq', 0x38: 'i32x4.ne', 0x39: 'i32x4.lt_s', 0x3a: 'i32x4.lt_u', 0x3b: 'i32x4.gt_s', 0x3c: 'i32x4.gt_u', 0x3d: 'i32x4.le_s', 0x3e: 'i32x4.le_u', 0x3f: 'i32x4.ge_s', 0x40: 'i32x4.ge_u',
		0x41: 'f32x4.eq', 0x42: 'f32x4.ne', 0x43: 'f32x4.lt', 0x44: 'f32x4.gt', 0x45: 'f32x4.le', 0x46: 'f32x4.ge',
		0x47: 'f64x2.eq', 0x48: 'f64x2.ne', 0x49: 'f64x2.lt', 0x4a: 'f64x2.gt', 0x4b: 'f64x2.le', 0x4c: 'f64x2.ge',
		0x4d: 'v128.not', 0x4e: 'v128.and', 0x4f: 'v128.andnot', 0x50: 'v128.or', 0x51: 'v128.xor', 0x52: 'v128.bitselect', 0x53: 'v128.any_true',
		0x5e: 'f32x4.demote_f64x2_zero', 0x5f: 'f64x2.promote_low_f32x4',
		0x60: 'i8x16.abs', 0x61: 'i8x16.neg', 0x62: 'i8x16.popcnt', 0x63: 'i8x16.all_true', 0x64: 'i8x16.bitmask',
		0x65: 'i8x16.narrow_i16x8_s', 0x66: 'i8x16.narrow_i16x8_u',
		0x67: 'f32x4.ceil', 0x68: 'f32x4.floor', 0x69: 'f32x4.trunc', 0x6a: 'f32x4.nearest',
		0x6b: 'i8x16.shl', 0x6c: 'i8x16.shr_s', 0x6d: 'i8x16.shr_u', 0x6e: 'i8x16.add', 0x6f: 'i8x16.add_sat_s', 0x70: 'i8x16.add_sat_u',
		0x71: 'i8x16.sub', 0x72: 'i8x16.sub_sat_s', 0x73: 'i8x16.sub_sat_u',
		0x74: 'f64x2.ceil', 0x75: 'f64x2.floor', 0x76: 'i8x16.min_s', 0x77: 'i8x16.min_u', 0x78: 'i8x16.max_s', 0x79: 'i8x16.max_u',
		0x7a: 'f64x2.trunc', 0x7b: 'i8x16.avgr_u',
		0x7c: 'i16x8.extadd_pairwise_i8x16_s', 0x7d: 'i16x8.extadd_pairwise_i8x16_u', 0x7e: 'i32x4.extadd_pairwise_i16x8_s', 0x7f: 'i32x4.extadd_pairwise_i16x8_u',
		0x80: 'i16x8.abs', 0x81: 'i16x8.neg', 0x82: 'i16x8.q15mulr_sat_s', 0x83: 'i16x8.all_true', 0x84: 'i16x8.bitmask',
		0x85: 'i16x8.narrow_i32x4_s', 0x86: 'i16x8.narrow_i32x4_u',
		0x87: 'i16x8.extend_low_i8x16_s', 0x88: 'i16x8.extend_high_i8x16_s', 0x89: 'i16x8.extend_low_i8x16_u', 0x8a: 'i16x8.extend_high_i8x16_u',
		0x8b: 'i16x8.shl', 0x8c: 'i16x8.shr_s', 0x8d: 'i16x8.shr_u', 0x8e: 'i16x8.add', 0x8f: 'i16x8.add_sat_s', 0x90: 'i16x8.add_sat_u',
		0x91: 'i16x8.sub', 0x92: 'i16x8.sub_sat_s', 0x93: 'i16x8.sub_sat_u',
		0x94: 'f64x2.nearest', 0x95: 'i16x8.mul', 0x96: 'i16x8.min_s', 0x97: 'i16x8.min_u', 0x98: 'i16x8.max_s', 0x99: 'i16x8.max_u',
		0x9b: 'i16x8.avgr_u', 0x9c: 'i16x8.extmul_low_i8x16_s', 0x9d: 'i16x8.extmul_high_i8x16_s', 0x9e: 'i16x8.extmul_low_i8x16_u', 0x9f: 'i16x8.extmul_high_i8x16_u',
		0xa0: 'i32x4.abs', 0xa1: 'i32x4.neg', 0xa3: 'i32x4.all_true', 0xa4: 'i32x4.bitmask',
		0xa7: 'i32x4.extend_low_i16x8_s', 0xa8: 'i32x4.extend_high_i16x8_s', 0xa9: 'i32x4.extend_low_i16x8_u', 0xaa: 'i32x4.extend_high_i16x8_u',
		0xab: 'i32x4.shl', 0xac: 'i32x4.shr_s', 0xad: 'i32x4.shr_u', 0xae: 'i32x4.add', 0xb1: 'i32x4.sub',
		0xb5: 'i32x4.mul', 0xb6: 'i32x4.min_s', 0xb7: 'i32x4.min_u', 0xb8: 'i32x4.max_s', 0xb9: 'i32x4.max_u', 0xba: 'i32x4.dot_i16x8_s',
		0xbc: 'i32x4.extmul_low_i16x8_s', 0xbd: 'i32x4.extmul_high_i16x8_s', 0xbe: 'i32x4.extmul_low_i16x8_u', 0xbf: 'i32x4.extmul_high_i16x8_u',
		0xc0: 'i64x2.abs', 0xc1: 'i64x2.neg', 0xc3: 'i64x2.all_true', 0xc4: 'i64x2.bitmask',
		0xc7: 'i64x2.extend_low_i32x4_s', 0xc8: 'i64x2.extend_high_i32x4_s', 0xc9: 'i64x2.extend_low_i32x4_u', 0xca: 'i64x2.extend_high_i32x4_u',
		0xcb: 'i64x2.shl', 0xcc: 'i64x2.shr_s', 0xcd: 'i64x2.shr_u', 0xce: 'i64x2.add', 0xd1: 'i64x2.sub',
		0xd5: 'i64x2.mul', 0xd6: 'i64x2.eq', 0xd7: 'i64x2.ne', 0xd8: 'i64x2.lt_s', 0xd9: 'i64x2.gt_s', 0xda: 'i64x2.le_s', 0xdb: 'i64x2.ge_s',
		0xdc: 'i64x2.extmul_low_i32x4_s', 0xdd: 'i64x2.extmul_high_i32x4_s', 0xde: 'i64x2.extmul_low_i32x4_u', 0xdf: 'i64x2.extmul_high_i32x4_u',
		0xe0: 'f32x4.abs', 0xe1: 'f32x4.neg', 0xe3: 'f32x4.sqrt', 0xe4: 'f32x4.add', 0xe5: 'f32x4.sub', 0xe6: 'f32x4.mul', 0xe7: 'f32x4.div',
		0xe8: 'f32x4.min', 0xe9: 'f32x4.max', 0xea: 'f32x4.pmin', 0xeb: 'f32x4.pmax',
		0xec: 'f64x2.abs', 0xed: 'f64x2.neg', 0xef: 'f64x2.sqrt', 0xf0: 'f64x2.add', 0xf1: 'f64x2.sub', 0xf2: 'f64x2.mul', 0xf3: 'f64x2.div',
		0xf4: 'f64x2.min', 0xf5: 'f64x2.max', 0xf6: 'f64x2.pmin', 0xf7: 'f64x2.pmax',
		0xf8: 'i32x4.trunc_sat_f32x4_s', 0xf9: 'i32x4.trunc_sat_f32x4_u', 0xfa: 'f32x4.convert_i32x4_s', 0xfb: 'f32x4.convert_i32x4_u',
		0xfc: 'i32x4.trunc_sat_f64x2_s_zero', 0xfd: 'i32x4.trunc_sat_f64x2_u_zero', 0xfe: 'f64x2.convert_low_i32x4_s', 0xff: 'f64x2.convert_low_i32x4_u',
	},
	OTHERS: {0x0c: 'v128.const', 0x0d: 'i8x16.shuffle'}

} as const;

// 0xFE-prefixed (threads/atomics). All memarg-shaped except `atomic.fence`, which has a reserved 0x00 byte instead of any real immediate.
export const THREAD_OPS = {
	MEM: {
		0x00: 'memory.atomic.notify', 0x01: 'memory.atomic.wait32', 0x02: 'memory.atomic.wait64',
		0x10: 'i32.atomic.load', 0x11: 'i64.atomic.load', 0x12: 'i32.atomic.load8_u', 0x13: 'i32.atomic.load16_u',
		0x14: 'i64.atomic.load8_u', 0x15: 'i64.atomic.load16_u', 0x16: 'i64.atomic.load32_u',
		0x17: 'i32.atomic.store', 0x18: 'i64.atomic.store', 0x19: 'i32.atomic.store8', 0x1a: 'i32.atomic.store16',
		0x1b: 'i64.atomic.store8', 0x1c: 'i64.atomic.store16', 0x1d: 'i64.atomic.store32',
		0x1e: 'i32.atomic.rmw.add', 0x1f: 'i64.atomic.rmw.add', 0x20: 'i32.atomic.rmw8.add_u', 0x21: 'i32.atomic.rmw16.add_u',
		0x22: 'i64.atomic.rmw8.add_u', 0x23: 'i64.atomic.rmw16.add_u', 0x24: 'i64.atomic.rmw32.add_u',
		0x25: 'i32.atomic.rmw.sub', 0x26: 'i64.atomic.rmw.sub', 0x27: 'i32.atomic.rmw8.sub_u', 0x28: 'i32.atomic.rmw16.sub_u',
		0x29: 'i64.atomic.rmw8.sub_u', 0x2a: 'i64.atomic.rmw16.sub_u', 0x2b: 'i64.atomic.rmw32.sub_u',
		0x2c: 'i32.atomic.rmw.and', 0x2d: 'i64.atomic.rmw.and', 0x2e: 'i32.atomic.rmw8.and_u', 0x2f: 'i32.atomic.rmw16.and_u',
		0x30: 'i64.atomic.rmw8.and_u', 0x31: 'i64.atomic.rmw16.and_u', 0x32: 'i64.atomic.rmw32.and_u',
		0x33: 'i32.atomic.rmw.or', 0x34: 'i64.atomic.rmw.or', 0x35: 'i32.atomic.rmw8.or_u', 0x36: 'i32.atomic.rmw16.or_u',
		0x37: 'i64.atomic.rmw8.or_u', 0x38: 'i64.atomic.rmw16.or_u', 0x39: 'i64.atomic.rmw32.or_u',
		0x3a: 'i32.atomic.rmw.xor', 0x3b: 'i64.atomic.rmw.xor', 0x3c: 'i32.atomic.rmw8.xor_u', 0x3d: 'i32.atomic.rmw16.xor_u',
		0x3e: 'i64.atomic.rmw8.xor_u', 0x3f: 'i64.atomic.rmw16.xor_u', 0x40: 'i64.atomic.rmw32.xor_u',
		0x41: 'i32.atomic.rmw.xchg', 0x42: 'i64.atomic.rmw.xchg', 0x43: 'i32.atomic.rmw8.xchg_u', 0x44: 'i32.atomic.rmw16.xchg_u',
		0x45: 'i64.atomic.rmw8.xchg_u', 0x46: 'i64.atomic.rmw16.xchg_u', 0x47: 'i64.atomic.rmw32.xchg_u',
		0x48: 'i32.atomic.rmw.cmpxchg', 0x49: 'i64.atomic.rmw.cmpxchg', 0x4a: 'i32.atomic.rmw8.cmpxchg_u', 0x4b: 'i32.atomic.rmw16.cmpxchg_u',
		0x4c: 'i64.atomic.rmw8.cmpxchg_u', 0x4d: 'i64.atomic.rmw16.cmpxchg_u', 0x4e: 'i64.atomic.rmw32.cmpxchg_u',
	},
	OTHERS: { 0x03: 'atomic.fence'}
} as const;

function inverseAll(obj: Record<string, Record<number, string>>) {
	return inverse<string>(Object.values(obj).reduce((a, b) => ({ ...a, ...b }), {}));
}
const ROOT_INV		= inverseAll(ROOT_OPS);//inverse<string>(Object.values(ROOT_OPS).reduce((a, b) => ({ ...a, ...b }), {}));
const FC_INV		= inverseAll(FC_OPS);//inverse<string>(Object.values(FC_OPS).reduce((a, b) => ({ ...a, ...b }), {}));
const FB_INV		= inverseAll(FB_OPS);//inverse<string>(Object.values(FB_OPS).reduce((a, b) => ({ ...a, ...b }), {}));
const SIMD_INV		= inverseAll(SIMD_OPS);//inverse<string>(Object.values(SIMD_OPS).reduce((a, b) => ({ ...a, ...b }), {}));
const THREAD_INV	= inverseAll(THREAD_OPS);//inverse<string>(Object.values(THREAD_OPS).reduce((a, b) => ({ ...a, ...b }), {}));

const FB_OPS_ALL	= new Set<string>(Object.keys(FB_INV));
const FC_OPS_ALL	= new Set<string>(Object.keys(FC_INV));
const SIMD_OPS_ALL	= new Set<string>(Object.keys(SIMD_INV));
const THREAD_OPS_ALL = new Set<string>(Object.keys(THREAD_INV));

// allow storing an string for assembler to resolve
const INDEX		= bin.as(U32, u => u as number| string, x => +x);

type LooseInstr = { op: string; [key: string]: any };

const Block: bin.TypeT<LooseInstr[]> = bin.Func((s, v) => {
	if (v) {
		for (const i of v)
			s.write(INSTR, i as Instr);
		bin.UINT8.put(s, 0x0B);
		return v;
	} else {
		const body = [];
		for (;;) {
			const i = s.read(INSTR);
			if (i.op === 'end_block')
				break;
			body.push(i);
		}
		return body;
	}
});

function makeInstr<T extends string, R extends bin.Type>(op: T, type: R) {
	return {op: bin.Const(op), ...type};
}
function makeImm<O extends string, T extends bin.Type>(op: O, type: T) { return {op: bin.Const(op), imm: type}; }

function mapTable<T extends Record<number, string>, R extends bin.Type>(table: T, type: R) {
	return Object.fromEntries(Object.entries(table).map(([k, op]) => [Number(k), makeInstr(op, type)])) as {
		[K in keyof T]: ReturnType<typeof makeInstr<T[K] & string, R>>
	};
}

const InstrBrCast 	= { flags: bin.UINT8, label: U32, from: HeapType, to: HeapType };

const INSTR = bin.Switch(bin.UINT8, {
	0x02:	makeInstr('block', {blockType: BlockType, body: Block }),
	0x03:	makeInstr('loop', {blockType: BlockType, body: Block }),
	0x04:	bin.as({blockType: BlockType, body: Block}, ({blockType, body}): {op: 'if', blockType: BlockType, then: LooseInstr[], else?: LooseInstr[] } => {
		const index = body.findIndex(i => i.op === 'else_marker');
		return index >= 0
			? { op: 'if', blockType, then: body.slice(0, index), else: body.slice(index + 1) } as const
			: { op: 'if', blockType, then: body} as const;
	}, v => {
		return {blockType: v.blockType, body: v.else ? [...v.then, { op: 'else_marker' }, ...v.else] : v.then};
	}),
	0x05:	makeInstr('else_marker', {}),
	0x0b:	makeInstr('end_block', {}),
	0x0E:	makeInstr('br_table', { labels: bin.Array(U32, INDEX), default: INDEX }),
	0x11:	makeInstr('call_indirect', { typeIndex: INDEX, tableIndex: U32 }),
	0x13:	makeInstr('return_call_indirect', { typeIndex: U32, tableIndex: U32 }),
	0x1B:	makeInstr('select', {}),
	0x1C:	makeImm('select.t', bin.Array(U32, ValType)),
	0xD0:	makeInstr('ref.null', {typeIndex: HeapType}),
	0x3F:	makeImm('memory.size', U32),
	0x40:	makeImm('memory.grow', U32),
	0x41:	makeImm('i32.const', S32),
	0x42:	makeImm('i64.const', SLEB128),
	0x43:	makeImm('f32.const', bin.Float32_LE),
	0x44:	makeImm('f64.const', bin.Float64_LE),
	...mapTable(ROOT_OPS.NONE, {}),
	...mapTable(ROOT_OPS.INDEX, { index: INDEX }),
	...mapTable(ROOT_OPS.MEM, { align: U32, offset: U32 }),

	0xfb: bin.Switch(bin.UINT8, {
		24:	makeInstr('br_on_cast', InstrBrCast),
		25:	makeInstr('br_on_cast_fail', InstrBrCast),
		...mapTable(FB_OPS.NONE, {}),
		...mapTable(FB_OPS.TYPE, {typeIndex: INDEX}),
		...mapTable(FB_OPS.TYPE_FIELD, {typeIndex: INDEX, field: U32 }),
		...mapTable(FB_OPS.ARRAY_NOTYPE, {typeIndex: INDEX}),
		...mapTable(FB_OPS.TYPE_N, {typeIndex: INDEX, n: U32 }),
		...mapTable(FB_OPS.TYPE_SEG, {typeIndex: INDEX, segIndex: INDEX }),
		...mapTable(FB_OPS.TYPE2, { dst: INDEX, src: INDEX }),
		...mapTable(FB_OPS.ONETYPE_NOIDX, {typeIndex: INDEX}),
		...mapTable(FB_OPS.REFTYPE, {typeIndex: ValType}),
	}, v => FB_INV[v.op]),

	0xfc: bin.Switch(bin.UINT8, {
		...mapTable(FC_OPS.NONE, {}),
		...mapTable(FC_OPS.INDEX, { index: INDEX }),
		...mapTable(FC_OPS.INDEX2, { seg: INDEX, target: INDEX }),
	}, v => FC_INV[v.op]),

	0xfd: bin.Switch(U32, {
		0x0c: makeImm('v128.const', bin.Buffer(16)),
		0x0d: makeImm('i8x16.shuffle', bin.Array(16, bin.UINT8)),
		...mapTable(SIMD_OPS.MEM, { align: U32, offset: U32 }),
		...mapTable(SIMD_OPS.LANE, { lane: bin.UINT8 }),
		...mapTable(SIMD_OPS.LANEMEM, { align: U32, offset: U32, lane: bin.UINT8 }),
		...mapTable(SIMD_OPS.NONE, {}),
	}, v => SIMD_INV[v.op]),

	0xfe: bin.Switch(bin.UINT8, {
		0x03: bin.as({ _: bin.Expect(bin.UINT8, 0) },
			() => ({ op: 'atomic.fence' as const }),
			() => ({ _: undefined })
		),
		...mapTable(THREAD_OPS.MEM, { align: U32, offset: U32 }),
	}, v => THREAD_INV[v.op]),

}, 	v => ROOT_INV[v.op]
	?? (FB_OPS_ALL.has(v.op) ? 0xfb : FC_OPS_ALL.has(v.op) ? 0xfc : SIMD_OPS_ALL.has(v.op) ? 0xfd : THREAD_OPS_ALL.has(v.op) ? 0xfe : 0x100)
);

export type Instr = bin.ReadType<typeof INSTR>;
export const ExprT = Block as bin.TypeT<Instr[]>;

//-----------------------------------------------------------------------------
//	shared: limits, table/memory/global types
//-----------------------------------------------------------------------------

// Only 3 of the 4 possible 2-bit flag values are real (2 -- shared, no max -- isn't valid wasm; memory64's extra bits aren't supported, see `default`).
// `shared` only appears as a key for flags=3 -- same "omit, don't set false" round-trip rule every optional field in this file follows.
const Limits = bin.Switch(bin.UINT8, {
	0: { min: U32 },
	1: { min: U32, max: U32 },
	3: { min: U32, max: U32, shared: bin.Const(true) },
	default: bin.Func((): never => { throw new Error('wasm: memory64/unrecognised limits flags are not supported'); }),
}, v => 'shared' in v ? 3 : 'max' in v ? 1 : 0);

// 0x40 (then a reserved 0x00) flags an explicit init expr -- disjoint from every reftype byte, so (unlike `BlockType`'s ambiguous lead byte) this is a plain `Switch`.
// `mapRecord`'s uniform-shape branches collapse together, so `ReadType` naturally derives just a 2-member union (with/without `init`) -- no hand-written interface needed.
type Limits = bin.ReadType<typeof Limits>;

const TableType = bin.Switch(bin.UINT8, {
	...mapRecord(VALTYPE_SWITCH, reftype => ({ reftype, limits: Limits })),
	0x40: bin.as(
		{ _: bin.Expect(bin.UINT8, 0), reftype: ValType, limits: Limits, init: ExprT },
		p => ({ reftype: p.reftype, limits: p.limits, init: p.init }),
		v => ({ reftype: v.reftype, limits: v.limits, init: v.init! })
	),
}, v => 'init' in v ? 0x40 : ValType.discriminator(v.reftype) as any);

export type TableType = bin.ReadType<typeof TableType>;

const MemType = Limits;

const GlobalType = { type: ValType, mut: bin.as(bin.UINT8, x => !!x, x => x ? 1 : 0) };
export type GlobalType = bin.ReadType<typeof GlobalType>;

//-----------------------------------------------------------------------------
//	sections
//-----------------------------------------------------------------------------

const Name = bin.String(U32, 'utf8');

// ---- type (1) ----
// Flattened across rec groups (see `RecType`); `groupSizes` keeps just enough to regroup identically on write, so callers needn't think about groups at all.
// Pure reshaping of `vec(rectype)` into one flat list + sizes -- exactly what `bin.as` is for, no custom get/put needed.
const TypeSection = bin.as(bin.Array(U32, RecType),
	groups => ({ types: groups.flat(), groupSizes: groups.map(g => g.length) }),
	v => {
		const groups = [];
		let i = 0;
		for (const n of v.groupSizes) {
			groups.push(v.types.slice(i, i + n));
			i += n;
		}
		return groups;
	}
);

// ---- import (2) ----
const ImportDesc = bin.Switch(bin.UINT8, {
	0x00: { kind: bin.Const('func'),	typeIndex: U32 },
	0x01: { kind: bin.Const('table'),	type: TableType },
	0x02: { kind: bin.Const('memory'),	type: MemType },
	0x03: { kind: bin.Const('global'),	type: GlobalType },
	0x04: { kind: bin.Const('tag'),	attribute: bin.UINT8, typeIndex: U32 },
}, (v: any) => v.kind === 'func' ? 0x00 : v.kind === 'table' ? 0x01 : v.kind === 'memory' ? 0x02 : v.kind === 'global' ? 0x03 : 0x04);
const Import		= { module: Name, name: Name, desc: ImportDesc };
export type Import	= bin.ReadType<typeof Import>;
const ImportSection = bin.Array(U32, Import);

// ---- function (3) ----
const FunctionSection = bin.Array(U32, U32);

// ---- table (4) ----
const TableSection	= bin.Array(U32, TableType);

// ---- memory (5) ----
const MemorySection = bin.Array(U32, MemType);

// ---- global (6) ----
const Global		= { type: GlobalType, init: ExprT };
const GlobalSection	= bin.Array(U32, Global);

// ---- export (7) ----
const EXPORT_KIND = ['func', 'table', 'memory', 'global'] as const;
const Export = {
	name: Name,
	kind: bin.as(bin.UINT8,
		b => {
			const kind = EXPORT_KIND[b];
			if (!kind)
				throw new Error('wasm: unrecognised export kind');
			return kind;
		},
		(kind: typeof EXPORT_KIND[number]) => EXPORT_KIND.indexOf(kind)
	),
	index: U32
};
export type Export	= bin.ReadType<typeof Export>;
const ExportSection = bin.Array(U32, Export);

// ---- start (8) ----
const StartSection = U32;

// ---- element (9) ----
// Flags (u32, values 0-7 only): bit0 = passive/declarative vs active; bit1 = explicit table (active) or declarative (non-active); bit2 = full `vec(expr)`+reftype vs `vec(funcidx)`+elemkind shorthand.
// Flags 0/4 (active, implicit table) skip the tag byte entirely and are always `funcref`.
const FUNCREF = { ref: 'func', nullable: true };

// All 8 flag values get their own `Switch` branch (see flags comment above) rather than deriving fields from bits imperatively; each reads only what that flag encodes.
// `as` fills in the implied `mode`/`reftype`/`table` on the way out, avoiding a stray always-undefined key -- same round-trip concern as the optional fields below.
const ElemSegment = bin.Switch(U32, {
	0: bin.as({ offset: ExprT, funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'active' as const, table: 0, offset: p.offset, reftype: FUNCREF, funcIndices: p.funcIndices })),
	1: bin.as({ _: bin.Expect(bin.UINT8, 0), funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'passive' as const, reftype: FUNCREF, funcIndices: p.funcIndices })),
	2: bin.as({ table: U32, offset: ExprT, _: bin.Expect(bin.UINT8, 0), funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'active' as const, table: p.table, offset: p.offset, reftype: FUNCREF, funcIndices: p.funcIndices }),
		v => ({ table: v.table ?? 0, offset: v.offset, funcIndices: v.funcIndices })),
	3: bin.as({ _: bin.Expect(bin.UINT8, 0), funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'declarative' as const, reftype: FUNCREF, funcIndices: p.funcIndices })),
	4: bin.as({ offset: ExprT, init: bin.Array(U32, ExprT) },
		p => ({ mode: 'active' as const, table: 0, offset: p.offset, reftype: FUNCREF, init: p.init })),
	5: bin.as({ reftype: ValType, init: bin.Array(U32, ExprT) },
		p => ({ mode: 'passive' as const, reftype: p.reftype, init: p.init })),
	6: bin.as({ table: U32, offset: ExprT, reftype: ValType, init: bin.Array(U32, ExprT) },
		p => ({ mode: 'active' as const, table: p.table, offset: p.offset, reftype: p.reftype, init: p.init }),
		v => ({ table: v.table ?? 0, offset: v.offset, reftype: v.reftype, init: v.init })),
	7: bin.as({ reftype: ValType, init: bin.Array(U32, ExprT) },
		p => ({ mode: 'declarative' as const, reftype: p.reftype, init: p.init })),
}, (v: any) => {
	const exprInit = v.init !== undefined;
	if (v.mode !== 'active')
		return (v.mode === 'declarative' ? 3 : 1) | (exprInit ? 4 : 0);
	return ((v.table ?? 0) !== 0 ? 2 : 0) | (exprInit ? 4 : 0);
});
const ElementSection = bin.Array(U32, ElemSegment);

// ---- code (10) ----
const Local			= { count: U32, type: ValType };
const FuncBody		= { locals: bin.Array(U32, Local), body: ExprT };
const CodeSection	= bin.Array(U32, bin.Size(U32, FuncBody));
export type Local 	= bin.ReadType<typeof Local>;
export type FuncBody = bin.ReadType<typeof FuncBody>;

// ---- data (11) ----
// `memory` (like `ElemSegment`'s `table`) is only present in the encoding at all when flags===2
// (explicit memory index) -- omitted here too, same round-trip-fidelity reason.
const DataSegment = bin.Switch(U32, {
	0: bin.as({ offset: ExprT, bytes: bin.Buffer(U32) },				p => ({ mode: 'active' as const, offset: p.offset, bytes: p.bytes })),
	1: bin.as({ bytes: bin.Buffer(U32) },								p => ({ mode: 'passive' as const, bytes: p.bytes })),
	2: bin.as({ memory: U32, offset: ExprT, bytes: bin.Buffer(U32) },	p => ({ mode: 'active' as const, memory: p.memory, offset: p.offset, bytes: p.bytes })),
}, v => v.mode === 'passive' ? 1 : 'memory' in v ? 2 : 0);
const DataSection = bin.Array(U32, DataSegment);

// ---- custom (0) ----
const CustomSection = { name: Name, data: bin.RemainingBuffer() };

//-----------------------------------------------------------------------------
//	module
//-----------------------------------------------------------------------------

const MAGIC		= 0x6d736100;	// bytes 00 61 73 6D ("\0asm"), read as one little-endian u32
const VERSION	= 1;

export type FuncSig = {params: ValType[], results: ValType[] };
export function equalFuncSig(a: FuncSig, b: FuncSig) {
	return a.params.length === b.params.length && a.results.length === b.results.length &&
		a.params.every((p, i) => p === b.params[i]) &&
		a.results.every((r, i) => r === b.results[i]);
}


const WasmSpec = {
	magic:		bin.Expect(bin.UINT32_LE, MAGIC),
	version:	bin.Expect(bin.UINT32_LE, VERSION),

	_:	bin.Merge(bin.RemainingRepeat({
		id:		bin.UINT8,
		_: bin.Merge(bin.Size(U32, bin.Switch(s => s.lookupObj('id'), {
				0:		{ customSections:	CustomSection		},
				1:		{ types:			TypeSection			},
				2:		{ imports:			ImportSection		},
				3:		{ functionTypes:	FunctionSection		},
				4:		{ tables:			TableSection		},
				5:		{ memories:			MemorySection		},
				6:		{ globals:			GlobalSection		},
				7:		{ exports:			ExportSection		},
				8:		{ start:			U32					},
				9:		{ elements:			ElementSection		},
				10:		{ code:				CodeSection			},
				11:		{ datas:			DataSection			},
				12:		{ dataCount:		U32	},
				default:	{ unknown: bin.RemainingBuffer() }
		})))
	}/*, (_, x) => {
		return [
			x.types,
			x.imports,
			x.functionTypes,
			x.tables,
			x.memories,
			x.globals,
			x.exports,
			x.start,
			x.elements,
			x.dataCount,
			x.code,
			x.datas,
			x.customSections,
		] as any[];
	}*/))
};

type WasmModuleData = bin.ReadType<typeof WasmSpec>;

export class WasmModule extends bin.Class(WasmSpec) {
	static check(data: Uint8Array): boolean {
		return data.length >= 8 && new bin.stream(data).read(bin.UINT32_LE) === MAGIC;
	}

	// The generated base only reads from a stream or constructs from a complete data object; this adds the two conveniences callers want:
	// build-then-mutate (`new WasmModule()`, then assign fields -- the style `towasm.ts`/this file's tests use), and reading raw bytes directly.
	constructor(arg?: bin._stream | Uint8Array | Partial<WasmModuleData>) {
		if (arg === undefined) {
			super({});
			//	types: { types: [], groupSizes: [] },
			//	imports: [], functionTypes: [], tables: [], memories: [], globals: [], exports: [],
			//	elements: [], code: [], datas: [],
			//);
			return;
		}
		if (arg instanceof Uint8Array)
			arg = new bin.stream(arg);
		super(arg);
		// Reading (not constructing) leaves 4 non-data artifacts: `magic`/`version` (validated `Expect` fields, always `undefined`), `_` (outer `Merge` placeholder, `{}`), `id` (last section's id byte).
		// Stripped so a freshly-read module matches one built directly from a data object.
		if (arg instanceof bin._stream) {
			const artifacts = this as { magic?: unknown; version?: unknown; _?: unknown; id?: unknown };
			delete artifacts.magic;
			delete artifacts.version;
			delete artifacts._;
			delete artifacts.id;
		}
	}

	write(s: bin._stream) {
		bin.UINT32_LE.put(s, MAGIC);
		bin.UINT32_LE.put(s, VERSION);
		const id = (n: number) => bin.UINT8.put(s, n);

		if (this.types)					{ id(1); bin.Size(U32, TypeSection).put(s, this.types); }
		if (this.imports)				{ id(2); bin.Size(U32, ImportSection).put(s, this.imports); }
		if (this.functionTypes)			{ id(3); bin.Size(U32, FunctionSection).put(s, this.functionTypes); }
		if (this.tables)				{ id(4); bin.Size(U32, TableSection).put(s, this.tables); }
		if (this.memories)				{ id(5); bin.Size(U32, MemorySection).put(s, this.memories); }
		if (this.globals)				{ id(6); bin.Size(U32, GlobalSection).put(s, this.globals); }
		if (this.exports)				{ id(7); bin.Size(U32, ExportSection).put(s, this.exports); }
		if (this.start !== undefined)	{ id(8); bin.Size(U32, StartSection).put(s, this.start); }
		if (this.elements)				{ id(9); bin.Size(U32, ElementSection).put(s, this.elements); }
		if (this.dataCount !== undefined) { id(12); bin.Size(U32, U32).put(s, this.dataCount); }
		if (this.code)					{ id(10); bin.Size(U32, CodeSection).put(s, this.code); }
		if (this.datas)					{ id(11); bin.Size(U32, DataSection).put(s, this.datas); }
		if (this.customSections)		{ id(0); bin.Size(U32, CustomSection).put(s, this.customSections); }
	}

	toBytes(): Uint8Array {
		const s = new bin.growingStream();
		this.write(s);
		return s.terminate();
	}

	// Quick text dump for visualising a module, mainly its function bodies -- not a spec-faithful WAT
	// pretty-printer: instructions are listed flat (unfolded), fields dumped generically, raw indices
	// only (no name section), and types/elements/data/start are omitted for brevity.
	toWAT(): string {
		const vt = (t: any): string => typeof t === 'string' ? t : `(ref${t.nullable ? ' null' : ''} ${t.ref})`;
		const arg = (v: any): string => v instanceof Uint8Array || Array.isArray(v) ? Array.from(v, (x: any) => typeof x === 'object' ? vt(x) : x).join(',') : typeof v === 'object' ? vt(v) : String(v);
		const render1 = (i: any) => `${i.op}${Object.keys(i).filter(k => k !== 'op').map(k => ' ' + arg(i[k])).join('')}`;
		const emit = (instrs: Instr[], depth: number, out: string[]) => {
			const pad = '  '.repeat(depth);
			for (const i of instrs) {
				if (i.op === 'block' || i.op === 'loop') {
					out.push(`${pad}${i.op}`);
					emit(i.body as Instr[], depth + 1, out);
				} else if (i.op === 'if') {
					emit(i.then as Instr[], depth + 1, out);
					if (i.else) {
						out.push(`${pad}else`);
						emit(i.else as Instr[], depth + 1, out);
					}
					out.push(`${pad}end`);
				} else {
					out.push(`${pad}${render1(i)}`);
				}
			}
		};

		const lines: string[] = ['(module'];
		for (const imp of this.imports ?? [])
			lines.push(`  (import "${imp.module}" "${imp.name}" (${imp.desc.kind}))`);
		for (const t of this.tables ?? [])
			lines.push(`  (table ${t.limits.min} ${(t.limits as any).max ?? ''} ${vt(t.reftype)})`);
		for (const m of this.memories ?? [])
			lines.push(`  (memory ${m.min} ${(m as any).max ?? ''})`);
		for (const g of this.globals ?? [])
			lines.push(`  (global ${g.type.mut ? `(mut ${vt(g.type.type)})` : vt(g.type.type)} ${g.init.map(render1).join(' ')})`);
		(this.functionTypes ?? []).forEach((t: number, i: number) => {
			lines.push(`  (func (;${i};) (type ${t})`);
			for (const l of this.code![i].locals)
				lines.push(`    (local ${Array(l.count).fill(vt(l.type)).join(' ')})`);
			emit(this.code![i].body, 2, lines);
			lines.push('  )');
		});
		for (const e of this.exports ?? [])
			lines.push(`  (export "${e.name}" (${e.kind} ${e.index}))`);
		lines.push(')');
		return lines.join('\n');
	}
}
