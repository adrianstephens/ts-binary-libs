/* eslint-disable @typescript-eslint/array-type */

//-----------------------------------------------------------------------------
//	memory utilities
//-----------------------------------------------------------------------------

export interface memory {
	length?: bigint;
	get(address: bigint, len: number): Uint8Array | Promise<Uint8Array>;
}

export class MappedMemory {
	static readonly	NONE	 	= 0;	// No permissions
	static readonly	READ	 	= 1;	// Read permission
	static readonly	WRITE		= 2;	// Write permission
	static readonly	EXECUTE  	= 4;	// Execute permission
	static readonly	RELATIVE	= 8;	// address is relative to dll base

	constructor(public data: Uint8Array, public address: bigint, public flags: number) {}
	resolveAddress(_base: number)		{ return this.address; }
	slice(begin: number, end?: number)	{ return new MappedMemory(this.data.subarray(begin, end), this.address + BigInt(begin), this.flags); }
	atRelative(begin: number, length?: number)	{ return this.slice(begin, length && (begin + length)); }
	at(begin: bigint, length?: number)	{ return this.atRelative(Number(begin - this.address), length); }
}


type ArrayCallback<A, R, T>	= (value: R, index: number, array: A) => T;
type ArrayReduction<A, R>	= (prev: R, curr: R, index: number, array: A) => R;

type ArrayMethod<R, F extends keyof Array<R>, A = ArrayLike<R>> = 
	F extends 'every' | 'filter' | 'find' | 'findIndex' | 'forEach' | 'map' | 'some'
	? (callback: ArrayCallback<A, R, any>, thisArg?: any) => any
	: F extends 'reduce' | 'reduceRight'
	? (callback: ArrayReduction<A, R>, initial?: R) => R
	: F extends 'copyWithin' | 'sort' | 'reverse' | 'fill'
	? MethodType<Array<R>[F], ArrayLike<R>>
	: Array<R>[F];

type MethodParams<M> = M extends (...args: infer P) => any ? P : never;
type MethodReturn<M> = M extends (...args: any[]) => infer R ? R : never;
type MethodType<M, R = MethodReturn<M>>	= (...args: MethodParams<M>) => R;

function arrayFunc<R, F extends keyof Array<R>>(array: ArrayLike<R>, func: F, ...args: MethodParams<ArrayMethod<R, F>>): MethodReturn<ArrayMethod<R, F>> {
	return (Array.prototype[func] as any).call(array, ...args);
}

export interface TypedArray<R = any> {
	buffer:			ArrayBufferLike;
	length:			number;
	byteLength:		number;
	byteOffset:		number;
    [n: number]:	R;
	[Symbol.iterator](): IterableIterator<R>;
	slice(begin:	number, end?: number): TypedArray<R>;
	subarray(begin: number, end?: number): TypedArray<R>;
	set(array: ArrayLike<R>, offset?: number): void;

	copyWithin:		MethodType<ArrayMethod<R, 'copyWithin'>>;
	every:			MethodType<ArrayMethod<R, 'every'>>;
	fill:			MethodType<ArrayMethod<R, 'fill'>>;
	filter:			MethodType<ArrayMethod<R, 'filter'>>;
	find:			MethodType<ArrayMethod<R, 'find'>>;
	findIndex:		MethodType<ArrayMethod<R, 'findIndex'>>;
	forEach:		MethodType<ArrayMethod<R, 'forEach'>>;
	indexOf:		MethodType<ArrayMethod<R, 'indexOf'>>;
	join:			MethodType<ArrayMethod<R, 'join'>>;
	lastIndexOf:	MethodType<ArrayMethod<R, 'lastIndexOf'>>;
	map:			MethodType<ArrayMethod<R, 'map'>>;
	reduce:			MethodType<ArrayMethod<R, 'reduce'>>;
	reduceRight:	MethodType<ArrayMethod<R, 'reduceRight'>>;
	reverse:		MethodType<ArrayMethod<R, 'reverse'>>;
	some:			MethodType<ArrayMethod<R, 'some'>>;
	sort:			MethodType<ArrayMethod<R, 'sort'>>;
	toString:		MethodType<ArrayMethod<R, 'toString'>>;
}
