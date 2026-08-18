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

function inverse<K extends PropertyKey, V extends PropertyKey>(table: Record<K, V>) { return Object.fromEntries(Object.entries(table).map(([k, v]) => [v, k])) as Record<V, K>; }
const UnreadString	= bin.Optional(false, bin.String(0));

//-----------------------------------------------------------------------------
//	LEB128 (signed) -- the library only provides ULEB128
//-----------------------------------------------------------------------------

// Standard signed LEB128: 7 bits/byte, continuation in the top bit, sign bit is bit 6 of the last byte.
// Always decodes to `bigint` (i64.const needs the full 64-bit range); narrowed to `number` where it's known to fit.
const SLEB128: bin.TypeT<bigint> = {
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

const S32: bin.TypeT<number> = bin.as(SLEB128, x => Number(x)|0, x => BigInt(x|0));
// Same SLEB128 codec as `S32` but without the 32-bit wraparound -- for tag/index values
// (HeapType, ValType's own discriminator, BlockType's type-index fallback) that must round-trip
// exactly rather than wrap like a real i32 arithmetic value.
const S33: bin.TypeT<number> = bin.as(SLEB128, x => Number(x), x => BigInt(x));
// `bin.ULEB128` is typed `number|bigint` (values beyond 2^53 need the bigint case) -- narrowed to
// plain `number` here for vec-length/index/count fields, which never actually get that large.
const U32: bin.TypeT<number> = bin.as(bin.ULEB128, x => Number(x), x => BigInt(x));

//-----------------------------------------------------------------------------
//	value types
//-----------------------------------------------------------------------------

const NUM_TYPE = {
	i32:	-1,
	i64:	-2,
	f32:	-3,
	f64:	-4,
	v128:	-5,
} as const;

const ABSTRACT_HEAP = {
	exn:		-23,
	array:		-22,
	struct:		-21,
	i31:		-20,
	eq:			-19,
	any:		-18,
	extern:		-17,
	func:		-16,
	none:		-15,
	noextern:	-14,
	nofunc:		-13,
	noexn:		-12,
} as const;

const STORAGE_ONLY = { i8: -8, i16: -9 } as const;

type NumTypeName		= keyof typeof NUM_TYPE;
type AbstractHeapName	= keyof typeof ABSTRACT_HEAP;

const TAG_TABLE			= { ...NUM_TYPE, ...STORAGE_ONLY, ...ABSTRACT_HEAP} as const;
const TAG_TABLE_INV		= Invert(TAG_TABLE);

type RawType = number | NumTypeName | AbstractHeapName | 'i8' | 'i16' | { ref: number | AbstractHeapName, nullable: boolean } | undefined;

const RawType: bin.TypeT<RawType> = {
	get: (s: bin._stream): RawType => {
		const v = s.read(S33);
		if (v >= 0)
			return v;
		if (v === -64)
			return undefined;
		if (v === -28 || v === -29)
			return { ref: HeapType.get(s), nullable: v === -29 };
		const name = TAG_TABLE_INV[v as keyof typeof TAG_TABLE_INV];
		if (name === undefined)
			throw new Error(`wasm: unknown type tag ${v}`);
		return name;
	},
	put: (s, val) => {
		if (val === undefined)
			return s.write(S33, -64);
		if (typeof val === 'number')
			return s.write(S33, val);
		if (typeof val === 'object') {
			s.write(S33, val.nullable ? -29 : -28);
			return s.write(RawType, val.ref);
		}
		const tag = TAG_TABLE[val as keyof typeof TAG_TABLE];
		if (tag === undefined)
			throw new Error(`wasm: unknown type name ${val}`);
		s.write(S33, tag);
	}
};

const HeapType = bin.as(RawType, v => {
	if (typeof v === 'number' || (typeof v === 'string' && v in ABSTRACT_HEAP))
		return v as HeapType;
	throw new Error(`wasm: expected heaptype, got ${JSON.stringify(v)}`);
});
export type HeapType = number | AbstractHeapName;

const ValType: bin.TypeT<ValType> = bin.as(RawType, v => {
	if (v === undefined || (typeof v === 'string' && (v in STORAGE_ONLY)))
		throw new Error(`wasm: expected valtype, got ${JSON.stringify(v)}`);
	return v as ValType;
});
export type ValType = NumTypeName | { ref: HeapType; nullable: boolean };

const BlockType: bin.TypeT<BlockType> = bin.as(RawType, v => {
	if (typeof v === 'string' && (v in STORAGE_ONLY))
		throw new Error(`wasm: expected blocktype, got ${JSON.stringify(v)}`);
	return v as BlockType;
});
export type BlockType = ValType | undefined | { typeIndex: number };

//-----------------------------------------------------------------------------
//	GC composite/sub/rec types (struct/array/func), for the type section
//-----------------------------------------------------------------------------

const StorageType: bin.TypeT<StorageType> = bin.as(RawType, v => v as StorageType);
const FieldType	= { type: StorageType, mut: bin.as(bin.UINT8, x => !!x, x => x ? 1 : 0) };
const ParamType = { type: ValType, id: UnreadString };
const FuncSig	= { params: bin.Array(U32, ParamType), results: bin.Array(U32, ValType) };

export type StorageType	= ValType | 'i8' | 'i16';
export type FieldType	= bin.ReadType<typeof FieldType>;
export type ParamType	= bin.ReadType<typeof ParamType>;
export type FuncSig		= bin.ReadType<typeof FuncSig>;

export function equalFuncSig(a: FuncSig, b: FuncSig) {
	return a.params.length === b.params.length && a.results.length === b.results.length
		&& a.params.every((p, i) => p.type === b.params[i].type)
		&& a.results.every((r, i) => r === b.results[i]);
}
//export function equalType(a: FuncSig, b: FuncSig) {
//}

const COMPTYPE_SWITCH = {
	0x60: { kind: bin.Const('func'), 	...FuncSig },
	0x5F: { kind: bin.Const('struct'), 	fields: bin.Array(U32, FieldType) },
	0x5E: { kind: bin.Const('array'), 	field: FieldType },
};

const CompType = bin.Switch(bin.UINT8,
	COMPTYPE_SWITCH,
	v => v.kind === 'func' ? 0x60 : v.kind === 'struct' ? 0x5F : 0x5E
);
export type CompType = bin.ReadType<typeof CompType>;

const SUBTYPE_SWITCH = {
	...COMPTYPE_SWITCH,
	0x50: { supertypes: bin.Array(U32, U32), type: CompType, final: bin.Const(false) },
	0x4F: { supertypes: bin.Array(U32, U32), type: CompType, final: bin.Const(true) },
};
const SubType = bin.Switch(bin.UINT8,
	SUBTYPE_SWITCH,
	v => 'supertypes' in v ? (v.final ? 0x4F : 0x50) : CompType.discriminator(v) as any
);
export type SubType = (CompType | { supertypes: number[], type: CompType, final: boolean}) & {id?: string};

const RecType = bin.Switch(bin.UINT8, {
	0x4E: bin.Array(U32, SubType),
	...Object.fromEntries(Object.entries(SUBTYPE_SWITCH).map(([b, t]) => [Number(b), bin.as(t, v => [v], arr => arr[0])])),
	},
	v => v.length > 1 ? 0x4E : 'supertypes' in v[0] ? (v[0].final ? 0x4F : 0x50) : CompType.discriminator(v[0]) as any
);

//-----------------------------------------------------------------------------
//	instructions
//-----------------------------------------------------------------------------

export const ROOT_OPS = {
	NONE: {
		0x00: 'unreachable', 0x01: 'nop', 0x0F: 'return', 0x1A: 'drop',
		0xD1: 'ref.is_null', 0xD3: 'ref.eq', 0xD4: 'ref.as_non_null',
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
	INDEX: {
		LOCAL:		{ 0x20: 'local.get', 0x21: 'local.set', 0x22: 'local.tee'},
		GLOBAL:		{ 0x23: 'global.get', 0x24: 'global.set',},
		TABLE:		{ 0x25: 'table.get', 0x26: 'table.set'},
		FUNC: 		{ 0xD2: 'ref.func', 0x10: 'call', 0x12: 'return_call', 0x14: 'call_ref', 0x15: 'return_call_ref',},
		LABEL: 		{ 0x0C: 'br', 0x0D: 'br_if', 0xD5: 'br_on_null', 0xD6: 'br_on_non_null'},
	},
	MEM: {
		0x28: 'i32.load', 0x29: 'i64.load', 0x2A: 'f32.load', 0x2B: 'f64.load',
		0x2C: 'i32.load8_s', 0x2D: 'i32.load8_u', 0x2E: 'i32.load16_s', 0x2F: 'i32.load16_u',
		0x30: 'i64.load8_s', 0x31: 'i64.load8_u', 0x32: 'i64.load16_s', 0x33: 'i64.load16_u', 0x34: 'i64.load32_s', 0x35: 'i64.load32_u',
		0x36: 'i32.store', 0x37: 'i64.store', 0x38: 'f32.store', 0x39: 'f64.store',
		0x3A: 'i32.store8', 0x3B: 'i32.store16', 0x3C: 'i64.store8', 0x3D: 'i64.store16', 0x3E: 'i64.store32',
	},
	OTHERS: {
		0x02: 'block', 0x03: 'loop', 0x04: 'if', 0x05: 'else_marker', 0x0b: 'end_block',
		0x0E: 'br_table', 0x11: 'call_indirect', 0x13: 'return_call_indirect', 0x1B: 'select', 0xD0: 'ref.null',
		0x3F: 'memory.size', 0x40: 'memory.grow',
		0x41: 'i32.const', 0x42: 'i64.const', 0x43: 'f32.const', 0x44: 'f64.const',
	}
} as const;

// 0xFB-prefixed (GC).
export const FB_OPS = {
	NONE: 			{ 15:'array.len',	26: 'any.convert_extern', 27: 'extern.convert_any', 28: 'ref.i31', 29: 'i31.get_s', 30: 'i31.get_u' },
	TYPE: 			{ 0: 'struct.new', 1: 'struct.new_default', 6: 'array.new', 7: 'array.new_default', 11: 'array.get', 12: 'array.get_s', 13: 'array.get_u', 14: 'array.set', 16: 'array.fill' },
	TYPE_FIELD: 	{ 2: 'struct.get', 3: 'struct.get_s', 4: 'struct.get_u', 5: 'struct.set' },
	TYPE_N: 		{ 8: 'array.new_fixed' },
	TYPE_SEG: 		{
		DATA: { 9: 'array.new_data', 18: 'array.init_data' },
		ELEM: {10: 'array.new_elem', 19: 'array.init_elem' },
	},
	TYPE2: 			{ 17: 'array.copy' },
	REFTYPE: 		{ 20: 'ref.test', 22: 'ref.cast' },
	OTHERS:			{ 24: 'br_on_cast', 25: 'br_on_cast_fail'},
} as const;

// 0xFC-prefixed: saturating float-to-int conversions (0-7), bulk memory (8-11), table ops (12-17).
export const FC_OPS = {
	NONE: {
		0: 'i32.trunc_sat_f32_s', 1: 'i32.trunc_sat_f32_u', 2: 'i32.trunc_sat_f64_s', 3: 'i32.trunc_sat_f64_u',
		4: 'i64.trunc_sat_f32_s', 5: 'i64.trunc_sat_f32_u', 6: 'i64.trunc_sat_f64_s', 7: 'i64.trunc_sat_f64_u',
	},
	INDEX: {
		DATA:	{ 9: 'data.drop' },
		ELEM: 	{13: 'elem.drop' },
		TABLE:	{15: 'table.grow', 16: 'table.size', 17: 'table.fill'}
	},
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
	NONE: {
		0x4d: 'v128.not', 0x4e: 'v128.and', 0x4f: 'v128.andnot', 0x50: 'v128.or', 0x51: 'v128.xor', 0x52: 'v128.bitselect', 0x53: 'v128.any_true',

		0x0e: 'i8x16.swizzle', 0x0f: 'i8x16.splat', 0x10: 'i16x8.splat', 0x11: 'i32x4.splat', 0x12: 'i64x2.splat', 0x13: 'f32x4.splat', 0x14: 'f64x2.splat',
		0x23: 'i8x16.eq', 0x24: 'i8x16.ne', 0x25: 'i8x16.lt_s', 0x26: 'i8x16.lt_u', 0x27: 'i8x16.gt_s', 0x28: 'i8x16.gt_u', 0x29: 'i8x16.le_s', 0x2a: 'i8x16.le_u', 0x2b: 'i8x16.ge_s', 0x2c: 'i8x16.ge_u',
		0x60: 'i8x16.abs', 0x61: 'i8x16.neg', 0x62: 'i8x16.popcnt', 0x63: 'i8x16.all_true', 0x64: 'i8x16.bitmask',
		0x65: 'i8x16.narrow_i16x8_s', 0x66: 'i8x16.narrow_i16x8_u',
		0x6b: 'i8x16.shl', 0x6c: 'i8x16.shr_s', 0x6d: 'i8x16.shr_u', 0x6e: 'i8x16.add', 0x6f: 'i8x16.add_sat_s', 0x70: 'i8x16.add_sat_u',
		0x71: 'i8x16.sub', 0x72: 'i8x16.sub_sat_s', 0x73: 'i8x16.sub_sat_u',
		0x76: 'i8x16.min_s', 0x77: 'i8x16.min_u', 0x78: 'i8x16.max_s', 0x79: 'i8x16.max_u',
		0x7b: 'i8x16.avgr_u', 0x7c: 'i16x8.extadd_pairwise_i8x16_s', 0x7d: 'i16x8.extadd_pairwise_i8x16_u', 0x7e: 'i32x4.extadd_pairwise_i16x8_s', 0x7f: 'i32x4.extadd_pairwise_i16x8_u',

		0x2d: 'i16x8.eq', 0x2e: 'i16x8.ne', 0x2f: 'i16x8.lt_s', 0x30: 'i16x8.lt_u', 0x31: 'i16x8.gt_s', 0x32: 'i16x8.gt_u', 0x33: 'i16x8.le_s', 0x34: 'i16x8.le_u', 0x35: 'i16x8.ge_s', 0x36: 'i16x8.ge_u',
		0x80: 'i16x8.abs', 0x81: 'i16x8.neg', 0x82: 'i16x8.q15mulr_sat_s', 0x83: 'i16x8.all_true', 0x84: 'i16x8.bitmask', 0x85: 'i16x8.narrow_i32x4_s', 0x86: 'i16x8.narrow_i32x4_u',
		0x87: 'i16x8.extend_low_i8x16_s', 0x88: 'i16x8.extend_high_i8x16_s', 0x89: 'i16x8.extend_low_i8x16_u', 0x8a: 'i16x8.extend_high_i8x16_u',
		0x8b: 'i16x8.shl', 0x8c: 'i16x8.shr_s', 0x8d: 'i16x8.shr_u', 0x8e: 'i16x8.add', 0x8f: 'i16x8.add_sat_s', 0x90: 'i16x8.add_sat_u', 0x91: 'i16x8.sub', 0x92: 'i16x8.sub_sat_s', 0x93: 'i16x8.sub_sat_u',
		0x95: 'i16x8.mul', 0x96: 'i16x8.min_s', 0x97: 'i16x8.min_u', 0x98: 'i16x8.max_s', 0x99: 'i16x8.max_u',
		0x9b: 'i16x8.avgr_u', 0x9c: 'i16x8.extmul_low_i8x16_s', 0x9d: 'i16x8.extmul_high_i8x16_s', 0x9e: 'i16x8.extmul_low_i8x16_u', 0x9f: 'i16x8.extmul_high_i8x16_u',

		0x37: 'i32x4.eq', 0x38: 'i32x4.ne', 0x39: 'i32x4.lt_s', 0x3a: 'i32x4.lt_u', 0x3b: 'i32x4.gt_s', 0x3c: 'i32x4.gt_u', 0x3d: 'i32x4.le_s', 0x3e: 'i32x4.le_u', 0x3f: 'i32x4.ge_s', 0x40: 'i32x4.ge_u',
		0xa0: 'i32x4.abs', 0xa1: 'i32x4.neg', 0xa3: 'i32x4.all_true', 0xa4: 'i32x4.bitmask',
		0xa7: 'i32x4.extend_low_i16x8_s', 0xa8: 'i32x4.extend_high_i16x8_s', 0xa9: 'i32x4.extend_low_i16x8_u', 0xaa: 'i32x4.extend_high_i16x8_u',
		0xab: 'i32x4.shl', 0xac: 'i32x4.shr_s', 0xad: 'i32x4.shr_u', 0xae: 'i32x4.add', 0xb1: 'i32x4.sub',
		0xb5: 'i32x4.mul', 0xb6: 'i32x4.min_s', 0xb7: 'i32x4.min_u', 0xb8: 'i32x4.max_s', 0xb9: 'i32x4.max_u', 0xba: 'i32x4.dot_i16x8_s',
		0xbc: 'i32x4.extmul_low_i16x8_s', 0xbd: 'i32x4.extmul_high_i16x8_s', 0xbe: 'i32x4.extmul_low_i16x8_u', 0xbf: 'i32x4.extmul_high_i16x8_u',
		0xf8: 'i32x4.trunc_sat_f32x4_s', 0xf9: 'i32x4.trunc_sat_f32x4_u', 0xfc: 'i32x4.trunc_sat_f64x2_s_zero', 0xfd: 'i32x4.trunc_sat_f64x2_u_zero',

		0xc0: 'i64x2.abs', 0xc1: 'i64x2.neg', 0xc3: 'i64x2.all_true', 0xc4: 'i64x2.bitmask',
		0xc7: 'i64x2.extend_low_i32x4_s', 0xc8: 'i64x2.extend_high_i32x4_s', 0xc9: 'i64x2.extend_low_i32x4_u', 0xca: 'i64x2.extend_high_i32x4_u',
		0xcb: 'i64x2.shl', 0xcc: 'i64x2.shr_s', 0xcd: 'i64x2.shr_u', 0xce: 'i64x2.add', 0xd1: 'i64x2.sub',
		0xd5: 'i64x2.mul', 0xd6: 'i64x2.eq', 0xd7: 'i64x2.ne', 0xd8: 'i64x2.lt_s', 0xd9: 'i64x2.gt_s', 0xda: 'i64x2.le_s', 0xdb: 'i64x2.ge_s',
		0xdc: 'i64x2.extmul_low_i32x4_s', 0xdd: 'i64x2.extmul_high_i32x4_s', 0xde: 'i64x2.extmul_low_i32x4_u', 0xdf: 'i64x2.extmul_high_i32x4_u',

		0x41: 'f32x4.eq', 0x42: 'f32x4.ne', 0x43: 'f32x4.lt', 0x44: 'f32x4.gt', 0x45: 'f32x4.le', 0x46: 'f32x4.ge',
		0x67: 'f32x4.ceil', 0x68: 'f32x4.floor', 0x69: 'f32x4.trunc', 0x6a: 'f32x4.nearest',
		0xe0: 'f32x4.abs', 0xe1: 'f32x4.neg', 0xe3: 'f32x4.sqrt', 0xe4: 'f32x4.add', 0xe5: 'f32x4.sub', 0xe6: 'f32x4.mul', 0xe7: 'f32x4.div', 0xe8: 'f32x4.min', 0xe9: 'f32x4.max', 0xea: 'f32x4.pmin', 0xeb: 'f32x4.pmax',
		0xfa: 'f32x4.convert_i32x4_s', 0xfb: 'f32x4.convert_i32x4_u', 0x5e: 'f32x4.demote_f64x2_zero',

		0x47: 'f64x2.eq', 0x48: 'f64x2.ne', 0x49: 'f64x2.lt', 0x4a: 'f64x2.gt', 0x4b: 'f64x2.le', 0x4c: 'f64x2.ge',
		0x74: 'f64x2.ceil', 0x75: 'f64x2.floor', 0x7a: 'f64x2.trunc', 0x94: 'f64x2.nearest',
		0xec: 'f64x2.abs', 0xed: 'f64x2.neg', 0xef: 'f64x2.sqrt', 0xf0: 'f64x2.add', 0xf1: 'f64x2.sub', 0xf2: 'f64x2.mul', 0xf3: 'f64x2.div', 0xf4: 'f64x2.min', 0xf5: 'f64x2.max', 0xf6: 'f64x2.pmin', 0xf7: 'f64x2.pmax',
		0xfe: 'f64x2.convert_low_i32x4_s', 0xff: 'f64x2.convert_low_i32x4_u', 0x5f: 'f64x2.promote_low_f32x4',
		
	},
	OTHERS: {0x0c: 'v128.const', 0x0d: 'i8x16.shuffle'}
} as const;

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

interface OPTABLE {[K: string]: Record<number, string> | OPTABLE;}

type Invert<T>		= { [K in keyof T as T[K] & PropertyKey]: K };
function Invert<T>(x: T) { return Object.fromEntries(Object.entries(x as any).map(([k, v]) => [v, k])) as Invert<T>; }

type Expand<T>		= T extends infer O ? { [K in keyof O]: O[K] } : never;
function Expand<T>(x: T): Expand<T> { return x as Expand<T>; }

type UnsignedAliases<T extends string> =
	& {[K in T as K extends `i${infer Middle}_s` ? `i${Middle}` : never]:	K}
	& {[K in T as K extends `i${infer Middle}_s` ? (`i${Middle}_u` extends T ? `u${Middle}` : never) : never]: K extends `i${infer Middle}_s` ? `i${Middle}_u` : never}

function makeUnsignedAliases<T extends string>(OP: T[]) {
	const alias: Record<string, any> = {};
	for (const m of OP) {
		if (m.endsWith('_s') && m[0] === 'i') {
			alias[`${m.slice(0, -2)}`] = m;
			alias[`u${m.slice(1, -2)}`] = m.slice(0, -2) + '_u';
		}
	}
	return alias as UnsignedAliases<T>;
}

type FlattenOps<T>	= T[keyof T] extends string ? Invert<T> : UnionToIntersection<{ [K in keyof T]: FlattenOps<T[K]> }[keyof T]>;
class TableBuilder<T extends object> {
	constructor(private root: T) {}
	flatten<S extends OPTABLE>(page: number, obj: S): TableBuilder<T & FlattenOps<S>> {
		for (const [byte, mnemonic] of Object.entries(obj)) {
			if (typeof mnemonic !== 'string')
				this.flatten(page, mnemonic);
			else
				(this.root as any)[mnemonic] = (page << 8) + Number(byte);
		}
		return this as never;
	}
	build(): T { return this.root; }
}

const OP = new TableBuilder({})
.flatten(0x00, ROOT_OPS)
.flatten(0xfb, FB_OPS)
.flatten(0xfc, FC_OPS)
.flatten(0xfd, SIMD_OPS)
.flatten(0xfe, THREAD_OPS)
.build();

function opSub(v: {op: string}) {
	const packed = (OP as any)[v.op];
	return packed === undefined ? 0x100 : packed & 0xff;
}

const Index			= bin.as(U32, u => u as number| string, x => +x);
export type Index	= number | string;

export type LooseInstr = { op: string; [key: string]: any };

const Block: bin.TypeT<LooseInstr[]> = bin.Func((s, v) => {
	if (v) {
		for (const i of v)
			s.write(Instr, i as Instr);
		bin.UINT8.put(s, 0x0B);
		return v;
	} else {
		const body: Instr[] = [];
		for (;;) {
			const i = s.read(Instr);
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
function mapTable<T extends Record<number, string>, R extends bin.Type>(table: T, type: R) {
	return Object.fromEntries(Object.entries(table).map(([k, op]) => [Number(k), makeInstr(op, type)])) as {
		[K in keyof T]: ReturnType<typeof makeInstr<T[K] & string, R>>
	};
}

const Instr = bin.Switch(bin.UINT8, {
	0x02:	makeInstr('block',	{ blockType: BlockType, body: Block, label: UnreadString }),
	0x03:	makeInstr('loop',	{ blockType: BlockType, body: Block, label: UnreadString }),
	0x04:	bin.as({ blockType: BlockType, body: Block }, ({ blockType, body }): { op: 'if', blockType: BlockType, then: LooseInstr[], else?: LooseInstr[], label?: string } => {
		const index = body.findIndex(i => i.op === 'else_marker');
		return index >= 0
			? { op: 'if', blockType, then: body.slice(0, index), else: body.slice(index + 1) } as const
			: { op: 'if', blockType, then: body } as const;
	}, v => {
		return {blockType: v.blockType, body: v.else ? [...v.then, { op: 'else_marker' }, ...v.else] : v.then };
	}),
	0x05:	makeInstr('else_marker', {}),
	0x0b:	makeInstr('end_block', {}),
	0x0E:	makeInstr('br_table',		{ labels: bin.Array(U32, Index), default: Index }),
	0x11:	makeInstr('call_indirect',	{ typeIndex: Index, tableIndex: U32 }),
	0x13:	makeInstr('return_call_indirect',	{ typeIndex: Index, tableIndex: Index }),
	0x1B:	makeInstr('select', {}),
	0x1C:	makeInstr('select',			{ imm: bin.Array(U32, ValType) }),
	0xD0:	makeInstr('ref.null', 		{ typeIndex: HeapType }),
	0x3F:	makeInstr('memory.size',	{ imm: U32 }),
	0x40:	makeInstr('memory.grow',	{ imm: U32 }),
	0x41:	makeInstr('i32.const', 		{ imm: S32 }),
	0x42:	makeInstr('i64.const', 		{ imm: SLEB128 }),
	0x43:	makeInstr('f32.const', 		{ imm: bin.Float32_LE }),
	0x44:	makeInstr('f64.const', 		{ imm: bin.Float64_LE }),
	...mapTable(ROOT_OPS.NONE, {}),
	...mapTable(ROOT_OPS.INDEX.LOCAL,	{ localIndex: Index }),
	...mapTable(ROOT_OPS.INDEX.GLOBAL,	{ globalIndex: Index }),
	...mapTable(ROOT_OPS.INDEX.TABLE,	{ tableIndex: Index }),
	...mapTable(ROOT_OPS.INDEX.FUNC,	{ funcIndex: Index }),
	...mapTable(ROOT_OPS.INDEX.LABEL,	{ label: Index }),
	...mapTable(ROOT_OPS.MEM, 			{ align: U32, offset: U32 }),

	0xfb: bin.Switch(bin.UINT8, {
		20:	makeInstr('ref.test', 			{ typeIndex: HeapType, nullable: bin.Const(false) }),
		21:	makeInstr('ref.test', 			{ typeIndex: HeapType, nullable: bin.Const(true) }),
		22:	makeInstr('ref.cast', 			{ typeIndex: HeapType, nullable: bin.Const(false) }),
		23:	makeInstr('ref.cast', 			{ typeIndex: HeapType, nullable: bin.Const(true) }),
		24:	makeInstr('br_on_cast', 		{ flags: bin.UINT8, label: U32, from: HeapType, to: HeapType }),
		25:	makeInstr('br_on_cast_fail',	{ flags: bin.UINT8, label: U32, from: HeapType, to: HeapType }),
		...mapTable(FB_OPS.NONE, {}),
		...mapTable(FB_OPS.TYPE,			{ typeIndex: Index}),
		...mapTable(FB_OPS.TYPE_FIELD,		{ typeIndex: Index, field: U32 }),
		...mapTable(FB_OPS.TYPE_N,			{ typeIndex: Index, n: U32 }),
		...mapTable(FB_OPS.TYPE_SEG.DATA,	{ typeIndex: Index, dataIndex: Index }),
		...mapTable(FB_OPS.TYPE_SEG.ELEM,	{ typeIndex: Index, elemIndex: Index }),
		...mapTable(FB_OPS.TYPE2,			{ dst: Index, src: Index }),
	}, v => {
		if (v.op === 'ref.test' || v.op === 'ref.cast')
			return (v.op === 'ref.test' ? 20 : 22) + (v.nullable ? 1 : 0);
		return opSub(v);
	}),

	0xfc: bin.Switch(bin.UINT8, {
		...mapTable(FC_OPS.NONE, {}),
		9:	makeInstr('data.drop',			{ dataIndex: Index }),
		13:	makeInstr('elem.drop',			{ elemIndex: Index }),
		...mapTable(FC_OPS.INDEX.TABLE, 	{ tableIndex: Index }),
		...mapTable(FC_OPS.INDEX2,			{ seg: Index, target: Index }),
	}, opSub),

	0xfd: bin.Switch(U32, {
		0x0c: makeInstr('v128.const', 		{ imm: bin.Buffer(16) }),
		0x0d: makeInstr('i8x16.shuffle',	{ imm: bin.Array(16, bin.UINT8) }),
		...mapTable(SIMD_OPS.MEM,			{ align: U32, offset: U32 }),
		...mapTable(SIMD_OPS.LANE,			{ lane: bin.UINT8 }),
		...mapTable(SIMD_OPS.LANEMEM,		{ align: U32, offset: U32, lane: bin.UINT8 }),
		...mapTable(SIMD_OPS.NONE, {}),
	}, opSub),

	0xfe: bin.Switch(bin.UINT8, {
		0x03: bin.as({ _: bin.Expect(bin.UINT8, 0) },
			() => ({ op: 'atomic.fence' as const }),
			() => ({ _: undefined })
		),
		...mapTable(THREAD_OPS.MEM,		{ align: U32, offset: U32 }),
	}, opSub),

}, 	v => {
	if (v.op === 'select')
		return 'imm' in v && v.imm ? 0x1c : 0x1b;
	const packed = OP[v.op];
	return packed === undefined ? 0x100 : packed > 0xff ? packed >> 8 : packed;
});

export type Instr = bin.ReadType<typeof Instr>;
export const Expr = Block as bin.TypeT<Instr[]>;

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
const MemType = Limits;
export type Limits = bin.ReadType<typeof Limits>;

const TableType = { reftype: RawType,
	_: bin.If(s => s.lookupObj('reftype') === undefined, {
		reftype: bin.AfterSkip(2, ValType),
		limits: Limits,
		init: Expr
	}, {
		limits: Limits
	})
};
export type TableType = bin.ReadType<typeof TableType>;

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
	groups => ({ types: groups.flat() as SubType[], groupSizes: groups.map(g => g.length) }),
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
	0x01: { kind: bin.Const('table'),	type: TableType},
	0x02: { kind: bin.Const('memory'),	type: MemType },
	0x03: { kind: bin.Const('global'),	type: GlobalType },
	0x04: { kind: bin.Const('tag'),		attribute: bin.UINT8, typeIndex: U32 },
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

const Global		= { type: GlobalType, init: Expr, id: UnreadString };
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
const FUNCREF = { ref: 'func', nullable: true } as const;

export type ElementSegment = ({
	mode: "active";
	table: number;
	offset: Instr[];
} | {
	mode: "passive" | "declarative";
}) & {
	reftype: ValType | {
		ref: 'func';
		nullable: true;
	}
} & ({
	funcIndices: number[];
} | {
	init: Instr[][]
});

const ElemSegment: bin.TypeT<ElementSegment> = bin.Switch(U32, {
	0: bin.as({ offset: Expr, funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'active' as const, table: 0, offset: p.offset, reftype: FUNCREF, funcIndices: p.funcIndices })),
	1: bin.as({ _: bin.Expect(bin.UINT8, 0), funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'passive' as const, reftype: FUNCREF, funcIndices: p.funcIndices })),
	2: bin.as({ table: U32, offset: Expr, _: bin.Expect(bin.UINT8, 0), funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'active' as const, table: p.table, offset: p.offset, reftype: FUNCREF, funcIndices: p.funcIndices }),
		v => ({ table: v.table ?? 0, offset: v.offset, funcIndices: v.funcIndices })),
	3: bin.as({ _: bin.Expect(bin.UINT8, 0), funcIndices: bin.Array(U32, U32) },
		p => ({ mode: 'declarative' as const, reftype: FUNCREF, funcIndices: p.funcIndices })),
	4: bin.as({ offset: Expr, init: bin.Array(U32, Expr) },
		p => ({ mode: 'active' as const, table: 0, offset: p.offset, reftype: FUNCREF, init: p.init })),
	5: bin.as({ reftype: ValType, init: bin.Array(U32, Expr) },
		p => ({ mode: 'passive' as const, reftype: p.reftype, init: p.init })),
	6: bin.as({ table: U32, offset: Expr, reftype: ValType, init: bin.Array(U32, Expr) },
		p => ({ mode: 'active' as const, table: p.table, offset: p.offset, reftype: p.reftype, init: p.init }),
		v => ({ table: v.table ?? 0, offset: v.offset, reftype: v.reftype, init: v.init })),
	7: bin.as({ reftype: ValType, init: bin.Array(U32, Expr) },
		p => ({ mode: 'declarative' as const, reftype: p.reftype, init: p.init })),
}, (v: any) => {
	const exprInit = v.init !== undefined;
	if (v.mode !== 'active')
		return (v.mode === 'declarative' ? 3 : 1) | (exprInit ? 4 : 0);
	return ((v.table ?? 0) !== 0 ? 2 : 0) | (exprInit ? 4 : 0);
});

const ElementSection = bin.Array(U32, ElemSegment);

// ---- code (10) ----

const Local			= { count: U32, type: ValType, id: UnreadString };
const FuncBody		= { locals: bin.Array(U32, Local), body: Expr, id: UnreadString };
const CodeSection	= bin.Array(U32, bin.Size(U32, FuncBody));
export type Local 	= bin.ReadType<typeof Local>;
export type FuncBody = bin.ReadType<typeof FuncBody>;

// ---- data (11) ----

export type DataSegment = ({
	mode: "active";
	memory?: number;
	offset: (Instr)[];
} | {
	mode: "passive";
}) & {
	bytes: Uint8Array;
};

const DataSegment: bin.TypeT<DataSegment> = bin.Switch(U32, {
	0: bin.as({ offset: Expr, bytes: bin.Buffer(U32) },					p => ({ mode: 'active' as const, offset: p.offset, bytes: p.bytes })),
	1: bin.as({ bytes: bin.Buffer(U32) },								p => ({ mode: 'passive' as const, bytes: p.bytes })),
	2: bin.as({ memory: U32, offset: Expr, bytes: bin.Buffer(U32) },	p => ({ mode: 'active' as const, memory: p.memory, offset: p.offset, bytes: p.bytes })),
}, v => v.mode === 'passive' ? 1 : 'memory' in v ? 2 : 0);
const DataSection = bin.Array(U32, DataSegment);

// ---- custom (0) ----

const CustomSection = { name: Name, data: bin.RemainingBuffer() };

//-----------------------------------------------------------------------------
//	module
//-----------------------------------------------------------------------------

const MAGIC		= 0x6d736100;	// bytes 00 61 73 6D ("\0asm"), read as one little-endian u32
const VERSION	= 1;

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

export type WasmModuleData = bin.ReadType<typeof WasmSpec>;

export class WasmModule extends bin.Class(WasmSpec) {
	static check(data: Uint8Array): boolean {
		return data.length >= 8 && new bin.stream(data).read(bin.UINT32_LE) === MAGIC;
	}

	// The generated base only reads from a stream or constructs from a complete data object; this adds the two conveniences callers want:
	// build-then-mutate (`new WasmModule()`, then assign fields -- the style `towasm.ts`/this file's tests use), and reading raw bytes directly.
	constructor(arg?: bin._stream | Uint8Array | Partial<WasmModuleData>) {
		if (arg instanceof Uint8Array)
			arg = new bin.stream(arg);
		super(arg ?? {});
		if (arg instanceof bin._stream)
			delete this.id;
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
		if (this.datas) 				{ id(12); bin.Size(U32, U32).put(s, this.datas.length); }
		if (this.code)					{ id(10); bin.Size(U32, CodeSection).put(s, this.code); }
		if (this.datas)					{ id(11); bin.Size(U32, DataSection).put(s, this.datas); }
		if (this.customSections)		{ id(0); bin.Size(U32, CustomSection).put(s, this.customSections); }
	}

	toBytes(): Uint8Array {
		const s = new bin.growingStream();
		this.write(s);
		return s.terminate();
	}

	toWAT(options?: { expandTypes?: boolean; hexFloats?: boolean }): string {
		// --- value/heap type helpers ---
		const ht = (h: HeapType)					=> typeof h === 'number' ? String(h) : h;
		const vt = (t: StorageType)					=> typeof t === 'string' ? t : `(ref${t.nullable ? ' null' : ''} ${ht(t.ref)})`;
		const bt = (b: BlockType, label?: string)	=> (label ? ' ' + label : '') + (b === undefined ? '' : typeof b === 'object' && 'typeIndex' in b ? ` (type ${b.typeIndex})` : ` (result ${vt(b)})`);
		const limits = (l: Limits): string			=> 'max' in l ? `${l.min} ${l.max}` : String(l.min);
		const maybeid = (x?: { id?: string })		=> x?.id ? ' ' + x.id : '';

		const funcRef = (idx: Index): string => {
			if (typeof idx === 'number') {
				const id = this.code?.[idx - numImportedFuncs]?.id;
				if (id)
					return id;
			}
			return String(idx);
		};
		const loc = (idx: Index, locals: Local[]) => {
			if (typeof idx === 'number') {
				const id = locals[idx]?.id;
				if (id)
					return id;
			}
			return String(idx);
		};

		// --- composite type helpers ---
		const funcSig	= (params: ParamType[], results: ValType[]) => [...params.map(p => `(param${maybeid(p)} ${vt(p.type)})`), ...results.map(r => `(result ${vt(r)})`)].join(' ');
		const compType	= (v: CompType) => {
			switch (v.kind) {
				case 'func':	return `(func ${funcSig(v.params, v.results)})`;
				case 'struct':	return `(struct ${v.fields.map(f => `(field${f.mut ? ' (mut' : ''} ${vt(f.type)}${f.mut ? ')' : ''})`).join(' ')})`;
				case 'array':	return `(array${v.field.mut ? ' (mut' : ''} ${vt(v.field.type)}${v.field.mut ? ')' : ''})`;
			}
		};
		// --- instruction rendering ---
		const f32str: (v: number) => string = options?.hexFloats ? v => {
				const buf = new ArrayBuffer(4);
				new DataView(buf).setFloat32(0, v, true);
				return `0x${Array.from(new Uint8Array(buf)).reverse().map(b => b.toString(16).padStart(2,'0')).join('')}`;
			} : v => String(v);

		const f64str: (v: number) => string = options?.hexFloats ? v => {
				const buf = new ArrayBuffer(8);
				new DataView(buf).setFloat64(0, v, true);
				return `0x${Array.from(new Uint8Array(buf)).reverse().map(b => b.toString(16).padStart(2,'0')).join('')}`;
			} : v => String(v);

		const renderInstr = (i: Instr, locals: Local[]): string => {
			switch (i.op) {
				case 'i32.const': return `i32.const ${i.imm}`;
				case 'i64.const': return `i64.const ${i.imm}`;
				case 'f32.const': return `f32.const ${f32str(i.imm)}`;
				case 'f64.const': return `f64.const ${f64str(i.imm)}`;
				case 'v128.const': return `v128.const i8x16 ${Array.from(i.imm).join(' ')}`;
				case 'i8x16.shuffle': return `i8x16.shuffle ${(i.imm).join(' ')}`;
				case 'local.get': case 'local.set': case 'local.tee': return `${i.op} ${loc(i.localIndex, locals)}`;
				case 'global.get': case 'global.set': return `${i.op} ${i.globalIndex}`;
				case 'table.get': case 'table.set': case 'table.grow': case 'table.size': case 'table.fill': return `${i.op} ${i.tableIndex}`;
				case 'call': case 'return_call': case 'ref.func': case 'call_ref': case 'return_call_ref': return `${i.op} ${funcRef(i.funcIndex)}`;
				case 'br': case 'br_if': case 'br_on_null': case 'br_on_non_null': return `${i.op} ${i.label}`;
				case 'br_table': return `br_table ${(i.labels).join(' ')} ${i.default}`;
				case 'call_indirect': case 'return_call_indirect': return `${i.op} ${i.typeIndex} ${i.tableIndex}`;
				case 'select': return 'imm' in i && i.imm ? `select (result ${i.imm.map(vt).join(' ')})` : 'select';
				case 'ref.null': return `ref.null ${ht(i.typeIndex)}`;
				case 'ref.test': case 'ref.cast': return `${i.op} ${i.nullable ? '(ref null ' : '(ref '}${ht(i.typeIndex)})`;
				case 'memory.size': case 'memory.grow': return i.op;
				case 'memory.init': case 'table.init': return `${i.op} ${i.seg} ${i.target}`;
				case 'memory.copy': case 'table.copy': return `${i.op} ${i.seg} ${i.target}`;
				case 'memory.fill': return 'memory.fill';
				case 'data.drop': return `data.drop ${i.dataIndex}`;
				case 'elem.drop': return `elem.drop ${i.elemIndex}`;
				case 'struct.get': case 'struct.get_s': case 'struct.get_u': case 'struct.set': return `${i.op} ${i.typeIndex} ${i.field}`;
				case 'array.new_fixed': return `array.new_fixed ${i.typeIndex} ${i.n}`;
				case 'array.new_data': case 'array.init_data': return `${i.op} ${i.typeIndex} ${i.dataIndex}`;
				case 'array.new_elem': case 'array.init_elem': return `${i.op} ${i.typeIndex} ${i.elemIndex}`;
				case 'array.copy': return `array.copy ${i.dst} ${i.src}`;
				case 'br_on_cast': case 'br_on_cast_fail': return `${i.op} ${i.label} (ref${i.flags & 1 ? ' null' : ''} ${ht(i.from)}) (ref${i.flags & 2 ? ' null' : ''} ${ht(i.to)})`;
				case 'atomic.fence': return 'atomic.fence';
				default: {
					// memory ops (align/offset) and lane ops
					const parts: string[] = [i.op];
					if ('offset' in i && i.offset !== 0)
						parts.push(`offset=${i.offset}`);
					if ('align' in i && i.align !== 0)
						parts.push(`align=${1 << (i.align)}`);
					if ('lane' in i)
						parts.push(String(i.lane));
					// GC type-indexed ops with just typeIndex
					if ('typeIndex' in i) {
						if ((typeof i.typeIndex === 'number') && this.types?.types?.[i.typeIndex]?.id)
							parts.push(this.types.types[i.typeIndex].id!);
						else
							parts.push(String(i.typeIndex));
					}
					return parts.join(' ');
				}
			}
		};

		const emit = (instrs: Instr[], locals: Local[], depth: number, out: string[]) => {
			const pad = '  '.repeat(depth);
			for (const i of instrs) {
				if (i.op === 'block' || i.op === 'loop') {
					out.push(`${pad}${i.op}${bt(i.blockType, i.label)}`);
					emit(i.body as Instr[], locals, depth + 1, out);
					out.push(`${pad}end`);
				} else if (i.op === 'if') {
					out.push(`${pad}if${bt(i.blockType, i.label)}`);
					emit(i.then as Instr[], locals, depth + 1, out);
					if (i.else) {
						out.push(`${pad}else`);
						emit(i.else as Instr[], locals, depth + 1, out);
					}
					out.push(`${pad}end`);
				} else {
					out.push(`${pad}${renderInstr(i, locals)}`);
				}
			}
		};

		const emitExpr = (instrs: Instr[], depth: number, out: string[]) => {
			emit(instrs, [], depth, out);
			out.push('  '.repeat(depth) + 'end');
		};

		const lines: string[] = ['(module'];

		// --- types ---
		for (const t of this.types?.types ?? []) {
			lines.push(`  (type ${'supertypes' in t
				? `(sub${t.final ? ' final' : ''}${t.supertypes.map(s => ` ${s}`).join('')} ${compType(t.type)})`
				: compType(t)
			})`);
		}

		// --- imports ---
		for (const imp of this.imports ?? []) {
			const d = imp.desc;
			let s = '';
			switch (d.kind) {
				case 'func':	s = `(func (type ${d.typeIndex}))`; break;
				case 'table':	s = `(table ${limits(d.type.limits)} ${vt(d.type.reftype!)})`; break;
				case 'memory':	s = `(memory ${limits(d.type)})`; break;
				case 'global':	s = `(global ${d.type.mut ? `(mut ${vt(d.type.type)})` : vt(d.type.type)})`; break;
				default:		s = `(${d.kind})`; break;
			}
			lines.push(`  (import "${imp.module}" "${imp.name}" ${s})`);
		}

		// --- tables ---
		for (const t of this.tables ?? []) {
			if ('init' in t && t.init) {
				const initLines: string[] = [];
				emitExpr(t.init, 3, initLines);
				lines.push(`  (table ${limits(t.limits)} ${vt(t.reftype!)}`);
				lines.push(...initLines);
				lines.push('  )');
			} else {
				lines.push(`  (table ${limits(t.limits)} ${vt(t.reftype!)})`);
			}
		}

		// --- memories ---
		for (const m of this.memories ?? [])
			lines.push(`  (memory ${limits(m)})`);

		// --- globals ---
		for (const g of this.globals ?? []) {
			const initLines: string[] = [];
			emitExpr(g.init, 2, initLines);
			lines.push(`  (global${maybeid(g)} ${g.type.mut ? `(mut ${vt(g.type.type)})` : vt(g.type.type)}`);
			lines.push(...initLines.map(l => '  ' + l));
			lines.push('  )');
		}

		// --- functions ---
		const numImportedFuncs = (this.imports ?? []).filter(i => i.desc.kind === 'func').length;

		const getsig = (t: number) => {
			const st = this.types?.types[t];
			if (st) {
				const ct = 'supertypes' in st ? st.type : st;
				if (ct.kind === 'func')
					return ct;
			}
		};

		(this.functionTypes ?? []).forEach((t, i) => {
			const sig = getsig(t);
			let sigStr = sig && options?.expandTypes ? funcSig(sig.params, sig.results) : `(type ${t})`;

			const code = this.code?.[i];
			lines.push(`  (func${maybeid(code)} (;${numImportedFuncs + i};) ${sigStr}`);
			if (code) {
				const st = this.types?.types[t];
				if (st) {
					const ct = 'supertypes' in st ? st.type : st;
					if (ct.kind === 'func')
						sigStr = funcSig(ct.params, ct.results);
				}


				for (const l of code.locals)
					lines.push(`    (local${maybeid(l)}${Array(l.count).fill(` ${vt(l.type)}`).join('')})`);
				emit(code.body, [...(sig?.params.map(p => ({ count: 1, ...p })) || []), ...code.locals], 2, lines);
			}
			lines.push('  )');
		});

		// --- elements ---
		for (const e of this.elements ?? []) {
			const reftype = vt(e.reftype);
			const items = 'funcIndices' in e
				? e.funcIndices.map(fi => `(ref.func ${fi})`).join(' ')
				: e.init.map(expr => {
					const exprLines: string[] = [];
					emit(expr, [], 0, exprLines);
					return `(item ${exprLines.join(' ')})`;
				}).join(' ');
			if (e.mode === 'active') {
				const offsetLines: string[] = [];
				emit(e.offset, [], 0, offsetLines);
				lines.push(`  (elem (table ${e.table}) (offset ${offsetLines.join(' ')}) ${reftype} ${items})`);
			} else {
				lines.push(`  (elem ${e.mode === 'declarative' ? 'declare ' : ''}${reftype} ${items})`);
			}
		}

		// --- datas ---
		for (const d of this.datas ?? []) {
			const bytes = `"${Array.from(d.bytes).map(b => `\\${b.toString(16).padStart(2,'0')}`).join('')}"`;
			if (d.mode === 'active') {
				const offsetLines: string[] = [];
				emit(d.offset, [], 0, offsetLines);
				lines.push(`  (data (memory ${d.memory ?? 0}) (offset ${offsetLines.join(' ')}) ${bytes})`);
			} else {
				lines.push(`  (data ${bytes})`);
			}
		}

		// --- start ---
		if (this.start !== undefined)
			lines.push(`  (start ${this.start})`);

		// --- exports ---
		for (const e of this.exports ?? [])
			lines.push(`  (export "${e.name}" (${e.kind} ${e.index}))`);

		lines.push(')');
		return lines.join('\n');
	}
}


//-----------------------------------------------------------------------------
//	hand-authoring helpers
//-----------------------------------------------------------------------------

// generated from the same mnemonic/immediate-shape tables (ROOT_OPS/FB_OPS/etc, keyed by shape) that
// drive `mapTable` above, so hand-authored instructions can't drift from what the parser/writer accepts.

type InstrFactory	= (...args: any[]) => LooseInstr;
type InstrOrFactory	= InstrFactory | LooseInstr;

function insertFactory(root: any, mnemonic: string, fn: InstrOrFactory) {
	const path = mnemonic.split('.');
	let node = root;
	for (let i = 0; i < path.length - 1; i++)
		node = node[path[i]] ??= {};
	const key = path[path.length - 1];
	const existing = node[key];
	if (existing && typeof existing === 'object')
		Object.assign(fn, existing);
	node[key] = fn;
}
export type MemArg = { offset?: number; align?: number };

// Type-level mirror of the runtime nesting:
// `Split` breaks a dotted mnemonic into path segments,
// `Nest` rebuilds those segments as a nested object type,
// `UnionToIntersection` folds the union of per-mnemonic nested types into a single intersection
// if any mnemonic is both a leaf and a namespace prefix, intersecting a function type with an object type is what would give that leaf both a call signature and the nested property, same as at runtime.

type Split<S extends string> = S extends `${infer Head}.${infer Rest}` ? [Head, ...Split<Rest>] : [S];

type Nest<Path extends readonly string[], Fn> =
	Path extends readonly [infer Only extends string]
		? { [K in Only]: Fn }
		: Path extends readonly [infer Head extends string, ...infer Rest extends string[]]
			? { [K in Head]: Nest<Rest, Fn> }
			: never;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer R) => void ? R : never;

// Every leaf's result is just typed as `Instr` rather than narrowed to that leaf's own mnemonic literal to keep the .d.ts compact
type PerMnemonic<S extends string, Fn extends InstrOrFactory> =
	S extends any ? Nest<Split<S>, Fn extends InstrFactory ? (...args: Parameters<Fn>) => Instr : {op: S}> : never;

//type GroupTree<Table extends Record<number, string>, Fn extends InstrOrFactory> =
//	UnionToIntersection<PerMnemonic<Extract<Table[keyof Table], string>, Fn>>;
type IGroupTree<Table extends Record<string, unknown>, Fn extends InstrOrFactory> =
	UnionToIntersection<PerMnemonic<Extract<keyof Table, string>, Fn>>;

// An alias's type is whatever's already at the real mnemonic's path in the tree so far -- not
// `PerMnemonic`, which would bake the *alias* name itself into the leaf's `{op: ...}` literal.
type PathValue<T, Path extends readonly string[]> =
	Path extends readonly [infer Only extends string]
		? Only extends keyof T ? T[Only] : never
		: Path extends readonly [infer Head extends string, ...infer Rest extends string[]]
			? Head extends keyof T ? PathValue<T[Head], Rest> : never
			: never;
type AliasGroupTree<Table extends Record<string, string>, Base> =
	UnionToIntersection<{ [K in keyof Table]: K extends string ? Nest<Split<K>, PathValue<Base, Split<Table[K] & string>>> : never }[keyof Table]>;

class TreeBuilder<T extends object> {
	constructor(private root: T) {}
	group<Table extends Record<number, string>, Fn extends InstrOrFactory>(table: Table, make: <S extends string>(op: S) => Fn) {
		const inv = Invert(table);
		return this
			.groupI(inv, make)
			.groupAlias(makeUnsignedAliases(Object.keys(inv) as (keyof typeof inv)[]));
	}
	groupAlias<Table extends Record<string, string>>(table: Table): TreeBuilder<T & AliasGroupTree<Table, T>> {
		for (const [alias, real] of Object.entries(table))
			insertFactory(this.root, alias, (real as string).split('.').reduce((n: any, k: string) => n[k], this.root));
		return this as never;
	}
	groupI<Table extends Record<string, unknown>, Fn extends InstrOrFactory>(table: Table, make: <S extends string>(op: S) => Fn): TreeBuilder<T & IGroupTree<Table, Fn>> {
		for (const op of Object.keys(table))
			insertFactory(this.root, op, make(op));
		return this as never;
	}
	one<S extends string, Fn extends InstrOrFactory>(op: S, fn: Fn): TreeBuilder<T & PerMnemonic<S, Fn>> {
		insertFactory(this.root, op, fn);
		return this as never;
	}
	more<S>(s: S): TreeBuilder<T & S> {
		for (const [k, v] of Object.entries(s as object)) {
			const existing = (this.root as any)[k];
			(this.root as any)[k] = (typeof v === 'function' && existing && typeof existing === 'object')
				? Object.assign(v, existing)
				: v;
		}
		return this as never;
	}
	build(): T { return this.root; }
}

const shape = {
	none:		(op: string) => ({ op } as const),
	mem:		(op: string) => (arg: MemArg = {}) => ({ op, offset: arg.offset ?? 0, align: arg.align ?? 0 }),
};

const I0 = new TreeBuilder({})
	.group(ROOT_OPS.NONE,			shape.none)
	.group(ROOT_OPS.INDEX.LOCAL,	op => (localIndex: Index) => ({ op, localIndex }))
	.group(ROOT_OPS.INDEX.GLOBAL,	op => (globalIndex: Index) => ({ op, globalIndex }))
	.group(ROOT_OPS.INDEX.TABLE,	op => (tableIndex: Index) => ({ op, tableIndex }))
	.group(ROOT_OPS.INDEX.FUNC,		op => (funcIndex: Index) => ({ op, funcIndex }))
	.group(ROOT_OPS.INDEX.LABEL,	op => (label: Index) => ({ op, label }))
	.group(ROOT_OPS.MEM,			shape.mem)
	.group(FB_OPS.NONE,				shape.none)
	.group(FB_OPS.TYPE,				op => (typeIndex: Index) => ({ op, typeIndex }))
	.group(FB_OPS.TYPE_FIELD,		op => (typeIndex: Index, field: number) => ({ op, typeIndex, field }))
	.group(FB_OPS.TYPE_N,			op => (typeIndex: Index, n: number) => ({ op, typeIndex, n }))
	.group(FB_OPS.TYPE_SEG.DATA,	op => (typeIndex: Index, dataIndex: Index) => ({ op, typeIndex, dataIndex }))
	.group(FB_OPS.TYPE_SEG.ELEM,	op => (typeIndex: Index, elemIndex: Index) => ({ op, typeIndex, elemIndex }))
	.group(FB_OPS.TYPE2,			op => (dst: Index, src: Index) => ({ op, dst, src }))
	.group(FC_OPS.NONE,				shape.none)
	.group(FC_OPS.INDEX.TABLE,		op => (tableIndex: Index) => ({ op, tableIndex }))
	.group(FC_OPS.INDEX2,			(op: string) => (seg: Index, target: Index) => ({ op, seg, target }))
	.group(SIMD_OPS.MEM,			shape.mem)
	.group(SIMD_OPS.LANE,			(op: string) => (lane: number) => ({ op, lane }))
	.group(SIMD_OPS.LANEMEM,		(op: string) => (lane: number, arg: MemArg = {}) => ({ op, offset: arg.offset ?? 0, align: arg.align ?? 0, lane }))
	.group(SIMD_OPS.NONE,			shape.none)
	.group(THREAD_OPS.MEM,			shape.mem)
	// Everything below has a bespoke shape (block bodies, typed consts, reserved bytes, ...) and mirrors
	// INSTR's own hand-written cases above one-for-one -- not a uniform group, so `.one` not `.group`.
	.one('block',					(blockType: BlockType | undefined, body: Instr[]) => ({ op: 'block' as const, blockType, body }))
	.one('loop',					(blockType: BlockType | undefined, body: Instr[]) => ({ op: 'loop' as const, blockType, body }))
	.one('if',						(blockType: BlockType | undefined, then: Instr[], else_?: Instr[]) => else_ ? { op: 'if' as const, blockType, then, else: else_ } : { op: 'if' as const, blockType, then })
	.one('br_table',				(labels: Index[], default_: Index) => ({ op: 'br_table' as const, labels, default: default_ }))
	.one('call_indirect',			(typeIndex: Index, tableIndex = 0) => ({ op: 'call_indirect' as const, typeIndex, tableIndex }))
	.one('return_call_indirect',	(typeIndex: Index, tableIndex = 0) => ({ op: 'return_call_indirect' as const, typeIndex, tableIndex }))
	.one('select',					(imm?: ValType[]) => ({ op: 'select' as const, imm }))
	.one('ref.test',				(typeIndex: HeapType, nullable = false) => ({ op: 'ref.test' as const, typeIndex, nullable }))
	.one('ref.cast',				(typeIndex: HeapType, nullable = false) => ({ op: 'ref.cast' as const, typeIndex, nullable }))
	.one('ref.null',				(typeIndex: HeapType) => ({ op: 'ref.null' as const, typeIndex }))
	.one('memory.size',				(imm = 0) => ({ op: 'memory.size' as const, imm }))
	.one('memory.grow',				(imm = 0) => ({ op: 'memory.grow' as const, imm }))
	.one('i32.const',				(imm: number) => ({ op: 'i32.const' as const, imm: imm | 0 }))
	.one('i64.const',				(imm: bigint) => ({ op: 'i64.const' as const, imm }))
	.one('f32.const',				(imm: number) => ({ op: 'f32.const' as const, imm }))
	.one('f64.const',				(imm: number) => ({ op: 'f64.const' as const, imm }))
	.one('br_on_cast',				(flags: number, label: number, from: HeapType, to: HeapType) => ({ op: 'br_on_cast' as const, flags, label, from, to }))
	.one('br_on_cast_fail',			(flags: number, label: number, from: HeapType, to: HeapType) => ({ op: 'br_on_cast_fail' as const, flags, label, from, to }))
	.one('data.drop', 				(dataIndex: Index) => ({ op: 'data.drop' as const, dataIndex }))
	.one('elem.drop', 				(elemIndex: Index) => ({ op: 'elem.drop' as const, elemIndex }))
	.one('atomic.fence',			{ op: 'atomic.fence' as const })
	.one('v128.const',				(imm: Uint8Array) => ({ op: 'v128.const' as const, imm }))
	.one('i8x16.shuffle',			(imm: number[]) => ({ op: 'i8x16.shuffle' as const, imm }));

//export const I = I0.build();

const I1 = I0.build();

type Expr1<T> = Instr[];
type Expr<T> = Instr[] | Instr;
type i32 = number;

function flattenArgs(args: Expr<any>[]) {
	const out: Instr[] = [];
	for (const a of args)
		if (Array.isArray(a))
			out.push(...a);
		else
			out.push(a);
	return out;
}

export function fold<T>(instr: Instr, ...args: Expr<any>[]): Expr1<T> {
	return [...flattenArgs(args), instr];
}

export const I = I0.more({
	i32: Object.assign(function(imm: number)			{ return I1.i32.const(imm | 0); }, {
		load:	(offset: Expr<i32>, arg?: MemArg )	=> fold<i32>(I1.i32.load(arg), offset)
	}),
	i64: function(imm: number|bigint)	{ return I1.i64.const(BigInt(imm)); },
	f32: function(imm: number)			{ return I1.f32.const(imm); },
	f64: function(imm: number)			{ return I1.f64.const(imm); },

	// table(tableidx).op(named stack args...)
	// Stack order per spec: table.get [i] -> val; table.set [i, x]; table.grow [x, n] -> old_sz;
	// table.fill [i, x, n]; table.copy [dst, src, n]; table.init [dst, src, n]
	table: function<T>(tableidx: Index) { return {
		get:	(i: Expr<i32>)													=> fold<T>(I1.table.get(tableidx), i),
		set:	(i: Expr<i32>, x: Expr<T>)										=> fold<void>(I1.table.set(tableidx), i, x),
		size:	()																=> fold<i32>(I1.table.size(tableidx)),
		grow:	(x: Expr<T>, n: Expr<i32>)										=> fold<i32>(I1.table.grow(tableidx), x, n),
		fill:	(i: Expr<i32>, x: Expr<T>, n: Expr<i32>)						=> fold<void>(I1.table.fill(tableidx), i, x, n),
		copy:	(dst: Expr<i32>, src: Expr<i32>, n: Expr<i32>, srctable: Index)	=> fold<void>(I1.table.copy(tableidx, srctable), dst, src, n),
		init:	(dst: Expr<i32>, src: Expr<i32>, n: Expr<i32>, elemidx: Index)	=> fold<void>(I1.table.init(tableidx, elemidx), dst, src, n),
		drop:	(elemidx: Index)												=> fold<void>(I1.elem.drop(elemidx)),
	}; },

	// memory().op(named stack args...)
	// Stack order: memory.grow [n]; memory.fill [dst, val, n]; memory.copy [dst, src, n]; memory.init [dst, src, n]
	memory: function(memidx = 0) { return {
		size:	()																=> fold<i32>(I1.memory.size(memidx)),
		grow:	(n: Expr<i32>)													=> fold<i32>(I1.memory.grow(memidx), n),
		fill:	(dst: Expr<i32>, val: Expr<i32>, n: Expr<i32>)					=> fold<void>(I1.memory.fill(memidx, memidx), dst, val, n),
		copy:	(dst: Expr<i32>, src: Expr<i32>, n: Expr<i32>)					=> fold<void>(I1.memory.copy(memidx, memidx), dst, src, n),
		init:	(dst: Expr<i32>, src: Expr<i32>, n: Expr<i32>, dataidx: Index)	=> fold<void>(I1.memory.init(dataidx, memidx), dst, src, n),
		drop:	(dataidx: Index)												=> fold<void>(I1.data.drop(dataidx)),
	}; },

	// array(typeIndex).op(named stack args...)
	// Stack order per GC spec: array.new [n]; array.get [arr, i]; array.set [arr, i, x];
	// array.fill [arr, i, x, n]; array.copy [dst, di, src, si, n]
	array: function<T>(typeIndex: Index) { return {
//		new:		(n: Expr<i32>)												=> fold<T>(I1.array.new(typeIndex), n),
		new:		(n: Expr<i32>|number)										=> typeof n === 'number' ? I1.array.new_fixed(typeIndex, n) : fold<T>(I1.array.new(typeIndex), n),
		new_default:(n: Expr<i32>)												=> fold<T>(I1.array.new_default(typeIndex), n),
		new_fixed:	(...vals: Expr<T>[])										=> fold<T>(I1.array.new_fixed(typeIndex, vals.length), vals.flat()),
		new_data:	(n: Expr<i32>, src: Expr<i32>, dataidx: Index)				=> fold<T>(I1.array.new_data(typeIndex, dataidx), n, src),
		new_elem:	(n: Expr<i32>, src: Expr<i32>, elemidx: Index)				=> fold<T>(I1.array.new_elem(typeIndex, elemidx), n, src),
		get:		(arr: Expr<T[]>, i: Expr<i32>)								=> fold<T>(I1.array.get(typeIndex), arr, i),
		get_s:		(arr: Expr<T[]>, i: Expr<i32>)								=> fold<T>(I1.array.get_s(typeIndex), arr, i),
		get_u:		(arr: Expr<T[]>, i: Expr<i32>)								=> fold<T>(I1.array.get_u(typeIndex), arr, i),
		set:		(arr: Expr<T[]>, i: Expr<i32>, x: Expr<T>)					=> fold<void>(I1.array.set(typeIndex), arr, i,	x),
		fill:		(arr: Expr<T[]>, i: Expr<i32>, x: Expr<T>, n: Expr<i32>)	=> fold<void>(I1.array.fill(typeIndex), arr, i,	x,	n),
		copy:		(dst: Expr<T[]>, di: Expr<i32>, src: Expr<T[]>, si: Expr<i32>, n: Expr<i32>)=> fold<void>(I1.array.copy(typeIndex, typeIndex), dst, di, src, si, n),
		init_data:	(arr: Expr<T[]>, i: Expr<i32>, n: Expr<i32>, dataidx: Index)=> fold<void>(I1.array.init_data(typeIndex, dataidx), arr, i, n),
		init_elem:	(arr: Expr<T[]>, i: Expr<i32>, n: Expr<i32>, elemidx: Index)=> fold<void>(I1.array.init_elem(typeIndex, elemidx), arr, i, n),
		len:		(arr: Expr<T[]>)											=> fold<i32>(I1.array.len, arr),
	}; },

	// Stack order: struct.new [field0, field1, ...]; struct.get [obj]; struct.set [obj, x]
	// T is a tuple of field types, e.g. [number, bigint, string]
	struct: function<T extends readonly unknown[]>(typeIndex: Index) { return {
		new:		(...fields: { [K in keyof T]: Expr<T[K]> })					=> fold<T>(I1.struct.new(typeIndex), (fields as Expr<unknown>[]).flat()),
		new_default:()															=> fold<T>(I1.struct.new_default(typeIndex)),
		get:		<F extends number & keyof T>(obj: Expr<T>, fieldidx: F)		=> fold<T[F]>(I1.struct.get(typeIndex, fieldidx), obj),
		get_s:		<F extends number & keyof T>(obj: Expr<T>, fieldidx: F)		=> fold<T[F]>(I1.struct.get_s(typeIndex, fieldidx), obj),
		get_u:		<F extends number & keyof T>(obj: Expr<T>, fieldidx: F)		=> fold<T[F]>(I1.struct.get_u(typeIndex, fieldidx), obj),
		set:		<F extends number & keyof T>(obj: Expr<T>, fieldidx: F, x: Expr<T[F]>): Expr<void>	=> fold<void>(I1.struct.set(typeIndex, fieldidx), obj, x),
	}; },
}).build();
