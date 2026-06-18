import * as bin from '@isopodlabs/binary';

const GGUF_DEFAULT_ALIGNMENT = 32; // defined in ggml.h

function Quant<T>(name: string, desc: string, block: number, buffer: bin.typedArray.TypedArrayConstructor<T>) {
	return {name, desc, block, buffer};
}

function BlockBuffer<T extends bin.bitfields.Descriptor>(desc: T, index: (i: number, x: bin.bitfields.BitOutput<T>) => number) {
	return bin.typedArray.BitFields(bin.bitfields.Chain(desc, {
		to:		x => ({raw: x, get: (i: number) => index(i, x) }),
		from:	x => x.raw
	}));
}

const QuantizationTypes = {
	0: Quant('F32', "32-bit standard IEEE 754 single-precision floating-point number.", 1, Float32Array),
	1: Quant('F16', '16-bit standard IEEE 754 half-precision floating-point number.', 1, bin.typedArray.BitFields(bin.float16)),
	2: Quant('Q4_0', '4-bit round-to-nearest quantization (q). Each block has 32 weights. Weight formula: w = q * block_scale. Legacy quantization method (not used widely as of today).',
		32, BlockBuffer({
			scale:	bin.float16,
			q:		bin.bitfields.Array(32, 4)
		}, (i, x) => x.q[i] * +x.scale)
	),
	3: Quant('Q4_1', '4-bit round-to-nearest quantization (q). Each block has 32 weights. Weight formula: w = q * block_scale + block_minimum. Legacy quantization method (not used widely as of today).',
		32, BlockBuffer({
			scale:	bin.float16,
			offset:	bin.float16,
			q:		bin.bitfields.Array(32, 4)
		}, (i, x) => x.q[i] * +x.scale + +x.offset)
	),
	6: Quant('Q5_0', '5-bit round-to-nearest quantization (q). Each block has 32 weights. Weight formula: w = q * block_scale. Legacy quantization method (not used widely as of today).',
		32, BlockBuffer({
			scale:	bin.float16,
			qh:		bin.bitfields.Array(32, 1),
			ql:		bin.bitfields.Array(32, 4)
		}, (i, x) => (x.ql[i] + (x.qh[i] << 4)) * +x.scale),
	),
	7: Quant('Q5_1', '5-bit round-to-nearest quantization (q). Each block has 32 weights. Weight formula: w = q * block_scale + block_minimum. Legacy quantization method (not used widely as of today).',
		32, BlockBuffer({
			scale:	bin.float16,
			offset:	bin.float16,
			qh:		bin.bitfields.Array(32, 1),
			ql:		bin.bitfields.Array(32, 4)
		}, (i, x) => (x.ql[i] + (x.qh[i] << 4)) * +x.scale + +x.offset)
	),
	8: Quant('Q8_0', '8-bit round-to-nearest quantization (q). Each block has 32 weights. Weight formula: w = q * block_scale. Legacy quantization method (not used widely as of today).',
		32, BlockBuffer({
			scale:	bin.float16,
			q:		bin.bitfields.Array(32, 8)
		}, (i, x) => x.q[i] * +x.scale)
	),
	9: Quant('Q8_1', '8-bit round-to-nearest quantization (q). Each block has 32 weights. Weight formula: w = q * block_scale + block_minimum. Legacy quantization method (not used widely as of today).',
		32, BlockBuffer({
			scale:	bin.float32,
			offset: bin.float32,
			q:		bin.bitfields.Array(32, 8)
		}, (i, x) => x.q[i] * +x.scale + +x.offset)
	),
	10: Quant('Q2_K', '2-bit quantization (q). Super-blocks with 16 blocks, each block has 16 weight. Weight formula: w = q * block_scale(4-bit) + block_min(4-bit), resulting in 2.625 bits-per-weight.',
		256, BlockBuffer({
 			scales: bin.bitfields.Array(16, {scale: 4, offset: 4}),
			q: 	bin.bitfields.Array(256, 2),
 			scale: 	bin.float16,
 			offset: bin.float16,
		}, (i, x) => x.q[i] * +x.scale + +x.offset)
	),
	11: Quant('Q3_K', '3-bit quantization (q). Super-blocks with 16 blocks, each block has 16 weights. Weight formula: w = q * block_scale(6-bit), resulting. 3.4375 bits-per-weight.',
		 256, BlockBuffer({
			qh: 	bin.bitfields.Array(256, 1),
			ql: 	bin.bitfields.Array(256, 2),
 			scales: bin.bitfields.Array(16, 6),
 			scale: 	bin.float16,
		}, (i, x) => (x.ql[i] + (x.qh[i] << 2)) * x.scales[i / 16] * +x.scale)
	),
	12: Quant('Q4_K', '4-bit quantization (q). Super-blocks with 8 blocks, each block has 32 weights. Weight formula: w = q * block_scale(6-bit) + block_min(6-bit), resulting in 4.5 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
 			offset: bin.float16,
 			scales: bin.bitfields.Array(16, 6),
			q: 		bin.bitfields.Array(256, 4),
		}, (i, x) => x.q[i] * +x.scale + +x.offset)
	),
	13: Quant('Q5_K', '5-bit quantization (q). Super-blocks with 8 blocks, each block has 32 weights. Weight formula: w = q * block_scale(6-bit) + block_min(6-bit), resulting in 5.5 bits-per-weight.',
		 256, BlockBuffer({
 			scales: bin.bitfields.Array(16, 6),
			qh:		bin.bitfields.Array(256, 1),
			ql:		bin.bitfields.Array(256, 4),
 			scale: 	bin.float16,
 			offset: bin.float16,
		}, (i, x) => ((x.ql[i] + (x.qh[i] << 4)) * x.scales[i >> 4]) + +x.offset)
	),
	14: Quant('Q6_K', '6-bit quantization (q). Super-blocks with 16 blocks, each block has 16 weights. Weight formula: w = q * block_scale(8-bit), resulting in 6.5625 bits-per-weight.',
		 256, BlockBuffer({
			ql:		bin.bitfields.Array(256, 4),
			qh:		bin.bitfields.Array(256, 2),
 			scales: bin.bitfields.Array(16, 8),
 			scale: 	bin.float16,
		}, (i, x) => (x.ql[i] + (x.qh[i] << 4)) * x.scales[i >> 4])
	),
	15: Quant('Q8_K', '8-bit quantization (q). Each block has 256 weights. Only used for quantizing intermediate results. All 2-6 bit dot products are implemented for this quantization type. Weight formula: w = q * block_scale.',
		 256, BlockBuffer({
			scale:	bin.float32,
			qs:		bin.bitfields.Array(256, 8),
			bsums:	bin.bitfields.Array(16, -16)
		}, (i, x) => x.qs[i] * +x.scale)
	),
	16: Quant('IQ2_XXS', '2-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 2.06 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(256, 2),
		 }, (i, x) => x.q[i] * +x.scale)
	),
	17: Quant('IQ2_XS', '2-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 2.31 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(256, 2),
 			scales:	bin.bitfields.Array(8, 8),
		}, (i, x) => x.q[i] * x.scales[i >> 3] * +x.scale)
	),
	18: Quant('IQ3_XXS', '3-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 3.06 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(256, 2),
			qh:		bin.bitfields.Array(64, 1),
		}, (i, x) => (x.q[i] + (x.qh[i >> 2] << 2)) * +x.scale)
	),
	19: Quant('IQ1_S', '1-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 1.56 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			ql:		bin.bitfields.Array(256, 1),
			qh:		bin.bitfields.Array(8, 16),
		}, (i, x) => ((x.ql[i] | (x.qh[i >> 3] << i % 8)) & 0xff) * +x.scale)
	),
	20: Quant('IQ4_NL', '4-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix.',
		 32, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(32, 4),
		}, (i, x) => x.q[i] * +x.scale)
	),
	21: Quant('IQ3_S', '3-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 3.44 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(256, 2),
			qh:		bin.bitfields.Array(64, 1),
			signs:	bin.bitfields.Array(256, 1),
 			scales:	bin.bitfields.Array(4, 8),
		}, (i, x) => ((x.q[i] | (x.qh[i >> 2] << 2)) * (x.signs[i] ? -1 : 1)) * x.scales[i >> 4] * +x.scale)
	),
	22: Quant('IQ2_S', '2-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 2.5 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(256, 2),
			qh:		bin.bitfields.Array(8, 8),
 			scales:	bin.bitfields.Array(8, 8),
		}, (i, x) => (x.q[i] | (x.qh[i >> 3] << 2)) * x.scales[i >> 3] * +x.scale)
	),
	23: Quant('IQ4_XS', '4-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 4.25 bits-per-weight.',
		 256, BlockBuffer({
 			scale: 	bin.float16,
			q:		bin.bitfields.Array(256, 4),
 			scales:	bin.bitfields.Array(8, 8),
		}, (i, x) => x.q[i] * x.scales[i >> 3] * +x.scale)
	),
	24: Quant('I8', '8-bit fixed-width integer number.', 1, Int8Array),
	25: Quant('I16', '16-bit fixed-width integer number.', 1, Int16Array),
	26: Quant('I32', '32-bit fixed-width integer number.', 1, Int32Array),
	27: Quant('I64', '64-bit fixed-width integer number.', 1, BigInt64Array),
	28: Quant('F64', '64-bit standard IEEE 754 double-precision floating-point number.', 1, Float64Array),
	29: Quant('IQ1_M', '1-bit quantization (q). Super-blocks with 256 weights. Weight w is obtained using super_block_scale & importance matrix, resulting in 1.75 bits-per-weight.',
		256, BlockBuffer({
			ql:		bin.bitfields.Array(256, 1),
			qh:		bin.bitfields.Array(128, 1),
 			scales:	bin.bitfields.Array(64, bin.float8e4m3),
		}, (i, x) => (x.ql[i] | (x.qh[i >> 1] << 1)) * +x.scales[i >> 4])
	),
	30: Quant('BF16', '16-bit shortened version of the 32-bit IEEE 754 single-precision floating-point number.', 1, bin.typedArray.BitFields(bin.float(7, 8))),
	34: Quant('TQ1_0', 'Ternary quantization.',
		256, BlockBuffer({
			q0: 	bin.bitfields.Array(48, 8),	// 5 trits per byte
			q1: 	bin.bitfields.Array(4, 8),	// 4 trits per byte
 			scale: 	bin.float16,
		}, (i, x) => ((i < 240
			? ((x.q0[Math.floor(i / 5)] / (3 ** (i % 5))) % 3)
			: ((x.q1[Math.floor((i - 240) / 4)] / (3 ** ((i - 240) % 4))) % 3)
			) - 1)* +x.scale
		)
	),
	35: Quant('TQ2_0', 'Ternary quantization.',
		256, BlockBuffer({
			qs: 	bin.bitfields.Array(256, 2),
 			scale: 	bin.float16,
		}, (i, x) => (x.qs[i] - 1) * +x.scale)
	),
	39: Quant('MXFP4', '4-bit Microscaling Block Floating Point.',
		32, BlockBuffer({
 			scale: 	bin.float8e4m3,
			q: 		bin.bitfields.Array(32, bin.float4),
		}, (i, x) => +x.q[i] * +x.scale)
	),
	40: Quant('NVFP4', '4-bit Microscaling Block Floating Point with global scale.',
		64, BlockBuffer({
 			scale: 	bin.float32,
			q: 		bin.bitfields.Array(64, bin.float4),
		}, (i, x) => +x.q[i] * +x.scale)
	),
	41: Quant('Q1_0', '1-bit quantization with fp16 block scale. Each block has 128 weights, where 0 represents -block_scale and 1 represents +block_scale.',
		128, BlockBuffer({
			scale:	bin.float16,
			q:		bin.bitfields.Array(128, 1)
		}, (i, x) => x.q[i] ? +x.scale : -x.scale)
	),
} as const;
type QuantizationTypes = keyof typeof QuantizationTypes

const ValueTypes = {
	UINT8:		0,
	INT8:		1,
	UINT16:		2,
	INT16:		3,
	UINT32:		4,
	INT32:		5,
	FLOAT32:	6,
	BOOL:		7,
	STRING:		8,
	ARRAY:		9,
	UINT64:		10,
	INT64:		11,
	FLOAT64:	12,
} as const;

const Size				= bin.as(bin.UINT64_LE, x => Number(x));	// 32 bits in v1
const QuantizationType	= bin.as(bin.UINT32_LE, x => x as QuantizationTypes);
const ValueType			= bin.as(bin.UINT32_LE, bin.EnumV(ValueTypes));
const String			= bin.String(Size);

class Tensor extends bin.Class({
	name:		String,
	shape:		bin.Array(bin.UINT32_LE, bin.UINT64_LE),
	dtype:		QuantizationType,
	offset:		bin.UINT64_LE,
	file:		bin.Func(s => s),
}) {
	data?: bin.MaybePromise<bin.typedArray.TypedArray<any>>;

	parameterCount() {
		return this.shape.reduce((acc: number, val: bigint) => acc * Number(val), 1);
	}
	async lookup(offset: number) {
		const q		= QuantizationTypes[this.dtype as QuantizationTypes];
		const data	= await (this.data ??= this.file.view_at(q.buffer, Number(this.offset), this.parameterCount()));
		const block = q.block;
		if (block === 1)
			return +data[offset];

		const value = data[offset / block];
		return +value.get(offset % block);
	}
}
/*
const ValueArray = bin.Switch(ValueType, {
	[ValueTypes.UINT8]:		bin.Array(Size, bin.UINT8),
	[ValueTypes.INT8]:		bin.Array(Size, bin.INT8),
	[ValueTypes.UINT16]:	bin.Array(Size, bin.UINT16_LE),
	[ValueTypes.INT16]:		bin.Array(Size, bin.INT16_LE),
	[ValueTypes.UINT32]:	bin.Array(Size, bin.UINT32_LE),
	[ValueTypes.INT32]:		bin.Array(Size, bin.INT32_LE),
//	[ValueTypes.FLOAT32]:	bin.Array(Size, bin.Float32_LE),
	[ValueTypes.FLOAT32]:	bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Float32', false)),
	[ValueTypes.BOOL]:		bin.Array(Size, bin.UINT8),
	[ValueTypes.STRING]:	bin.Array(Size, String),
	[ValueTypes.ARRAY]:		bin.Array(Size, bin.FuncType((): bin.interop.TypeT<any[]|bin.typedArray.TypedArray<number>> => ValueArray)),
	[ValueTypes.UINT64]:	bin.Array(Size, bin.UINT64_LE),
	[ValueTypes.INT64]:		bin.Array(Size, bin.INT64_LE),
	[ValueTypes.FLOAT64]:	bin.Array(Size, bin.Float64_LE),
});
*/
const ValueBuffer = bin.Switch(ValueType, {
	[ValueTypes.UINT8]:		bin.Buffer(Size, Uint8Array),
	[ValueTypes.INT8]:		bin.Buffer(Size, Int8Array),
	[ValueTypes.UINT16]:	bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Uint16', false)),
	[ValueTypes.INT16]:		bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Int16', false)),
	[ValueTypes.UINT32]:	bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Uint32', false)),
	[ValueTypes.INT32]:		bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Int32', false)),
	[ValueTypes.FLOAT32]:	bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Float32', false)),
	[ValueTypes.BOOL]:		bin.Buffer(Size, Uint8Array),
	[ValueTypes.STRING]:	bin.Array(Size, String),
	[ValueTypes.ARRAY]:		bin.Array(Size, bin.FuncType((): bin.interop.TypeT<any[]|bin.typedArray.TypedArray<any>> => ValueBuffer)),
	[ValueTypes.UINT64]:	bin.Buffer(Size, bin.typedArray.DataViewTypedArray('BigUint64', false)),
	[ValueTypes.INT64]:		bin.Buffer(Size, bin.typedArray.DataViewTypedArray('BigInt64', false)),
	[ValueTypes.FLOAT64]:	bin.Buffer(Size, bin.typedArray.DataViewTypedArray('Float64', false)),
});

const KvPairSpec = {
	key:	String,
	value:	bin.Switch(ValueType, {
		[ValueTypes.UINT8]:		bin.UINT8,
		[ValueTypes.INT8]:		bin.INT8,
		[ValueTypes.UINT16]:	bin.UINT16_LE,
		[ValueTypes.INT16]:		bin.INT16_LE,
		[ValueTypes.UINT32]:	bin.UINT32_LE,
		[ValueTypes.INT32]:		bin.INT32_LE,
		[ValueTypes.FLOAT32]:	bin.Float32_LE,
		[ValueTypes.BOOL]:		bin.UINT8,
		[ValueTypes.STRING]:	String,
		[ValueTypes.ARRAY]:		ValueBuffer,//Array,
		[ValueTypes.UINT64]:	bin.UINT64_LE,
		[ValueTypes.INT64]:		bin.INT64_LE,
		[ValueTypes.FLOAT64]:	bin.Float64_LE,
	})
};

function addValue(obj: any, key: string, value: any) {
	const dot = key.indexOf('.');
	if (dot !== -1)
		addValue(obj[key.substring(0, dot)] ??= {}, key.substring(dot + 1), value);
	else
		obj[key] = value;
	return obj;
}

const GgufSpec = {
	magic:			bin.Expect(bin.String(4), 'GGUF'),
	version:		bin.UINT32_LE,
	tensor_count:	Size,

	metadata:		bin.as(bin.Array(Size, KvPairSpec), array => array.reduce((acc, i) => addValue(acc, i.key, i.value), {}) as any),
	tensors:		bin.Array('tensor_count', Tensor),
};


export async function readGguf(stream: bin.interop._stream) {
	const r = await bin.interop.stream(stream).read(GgufSpec);

	const alignment = r.metadata.general.alignment ?? GGUF_DEFAULT_ALIGNMENT;
	const start 	= BigInt((stream.tell() + alignment - 1) & -alignment);

	for (const t of r.tensors)
		t.offset += start;
	return r;
}
