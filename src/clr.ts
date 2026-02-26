import * as bin from '@isopodlabs/binary';
import * as pe from './pe';

//-----------------------------------------------------------------------------
//	CLR
//-----------------------------------------------------------------------------

const HEAP = {
	String:			0,
	GUID:			1,
	Blob:			2,
	UserString:		3,
} as const;

const CLR_FLAGS = {
	FLAGS_ILONLY:				0x00000001,
	FLAGS_32BITREQUIRED:		0x00000002,
	FLAGS_IL_LIBRARY:			0x00000004,
	FLAGS_STRONGNAMESIGNED:		0x00000008,
	FLAGS_NATIVE_ENTRYPOINT:	0x00000010,
	FLAGS_TRACKDEBUGDATA:		0x00010000,
} as const;

const CLR_HEADER = {
	cb:							bin.UINT32_LE,
	MajorRuntimeVersion:		bin.UINT16_LE,
	MinorRuntimeVersion:		bin.UINT16_LE,
	MetaData:					pe.DATA_DIRECTORY,
	Flags:						bin.asFlags(bin.UINT32_LE, CLR_FLAGS),
	EntryPoint:					bin.UINT32_LE,
	Resources:					pe.DATA_DIRECTORY,
	StrongNameSignature:		pe.DATA_DIRECTORY,
	CodeManagerTable:			pe.DATA_DIRECTORY,
	VTableFixups:				pe.DATA_DIRECTORY,
	ExportAddressTableJumps:	pe.DATA_DIRECTORY,
	//ManagedNativeHeader:		pe.DATA_DIRECTORY,
};

const STREAM_HDR = {
	Offset:		bin.UINT32_LE,		// Memory offset to start of this stream from start of the metadata root (§II.24.2.1)
	Size:		bin.UINT32_LE,		// Size of this stream in bytes, shall be a multiple of 4.
	Name:		bin.NullTerminatedStringType(),	// Name of the stream as null-terminated variable length array of ASCII characters, padded to the next 4-byte boundary with \0 characters. The name is limited to 32 characters.
	unused:		bin.AlignType(4),
};

const METADATA_ROOT = {
	Signature:    	bin.UINT32_LE,	//'BSJB'
	MajorVersion: 	bin.UINT16_LE,
	MinorVersion: 	bin.UINT16_LE,
	Reserved:     	bin.UINT32_LE,	// always 0
	Version:      	bin.StringType(bin.UINT32_LE, 'utf8', true),
	unknown: 		bin.UINT16_LE,
	Streams:		bin.ArrayType(bin.UINT16_LE, STREAM_HDR)
};

const CLR_TABLES = {
	Reserved:    	bin.UINT32_LE,	// Reserved, always 0 (§II.24.1).
	MajorVersion:	bin.UINT8,		// Major version of table schemata; shall be 2 (§II.24.1).
	MinorVersion:	bin.UINT8,		// Minor version of table schemata; shall be 0 (§II.24.1).
	HeapSizes:   	bin.UINT8,		// Bit vector for heap sizes.
	Reserved2:   	bin.UINT8,		// Reserved, always 1 (§II.24.1).
	Valid:  	 	bin.UINT64_LE,	// Bit vector of present tables, let n be the number of bits that are 1.
	Sorted: 	 	bin.UINT64_LE,	// Bit vector of sorted tables.
};

enum TABLE {
	Module						= 0x00,
	TypeRef						= 0x01,
	TypeDef						= 0x02,
	// Unused					= 0x03,
	Field						= 0x04,
	// Unused					= 0x05,
	MethodDef					= 0x06,
	// Unused					= 0x07,
	Param						= 0x08,
	InterfaceImpl				= 0x09,
	MemberRef					= 0x0a,
	Constant					= 0x0b,
	CustomAttribute				= 0x0c,
	FieldMarshal				= 0x0d,
	DeclSecurity				= 0x0e,
	ClassLayout					= 0x0f,

	FieldLayout					= 0x10,
	StandAloneSig				= 0x11,
	EventMap					= 0x12,
	// Unused					= 0x13,
	Event						= 0x14,
	PropertyMap					= 0x15,
	// Unused					= 0x16,
	Property					= 0x17,
	MethodSemantics				= 0x18,
	MethodImpl					= 0x19,
	ModuleRef					= 0x1a,
	TypeSpec					= 0x1b,
	ImplMap						= 0x1c,
	FieldRVA					= 0x1d,
	// Unused					= 0x1e,
	// Unused					= 0x1f,

	Assembly					= 0x20,
	AssemblyProcessor			= 0x21,
	AssemblyOS					= 0x22,
	AssemblyRef					= 0x23,
	AssemblyRefProcessor		= 0x24,
	AssemblyRefOS				= 0x25,
	File						= 0x26,
	ExportedType				= 0x27,
	ManifestResource			= 0x28,
	NestedClass					= 0x29,
	GenericParam				= 0x2a,
	MethodSpec					= 0x2b,
	GenericParamConstraint		= 0x2c,
}

function bytesToGuid(bytes: Uint8Array) {
    // Convert each byte to a two-digit hexadecimal string
    const hexArray = Array.from(bytes, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2));

    // Join the hex strings into the standard GUID format
    return hexArray.slice(0, 4).join('') + '-' +
           hexArray.slice(4, 6).join('') + '-' +
           hexArray.slice(6, 8).join('') + '-' +
           hexArray.slice(8, 10).join('') + '-' +
           hexArray.slice(10, 16).join('');
}

class clr_stream extends bin.stream {
	constructor(buffer: Uint8Array, public heaps:Uint8Array[], public heap_sizes: number, public table_counts: number[]) {
		super(buffer);
	}
	getOffset(big: boolean) {
		return (big ? bin.UINT32_LE : bin.UINT16_LE).get(this);
	}
	getHeap(heap:number) {
		return this.heaps[heap].subarray(this.getOffset(!!(this.heap_sizes & (1 << heap))));
	}
	getIndex(table:number) {
		return this.getOffset(this.table_counts[table] > 0xffff);
	}
	getCodedIndex(B: number, trans:number[]) {
		const	thresh = 0xffff >> B;
		for (const i of trans) {
			if (this.table_counts[i] > thresh)
				return bin.UINT32_LE.get(this);
		}
		return bin.UINT16_LE.get(this);
	}
	getString() {
		const mem	= this.getHeap(HEAP.String);
		const n		= mem.indexOf(0);
		return String.fromCharCode(...mem.subarray(0, n));
	}
	getGUID() {
		return bytesToGuid(this.getHeap(HEAP.GUID));
	}
	getBlob() {
		return this.getHeap(HEAP.Blob);
	}
}
class clr_dummy extends bin.dummy {
	constructor(public heap_sizes: number, public table_counts: number[]) {
		super();
	}
	getOffset(big: boolean) {
		return (big ? bin.UINT32_LE : bin.UINT16_LE).get(this);
	}
	getHeap(heap:number) {
		return this.getOffset(!!(this.heap_sizes & (1 << heap)));
	}
	getIndex(table:number) {
		return this.getOffset(this.table_counts[table] > 0xffff);
	}
	getCodedIndex(B: number, trans:number[]) {
		const	thresh = 0xffff >> B;
		for (const i of trans) {
			if (this.table_counts[i] > thresh)
				return bin.UINT32_LE.get(this);
		}
		return bin.UINT16_LE.get(this);
	}
	getString() { return this.getHeap(HEAP.String); }
	getGUID() 	{ return this.getHeap(HEAP.GUID); }
	getBlob() 	{ return this.getHeap(HEAP.Blob); }
}

const clr_String = {
	get(s: clr_stream) 					{ return s.getString(); },
	put(_s: clr_stream, _v : number)	{}
};
const clr_GUID = {
	get(s: clr_stream) 					{ return s.getGUID(); },
	put(_s: clr_stream, _v : number)	{}
};
const clr_Blob = {
	get(s: clr_stream) 					{ return s.getBlob(); },
	put(_s: clr_stream, _v : number)	{}
};
const Signature 			= clr_Blob;
const CustomAttributeValue	= clr_Blob;

const clr_Code = bin.UINT32_LE;

function Indexed(table: number) {
	return {
		get(s: clr_stream) 				{ return s.getIndex(table); }
	};
}
function IndexedList(table: number) {
	return {
		get(s: clr_stream) 				{ return s.getIndex(table); }
	};
}
function CodedIndex(trans: number[], B: number)	{
	return {
		get(s: clr_stream) 				{ return s.getCodedIndex(B, trans); }
	};
}

const TypeDefOrRef			= CodedIndex([TABLE.TypeDef, TABLE.TypeRef, TABLE.TypeSpec], 2);
const HasConstant			= CodedIndex([TABLE.Field, TABLE.Param, TABLE.Property], 2);
const HasCustomAttribute	= CodedIndex([
	TABLE.MethodDef, TABLE.Field, TABLE.TypeRef, TABLE.TypeDef, TABLE.Param, TABLE.InterfaceImpl, TABLE.MemberRef, TABLE.Module, TABLE.DeclSecurity, TABLE.Property, TABLE.Event, TABLE.StandAloneSig,
	TABLE.ModuleRef, TABLE.TypeSpec, TABLE.Assembly, TABLE.AssemblyRef, TABLE.File, TABLE.ExportedType, TABLE.ManifestResource, TABLE.GenericParam, TABLE.GenericParamConstraint, TABLE.MethodSpec,
], 5);
const HasFieldMarshall		= CodedIndex([TABLE.Field, TABLE.Param], 1);
const HasDeclSecurity		= CodedIndex([TABLE.TypeDef, TABLE.MethodDef, TABLE.Assembly], 2);
const MemberRefParent		= CodedIndex([TABLE.TypeDef, TABLE.TypeRef, TABLE.ModuleRef, TABLE.MethodDef, TABLE.TypeSpec], 1);
const HasSemantics			= CodedIndex([TABLE.Event, TABLE.Property], 1);
const MethodDefOrRef		= CodedIndex([TABLE.MethodDef, TABLE.MemberRef], 1);
const MemberForwarded		= CodedIndex([TABLE.Field, TABLE.MethodDef], 1);
const Implementation		= CodedIndex([TABLE.File, TABLE.AssemblyRef, TABLE.ExportedType], 2);
const CustomAttributeType	= CodedIndex([0, 0, TABLE.MethodDef, TABLE.MemberRef], 3);
const TypeOrMethodDef		= CodedIndex([TABLE.TypeDef, TABLE.MethodDef], 1);
const ResolutionScope		= CodedIndex([TABLE.Module, TABLE.ModuleRef, TABLE.AssemblyRef, TABLE.TypeRef], 2);

const TableReaders = {
	[TABLE.Module]: {
		generation:	bin.UINT16_LE,
		name:		clr_String,
		mvid:		clr_GUID,
		encid:		clr_GUID,
		encbaseid:	clr_GUID,
	},
	[TABLE.TypeRef]: {
		scope:		ResolutionScope,
		name:		clr_String,
		namespce:	clr_String,
	},
	[TABLE.TypeDef]: {
		flags:		bin.UINT32_LE,
		name:		clr_String,
		namespce:	clr_String,
		extends:	TypeDefOrRef,
		fields:		IndexedList(TABLE.Field),
		methods:	IndexedList(TABLE.MethodDef),
	},
	[TABLE.Field]: {
		flags:		bin.UINT16_LE,
		name:		clr_String,
		signature:	Signature,
	},
	[TABLE.MethodDef]: {
		code:		clr_Code,
		implflags:	bin.UINT16_LE,
		flags:		bin.UINT16_LE,
		name:		clr_String,
		signature:	Signature,
		paramlist:	IndexedList(TABLE.Param),
	},
	[TABLE.Param]: {
		flags:		bin.UINT16_LE,
		sequence:	bin.UINT16_LE,
		name:		clr_String,
	},
	[TABLE.InterfaceImpl]: {
		clss:		Indexed(TABLE.TypeDef),
		interfce:	TypeDefOrRef,
	},
	[TABLE.MemberRef]: {
		clss:		MemberRefParent,
		name:		clr_String,
		signature:	Signature,
	},
	[TABLE.Constant]: {
		type:		bin.UINT16_LE,
		parent:		HasConstant,
		value:		clr_Blob,
	},
	[TABLE.CustomAttribute]: {
		parent:		HasCustomAttribute,
		type:		CustomAttributeType,
		value:		CustomAttributeValue,
	},	
	[TABLE.FieldMarshal]: {
		parent:			HasFieldMarshall,
		native_type:	clr_Blob,
	},
	[TABLE.DeclSecurity]: {
		action:			bin.UINT16_LE,
		parent:			HasDeclSecurity,
		permission_set:	clr_Blob,
	},
	[TABLE.ClassLayout]: {
		packing_size:	bin.UINT16_LE,
		class_size:		bin.UINT32_LE,
		parent:			Indexed(TABLE.TypeDef),
	},
	[TABLE.FieldLayout]: {
		offset:			bin.UINT32_LE,
		field:			Indexed(TABLE.Field),
	},
	[TABLE.StandAloneSig]: {
		signature:		Signature,
	},
	[TABLE.EventMap]: {
		parent:			Indexed(TABLE.TypeDef),
		event_list:		IndexedList(TABLE.Event),
	},
	[TABLE.Event]: {
		flags:			bin.UINT16_LE,
		name:			clr_String,
		event_type:		TypeDefOrRef,
	},
	[TABLE.PropertyMap]: {
		parent:			Indexed(TABLE.TypeDef),
		property_list:	IndexedList(TABLE.Property),
	},
	[TABLE.Property]: {
		flags:			bin.UINT16_LE,
		name:			clr_String,
		type:			Signature,
	},
	[TABLE.MethodSemantics]: {
		flags:			bin.UINT16_LE,
		method:			Indexed(TABLE.MethodDef),
		association:	HasSemantics,
	},
	[TABLE.MethodImpl]: {
		clss:				Indexed(TABLE.TypeDef),
		method_body:		MethodDefOrRef,
		method_declaration:	MethodDefOrRef,
	},
	[TABLE.ModuleRef]: {
		name:			clr_String,
	},
	[TABLE.TypeSpec]: {
		signature:		clr_Blob,
	},
	[TABLE.ImplMap]: {
		flags:				bin.UINT16_LE,
		member_forwarded:	MemberForwarded,
		name:				clr_String,
		scope:				Indexed(TABLE.ModuleRef),
	},
	[TABLE.FieldRVA]: {
		rva:		bin.UINT32_LE,
		field:		Indexed(TABLE.Field),
	},
	[TABLE.Assembly]: {
		hashalg:	bin.UINT32_LE,
		major:		bin.UINT16_LE,
		minor:		bin.UINT16_LE,
		build:		bin.UINT16_LE,
		rev:		bin.UINT16_LE,
		flags:		bin.UINT32_LE,
		publickey:	clr_Blob,
		name:		clr_String,
		culture:	clr_String,
	},
	[TABLE.AssemblyProcessor]: {
		processor:	bin.UINT32_LE,
	},
	[TABLE.AssemblyOS]: {
		platform:	bin.UINT32_LE,
		minor:		bin.UINT32_LE,
		major:		bin.UINT32_LE,
	},
	[TABLE.AssemblyRef]: {
		major:		bin.UINT16_LE,
		minor:		bin.UINT16_LE,
		build:		bin.UINT16_LE,
		rev:		bin.UINT16_LE,
		flags:		bin.UINT32_LE,
		publickey:	clr_Blob,
		name:		clr_String,
		culture:	clr_String,
		hashvalue:	clr_Blob,
	},
	[TABLE.AssemblyRefProcessor]: {
		processor:	bin.UINT32_LE,
		assembly:	Indexed(TABLE.AssemblyRef),
	},
	[TABLE.AssemblyRefOS]: {
		platform:	bin.UINT32_LE,
		major:		bin.UINT32_LE,
		minor:		bin.UINT32_LE,
		assembly:	Indexed(TABLE.AssemblyRef),
	},
	[TABLE.File]: {
		flags:		bin.UINT32_LE,
		name:		clr_String,
		hash:		clr_Blob,
	},
	[TABLE.ExportedType]: {
		flags:		bin.UINT32_LE,
		typedef_id:	bin.UINT32_LE,//(a 4-byte index into a TypeDef table of another module in this Assembly).
		name:		clr_String,
		namespce:	clr_String,
		implementation:	Implementation,
	},
	[TABLE.ManifestResource]: {
		data:			bin.UINT32_LE,
		flags:			bin.UINT32_LE,
		name:			clr_String,
		implementation:	Implementation,
	},
	[TABLE.NestedClass]: {
		nested_class:		Indexed(TABLE.TypeDef),
		enclosing_class:	Indexed(TABLE.TypeDef),
	},
	[TABLE.GenericParam]: {
		number:			bin.UINT16_LE,
		flags:			bin.UINT16_LE,
		owner:			TypeOrMethodDef,
		name:			clr_String,
	},
	[TABLE.MethodSpec]: {
		method:			MethodDefOrRef,
		instantiation:	Signature,
	},
	[TABLE.GenericParamConstraint]: {
		owner:			Indexed(TABLE.GenericParam),
		constraint:		TypeDefOrRef,
	},
};

const ResourceManagerHeader = {
	magic:			bin.UINT32_LE,
	version:		bin.UINT32_LE,
	skip:			bin.UINT32_LE,
};

const ResourceManager = {
	reader: 		bin.StringType(bin.UINT8),// Class name of IResourceReader to parse this file
	set:			bin.StringType(bin.UINT8),// Class name of ResourceSet to parse this file
	version:		bin.UINT32_LE,
	num_resources:	bin.UINT32_LE,
	types: 			bin.ArrayType(bin.UINT32_LE, bin.StringType(bin.UINT8)),
};

const ResourceEntry = {
	name:			bin.StringType(bin.UINT8, 'utf16le', false, 1),
	offset:			bin.UINT32_LE,
};

interface Table { count: number, size: number, offset: number }

export class CLR {
	private raw?:		Uint8Array;
	header;
	table_info;
	heaps:		Uint8Array[] = [];
	tables:		Record<TABLE, Table> = {} as any;
	Resources?:	Uint8Array;

	constructor(pe: pe.PE, clr_data: Uint8Array) {
		this.header		= bin.read(new bin.stream(clr_data), CLR_HEADER);
		const meta_data	= pe.GetDataDir(this.header.MetaData);
		const meta_root	= meta_data && bin.read(new bin.stream(meta_data.data), METADATA_ROOT);

		if (meta_root?.Signature != bin.utils.stringCode('BSJB'))
			throw new Error("Invalid CLR");

		let 	table_data;

		for (const h of meta_root!.Streams) {
			const	mem = meta_data!.data.subarray(h.Offset, h.Offset + h.Size);
			switch (h.Name) {
				case "#~":			table_data					= mem; break;
				case "#Strings":	this.heaps[HEAP.String]		= mem; break;
				case "#US":			this.heaps[HEAP.UserString]	= mem; break;
				case "#GUID":		this.heaps[HEAP.GUID]		= mem; break;
				case "#Blob":		this.heaps[HEAP.Blob]		= mem; break;
			}
		}

		if (table_data) {
			const stream	= new bin.stream(table_data);
			this.table_info	= bin.read(stream, CLR_TABLES);
			const table_counts: number[] = [];

			//read counts
			for (let b = this.table_info.Valid; b; b = bin.utils.clearLowest(b)) {
				const i = bin.utils.lowestSetIndex(b);
				table_counts[i] = bin.UINT32_LE.get(stream);
			}

			this.raw 		= stream.remainder();
			const stream1 	= new clr_dummy(this.table_info.HeapSizes, table_counts);
			let offset 		= 0;

			for (let b = this.table_info.Valid; b; b = bin.utils.clearLowest(b)) {
				const i = bin.utils.lowestSetIndex(b) as TABLE;
				stream1.seek(0);
				bin.read(stream1, TableReaders[i]);
				this.tables[i] = {offset, count: table_counts[i], size: stream1.tell()};
				offset	+= this.tables[i]!.size * this.tables[i]!.count;
			}

			this.Resources = pe.GetDataDir(this.header.Resources)?.data;
		}
	}

	getEntry<T extends TABLE>(t: T, i: number): bin.ReadType<typeof TableReaders[T]>;
	getEntry(t: TABLE, i: number): any;
	getEntry(t: TABLE, i: number) : any {
		const table = this.tables[t];
		if (table) {
			const stream2 = new clr_stream(this.raw!, this.heaps, this.table_info!.HeapSizes, Object.values(this.tables).map(i => i.count));
			stream2.seek(table.offset + i * table.size);
			return bin.read(stream2, TableReaders[t]);
		}
	}

	getTable<T extends TABLE>(t: T): bin.ReadType<typeof TableReaders[T]>[];
	getTable(t: TABLE): any;
	getTable(t: TABLE) {
		const table = this.tables[t];
		if (table) {
			const stream2 = new clr_stream(this.raw!, this.heaps, this.table_info!.HeapSizes, Object.values(this.tables).map(i => i.count));
			stream2.seek(table.offset);
			const result: any[] = [];
			for (let i = 0; i < table.count; i++)
				result.push(bin.read(stream2, TableReaders[t]));
			return result;
		}
	}

	getResources(block: string) {
		if (this.Resources) {
			for (const i of this.getTable(TABLE.ManifestResource)!) {
				if (i.name == block) {
					const data0 	= new bin.stream(this.Resources.subarray(i.data));
					const size 		= bin.UINT32_LE.get(data0);
					return getResources(data0.read_buffer(size));
				}
			}
		}
	}

	getResource(block: string, name: string) {
		return this.getResources(block)?.[name];
	}

	allResources() {
		if (this.Resources) {
			const result = {} as any;
			for (const i of this.getTable(TABLE.ManifestResource)!) {
				const data0 	= new bin.stream(this.Resources.subarray(i.data));
				const size 		= bin.UINT32_LE.get(data0);
				const resources = getResources(data0.read_buffer(size));
				if (resources)
					Object.assign(result, resources);
			}
			return result;
		}
	}
}

function getResources(data: Uint8Array) {
	const stream	= new bin.stream(data); 
	const manager0 	= bin.read(stream, ResourceManagerHeader);
	if (manager0.magic == 0xBEEFCACE) {
		const manager	= bin.read_more(stream, ResourceManager, manager0);
		bin.AlignType(8).get(stream);
		const _hashes 	= bin.readn(stream, bin.UINT32_LE, manager.num_resources);
		const _offsets	= bin.readn(stream, bin.UINT32_LE, manager.num_resources);
		const start		= bin.UINT32_LE.get(stream);
		const entries 	= bin.readn(stream, ResourceEntry, manager.num_resources);

		const resources : Record<string, any> = {};
		const decoder	= new TextDecoder('utf-8');
		for (let j = 0; j < manager.num_resources; j++) {
			const from	= start + entries[j].offset;
			resources[entries[j].name] = data[from] == 1
				? decoder.decode(data.subarray(from + 2, from + 2 + data[from + 1]))
				: data.subarray(from, j < manager.num_resources - 1 ? start + entries[j + 1].offset : data.length);
		}
		return resources;
	}
}

// hook into PE reader
/*
pe.DIRECTORIES.CLR_DESCRIPTOR.read = (pe: pe.PE, data: binary.MappedMemory) => {
	function fix_names(table: any[]) {
		if ('name' in table[0])
			return Object.fromEntries(table.map(i => [i.name, i]));
		return table;
	}
	const clr = new CLR(pe, data.data);
	return Object.fromEntries(Object.entries(clr.tables).map(([k, v]) => [TABLE[+k], fix_names(clr.getTable(+k)!)]));
};
*/
export function ReadCLR(pe: pe.PE, data: bin.MappedMemory) {
	function fix_names(table: any[]) {
		if ('name' in table[0])
			return Object.fromEntries(table.map(i => [i.name, i]));
		return table;
	}
	const clr = new CLR(pe, data.data);
	return Object.fromEntries(Object.entries(clr.tables).map(([k, _]) => [TABLE[+k], fix_names(clr.getTable(+k)!)]));
}

