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
