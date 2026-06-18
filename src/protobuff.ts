import * as bin from '@isopodlabs/binary';

export interface Field<K extends string, T, R extends boolean> {
	key:		K;
	decode:		(v: any) => T;
	repeated:	R;
}

export type Schema = Record<number, Field<any, any, any>>;

type Fields<T extends Schema> = T[Extract<keyof T, number>];
type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Decoded<T extends Schema> = Simplify<{
	[F in Fields<T> as F['key']]: F extends Field<any, infer V, infer R> ? R extends true ? V[] : V : never;
}>;

export function Field<K extends string, T>(key: K, decode: (v: any) => T): Field<K, T, false> {
	return { key, decode, repeated: false };
}

export function Repeat<K extends string, T>(key: K, decode: (v: any) => T): Field<K, T, true> {
	return { key, decode, repeated: true };
}

export const Proto = bin.RemainingArray({
	_: bin.Merge(bin.as(bin.ULEB128, bin.bitfields.BitFields(0, {
		wire:	3,
		field:	29,
	} as const))),
	value: bin.Switch(s => s.obj.wire, {
		0: bin.ULEB128,
		1: bin.UINT64_LE,
		2: bin.Buffer(bin.ULEB128),
		5: bin.UINT32_LE,
	})
});

export function Proto2<T extends Schema>(schema: T) {
	return bin.as(Proto, fields => {
		const result: any = {};

		for (const f of fields) {
			const def = schema[f.field];
			if (!def)
				continue;

			const { key, decode, repeated } = def;
			const decoded = decode(f.value);
			if (repeated)
				(result[key] ??= []).push(decoded);
			else
				result[key] = decoded;
		}
		return result as Decoded<T>;
	});
}

// Proto decoders
export const varint		= (v: bigint | number) => Number(v);
export const sint32		= (v: bigint | number) => { const n = Number(v); return (n >>> 1) ^ -(n & 1); };
export const sint64		= (v: bigint | number) => { const n = BigInt(v); return (n >> 1n) ^ -(n & 1n); };
export const float32	= (v: number) => { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, v, true); return dv.getFloat32(0, true); };
export const float64	= (v: bigint) => { const dv = new DataView(new ArrayBuffer(8)); dv.setBigUint64(0, v, true); return dv.getFloat64(0, true); };
export const bytes		= (v: Uint8Array) => v;
export const str		= (v: Uint8Array) => new TextDecoder().decode(v);
export const bool		= (v: bigint | number) => Boolean(Number(v));
export const int64		= (v: bigint | number) => BigInt(v);
export function ref<T extends Schema>(schema: T) {
	return (data: Uint8Array) => new bin.stream(data).read(Proto2(schema));
}
export function forwardref(func: ()=>Schema) {
	return (data: Uint8Array) => new bin.stream(data).read(Proto2(func()));
}
export function Enum<E extends Record<string, number>>(_e: E) {
	return (data: number|bigint) => data as E[keyof E];
}
