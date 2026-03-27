/* eslint-disable @typescript-eslint/no-unused-vars */
import * as bin from '@isopodlabs/binary';

function field(f: string) {
	return (s: bin._stream) => s.obj[f];
}

const uint8 = bin.UINT8;
const uint16 = bin.UINT16_LE;
const uint32 = bin.UINT32_LE;
const uint64 = bin.UINT64_LE;
const int8 = bin.INT8;
const int16 = bin.INT16;
const int32 = bin.INT32;
const int64 = bin.INT64;

const type16_t = uint16;
const type_t = uint32;
const token_t = uint32;
const ItemId = type_t;

const octword = bin.Buffer(32);
const uoctword = bin.Buffer(32);

const date = bin.Float64_LE; // double
const stringz = bin.NullTerminatedString();

// 96-bit unsigned integer with power of 10 scaling factor
export class Decimal extends bin.Class({
	reserved: uint16,
	scale: uint8,
	sign: uint8,
	mhi: uint32,
	mlo: uint64,
}) {
/*	constructor(value?: number) {
		if (value !== undefined) {
			this.sign = value < 0 ? 0x80 : 0;
			this.scale = 0;
			let d = Math.abs(value);
			while (d % 1 !== 0) {
				d *= 10;
				this.scale++;
			}
			this.mhi = Math.floor(d / Math.pow(2, 64));
			this.mlo = BigInt(Math.floor(d - this.mhi * Math.pow(2, 64)));
		} else {
			this.scale = 0;
			this.sign = 0;
			this.mhi = 0;
			this.mlo = 0n;
		}
	}
*/
	toNumber(): number {
		const value = this.mhi * Math.pow(2, 64) + Number(this.mlo);
		return value / Math.pow(10, this.scale);
	}
}

// Constants
const CV_SIGNATURE_C6 = 0;
const CV_SIGNATURE_C7 = 1;
const CV_SIGNATURE_C11 = 2;
const CV_SIGNATURE_C13 = 4;
const CV_SIGNATURE_RESERVED = 5;
const CV_MAXOFFSET = 0xffffffff;

// Compression functions

function skip(s: bin._stream, len: number) {
	s.seek(s.tell() + len);
}

const CVCompressed: bin.TypeT<number> = {
	get(s: bin._stream) 				{
		const buffer	= s.remainder();
		const b0		= buffer[0];
		
		if ((b0 & 0x80) === 0x00) {
			skip(s, 1);
			return b0;

		} else if ((b0 & 0xC0) === 0x80) {
			skip(s, 2);
			return ((b0 & 0x3f) << 8) | buffer[1];

		} else if ((b0 & 0xE0) === 0xC0) {
			skip(s, 4);
			return ((b0 & 0x1f) << 24) |
					(buffer[1] << 16) |
					(buffer[2] << 8) |
					buffer[3];

		}
		throw new Error("Invalid compressed data");
	},
	put(s: bin._stream, v: number)	{
		if (v <= 0x7F) {
			s.write_view(new Uint8Array([v]));

		} else if (v <= 0x3FFF) {
			s.write_view(new Uint8Array([
				((v >> 8) | 0x80) & 0xFF,
				v & 0xFF
			]));

		} else if (v <= 0x1FFFFFFF) {
			s.write_view(new Uint8Array([
				((v >> 24) | 0xC0) & 0xFF,
				(v >> 16) & 0xFF,
				(v >> 8) & 0xFF,
				v & 0xFF
			]));
		}
	}
};

function EncodeSignedInt32(input: number): number {
	return input >= 0 ? input << 1 : ((-input) << 1) | 1;
}

function DecodeSignedInt32(input: number): number {
	return (input & 1) ? -(input >> 1) : (input >> 1);
}

// Type masks and shifts
export const CV_MMASK = 0x700;
export const CV_TMASK = 0x0f0;
export const CV_SMASK = 0x00f;
export const CV_MSHIFT = 8;
export const CV_TSHIFT = 4;
export const CV_SSHIFT = 0;

// Macros as functions
export function CV_MODE(typ: number): number {
	return (typ & CV_MMASK) >> CV_MSHIFT;
}

export function CV_TYPE(typ: number): number {
	return (typ & CV_TMASK) >> CV_TSHIFT;
}

export function CV_SUBT(typ: number): number {
	return (typ & CV_SMASK) >> CV_SSHIFT;
}

// Pointer mode enumeration
const enum prmode_e {
	TM_DIRECT = 0,
	TM_NPTR = 1,
	TM_FPTR = 2,
	TM_HPTR = 3,
	TM_NPTR32 = 4,
	TM_FPTR32 = 5,
	TM_NPTR64 = 6,
	TM_NPTR128 = 7,
}

// Type enumeration
const enum type_e {
	SPECIAL = 0x00,
	SIGNED = 0x01,
	UNSIGNED = 0x02,
	BOOLEAN = 0x03,
	REAL = 0x04,
	COMPLEX = 0x05,
	SPECIAL2 = 0x06,
	INT = 0x07,
	CVRESERVED = 0x0f,
}

// Special type enumeration
const enum special_e {
	SP_NOTYPE = 0x00,
	SP_ABS = 0x01,
	SP_SEGMENT = 0x02,
	SP_VOID = 0x03,
	SP_CURRENCY = 0x04,
	SP_NBASICSTR = 0x05,
	SP_FBASICSTR = 0x06,
	SP_NOTTRANS = 0x07,
	SP_HRESULT = 0x08,
}

// Leaf enumeration
enum LEAF_ENUM_e {
	LF_MODIFIER_16t = 0x0001,
	LF_POINTER_16t = 0x0002,
	LF_ARRAY_16t = 0x0003,
	LF_CLASS_16t = 0x0004,
	LF_STRUCTURE_16t = 0x0005,
	LF_UNION_16t = 0x0006,
	LF_ENUM_16t = 0x0007,
	LF_PROCEDURE_16t = 0x0008,
	LF_MFUNCTION_16t = 0x0009,
	LF_VTSHAPE = 0x000a,
	LF_COBOL0_16t = 0x000b,
	LF_COBOL1 = 0x000c,
	LF_BARRAY_16t = 0x000d,
	LF_LABEL = 0x000e,
	LF_NULL = 0x000f,
	LF_NOTTRAN = 0x0010,
	LF_DIMARRAY_16t = 0x0011,
	LF_VFTPATH_16t = 0x0012,
	LF_PRECOMP_16t = 0x0013,
	LF_ENDPRECOMP = 0x0014,
	LF_OEM_16t = 0x0015,
	LF_TYPESERVER_ST = 0x0016,

	// 32-bit versions
	LF_TI16_MAX = 0x1000,
	LF_MODIFIER = 0x1001,
	LF_POINTER = 0x1002,
	LF_ARRAY_ST = 0x1003,
	LF_CLASS_ST = 0x1004,
	LF_STRUCTURE_ST = 0x1005,
	LF_UNION_ST = 0x1006,
	LF_ENUM_ST = 0x1007,
	LF_PROCEDURE = 0x1008,
	LF_MFUNCTION = 0x1009,

	// Numeric leaves
	//LF_NUMERIC = 0x8000,
	LF_CHAR = 0x8000,
	LF_SHORT = 0x8001,
	LF_USHORT = 0x8002,
	LF_LONG = 0x8003,
	LF_ULONG = 0x8004,
	LF_REAL32 = 0x8005,
	LF_REAL64 = 0x8006,
	LF_REAL80 = 0x8007,
	LF_REAL128 = 0x8008,
	LF_QUADWORD = 0x8009,
	LF_UQUADWORD = 0x800a,
	LF_DECIMAL = 0x8019,
	LF_DATE = 0x801a,
}

// Value structure for numeric leaves
const Value = bin.Switch(uint16, {
	[LEAF_ENUM_e.LF_CHAR]: int8,
	[LEAF_ENUM_e.LF_SHORT]: int16,
	[LEAF_ENUM_e.LF_USHORT]: uint16,
	[LEAF_ENUM_e.LF_LONG]: int32,
	[LEAF_ENUM_e.LF_ULONG]: uint32,
	[LEAF_ENUM_e.LF_REAL32]: bin.Float32,
	[LEAF_ENUM_e.LF_REAL64]: bin.Float64,
	[LEAF_ENUM_e.LF_QUADWORD]: uint64,
	[LEAF_ENUM_e.LF_UQUADWORD]: uint64,
	[LEAF_ENUM_e.LF_DECIMAL]: Decimal,
	[LEAF_ENUM_e.LF_DATE]: date,
});


// Property structure for classes/structs/unions
const prop_t = bin.as(uint16, bin.BitFields(16, {
	packed:			1,
	ctor:			1,
	ovlops:			1,
	isnested:		1,
	cnested:		1,
	opassign:		1,
	opcast:			1,
	fwdref:			1,
	scoped:			1,
	hasuniquename:	1,
	sealed:			1,
	hfa:			bin.BitField(2, bin.Enum({none: 0, float: 1, double: 2, other:3})),
	intrinsic:		1,
	mocom:			bin.BitField(2, bin.Enum({NONAME: 0, ref: 1, Value: 2, 'interface':3})),
}));

// Field attribute structure
const fldattr_t = bin.as(uint16, bin.BitFields(16, {
	access: 2,
	mprop: 3,
	pseudo: 1,
	noinherit: 1,
	noconstruct: 1,
	compgenx: 1,
	sealed: 1
}));

// Function attribute structure
const funcattr_t = bin.as(uint8, bin.BitFields(8, {
	cxxreturnudt: 1,
	ctor: 1,
	ctorvbase: 1,
}));

const modifier_t = bin.as(uint16, bin.BitFields(16, {
	constant: 1,
	volatile: 1,
	unaligned: 1,
}));

//	MODIFIER
const Modifier_16t = {
	attr:	modifier_t,
	type:	type16_t,
};
const Modifier = {
	type:	type_t,
	attr:	modifier_t,
};

//	POINTER

//	type for pointer records
enum ptrtype_e {
	PTR_NEAR			= 0x00, // 16 bit pointer
	PTR_FAR				= 0x01, // 16:16 far pointer
	PTR_HUGE			= 0x02, // 16:16 huge pointer
	PTR_BASE_SEG		= 0x03, // based on segment
	PTR_BASE_VAL		= 0x04, // based on value of base
	PTR_BASE_SEGVAL		= 0x05, // based on segment value of base
	PTR_BASE_ADDR		= 0x06, // based on address of base
	PTR_BASE_SEGADDR	= 0x07, // based on segment address of base
	PTR_BASE_TYPE		= 0x08, // based on type
	PTR_BASE_SELF		= 0x09, // based on self
	PTR_NEAR32			= 0x0a, // 32 bit pointer
	PTR_FAR32			= 0x0b, // 16:32 pointer
	PTR_64				= 0x0c, // 64 bit pointer
	PTR_UNUSEDPTR		= 0x0d	// first unused pointer type
};

//	modes for pointers
enum ptrmode_e {
	PTR_MODE_PTR		= 0x00, // "normal" pointer
	PTR_MODE_REF		= 0x01, // "old" reference
//	PTR_MODE_LVREF		= 0x01, // l-value reference
	PTR_MODE_PMEM		= 0x02, // pointer to data member
	PTR_MODE_PMFUNC		= 0x03, // pointer to member function
	PTR_MODE_RVREF		= 0x04, // r-value reference
	PTR_MODE_RESERVED	= 0x05	// first unused pointer mode
};

//	pointer-to-member types
enum pmtype_e {
	PMTYPE_Undef		= 0x00, // not specified (pre VC8)
	PMTYPE_D_Single		= 0x01, // member data, single inheritance
	PMTYPE_D_Multiple	= 0x02, // member data, multiple inheritance
	PMTYPE_D_Virtual	= 0x03, // member data, virtual inheritance
	PMTYPE_D_General	= 0x04, // member data, most general
	PMTYPE_F_Single		= 0x05, // member function, single inheritance
	PMTYPE_F_Multiple	= 0x06, // member function, multiple inheritance
	PMTYPE_F_Virtual	= 0x07, // member function, virtual inheritance
	PMTYPE_F_General	= 0x08, // member function, most general
};

const Pointer_16t = {
	attr: bin.as(uint32, bin.BitFields(32, {
		ptrtype:	bin.BitField(5, bin.Enum(ptrtype_e)),
		ptrmode:	bin.BitField(3, bin.Enum(ptrmode_e)),
		isflat32: 	1,
		isvolatile:	1,
		isconst:	1,
		isunaligned: 1,
	})),
	utype:	type16_t,
	pbase: bin.Switch((s: bin._stream) => s.obj.attr.ptrtype, {
		PTR_BASE_SEG: {
			bseg: uint16,
		},
		PTR_BASE_TYPE: {
			index: type16_t,
			name: stringz,
		},
	}/*, binary.Switch((s: binary._stream) => s.obj.attr.ptrmode, {
		PTR_MODE_PMEM: {
			pmclass:	type16_t,	// index of containing class for pointer to member
			pmenum:		binary.asEnum(uint16, pmtype_e),		// enumeration specifying pm format (pmtype_e)
		}
	})*/)
};

const Pointer = {
	utype: type_t,
	attr: bin.as(uint32, bin.BitFields(32, {
		ptrtype:	bin.BitField(5, bin.Enum(ptrtype_e)),
		ptrmode:	bin.BitField(3, bin.Enum(ptrmode_e)),
		isflat32: 1,
		isvolatile: 1,
		isconst: 1,
		isunaligned: 1,
		isrestrict: 1,
		size: 6, // 6 bits
		ismocom: 1,
		islref: 1,
		isrref: 1,
	})),
	pbase: bin.Switch((s: bin._stream) => s.obj.attr.ptrtype, {
		PTR_BASE_SEG: {
			bseg: uint16,
		},
		PTR_BASE_TYPE: {
			index: type16_t,
			name: stringz,
		},
	}/*, binary.Switch((s: binary._stream) => s.obj.attr.ptrmode, {
		PTR_MODE_PMEM: {
			pmclass:	type16_t,	// index of containing class for pointer to member
			pmenum:		binary.asEnum(uint16, pmtype_e),		// enumeration specifying pm format (pmtype_e)
		}
	})*/)
};

//	ARRAY
const Array_16t = {
	elemtype: type16_t,
	idxtype: type16_t,
	size: Value,
	name: stringz,
};
const Array = {
	elemtype: type_t,
	idxtype: type_t,
	size: Value,
	name: stringz,
};

const StridedArray = {
	elemtype: type_t,
	idxtype: type_t,
	stride: uint32,
	size: Value,
	name: stringz,
};

//	VECTOR
const Vector = {
	elemtype: type_t,
	count: uint32,
	size: Value,
	name: stringz,
};

//	MATRIX
const Matrix = {
	elemtype: type_t,
	rows: uint32,
	cols: uint32,
	majorStride: uint32,
	_: bin.as(uint32, bin.BitFields(32, {
		row_major: 1,
		unused: 7,
	})),
	size: Value,
	name: stringz,
};

//	CLASS, STRUCTURE
const Class_16t = {
	count: uint16,
	field: type16_t,
	property: prop_t,
	derived: type16_t,
	vshape: type16_t,
	size: Value,
	name: stringz,
};

const Class = {
	count: uint16,
	property: prop_t,
	field: type_t,
	derived: type_t,
	vshape: type_t,
	size: Value,
	name: stringz,
};

// Union structure
const Union_16t = {
	count: uint16,
	field: type16_t,
	property: prop_t,
	size: Value,
	name: stringz,
};
const Union = {
	count: uint16,
	property: prop_t,
	field: type_t,
	size: Value,
	name: stringz,
};

// Enum structure
const Enum_16t = {
	count: uint16,
	utype: type16_t,
	field: type16_t,
	property: prop_t,
	name: stringz,
};
const Enum = {
	count: uint16,
	property: prop_t,
	utype: type_t,
	field: type_t,
	name: stringz,
};


//	PROCEDURE
const Proc_16t = {
	rvtype:		type16_t,		// type index of return value
	calltype:	uint8,	// calling convention (call_t)
	funcattr:	funcattr_t,	// attributes
	parmcount:	uint16,	// number of parameters
	arglist:	type16_t,	// type index of argument list
};
const Proc = {
	rvtype:		type_t,		// type index of return value
	calltype:	uint8,	// calling convention (call_t)
	funcattr:	funcattr_t,	// attributes
	parmcount:	uint16,	// number of parameters
	arglist:	type_t,	// type index of argument list
};

//	member function
const MFunc_16t = { // LF_MFUNCTION_16t
	rvtype:		type16_t,		// type index of return value
	classtype:	type16_t,	// type index of containing class
	thistype:	type16_t,	// type index of this pointer (model specific)
	calltype:	uint8,	// calling convention (call_t)
	funcattr:	funcattr_t,	// attributes
	parmcount:	uint16,	// number of parameters
	arglist:	type16_t,	// type index of argument list
	thisadjust:	uint32,	// this adjuster (long because pad required anyway)
};
const MFunc = { // LF_MFUNCTION_16t
	rvtype:		type_t,		// type index of return value
	classtype:	type_t,	// type index of containing class
	thistype:	type_t,	// type index of this pointer (model specific)
	calltype:	uint8,	// calling convention (call_t)
	funcattr:	funcattr_t,	// attributes
	parmcount:	uint16,	// number of parameters
	arglist:	type_t,	// type index of argument list
	thisadjust:	uint32,	// this adjuster (long because pad required anyway)
};

//	ALIAS
const Alias = { // LF_ALIAS
	utype:	type_t,
	name: 	stringz,
};

function ST(x: any) {
	return x;
}

// Base leaf structure
const Leaf = bin.Switch(uint16, {
	LF_MODIFIER_16t:		Modifier_16t,
	LF_POINTER_16t:			Pointer_16t,
	LF_ARRAY_16t:			Array_16t,
	LF_CLASS_16t:			Class_16t,
	LF_STRUCTURE_16t:		Class_16t,
	LF_UNION_16t:			Union_16t,
	LF_ENUM_16t:			Enum_16t,
	LF_PROCEDURE_16t:		Proc_16t,
	LF_MFUNCTION_16t:		MFunc_16t,
//	LF_VTSHAPE:				VTShape,
//	LF_COBOL0_16t:			Cobol0_16t,
//	LF_COBOL1:				Cobol1,
//	LF_BARRAY_16t:			BArray_16t,
//	LF_LABEL:				Label,
//	LF_NULL:
//	LF_NOTTRAN:
//	LF_DIMARRAY_16t:		DimArray_16t,
//	LF_VFTPATH_16t:			VFTPath_16t,
//	LF_PRECOMP_16t:			PreComp_16t,
//	LF_ENDPRECOMP:			EndPreComp,
//	LF_OEM_16t:
//	LF_TYPESERVER_ST:
//	LF_SKIP_16t:			Skip_16t,
//	LF_ARGLIST_16t:			ArgList_16t,
//	LF_DEFARG_16t:			DefArg_16t,
//	LF_LIST:				List,
//	LF_FIELDLIST_16t:		FieldList_16t,
//	LF_DERIVED_16t:			Derived_16t,
//	LF_BITFIELD_16t:		Bitfield_16t,
//	LF_METHODLIST_16t:		MethodList_16t,
//	LF_DIMCONU_16t:			DimCon_16t,
//	LF_DIMCONLU_16t:		DimCon_16t,
//	LF_DIMVARU_16t:			DimVar_16t,
//	LF_DIMVARLU_16t:		DimVar_16t,
//	LF_REFSYM:				RefSym,
//	LF_BCLASS_16t:			BClass_16t,
//	LF_VBCLASS_16t:			VBClass_16t,
//	LF_IVBCLASS_16t:		VBClass_16t,
//	LF_ENUMERATE_ST:		ST(Enumerate),
//	LF_FRIENDFCN_16t:		FriendFcn_16t,
//	LF_INDEX_16t:			Index_16t,
//	LF_MEMBER_16t:			Member_16t,
//	LF_STMEMBER_16t:		STMember_16t,
//	LF_METHOD_16t:			Method_16t,
//	LF_NESTTYPE_16t:		NestType_16t,
//	LF_VFUNCTAB_16t:		VFuncTab_16t,
//	LF_FRIENDCLS_16t:		FriendCls_16t,
//	LF_ONEMETHOD_16t:		OneMethod_16t,
//	LF_VFUNCOFF_16t:		VFuncOff_16t,
	LF_MODIFIER:			Modifier,
	LF_POINTER:				Pointer,
	LF_ARRAY_ST:			Array,
	LF_CLASS_ST:			ST(Class),
	LF_STRUCTURE_ST:		ST(Class),
	LF_UNION_ST:			ST(Union),
	LF_ENUM_ST:				ST(Enum),
	LF_PROCEDURE:			Proc,
	LF_MFUNCTION:			MFunc,
//	LF_COBOL0:				Cobol0,
//	LF_BARRAY:				BArray,
//	LF_DIMARRAY_ST:			ST(DimArray),
//	LF_VFTPATH:				VFTPath,
//	LF_PRECOMP_ST:			ST(PreComp),
//	LF_OEM:
	LF_ALIAS_ST:			ST(Alias),
//	LF_OEM2:
//	LF_SKIP:				Skip,
//	LF_ARGLIST:				ArgList,
//	LF_DEFARG_ST:			DefArg,
//	LF_FIELDLIST:			FieldList,
//	LF_DERIVED:				Derived,
//	LF_BITFIELD:			Bitfield,
//	LF_METHODLIST:			MethodList,
//	LF_DIMCONU:				DimCon,
//	LF_DIMCONLU:			DimCon,
//	LF_DIMVARU:				DimVar,
//	LF_DIMVARLU:			DimVar,
//	LF_BCLASS:				BClass,
//	LF_VBCLASS:				VBClass,
//	LF_IVBCLASS:			VBClass,
//	LF_FRIENDFCN_ST:		ST(FriendFcn),
//	LF_INDEX:				Index,
//	LF_MEMBER_ST:			ST(Member),
//	LF_STMEMBER_ST:			ST(STMember),
//	LF_METHOD_ST:			ST(Method),
//	LF_NESTTYPE_ST:			ST(NestType),
//	LF_VFUNCTAB:			VFuncTab,
//	LF_FRIENDCLS:			FriendCls,
//	LF_ONEMETHOD_ST:		ST(OneMethod),
//	LF_VFUNCOFF:			VFuncOff,
//	LF_NESTTYPEEX_ST:		ST(NestTypeEx),
//	LF_MEMBERMODIFY_ST:		ST(MemberModify),
//	LF_MANAGED_ST:			ST(Managed),
//	LF_TYPESERVER:			TypeServer,
//	LF_ENUMERATE:			Enumerate,
	LF_ARRAY:				Array,
	LF_CLASS:				Class,
	LF_STRUCTURE:			Class,
	LF_UNION:				Union,
	LF_ENUM:				Enum,
//	LF_DIMARRAY:			DimArray,
//	LF_PRECOMP:				PreComp,
	LF_ALIAS:				Alias,
//	LF_DEFARG:				DefArg,
//	LF_FRIENDFCN:			FriendFcn,
//	LF_MEMBER:				Member,
//	LF_STMEMBER:			STMember,
//	LF_METHOD:				Method,
//	LF_NESTTYPE:			NestType,
//	LF_ONEMETHOD:			OneMethod,
//	LF_NESTTYPEEX:			NestTypeEx,
//	LF_MEMBERMODIFY:		MemberModify,
//	LF_MANAGED:				Managed,
//	LF_TYPESERVER2:			TypeServer2,
	LF_STRIDED_ARRAY:		StridedArray,
//	LF_HLSL:				HLSL,
//	LF_MODIFIER_EX:			ModifierEx,
//	LF_INTERFACE:			Interface,
//	LF_BINTERFACE:			BInterface,
	LF_VECTOR:				Vector,
	LF_MATRIX:				Matrix,
//	LF_VFTABLE:				Vftable,
//	LF_FUNC_ID:				FuncId,
//	LF_MFUNC_ID:			MFuncId,
//	LF_BUILDINFO:			BuildInfo,
//	LF_SUBSTR_LIST:			ArgList,
//	LF_STRING_ID:			StringId,
//	LF_UDT_SRC_LINE:		UdtSrcLine,
//	LF_UDT_MOD_SRC_LINE:	UdtModSrcLine,
//	default:				return proc(*type);
});

// Symbol enumeration - Complete list
enum SYM_ENUM_e {
	S_COMPILE = 0x0001,
	S_REGISTER_16t = 0x0002,
	S_CONSTANT_16t = 0x0003,
	S_UDT_16t = 0x0004,
	S_SSEARCH = 0x0005,
	S_END = 0x0006,
	S_SKIP = 0x0007,
	S_CVRESERVE = 0x0008,
	S_OBJNAME_ST = 0x0009,
	S_ENDARG = 0x000a,
	S_COBOLUDT_16t = 0x000b,
	S_MANYREG_16t = 0x000c,
	S_RETURN = 0x000d,
	S_ENTRYTHIS = 0x000e,
	S_BPREL16 = 0x0100,
	S_LDATA16 = 0x0101,
	S_GDATA16 = 0x0102,
	S_PUB16 = 0x0103,
	S_LPROC16 = 0x0104,
	S_GPROC16 = 0x0105,
	S_THUNK16 = 0x0106,
	S_BLOCK16 = 0x0107,
	S_WITH16 = 0x0108,
	S_LABEL16 = 0x0109,
	S_CEXMODEL16 = 0x010a,
	S_VFTABLE16 = 0x010b,
	S_REGREL16 = 0x010c,
	S_BPREL32_16t = 0x0200,
	S_LDATA32_16t = 0x0201,
	S_GDATA32_16t = 0x0202,
	S_PUB32_16t = 0x0203,
	S_LPROC32_16t = 0x0204,
	S_GPROC32_16t = 0x0205,
	S_THUNK32_ST = 0x0206,
	S_BLOCK32_ST = 0x0207,
	S_WITH32_ST = 0x0208,
	S_LABEL32_ST = 0x0209,
	S_CEXMODEL32 = 0x020a,
	S_VFTABLE32_16t = 0x020b,
	S_REGREL32_16t = 0x020c,
	S_LTHREAD32_16t = 0x020d,
	S_GTHREAD32_16t = 0x020e,
	S_SLINK32 = 0x020f,
	S_LPROCMIPS_16t = 0x0300,
	S_GPROCMIPS_16t = 0x0301,
	S_PROCREF_ST = 0x0400,
	S_DATAREF_ST = 0x0401,
	S_ALIGN = 0x0402,
	S_LPROCREF_ST = 0x0403,
	S_OEM = 0x0404,

	// 32-bit symbols
	S_TI16_MAX = 0x1000,
	S_REGISTER_ST = 0x1001,
	S_CONSTANT_ST = 0x1002,
	S_UDT_ST = 0x1003,
	S_COBOLUDT_ST = 0x1004,
	S_MANYREG_ST = 0x1005,
	S_BPREL32_ST = 0x1006,
	S_LDATA32_ST = 0x1007,
	S_GDATA32_ST = 0x1008,
	S_PUB32_ST = 0x1009,
	S_LPROC32_ST = 0x100a,
	S_GPROC32_ST = 0x100b,
	S_VFTABLE32 = 0x100c,
	S_REGREL32_ST = 0x100d,
	S_LTHREAD32_ST = 0x100e,
	S_GTHREAD32_ST = 0x100f,
	S_LPROCMIPS_ST = 0x1010,
	S_GPROCMIPS_ST = 0x1011,
	S_FRAMEPROC = 0x1012,
	S_COMPILE2_ST = 0x1013,
	S_MANYREG2_ST = 0x1014,
	S_LPROCIA64_ST = 0x1015,
	S_GPROCIA64_ST = 0x1016,
	S_LOCALSLOT_ST = 0x1017,
	S_PARAMSLOT_ST = 0x1018,
	S_ANNOTATION = 0x1019,
	S_GMANPROC_ST = 0x101a,
	S_LMANPROC_ST = 0x101b,
	S_RESERVED1 = 0x101c,
	S_RESERVED2 = 0x101d,
	S_RESERVED3 = 0x101e,
	S_RESERVED4 = 0x101f,
	S_LMANDATA_ST = 0x1020,
	S_GMANDATA_ST = 0x1021,
	S_MANFRAMEREL_ST = 0x1022,
	S_MANREGISTER_ST = 0x1023,
	S_MANSLOT_ST = 0x1024,
	S_MANMANYREG_ST = 0x1025,
	S_MANREGREL_ST = 0x1026,
	S_MANMANYREG2_ST = 0x1027,
	S_MANTYPREF = 0x1028,
	S_UNAMESPACE_ST = 0x1029,

	// Modern symbols
	S_ST_MAX = 0x1100,
	S_OBJNAME = 0x1101,
	S_THUNK32 = 0x1102,
	S_BLOCK32 = 0x1103,
	S_WITH32 = 0x1104,
	S_LABEL32 = 0x1105,
	S_REGISTER = 0x1106,
	S_CONSTANT = 0x1107,
	S_UDT = 0x1108,
	S_COBOLUDT = 0x1109,
	S_MANYREG = 0x110a,
	S_BPREL32 = 0x110b,
	S_LDATA32 = 0x110c,
	S_GDATA32 = 0x110d,
	S_PUB32 = 0x110e,
	S_LPROC32 = 0x110f,
	S_GPROC32 = 0x1110,
	S_REGREL32 = 0x1111,
	S_LTHREAD32 = 0x1112,
	S_GTHREAD32 = 0x1113,
	S_LPROCMIPS = 0x1114,
	S_GPROCMIPS = 0x1115,
	S_COMPILE2 = 0x1116,
	S_MANYREG2 = 0x1117,
	S_LPROCIA64 = 0x1118,
	S_GPROCIA64 = 0x1119,
	S_LOCALSLOT = 0x111a,
//	S_SLOT = 0x111a, // alias
	S_PARAMSLOT = 0x111b,
	S_LMANDATA = 0x111c,
	S_GMANDATA = 0x111d,
	S_MANFRAMEREL = 0x111e,
	S_MANREGISTER = 0x111f,
	S_MANSLOT = 0x1120,
	S_MANMANYREG = 0x1121,
	S_MANREGREL = 0x1122,
	S_MANMANYREG2 = 0x1123,
	S_UNAMESPACE = 0x1124,
	S_PROCREF = 0x1125,
	S_DATAREF = 0x1126,
	S_LPROCREF = 0x1127,
	S_ANNOTATIONREF = 0x1128,
	S_TOKENREF = 0x1129,
	S_GMANPROC = 0x112a,
	S_LMANPROC = 0x112b,
	S_TRAMPOLINE = 0x112c,
	S_MANCONSTANT = 0x112d,
	S_ATTR_FRAMEREL = 0x112e,
	S_ATTR_REGISTER = 0x112f,
	S_ATTR_REGREL = 0x1130,
	S_ATTR_MANYREG = 0x1131,
	S_SEPCODE = 0x1132,
	S_LOCAL_2005 = 0x1133,
	S_DEFRANGE_2005 = 0x1134,
	S_DEFRANGE2_2005 = 0x1135,
	S_SECTION = 0x1136,
	S_COFFGROUP = 0x1137,
	S_EXPORT = 0x1138,
	S_CALLSITEINFO = 0x1139,
	S_FRAMECOOKIE = 0x113a,
	S_DISCARDED = 0x113b,
	S_COMPILE3 = 0x113c,
	S_ENVBLOCK = 0x113d,
	S_LOCAL = 0x113e,
	S_DEFRANGE = 0x113f,
	S_DEFRANGE_SUBFIELD = 0x1140,
	S_DEFRANGE_REGISTER = 0x1141,
	S_DEFRANGE_FRAMEPOINTER_REL = 0x1142,
	S_DEFRANGE_SUBFIELD_REGISTER = 0x1143,
	S_DEFRANGE_FRAMEPOINTER_REL_FULL_SCOPE = 0x1144,
	S_DEFRANGE_REGISTER_REL = 0x1145,
	S_LPROC32_ID = 0x1146,
	S_GPROC32_ID = 0x1147,
	S_LPROCMIPS_ID = 0x1148,
	S_GPROCMIPS_ID = 0x1149,
	S_LPROCIA64_ID = 0x114a,
	S_GPROCIA64_ID = 0x114b,
	S_BUILDINFO = 0x114c,
	S_INLINESITE = 0x114d,
	S_INLINESITE_END = 0x114e,
	S_PROC_ID_END = 0x114f,
	S_DEFRANGE_HLSL = 0x1150,
	S_GDATA_HLSL = 0x1151,
	S_LDATA_HLSL = 0x1152,
	S_FILESTATIC = 0x1153,
	S_ARMSWITCHTABLE = 0x1159,
	S_CALLEES = 0x115a,
	S_CALLERS = 0x115b,
	S_POGODATA = 0x115c,
	S_INLINESITE2 = 0x115d,
	S_HEAPALLOCSITE = 0x115e,
	S_MOD_TYPEREF = 0x115f,
	S_REF_MINIPDB = 0x1160,
	S_PDBMAP = 0x1161,
	S_GDATA_HLSL32 = 0x1162,
	S_LDATA_HLSL32 = 0x1163,
	S_GDATA_HLSL32_EX = 0x1164,
	S_LDATA_HLSL32_EX = 0x1165,
	S_FASTLINK = 0x1167,
	S_INLINEES = 0x1168,
	S_RECTYPE_MAX = 0x1169,
//	S_RECTYPE_LAST = 0x1168,
	S_RECTYPE_PAD = 0x1269,
}


// Base symbol structure
const SYMTYPE = {
	reclen: uint16,
	rectyp: bin.asEnum(uint16, SYM_ENUM_e),
	data: bin.Size(field('reclen'), bin.Switch(field('rectype'), {
		// Register symbol
		S_REGSYM: {
			typind: type_t,
			reg: uint16,
			name: stringz,
		},

		// Constant symbol
		S_CONSTSYM: {
			typind: type_t,
			value: Value,
			name: stringz,
		},

		// UDT symbol
		S_UDTSYM: {
			typind: type_t,
			name: stringz,
		},

		// Data symbol
		S_DATASYM32: {
			typind: type_t,
			addr: {
				off: uint32,
				seg: uint16,
			},
			name: stringz,
		},

		// Procedure symbol
		S_PROCSYM32: {
			pParent: uint32,
			pEnd: uint32,
			pNext: uint32,
			len: uint32,
			DbgStart: uint32,
			DbgEnd: uint32,
			typind: type_t,
			addr: {
				off: uint32,
				seg: uint16,
			},
			flags: bin.as(uint8, bin.BitFields(8, {
				PFLAG_NOFPO: 1,
				PFLAG_INT: 1,
				PFLAG_FAR: 1,
				PFLAG_NEVER: 1,
				PFLAG_NOTREACHED: 1,
				PFLAG_CUST_CALL: 1,
				PFLAG_NOINLINE: 1,
				PFLAG_OPTDBGINFO: 1,
			})),
			name: stringz,
		},

	}))
};

// Subsection types
enum DEBUG_S {
	IGNORE = 0x80000000,
	SYMBOLS = 0xf1,
	LINES = 0xf2,
	STRINGTABLE = 0xf3,
	FILECHKSMS = 0xf4,
	FRAMEDATA = 0xf5,
	INLINEELINES = 0xf6,
	CROSSSCOPEIMPORTS = 0xf7,
	CROSSSCOPEEXPORTS = 0xf8,
}

// Line information
const LineInfo = {
	offset: uint32,
	_: bin.as(uint32, bin.BitFields(32, {
		linenumStart: 24,
		deltaLineEnd: 7,
		fStatement: 1,
	})),
};

// Subsection base structure
const SubSection = {
	type:	uint32,
	data:	bin.Size(int32, bin.Switch(field('type'), {
		[DEBUG_S.SYMBOLS]: bin.RemainingArray(SYMTYPE),
		[DEBUG_S.LINES]: bin.RemainingArray(LineInfo),
		[DEBUG_S.STRINGTABLE]: bin.RemainingArray(stringz),
		[DEBUG_S.FILECHKSMS]: bin.Remainder,
		[DEBUG_S.FRAMEDATA]: bin.Remainder,
		[DEBUG_S.INLINEELINES]: bin.Remainder,
		[DEBUG_S.CROSSSCOPEIMPORTS]: bin.Remainder,
		[DEBUG_S.CROSSSCOPEEXPORTS]: bin.Remainder,
	}))
};
