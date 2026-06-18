import * as bin from '@isopodlabs/binary';
import * as pb from './protobuff';

// onnx schemas
const Version = {
  	_START_VERSION: 		0,
	IR_VERSION_2017_10_10:	0x0000000000000001,
	IR_VERSION_2017_10_30:	0x0000000000000002,
	IR_VERSION_2017_11_3:	0x0000000000000003,
	IR_VERSION_2019_1_22:	0x0000000000000004,
	IR_VERSION_2019_3_18:	0x0000000000000005,
	IR_VERSION_2019_9_19:	0x0000000000000006,
	IR_VERSION_2020_5_8:	0x0000000000000007,
	IR_VERSION_2021_7_30:	0x0000000000000008,
	IR_VERSION_2023_5_5:	0x0000000000000009,
	IR_VERSION_2024_3_25:	0x000000000000000A,
	IR_VERSION_2025_05_12:	0x000000000000000B,
	IR_VERSION_2025_08_26:	0x000000000000000C,
	IR_VERSION:				0x000000000000000D,
};

const StringStringEntry = {
	1: pb.Field('key', 		pb.str),
	2: pb.Field('value', 	pb.str),
};

const Segment = {
	1: pb.Field('begin', 	pb.int64),
	2: pb.Field('end', 		pb.int64),
};

const TensorDataType = {
	UNDEFINED:		0,
	FLOAT:			1,
	UINT8:			2,
	INT8:			3,
	UINT16:			4,
	INT16:			5,
	INT32:			6,
	INT64:			7,
	STRING:			8,
	BOOL:			9,
	FLOAT16:		10,
	DOUBLE:			11,
	UINT32:			12,
	UINT64:			13,
	COMPLEX64:		14,
	COMPLEX128:		15,
	BFLOAT16:		16,
	FLOAT8E4M3FN:	17,
	FLOAT8E4M3FNUZ:	18,
	FLOAT8E5M2:		19,
	FLOAT8E5M2FNUZ:	20,
	UINT4:			21,
	INT4:			22,
	FLOAT4E2M1:		23,
	FLOAT8E8M0:		24,
	UINT2:			25,
	INT2:			26,
} as const;

const TensorDataTypeBuffer = {
	[TensorDataType.UNDEFINED]: 		Uint8Array,
	[TensorDataType.FLOAT]: 			Float32Array,
	[TensorDataType.UINT8]: 			Uint8Array,
	[TensorDataType.INT8]: 				Int8Array,
	[TensorDataType.UINT16]: 			Uint16Array,
	[TensorDataType.INT16]: 			Int16Array,
	[TensorDataType.INT32]: 			Int32Array,
	[TensorDataType.INT64]: 			BigInt64Array,
	[TensorDataType.STRING]: 			Uint8Array,
	[TensorDataType.BOOL]: 				Uint8Array,
	[TensorDataType.FLOAT16]: 			bin.typedArray.BitFields(bin.float16),
	[TensorDataType.DOUBLE]: 			Float64Array,
	[TensorDataType.UINT32]: 			Uint32Array,
	[TensorDataType.UINT64]: 			BigUint64Array,
	[TensorDataType.COMPLEX64]: 		bin.typedArray.BitFields({r: bin.float32, i: bin.float32}),
	[TensorDataType.COMPLEX128]: 		bin.typedArray.BitFields({r: bin.float64, i: bin.float64}),
	[TensorDataType.BFLOAT16]: 			bin.typedArray.BitFields(bin.Bfloat16),
	[TensorDataType.FLOAT8E4M3FN]: 		bin.typedArray.BitFields(bin.float(3, 4, {noInf: true})),
	[TensorDataType.FLOAT8E4M3FNUZ]: 	bin.typedArray.BitFields(bin.float(3, 4, {ebias: 8, noInf: true, noNeg0: true})),
	[TensorDataType.FLOAT8E5M2]: 		bin.typedArray.BitFields(bin.float(2, 5, {noInf: true})),
	[TensorDataType.FLOAT8E5M2FNUZ]: 	bin.typedArray.BitFields(bin.float(2, 5, {ebias: 16, noInf: true, noNeg0: true})),
	[TensorDataType.UINT4]: 			bin.typedArray.Uint(4),
	[TensorDataType.INT4]: 				bin.typedArray.Int(4),
	[TensorDataType.FLOAT4E2M1]: 		bin.typedArray.BitFields(bin.float4),
	[TensorDataType.FLOAT8E8M0]: 		bin.typedArray.BitFields(bin.float(0, 8, {sbit: false})),
	[TensorDataType.UINT2]: 			bin.typedArray.Uint(2),
	[TensorDataType.INT2]: 				bin.typedArray.Int(2),
} as const;

class Tensor extends bin.Class(pb.Proto2({
	1:  pb.Repeat('dims', 			pb.varint),
	2:  pb.Field('data_type', 		pb.Enum(TensorDataType)),
	3:  pb.Field('segment', 		pb.ref(Segment)),
	4:  pb.Repeat('float_data', 	pb.float32),
	5:  pb.Repeat('int32_data', 	pb.varint),
	6:  pb.Repeat('string_data', 	pb.bytes),
	7:  pb.Repeat('int64_data', 	pb.int64),
	8:  pb.Field('name', 			pb.str),
	9:  pb.Field('raw_data', 		pb.bytes),
	10: pb.Repeat('double_data', 	pb.float64),
	11: pb.Repeat('uint64_data', 	pb.int64),
	12: pb.Field('doc_string', 		pb.str),
	13: pb.Repeat('external_data', 	pb.ref(StringStringEntry)),
	14: pb.Field('data_location', 	pb.Enum({DEFAULT: 0, EXTERNAL: 1})),
	16: pb.Repeat('metadata_props', pb.ref(StringStringEntry)),
})) {
	get data() {
		let raw = this.raw_data as bin.typedArray.TypedArray;
		if (!raw) {
			switch (this.data_type) {
				case TensorDataType.STRING: 		return this.string_data;
				case TensorDataType.FLOAT:			return Float32Array.from(this.float_data);
				case TensorDataType.DOUBLE:			return Float64Array.from(this.double_data);
				case TensorDataType.INT64:			return BigInt64Array.from(this.int64_data);
				case TensorDataType.UINT64:			return BigUint64Array.from(this.uint64_data);
				case TensorDataType.COMPLEX64:		raw = Float32Array.from(this.float_data); break;
				case TensorDataType.COMPLEX128:		raw = Float64Array.from(this.double_data); break;

				case TensorDataType.INT32:			return Int32Array.from(this.int32_data);
				case TensorDataType.UINT32:			return Uint32Array.from(this.int32_data);

				case TensorDataType.INT16:			return Int16Array.from(this.int32_data);
				case TensorDataType.UINT16:			return Uint16Array.from(this.int32_data);
				case TensorDataType.FLOAT16:
				case TensorDataType.BFLOAT16:		raw = Uint16Array.from(this.int32_data); break;

				case TensorDataType.INT8:			return Int8Array.from(this.int32_data);
				case TensorDataType.UINT8:
				case TensorDataType.BOOL:			return Uint8Array.from(this.int32_data);
				case TensorDataType.FLOAT8E4M3FN:
				case TensorDataType.FLOAT8E4M3FNUZ:
				case TensorDataType.FLOAT8E5M2:
				case TensorDataType.FLOAT8E5M2FNUZ:
				case TensorDataType.FLOAT8E8M0:		raw = Uint8Array.from(this.int32_data); break;

				case TensorDataType.INT4:			return bin.typedArray.Int(4).from(this.int32_data);
				case TensorDataType.UINT4:			return bin.typedArray.Uint(4).from(this.int32_data);
				case TensorDataType.INT2:			return bin.typedArray.Int(2).from(this.int32_data);
				case TensorDataType.UINT2:			return bin.typedArray.Uint(2).from(this.int32_data);
				case TensorDataType.FLOAT4E2M1:		raw = bin.typedArray.Uint(4).from(this.int32_data); break;
			}
		}
		return new TensorDataTypeBuffer[this.data_type](raw.buffer as ArrayBuffer, raw.byteOffset, raw.byteLength);
	}
};

function refbin<T>(schema: bin.TypeT<T>) {
	return (data: Uint8Array) => new bin.stream(data).read(schema);
}

const TensorShape = {
	1: pb.Repeat('dim', 			pb.ref({
		1: pb.Field('dim_value', 		pb.int64),
		2: pb.Field('dim_param', 		pb.str),
		3: pb.Field('denotation', 		pb.str),
	})),
};

const Type = {
	1: pb.Field('tensor_type', 		pb.ref({//TypeTensor
		1: pb.Field('elem_type', 		pb.varint),
		2: pb.Field('shape', 			pb.ref(TensorShape)),
	})),
	4: pb.Field('sequence_type', 	pb.ref({//TypeSequence
		1: pb.Field('elem_type', 		pb.forwardref(():any=>Type)),//(v: Uint8Array): any => new bin.stream(v).read(Proto2(Type))),
	})),
	5: pb.Field('map_type', 		pb.ref({//TypeMap
		1: pb.Field('key_type', 		pb.varint),
		2: pb.Field('value_type', 		pb.forwardref(():any=>Type)),
	})),
	9: pb.Field('optional_type', 	pb.ref({//TypeOptional),
		1: pb.Field('elem_type', 		pb.forwardref(():any=>Type)),
	})),
	8: pb.Field('sparse_tensor_type',pb.ref({//TypeSparseTensor),
		1: pb.Field('elem_type', 		pb.varint),
		2: pb.Field('shape', 			pb.ref(TensorShape)),
	})),
	7: pb.Field('opaque_type', 		pb.ref({//TypeOpaque),
		1: pb.Field('domain', 			pb.str),
		2: pb.Field('name', 			pb.str),
	})),
	6: pb.Field('denotation', 		pb.str),
};

const ElemType = {
	UNDEFINED:		0,
	TENSOR:			1,
	SPARSE_TENSOR:	2,
	SEQUENCE:		3,
	MAP:			4,
	OPTIONAL:		5,
} as const;

const Sequence = {
	1: pb.Field('name', 				pb.str),
	2: pb.Field('elem_type', 			pb.Enum(ElemType)),
	3: pb.Repeat('tensor_values', 		refbin(Tensor)),
	4: pb.Repeat('sparse_tensor_values',pb.forwardref(():any=>SparseTensor)),
	5: pb.Repeat('sequence_values', 	pb.forwardref(():any=>Sequence)),
	6: pb.Repeat('map_values', 			pb.forwardref(():any=>Map)),
	7: pb.Repeat('optional_values', 	pb.forwardref(():any=>Optional)),
};

const Map = {
	1: pb.Field('name', 				pb.str),
	2: pb.Field('key_type', 			pb.varint),
	3: pb.Repeat('keys', 				pb.int64),
	4: pb.Repeat('string_keys', 		pb.bytes),
	5: pb.Field('values', 				pb.ref(Sequence)),
};

const Optional = {
	1: pb.Field('name', 				pb.str),
	2: pb.Field('elem_type', 			pb.Enum(ElemType)),
	3: pb.Field('tensor_value', 		refbin(Tensor)),
	4: pb.Field('sparse_tensor_value', 	pb.forwardref(():any=>SparseTensor)),
	5: pb.Field('sequence_value', 		pb.ref(Sequence)),
	6: pb.Field('map_value', 			pb.ref(Map)),
	7: pb.Field('optional_value', 		pb.forwardref(():any=>Optional)),
};

const SparseTensor = {
	1: pb.Field('values', 				refbin(Tensor)),
	2: pb.Field('indices', 				refbin(Tensor)),
	3: pb.Repeat('dims', 				pb.int64),
};

const ValueInfo = {
	1: pb.Field('name', 				pb.str),
	2: pb.Field('type', 				pb.ref(Type)),
	3: pb.Field('doc_string', 			pb.str),
	4: pb.Repeat('metadata_props', 		pb.ref(StringStringEntry)),
};

const AttributeType = {
	UNDEFINED: 		0,
	FLOAT: 			1,
	INT: 			2,
	STRING: 		3,
	TENSOR: 		4,
	GRAPH: 			5,
	SPARSE_TENSOR: 	11,
	TYPE_PROTO: 	13,
	FLOATS: 		6,
	INTS: 			7,
	STRINGS: 		8,
	TENSORS: 		9,
	GRAPHS: 		10,
	SPARSE_TENSORS: 12,
	TYPE_PROTOS: 	14,
};
const Attribute = {
	1:  pb.Field('name', 				pb.str),
	21: pb.Field('ref_attr_name', 		pb.str),
	13: pb.Field('doc_string', 			pb.str),
	20: pb.Field('type', 				pb.Enum(AttributeType)),
	2:  pb.Field('f', 					pb.float32),
	3:  pb.Field('i', 					pb.int64),
	4:  pb.Field('s', 					pb.bytes),
	5:  pb.Field('t', 					refbin(Tensor)),
	6:  pb.Field('g', 					pb.forwardref(():any=>Graph)),
	22: pb.Field('sparse_tensor', 		pb.ref(SparseTensor)),
	14: pb.Field('tp', 					pb.ref(Type)),
	7:  pb.Repeat('floats', 			pb.float32),
	8:  pb.Repeat('ints', 				pb.int64),
	9:  pb.Repeat('strings', 			pb.bytes),
	10: pb.Repeat('tensors', 			refbin(Tensor)),
	11: pb.Repeat('graphs', 			pb.forwardref(():any=>Graph)),
	23: pb.Repeat('sparse_tensors', 	pb.ref(SparseTensor)),
	15: pb.Repeat('type_protos', 		pb.ref(Type)),
};

const IntIntListEntry = {
	1: pb.Field('key', 					pb.int64),
	2: pb.Repeat('value', 				pb.int64),
};

const SimpleShardedDim = {
	1: pb.Field('dim_value', 			pb.int64),
	2: pb.Field('dim_param', 			pb.str),
	3: pb.Field('num_shards', 			pb.int64),
};

const ShardedDim = {
	1: pb.Field('axis', 				pb.int64),
	2: pb.Repeat('simple_sharding', 	pb.ref(SimpleShardedDim)),
};

const ShardingSpec = {
	1: pb.Field('tensor_name', 					pb.str),
	2: pb.Repeat('device', 						pb.int64),
	3: pb.Repeat('index_to_device_group_map', 	pb.ref(IntIntListEntry)),
	4: pb.Repeat('sharded_dim', 				pb.ref(ShardedDim)),
};

const NodeDeviceConfiguration = {
	1: pb.Field('configuration_id', 		pb.str),
	2: pb.Repeat('sharding_spec', 			pb.ref(ShardingSpec)),
	3: pb.Field('pipeline_stage', 			pb.varint),
};

const Node = {
	1: pb.Repeat('input', 					pb.str),
	2: pb.Repeat('output', 					pb.str),
	3: pb.Field('name', 					pb.str),
	4: pb.Field('op_type', 					pb.str),
	7: pb.Field('domain', 					pb.str),
	8: pb.Field('overload', 				pb.str),
	5: pb.Repeat('attribute', 				pb.ref(Attribute)),
	6: pb.Field('doc_string', 				pb.str),
	9: pb.Repeat('metadata_props', 			pb.ref(StringStringEntry)),
	10:pb.Repeat('device_configurations', 	pb.ref(NodeDeviceConfiguration)),
};

const TensorAnnotation = {
	1: pb.Field('tensor_name', 					pb.str),
	2: pb.Repeat('quant_parameter_tensor_names', pb.ref(StringStringEntry)),
};

const Graph = {
	1:  pb.Repeat('node', 					pb.ref(Node)),
	2:  pb.Field('name', 					pb.str),
	5:  pb.Repeat('initializer', 			refbin(Tensor)),
	15: pb.Repeat('sparse_initializer', 	pb.ref(SparseTensor)),
	10: pb.Field('doc_string', 				pb.str),
	11: pb.Repeat('input',                  pb.ref(ValueInfo)),
	12: pb.Repeat('output',                 pb.ref(ValueInfo)),
	13: pb.Repeat('value_info',             pb.ref(ValueInfo)),
	14: pb.Repeat('quantization_annotation',pb.ref(TensorAnnotation)),
	16: pb.Repeat('metadata_props', 		pb.ref(StringStringEntry)),
};

const TrainingInfo = {
	1: pb.Field('initialization', 			pb.ref(Graph)),
	2: pb.Field('algorithm', 				pb.ref(Graph)),
	3: pb.Repeat('initialization_binding', 	pb.ref(StringStringEntry)),
	4: pb.Repeat('update_binding', 			pb.ref(StringStringEntry)),
};

const OperatorSetId = {
	1: pb.Field('domain', 				pb.str),
	2: pb.Field('version', 				pb.int64),
};

const DeviceConfiguration = {
	1: pb.Field('name', 				pb.str),
	2: pb.Field('num_devices', 			pb.varint),
	3: pb.Repeat('device', 				pb.str),
};

const Function = {
	1:  pb.Field('name',				pb.str),
	4:  pb.Repeat('input',				pb.str),
	5:  pb.Repeat('output',				pb.str),
	6:  pb.Repeat('attribute',			pb.str),
	11: pb.Repeat('attribute_proto', 	pb.ref(Attribute)),
	7:  pb.Repeat('node',            	pb.ref(Node)),
	8:  pb.Field('doc_string', 			pb.str),
	9:  pb.Repeat('opset_import', 		pb.ref(OperatorSetId)),
	10: pb.Field('domain', 				pb.str),
	13: pb.Field('overload', 			pb.str),
	12: pb.Repeat('value_info',			pb.ref(ValueInfo)),
	14: pb.Repeat('metadata_props',		pb.ref(StringStringEntry)),
};

const Model = {
	1:  pb.Field('ir_version',			pb.int64),
	8:  pb.Repeat('opset_import',		pb.ref(OperatorSetId)),
	2:  pb.Field('producer_name',		pb.str),
	3:  pb.Field('producer_version',	pb.str),
	4:  pb.Field('domain',				pb.str),
	5:  pb.Field('model_version',		pb.int64),
	6:  pb.Field('doc_string',			pb.str),
	7:  pb.Field('graph',				pb.ref(Graph)),
	14: pb.Repeat('metadata_props',		pb.ref(StringStringEntry)),
	20: pb.Repeat('training_info',   	pb.ref(TrainingInfo)),
	25: pb.Repeat('functions',       	pb.ref(Function)),
	26: pb.Repeat('configuration',		pb.ref(DeviceConfiguration)),
};

export type Model = pb.Decoded<typeof Model>;

export function readOnnxModel(data: Uint8Array) {
	const stream = new bin.stream(data);
	return stream.read(pb.Proto2(Model));
}