import * as bin from '@isopodlabs/binary';
import { MappedMemory } from './common';
import { ReadCLR } from './clr';

class MyDate extends Date {
	constructor(x: number) { super(x * 1000); }
	valueOf()	{ return this.getTime() / 1000; }
	toString()	{ return super.toString(); }
}

const uint16	= bin.UINT16_LE;
const uint32	= bin.UINT32_LE;
const uint64	= bin.UINT64_LE;

const TIMEDATE	= bin.as(uint32, MyDate);

//-----------------------------------------------------------------------------
//	COFF
//-----------------------------------------------------------------------------

const MACHINES: Record<string, number> = {
	UNKNOWN:	0x0,
	AM33:		0x1d3,
	AMD64:		0x8664,
	ARM:		0x1c0,
	ARMV7:		0x1c4,
	EBC:		0xebc,
	I386:		0x14c,
	IA64:		0x200,
	M32R:		0x9041,
	MIPS16:		0x266,
	MIPSFPU:	0x366,
	MIPSFPU16:	0x466,
	POWERPC:	0x1f0,
	POWERPCFP:	0x1f1,
	R4000:		0x166,
	SH3:		0x1a2,
	SH3DSP:		0x1a3,
	SH4:		0x1a6,
	SH5:		0x1a8,
	THUMB:		0x1c2,
	WCEMIPSV2:	0x169,
};
const MACHINE = bin.asEnum(uint16, MACHINES);

const FILE_HEADER = {
	Machine:				MACHINE,
	NumberOfSections:		uint16,
	TimeDateStamp:			uint32,
	PointerToSymbolTable:	uint32,
	NumberOfSymbols:		uint32,
	SizeOfOptionalHeader:	uint16,
	Characteristics:		uint16,
};

const SECTION_CHARACTERISTICS = {
//							0x00000000,
//							0x00000001,
//							0x00000002,
//							0x00000004,
	TYPE_NO_PAD:			0x00000008,
//							0x00000010,
	CNT_CODE:				0x00000020,
	CNT_INITIALIZED_DATA:	0x00000040,
	CNT_UNINITIALIZED_DATA:	0x00000080,
	LNK_OTHER:				0x00000100,
	LNK_INFO:				0x00000200,
//							0x00000400,
	LNK_REMOVE:				0x00000800,
	LNK_COMDAT:				0x00001000,
	GPREL:					0x00008000,
//	MEM_PURGEABLE			0x00020000,
	MEM_16BIT:				0x00020000,
	MEM_LOCKED:				0x00040000,
	MEM_PRELOAD:			0x00080000,
	ALIGN:					0x00f00000,
	//ALIGN_1BYTES			0x00100000,
	//ALIGN_2BYTES			0x00200000,
	//ALIGN_4BYTES			0x00300000,
	//ALIGN_8BYTES			0x00400000,
	//ALIGN_16BYTES			0x00500000,
	//ALIGN_32BYTES			0x00600000,
	//ALIGN_64BYTES			0x00700000,
	//ALIGN_128BYTES		0x00800000,
	//ALIGN_256BYTES		0x00900000,
	//ALIGN_512BYTES		0x00A00000,
	//ALIGN_1024BYTES		0x00B00000,
	//ALIGN_2048BYTES		0x00C00000,
	//ALIGN_4096BYTES		0x00D00000,
	//ALIGN_8192BYTES		0x00E00000,
	LNK_NRELOC_OVFL:		0x01000000,
	MEM_DISCARDABLE:		0x02000000,
	MEM_NOT_CACHED:			0x04000000,
	MEM_NOT_PAGED:			0x08000000,
	MEM_SHARED:				0x10000000,
	MEM_EXECUTE:			0x20000000,
	MEM_READ:				0x40000000,
	MEM_WRITE:				0x80000000,
} as const;

export class Section extends bin.ReadClass({
	Name:					bin.StringType(8),
	VirtualSize:			uint32,
	VirtualAddress:			bin.asHex(uint32),
	SizeOfRawData:			uint32,
	PointerToRawData:		bin.asHex(uint32),
	PointerToRelocations:	bin.asHex(uint32),
	PointerToLinenumbers:	bin.asHex(uint32),
	NumberOfRelocations:	bin.INT16_LE,
	NumberOfLinenumbers:	bin.INT16_LE,
	Characteristics:		bin.asFlags(uint32, SECTION_CHARACTERISTICS)
}) {
	data?: MappedMemory;
	constructor(r: bin.stream) {
		super(r);
		try {
			this.data = new MappedMemory(bin.buffer_at(r, +this.PointerToRawData, this.SizeOfRawData), BigInt(this.VirtualAddress.value), this.flags);
		} catch (e) {
			console.log(e);
		}
	}
	get flags() {
		return MappedMemory.RELATIVE
			| (this.Characteristics.MEM_READ	? MappedMemory.READ 		: 0)
			| (this.Characteristics.MEM_WRITE	? MappedMemory.WRITE 	: 0)
			| (this.Characteristics.MEM_EXECUTE	? MappedMemory.EXECUTE	: 0);
	}
}

export class COFF {
	static check(data: Uint8Array): boolean {
		const header = bin.read(new bin.stream(data), FILE_HEADER);
		return MACHINES[header.Machine] !== undefined;
	}

	header:		bin.ReadType<typeof FILE_HEADER>;
	opt?:		bin.ReadType<typeof OPTIONAL_HEADER> & (bin.ReadType<typeof OPTIONAL_HEADER32> | bin.ReadType<typeof OPTIONAL_HEADER64>);
	sections:	Section[];

	constructor(data: Uint8Array) {
		const file	= new bin.stream(data);
		this.header = bin.read(file, FILE_HEADER);

		if (this.header.SizeOfOptionalHeader) {
			console.log("COFF: SizeOfOptionalHeader", this.header.SizeOfOptionalHeader);

		}

		this.sections = Array.from({length: this.header.NumberOfSections}, () => new Section(file));
	}
}

// these appear in libs:

const SYMBOL = {
	a: uint16,	//0
	b: uint16,	//0xffff
	c: uint16,	//0
	Architecture:	MACHINE,  // 0x14C for x86, 0x8664 for x64
	Id:				uint32,
	Length:			uint32,
	//union {
	//    Hint: uint16,
	//    Ordinal: uint16,
		Value: uint16,
	//}
	Type: uint16,
	Symbol: bin.NullTerminatedStringType(),
	Module: bin.NullTerminatedStringType(),
};

export class COFFSymbol extends bin.ReadClass(SYMBOL) {
	static check(data: Uint8Array): boolean {
		const test = bin.read(new bin.stream(data), SYMBOL);
		return test.a === 0 && test.b === 0xffff && test.c === 0 && test.Architecture != 'UNKNOWN';
	}
	constructor(data: Uint8Array) {
		super(new bin.stream(data));
	}
}

//-----------------------------------------------------------------------------
//	PE
//-----------------------------------------------------------------------------

export class pe_stream extends bin.stream {
	constructor(public pe: PE, data: Uint8Array) {
		super(data);
	}
	translate_rva(addr: number) { return this.pe.GetDataRVA(addr); }
	get_rva()	{ return this.pe.GetDataRVA(uint32.get(this))?.data; }
}

const RVA_BLOB = {
	get(s: pe_stream)	{ return s.get_rva(); },
	put(_s: pe_stream)	{}
};
const RVA_STRING = {
	get(s: pe_stream)	{ return bin.utils.decodeTextTo0(s.get_rva(), 'utf8'); },
	put(_s: pe_stream)	{}
};
const RVA_ARRAY16 = {
	get(s: pe_stream)	{ return bin.utils.as16(s.get_rva()); },
	put(_s: pe_stream)	{}
};
const RVA_ARRAY32 = {
	get(s: pe_stream)	{ return bin.utils.as32(s.get_rva()); },
	put(_s: pe_stream)	{}
};

const DOS_HEADER = {
	magic:		uint16,
	cblp:		uint16,
	cp:			uint16,
	crlc:		uint16,
	cparhdr:	uint16,
	minalloc:	uint16,
	maxalloc:	bin.asHex(uint16),
	ss:			uint16,
	sp:			uint16,
	csum:		uint16,
	ip:			uint16,
	cs:			uint16,
	lfarlc:		uint16,
	ovno:		uint16,
};

const EXE_HEADER = {
	res:		bin.ArrayType(4, uint16),
	oemid:		uint16,
	oeminfo:	uint16,
	res2:		bin.ArrayType(10, uint16),
	lfanew:		bin.INT32_LE,
};

interface DirectoryInfo {
	read: (pe: PE, data: MappedMemory) => unknown;
}
const NoInfo: DirectoryInfo = {
	read: (pe: PE, data: MappedMemory) => data
};

export const DIRECTORIES = {
	EXPORT:			{read: (pe, data) => ReadExports(new pe_stream(pe, data.data)) },
	IMPORT:			{read: (pe, data) => ReadImports(new pe_stream(pe, data.data)) },
	RESOURCE:		{read: (pe, data) => ReadResourceDirectory(new pe_stream(pe, data.data))},
	EXCEPTION:		NoInfo,	// Exception Directory
	SECURITY:		NoInfo,	// Security Directory
	BASERELOC:		NoInfo,	// Base Relocation Table
	DEBUG_DIR:		NoInfo,	// Debug Directory
	ARCHITECTURE:	NoInfo,	// Architecture Specific Data
	GLOBALPTR:		NoInfo,	// RVA of GP
	TLS:			NoInfo,
	LOAD_CONFIG:	NoInfo,	// Load Configuration Directory
	BOUND_IMPORT:	NoInfo,	// Bound Import Directory in headers
	IAT:			NoInfo,	// Import Address Table
	DELAY_IMPORT:	NoInfo,
	CLR_DESCRIPTOR:	{read: ReadCLR },
} as const satisfies Record<string, DirectoryInfo>;

type DirectoryName	= keyof typeof DIRECTORIES;
type DirectoryReadResult<T extends DirectoryName> = typeof DIRECTORIES[T] extends {read: (pe: PE, data: MappedMemory) => infer R} ? R : MappedMemory | undefined;

export const DATA_DIRECTORY = {
	VirtualAddress: 			uint32,
	Size: 						uint32,
};

type Directory		= bin.ReadType<typeof DATA_DIRECTORY>;

const MAGIC = {
	NT32:		0x10b,
	NT64:		0x20b,
	ROM:		0x107,
	OBJ:		0x104,	// object files, eg as output
//	DEMAND:		0x10b,	// demand load format, eg normal ld output
	TARGET:		0x101,	// target shlib
	HOST:		0x123,	// host   shlib
};

const DLLCHARACTERISTICS = {
	DYNAMIC_BASE:		  	0x0040,	// DLL can be relocated at load time (ASLR)
	FORCE_INTEGRITY:	   	0x0080,	// Code integrity checks are enforced
	NX_COMPAT:			 	0x0100,	// Image is NX compatible (DEP)
	NO_ISOLATION:		  	0x0200,	// Isolation aware, but do not isolate the image
	NO_SEH:					0x0400,	// Does not use structured exception handling
	NO_BIND:			   	0x0800,	// Do not bind the image
	WDM_DRIVER:				0x2000,	// Driver uses WDM model
	TERMINAL_SERVER_AWARE: 	0x8000,	// Terminal Server aware
};

const OPTIONAL_HEADER = {
	Magic:						bin.asEnum(uint16, MAGIC),
	MajorLinkerVersion:			bin.UINT8,
	MinorLinkerVersion:			bin.UINT8,
	SizeOfCode:					uint32,
	SizeOfInitializedData:		uint32,
	SizeOfUninitializedData:	uint32,
	AddressOfEntryPoint:		bin.asHex(uint32),
	BaseOfCode:					bin.asHex(uint32),
};

const OPTIONAL_HEADER32 = {
	BaseOfData: 				bin.asHex(uint32),
	ImageBase:  				bin.asHex(uint32),
	SectionAlignment:   		uint32,
	FileAlignment:  			uint32,
	MajorOperatingSystemVersion:uint16,
	MinorOperatingSystemVersion:uint16,
	MajorImageVersion:  		uint16,
	MinorImageVersion:  		uint16,
	MajorSubsystemVersion:  	uint16,
	MinorSubsystemVersion:  	uint16,
	Win32VersionValue:  		uint32,
	SizeOfImage:				uint32,
	SizeOfHeaders:  			uint32,
	CheckSum:   				uint32,
	Subsystem:  				uint16,
	DllCharacteristics: 		bin.asFlags(uint16, DLLCHARACTERISTICS),
	SizeOfStackReserve: 		uint32,
	SizeOfStackCommit:  		uint32,
	SizeOfHeapReserve:  		uint32,
	SizeOfHeapCommit:   		uint32,
	LoaderFlags:				uint32,
	DataDirectory:  			bin.objectWithNames(bin.ArrayType(uint32, DATA_DIRECTORY), bin.names(Object.keys(DIRECTORIES))),
};

const OPTIONAL_HEADER64 = {
	ImageBase:  				bin.asHex(uint64),
	SectionAlignment:   		uint32,
	FileAlignment:  			uint32,
	MajorOperatingSystemVersion:uint16,
	MinorOperatingSystemVersion:uint16,
	MajorImageVersion:  		uint16,
	MinorImageVersion:  		uint16,
	MajorSubsystemVersion:  	uint16,
	MinorSubsystemVersion:  	uint16,
	Win32VersionValue:  		uint32,
	SizeOfImage:				uint32,
	SizeOfHeaders:  			uint32,
	CheckSum:   				uint32,
	Subsystem:  				uint16,
	DllCharacteristics: 		bin.asFlags(uint16, DLLCHARACTERISTICS),
	SizeOfStackReserve: 		uint64,
	SizeOfStackCommit:  		uint64,
	SizeOfHeapReserve:  		uint64,
	SizeOfHeapCommit:   		uint64,
	LoaderFlags:				uint32,
	DataDirectory:  			bin.objectWithNames(bin.ArrayType(uint32, DATA_DIRECTORY), bin.names(Object.keys(DIRECTORIES))),
};

export class PE {
	static check(data: Uint8Array): boolean {
		return uint16.get(new bin.stream(data)) === bin.utils.stringCode("MZ");
	}

	header:		bin.ReadType<typeof DOS_HEADER> & bin.ReadType<typeof EXE_HEADER>;
	opt?:		bin.ReadType<typeof OPTIONAL_HEADER> & (bin.ReadType<typeof OPTIONAL_HEADER32> | bin.ReadType<typeof OPTIONAL_HEADER64>);
	sections:	Section[];

	constructor(data: Uint8Array) {
		const file	= new bin.stream(data);
		this.header	= bin.read(file, {...DOS_HEADER, ...EXE_HEADER});

		file.seek(this.header.lfanew);
		if (uint32.get(file) == bin.utils.stringCode("PE\0\0")) {
			const h = bin.read(file, FILE_HEADER);

			if (h.SizeOfOptionalHeader) {
				const opt	= new bin.stream(bin.read_buffer(file, h.SizeOfOptionalHeader));
				const opt1	= bin.read(opt, OPTIONAL_HEADER);
				if (opt1.Magic == 'NT32')
					this.opt = bin.read_more(opt, OPTIONAL_HEADER32, opt1);
				else if (opt1.Magic == 'NT64')
					this.opt = bin.read_more(opt, OPTIONAL_HEADER64, opt1);
			}

			this.sections = Array.from({length: h.NumberOfSections}, () => new Section(file));
		} else {
			this.sections = [];
		}
	}

	get directories() {
		return this.opt?.DataDirectory;
	}

	get directories2() {
		const dirs = this.directories;
		if (dirs)
			return Object.fromEntries(Object.keys(dirs).map(dir => [dir, this.ReadDirectory(dir as DirectoryName)]));
	}
	FindSectionRVA(rva: number) {
		for (const i of this.sections) {
			if (rva >= +i.VirtualAddress && rva < +i.VirtualAddress + i.SizeOfRawData)
				return i;
		}
	}

	FindSectionRaw(addr: number) {
		for (const i of this.sections) {
			if (addr >= +i.PointerToRawData && addr < +i.PointerToRawData + i.SizeOfRawData)
				return i;
		}
	}

	GetDataRVA(rva: number, size?: number) {
		const sect = this.FindSectionRVA(rva);
		if (sect && sect.data)
			return sect.data.at(BigInt(rva), size);
	}
	GetDataRaw(addr: number, size: number) {
		const sect = this.FindSectionRaw(addr);
		if (sect && sect.data) {
			const offset = addr - +sect.PointerToRawData;
			return sect.data.data.subarray(offset, offset + size);
		}
	}
	GetDataDir(dir: Directory) {
		if (dir.Size)
			return this.GetDataRVA(dir.VirtualAddress, dir.Size);
	}

	ReadDirectory<T extends DirectoryName>(name: T) : DirectoryReadResult<T> {
		const dir	= this.opt?.DataDirectory[name];
		if (dir?.Size) {
			const data 	= this.GetDataDir(dir);
			const info	= DIRECTORIES[name];
			if (data && 'read' in info && info.read)
				return info.read(this, data) as DirectoryReadResult<T>;
			return data as DirectoryReadResult<T>;
		}
		return undefined as DirectoryReadResult<T>;
	}
}

//-----------------------------------------------------------------------------
//	exports
//-----------------------------------------------------------------------------

const EXPORT_DIRECTORY = {
	ExportFlags:	uint32,	// Reserved, must be 0.
	TimeDateStamp:	TIMEDATE,			// The time and date that the export data was created.
	MajorVersion:	bin.asHex(uint16),	// The major version number. The major and minor version numbers can be set by the user.
	MinorVersion:	bin.asHex(uint16),	// The minor version number.
	DLLName:		RVA_STRING,			// The address of the ASCII string that contains the name of the DLL. This address is relative to the image base.
	OrdinalBase:	uint32,				// The starting ordinal number for exports in this image. This field specifies the starting ordinal number for the export address table. It is usually set to 1.
	NumberEntries:	uint32,				// The number of entries in the export address table.
	NumberNames:	uint32,				// The number of entries in the name pointer table. This is also the number of entries in the ordinal table.
	FunctionTable:	RVA_ARRAY32,		// RVA of functions
	NameTable:		RVA_ARRAY32,		// RVA of names
	OrdinalTable:	RVA_ARRAY16,		// RVA from base of image
};

interface ExportEntry {
	ordinal: number;
	name: string;
	address: number;
}

export function ReadExports(file: pe_stream) {
	const dir 		= bin.read(file, EXPORT_DIRECTORY);
	const addresses	= dir.FunctionTable!;
	const names		= dir.NameTable;
	const ordinals	= dir.OrdinalTable;

	const result: ExportEntry[] = [];
	for (let i = 0; i < dir.NumberEntries; i++) {
		const sect = file.pe.FindSectionRVA(addresses[i]);
		if (sect) {
			const ordinal	= (ordinals && i < dir.NumberNames ? ordinals[i] : i) + dir.OrdinalBase;
			const name		= names && i < dir.NumberNames ? bin.utils.decodeTextTo0(file.pe.GetDataRVA(names[i])?.data, 'utf8') : '';
			result.push({ordinal, name, address: addresses[i]});
		}
	}
	const sorted = result.sort((a, b)=> a.address - b.address);
	return sorted.map((v, i) => {
		let j = i;
		while (++j < sorted.length && sorted[j].address == v.address)
			;
		return [v.ordinal, v.name, file.pe.GetDataRVA(v.address, j < sorted.length ? sorted[j].address - v.address : undefined)];
	});
}

//-----------------------------------------------------------------------------
//	imports
//-----------------------------------------------------------------------------

export class DLLImports extends Array {}

const RVA_ITA64 = {
	get(s: pe_stream)	{ 
		const r = bin.utils.as64(s.get_rva());
		if (r) {
			const end = r.indexOf(0n);
			const result = Array.from(end < 0 ? r : r.subarray(0, end), i =>
				i >> 63n
					? `ordinal_${i - (1n << 63n)}`
					: bin.utils.decodeTextTo0(s.pe.GetDataRVA(Number(i))?.data.subarray(2), 'utf8')
			);
			Object.setPrototypeOf(result, DLLImports.prototype);
			return result;
		}
	},
	put(_s: pe_stream)	{}
};

const IMPORT_DESCRIPTOR = {
	Characteristics:	uint32,	// 0 for terminating null import descriptor
	TimeDateStamp:  	TIMEDATE,			// 0 if not bound, -1 if bound, and real date\time stamp in IMAGE_DIRECTORY_ENTRY_BOUND_IMPORT (new BIND)	// O.W. date/time stamp of DLL bound to (Old BIND)
	ForwarderChain: 	uint32,	// -1 if no forwarders
	DllName:			RVA_STRING,//uint32,
	FirstThunk:			RVA_ITA64,//uint32,	// RVA to IAT (if bound this IAT has actual addresses)
};

export function ReadImports(file: pe_stream) {
	const result: [string, any][] = [];
	for (;;) {
		try {
			const r = bin.read(file, IMPORT_DESCRIPTOR);
			if (!r.Characteristics)
				break;
			result.push([r.DllName, r.FirstThunk]);
		} catch (_e) {
			break;
		}
	}
	return result;
}

//-----------------------------------------------------------------------------
//	resources
//-----------------------------------------------------------------------------

class RESOURCE_DATA_ENTRY extends bin.ReadClass({
	Data:			RVA_BLOB,
	Size:			uint32,
	CodePage:		uint32,
	Reserved:		uint32,
}) {
	get data(): Uint8Array {
		return this.Data!.slice(0, this.Size);
	}
}

const RESOURCE_DIRECTORY = {
	Characteristics:		uint32,
	TimeDateStamp:			uint32,
	MajorVersion:			uint16,
	MinorVersion:			uint16,
	NumberOfNamedEntries:	uint16,
	NumberOfIdEntries:		uint16,
	entries:				bin.ArrayType(s => s.obj.NumberOfNamedEntries + s.obj.NumberOfIdEntries, {
		u0: uint32,
		u1: uint32,
	})
};

const IRT = {
	0:	'NONE',
	1:	'CURSOR',
	2:	'BITMAP',
	3:	'ICON',
	4:	'MENU',
	5:	'DIALOG',
	6:	'STRING',
	7:	'FONTDIR',
	8:	'FONT',
	9:	'ACCELERATOR',
	10:	'RCDATA',
	11:	'MESSAGETABLE',
	12:	'GROUP_CURSOR',
	14:	'GROUP_ICON',
	16:	'VERSION',
	17:	'DLGINCLUDE',
	19:	'PLUGPLAY',
	20:	'VXD',
	21:	'ANICURSOR',
	22:	'ANIICON',
	23:	'HTML',
	24:	'MANIFEST',
	241:'TOOLBAR',
} as const;

export function ReadResourceDirectory(file: pe_stream, type = 0) {
	const dir 		= bin.read(file, RESOURCE_DIRECTORY);
	const id_type	= bin.StringType(uint16, 'utf16le');
	const topbit	= 0x80000000;
	const result : Record<string, any> = {};

	for (const i of dir.entries) {
		const id = i.u0 & topbit ? id_type.get((file.seek(i.u0 & ~topbit), file)) : !type ? IRT[i.u0 as keyof typeof IRT] : i.u0;
		
		file.seek(i.u1 & ~topbit);
		result[id]	= i.u1 & topbit
			? ReadResourceDirectory(file, type || i.u0)
			: new RESOURCE_DATA_ENTRY(file);
	}
	return result;
}
