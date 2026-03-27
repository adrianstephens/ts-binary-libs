import * as bin from '@isopodlabs/binary';
import { MappedMemory, memory } from './common';

class mach_stream extends bin.stream {
	constructor(public base: Uint8Array, data: Uint8Array, be: boolean, public memflags: number, public mem?: memory) { super(data, be); }
	subdata(offset: number, size?: number) {
		return this.base.subarray(offset, size && offset + size);
	}
	substream(offset: number, size?: number) {
		return new mach_stream(this.base, this.subdata(offset, size), this.be!, this.memflags, this.mem);
	}
	getmem(address: bigint, size: number) {
		return this.mem?.get(address, size);
	}
}

const uint16	= bin.UINT16;
const uint32	= bin.UINT32;
const uint64	= bin.UINT64;
const int32		= bin.INT32;
const xint32	= bin.asHex(uint32);
const xint64	= bin.asHex(uint64);

const FILETYPE = {
	OBJECT:			1,	// Relocatable object file
	EXECUTE:		2,	// Executable file
	FVMLIB:			3,	// Fixed VM shared library file
	CORE:			4,	// Core file
	PRELOAD:		5,	// Preloaded executable file
	DYLIB:			6,	// Dynamically bound shared library
	DYLINKER:	 	7,	// Dynamic link editor
	BUNDLE:			8,	// Dynamically bound bundle file
	DYLIB_STUB: 	9,	// Shared library stub for static linking
	DSYM:			10,	// Companion file with only debug sections
	KEXT_BUNDLE:	11,	// x86_64 kexts
	FILESET:		12
} as const;

//	Machine types known by all
enum CPU_TYPE {
	ANY			= -1,
	ARCH_MASK	= 0xff000000,		// mask for architecture bits
	ARCH_64		= 0x01000000,		// 64 bit ABI

	VAX			= 1,
	MC680x0		= 6,
	X86			= 7,
	MIPS		= 8,
	MC98000		= 10,
	HPPA		= 11,
	ARM			= 12,
	MC88000		= 13,
	SPARC		= 14,
	I860		= 15,
	ALPHA		= 16,
	POWERPC		= 18,

	X86_64		= X86 		| ARCH_64,
	POWERPC_64	= POWERPC 	| ARCH_64,
	ARM_64		= ARM 		| ARCH_64,
};

const CPU_SUBTYPES: {[K in CPU_TYPE]?: any} = {
	[CPU_TYPE.VAX]			: {
		VAX_ALL:		0,
		VAX780:			1,
		VAX785:			2,
		VAX750:			3,
		VAX730:			4,
		UVAXI:			5,
		UVAXII:			6,
		VAX8200:		7,
		VAX8500:		8,
		VAX8600:		9,
		VAX8650:		10,
		VAX8800:		11,
		UVAXIII:		12,
	},
	[CPU_TYPE.MC680x0]		: {
		MC680x0_ALL:	1,
		MC68030:		1,	// compat
		MC68040:		2,
		MC68030_ONLY:	3,
	},
	[CPU_TYPE.X86]			: {
		X86_ALL:		3,
		X86_64_ALL:		3,
		X86_ARCH1:		4,
	},
	[CPU_TYPE.MIPS]			: {
		MIPS_ALL:		0,
		MIPS_R2300:		1,
		MIPS_R2600:		2,
		MIPS_R2800:		3,
		MIPS_R2000a:	4,	// pmax
		MIPS_R2000:		5,
		MIPS_R3000a:	6,	// 3max
		MIPS_R3000:		7,
	
	},
	[CPU_TYPE.MC98000]		: {
		MC98000_ALL:	0,
		MC98601:		1,
	
	},
	[CPU_TYPE.HPPA]			: {
		HPPA_ALL:		0,
		HPPA_7100:		0,	// compat
		HPPA_7100LC:	1,
	},
	[CPU_TYPE.ARM]			: {
		ARM_ALL:	 		0,
		ARM_V4T:		5,
		ARM_V6:	 		6,
		ARM_V5TEJ:		7,
		ARM_XSCALE:		8,
		ARM_V7:			9,
		ARM_V7S:			11,
		ARM_V7K:			12,
		ARM_V6M:			14,
		ARM_V7M:			15,
		ARM_V7EM: 		16,
	
	},
	[CPU_TYPE.MC88000]		: {
		MC88000_ALL:	0,
		MC88100:		1,
		MC88110:		2,
	
	},
	[CPU_TYPE.SPARC]		: {
		SPARC_ALL:		0,
	},
	[CPU_TYPE.I860]			: {
		I860_ALL:		0,
		I860_860:		1,
	},
	[CPU_TYPE.ALPHA]		: {

	},
	[CPU_TYPE.POWERPC]		: {
		POWERPC_ALL:	0,
		POWERPC_601:	1,
		POWERPC_602:	2,
		POWERPC_603:	3,
		POWERPC_603e:	4,
		POWERPC_603ev:	5,
		POWERPC_604:	6,
		POWERPC_604e:	7,
		POWERPC_620:	8,
		POWERPC_750:	9,
		POWERPC_7400:	10,
		POWERPC_7450:	11,
		POWERPC_970:	100,
	},
	[CPU_TYPE.X86_64]		: {
		I386_ALL:		0x03,
		I386:			0x03,
		I486:			0x04,
		I486SX:			0x84,
		I586:			0x05,
		PENT:			0x05,
		PENTPRO:		0x16,
		PENTII_M3:		0x36,
		PENTII_M5:		0x56,
		CELERON:		0x67,
		CELERON_MOBILE:	0x77,
		PENTIUM_3:		0x08,
		PENTIUM_3_M:	0x18,
		PENTIUM_3_XEON:	0x28,
		PENTIUM_M:		0x09,
		PENTIUM_4:		0x0a,
		PENTIUM_4_M:	0x1a,
		ITANIUM:		0x0b,
		ITANIUM_2:		0x1b,
		XEON:			0x0c,
		XEON_MP:		0x1c,
	},
	[CPU_TYPE.POWERPC_64]	: {

	},
	[CPU_TYPE.ARM_64]		: {
		FEATURE: 		0x01000000,	// mask for feature flags
		LIB64: 			0x80000000,	// 64 bit libraries
		ARM64_ALL:		0,
		ARM64_V8: 		1,
		ARM64E:	 		2,
	},
};

// Constants for the flags field of the header
const HEADER_FLAGS = {
	NOUNDEFS:				0x1,		// the object file has no undefinedreferences
	INCRLINK:				0x2,		// the object file is the output of an incremental link against a base file and can't be link edited again
	DYLDLINK:				0x4,		// the object file is input for the dynamic linker and can't be staticly link edited again
	BINDATLOAD:				0x8,		// the object file's undefined references are bound by the dynamic linker when loaded.
	PREBOUND:				0x10,		// the file has its dynamic undefined references prebound.
	SPLIT_SEGS:				0x20,		// the file has its read-only and read-write segments split
	LAZY_INIT:				0x40,		// the shared library init routine is to be run lazily via catching memory faults to its writeable segments (obsolete)
	TWOLEVEL:				0x80,		// the image is using two-level name space bindings
	FORCE_FLAT:				0x100,		// the executable is forcing all images to use flat name space bindings
	NOMULTIDEFS:			0x200,		// this umbrella guarantees no multiple defintions of symbols in its sub-images so the two-level namespace hints can always be used.
	NOFIXPREBINDING:		0x400,		// do not have dyld notify the prebinding agent about this executable
	PREBINDABLE:			0x800,		// the binary is not prebound but can have its prebinding redone. only used when MH_PREBOUND is not set.
	ALLMODSBOUND:			0x1000,		// indicates that this binary binds to all two-level namespace modules of its dependent libraries. only used when MH_PREBINDABLE and MH_TWOLEVELare both set.
	SUBSECTIONS_VIA_SYMBOLS:0x2000,		// safe to divide up the sections into sub-sections via symbols for dead code stripping
	CANONICAL:				0x4000,		// the binary has been canonicalized via the unprebind operation
	WEAK_DEFINES:			0x8000,		// the final linked image contains external weak symbols
	BINDS_TO_WEAK:			0x10000,	// the final linked image uses weak symbols
	ALLOW_STACK_EXECUTION:	0x20000,	// When this bit is set, all stacks in the task will be given stack execution privilege.	Only used in MH_EXECUTE filetypes.
	ROOT_SAFE:				0x40000,	// When this bit is set, the binary declares it is safe for use in processes with uid zero
	SETUID_SAFE:			0x80000,	// When this bit is set, the binary declares it is safe for use in processes when issetugid() is true
	NO_REEXPORTED_DYLIBS:	0x100000,	// When this bit is set on a dylib, the static linker does not need to examine dependent dylibs to see if any are re-exported
	PIE:					0x200000,	// When this bit is set, the OS will load the main executable at a random address.Only used in MH_EXECUTE filetypes.
	DEAD_STRIPPABLE_DYLIB:	0x400000,	// Only for use on dylibs.	When linking against a dylib that has this bit set, the static linker will automatically not create a LC_LOAD_DYLIBload command to the dylib if no symbols are being referenced from the dylib.
	HAS_TLV_DESCRIPTORS:	0x800000,	// Contains a section of type S_THREAD_LOCAL_VARIABLES
	NO_HEAP_EXECUTION:		0x1000000,	// When this bit is set, the OS will run the main executable with a non-executable heap even on platforms (e.g. i386) that don't require it.Only used in MH_EXECUTE filetypes.
} as const;

const header = {
	magic:		uint32,			// mach magic number identifier
	cputype:	bin.as(uint32, bin.Enum(CPU_TYPE)),
	cpusubtype:	bin.as(uint32, (x: number): number|string => x),//binary.Enum(CPU_SUBTYPE)),
	filetype:	bin.as(uint32, bin.Enum(FILETYPE)),
	ncmds:		uint32,			// number of load commands
	sizeofcmds:	uint32,			// the size of all the load commands
	flags:		bin.as(uint32, bin.Flags(HEADER_FLAGS, true))
};

const fat_arch = {
	cputype:	 	bin.as(uint32, bin.Enum(CPU_TYPE)),
	cpusubtype:	bin.as(uint32, (x: number): number|string => x),//binary.Enum(CPU_SUBTYPE)),
	offset:		bin.UINT32_BE,		// file offset to this object file
	size:		bin.UINT32_BE,		// size of this object file
	align:		bin.UINT32_BE,		// alignment as a power of 2
	contents:	bin.Const<MachFile|undefined>(undefined),
};

const fat_header = {
	magic:		uint32,		// FAT_MAGIC
	archs:		bin.Array(uint32, fat_arch)
};

const REQ_DYLD = 0x80000000;
export enum CMD {
	SEGMENT						= 0x01,				// segment of this file to be mapped
	SYMTAB						= 0x02,				// link-edit stab symbol table info
	SYMSEG						= 0x03,				// link-edit gdb symbol table info (obsolete)
	THREAD						= 0x04,				// thread
	UNIXTHREAD					= 0x05,				// unix thread (includes a stack)
	LOADFVMLIB					= 0x06,				// load a specified fixed VM shared library
	IDFVMLIB					= 0x07,				// fixed VM shared library identification
//	IDENT						= 0x08,				// object identification info (obsolete)
	FVMFILE						= 0x09,				// fixed VM file inclusion (internal use)
//	PREPAGE						= 0x0a,				// prepage command (internal use)
	DYSYMTAB					= 0x0b,				// dynamic link-edit symbol table info
	LOAD_DYLIB					= 0x0c,				// load a dynamically linked shared library
	ID_DYLIB					= 0x0d,				// dynamically linked shared lib ident
	LOAD_DYLINKER				= 0x0e,				// load a dynamic linker
	ID_DYLINKER					= 0x0f,				// dynamic linker identification
	PREBOUND_DYLIB				= 0x10,				// modules prebound for a dynamically linked shared library
	ROUTINES					= 0x11,				// image routines
	SUB_FRAMEWORK				= 0x12,				// sub framework
	SUB_UMBRELLA				= 0x13,				// sub umbrella
	SUB_CLIENT					= 0x14,				// sub client
	SUB_LIBRARY					= 0x15,				// sub library
	TWOLEVEL_HINTS				= 0x16,				// two-level namespace lookup hints
	PREBIND_CKSUM				= 0x17,				// prebind checksum
	LOAD_WEAK_DYLIB				= REQ_DYLD+0x18,	// load a dynamically linked shared library that is allowed to be missing (all symbols are weak imported).
	SEGMENT_64					= 0x19,				// 64-bit segment of this file to be mapped
	ROUTINES_64					= 0x1a,				// 64-bit image routines
	UUID						= 0x1b,				// the uuid
	RPATH						= REQ_DYLD+0x1c,	// runpath additions
	CODE_SIGNATURE				= 0x1d,				// local of code signature
	SEGMENT_SPLIT_INFO			= 0x1e,				// local of info to split segments
	REEXPORT_DYLIB				= REQ_DYLD+0x1f,	// load and re-export dylib
	LAZY_LOAD_DYLIB				= 0x20,				// delay load of dylib until first use
	ENCRYPTION_INFO				= 0x21,				// encrypted segment information
	DYLD_INFO					= 0x22,				// compressed dyld information
	DYLD_INFO_ONLY				= REQ_DYLD+0x22,	// compressed dyld information only
	LOAD_UPWARD_DYLIB			= REQ_DYLD+0x23,	// load upward dylib
	VERSION_MIN_MACOSX			= 0x24,				// build for MacOSX min OS version
	VERSION_MIN_IPHONEOS		= 0x25,				// build for iPhoneOS min OS version
	FUNCTION_STARTS				= 0x26,				// compressed table of function start addresses
	DYLD_ENVIRONMENT			= 0x27,				// string for dyld to treat like environment variable
	MAIN						= REQ_DYLD+0x28,	// replacement for LC_UNIXTHREAD
	DATA_IN_CODE				= 0x29,				// table of non-instructions in __text
	SOURCE_VERSION				= 0x2A,				// source version used to build binary
	DYLIB_CODE_SIGN_DRS			= 0x2B,				// Code signing DRs copied from linked dylibs
	ENCRYPTION_INFO_64			= 0x2C,				// 64-bit encrypted segment information
	LINKER_OPTION				= 0x2D,				// linker options in MH_OBJECT files
	LINKER_OPTIMIZATION_HINT	= 0x2E,				// optimization hints in MH_OBJECT files
	VERSION_MIN_TVOS			= 0x2F,				// build for AppleTV min OS version
	VERSION_MIN_WATCHOS			= 0x30,				// build for Watch min OS version
	NOTE						= 0x31,				// arbitrary data included within a Mach-O file
	BUILD_VERSION				= 0x32,				// build for platform min OS version
	DYLD_EXPORTS_TRIE			= REQ_DYLD+0x33,	// used with linkedit_data_command, payload is trie
	DYLD_CHAINED_FIXUPS			= REQ_DYLD+0x34,	// used with linkedit_data_command
};

const str = {
	get(s: bin.stream) {
		const off = uint32.get(s);	// offset to the string
		return bin.utils.decodeTextTo0(s.view_at(Uint8Array, off - 8), 'utf8');
	}
};

const index_table = {
	first:	uint32,
	count:	uint32,
};

const blob = {
	get(s: mach_stream): Uint8Array|undefined {
		const offset	= uint32.get(s);
		const size		= uint32.get(s);
		if (size)
			return s.view_at(Uint8Array, offset, size);
	}
};

function blobT<T extends bin.TypeReader>(type: T) {
	return {
		get(s: mach_stream) {
			const offset	= uint32.get(s);
			const size		= uint32.get(s);
			return {
				data: s.subdata(offset, size),
				contents: bin.read(s.substream(offset, size), type)
			};
		}
	};
}

function blobArray<T extends bin.Type>(type: T) {
	return blobT(bin.RemainingArray(type));
}


function count_table<T extends bin.TypeReader>(type: T) {
	return {
		get(s: mach_stream) {
			const offset	= uint32.get(s);
			const count		= uint32.get(s);
			if (count)
				return bin.readn(s.substream(offset), type, count);
		}
	};
}

const fixed_string16	= bin.String(16);
const version			= bin.asFlags(uint32, {major: 0xffff0000, minor: 0xff00, patch: 0xff}, false);

const command = {
	cmd:		bin.as(uint32, v => v as CMD),
	cmdsize:	uint32,
};

const SECTION_FLAGS = bin.BitFields(32, {
	TYPE: bin.BitField(8, bin.Enum({
		REGULAR:							0x0,	// regular section
		ZEROFILL:							0x1,	// zero fill on demand section
		CSTRING_LITERALS:					0x2,	// section with only literal C strings
		LITERALS4:							0x3,	// section with only 4 byte literals
		LITERALS8:							0x4,	// section with only 8 byte literals
		LITERAL_POINTERS:					0x5,	// section with only pointers to literals
		NON_LAZY_SYMBOL_POINTERS:			0x6,	// section with only non-lazy symbol pointers
		LAZY_SYMBOL_POINTERS:				0x7,	// section with only lazy symbol pointers
		SYMBOL_STUBS:						0x8,	// section with only symbol stubs, byte size of stub in	the reserved2 field
		MOD_INIT_FUNC_POINTERS:				0x9,	// section with only function pointers for initialization
		MOD_TERM_FUNC_POINTERS:				0xa,	// section with only function pointers for termination
		COALESCED:							0xb,	// section contains symbols that are to be coalesced
		GB_ZEROFILL:						0xc,	// zero fill on demand section (that can be larger than 4 gigabytes)
		INTERPOSING:						0xd,	// section with only pairs of function pointers for interposing
		LITERALS16:							0xe,	// section with only 16 byte literals
		DTRACE_DOF:							0xf,	// section contains DTrace Object Format
		LAZY_DYLIB_SYMBOL_POINTERS:			0x10,	// section with only lazy symbol pointers to lazy loaded dylibs
		// Section types to support thread local variables
		THREAD_LOCAL_REGULAR:				0x11,	// template of initial values for TLVs
		THREAD_LOCAL_ZEROFILL:				0x12,	// template of initial values for TLVs
		THREAD_LOCAL_VARIABLES:				0x13,	// TLV descriptors
		THREAD_LOCAL_VARIABLE_POINTERS:		0x14,	// pointers to TLV descriptors
		THREAD_LOCAL_INIT_FUNCTION_POINTERS:0x15,	// functions to call to initialize TLV values
	})),
	ATTRIBUTES: bin.BitFields(24, {
		SYS: bin.BitField(16, bin.Flags({
			SOME_INSTRUCTIONS: 		0x0004,	// section contains some machine instructions
			EXT_RELOC: 				0x0002,	// section has external relocation entries
			LOC_RELOC: 				0x0001,	// section has local relocation entries
		}, true)),
		USR: bin.BitField(8, bin.Flags({
			PURE_INSTRUCTIONS:		0x80,	// section contains only true machine instructions
			NO_TOC:					0x40,	// section contains coalesced symbols that are not to be in a ranlib table of contents
			STRIP_STATIC_SYMS:		0x20,	// ok to strip static symbols in this section in files with the MH_DYLDLINK flag
			NO_DEAD_STRIP:			0x10,	// no dead stripping
			LIVE_SUPPORT:			0x08,	// blocks are live if they reference live blocks
			SELF_MODIFYING_CODE:	0x04,	// Used with i386 code stubs written on by dyld
			DEBUG:					0x02,	// a debug section
		}, true)),
	}),
});

function section(bits: 32|64) {
	const type		= bin.asHex(bin.UINT(bits));

	class Section extends bin.Class({
		sectname: 	fixed_string16,
		segname: 	fixed_string16,
		addr:		type,		// memory address of this section
		size:		type,		// size in bytes of this section
		offset:		xint32,		// file offset of this section
		align:		uint32,		// section alignment (power of 2)
		reloff:		xint32,		// file offset of relocation entries
		nreloc:		uint32,		// number of relocation entries
		flags:		bin.as(uint32, SECTION_FLAGS),	// flags (section type and attributes)
		reserved1:	uint32,		// reserved (for offset or index)
		reserved2:	uint32,		// reserved (for count or sizeof)
		_:			bin.Aligned(bits / 8, bin.Const(undefined)),
	}) {
		data:	Promise<MappedMemory>;
		constructor(s: mach_stream) {
			super(s);
			const prot	= this.flags.ATTRIBUTES.SYS.SOME_INSTRUCTIONS ? MappedMemory.EXECUTE | s.memflags : s.memflags;
			this.data 	= (async () =>
				//new binary.utils.MappedMemory(await s.file.get(BigInt(this.addr), Number(this.size)), Number(this.addr), prot)
				new MappedMemory(s.subdata(+this.offset, Number(this.size)), BigInt(this.addr.value), prot)
			)();
		}
	}
	return Section;
}

const SEGMENT_FLAGS = {
	HIGHVM:					0x1,	// the file contents for this segment is for the high part of the VM space, the low part is zero filled (for stacks in core files)
	FVMLIB:					0x2,	// this segment is the VM that is allocated by a fixed VM library, for overlap checking in the link editor
	NORELOC:				0x4,	// this segment has nothing that was relocated in it and nothing relocated to it, that is it maybe safely replaced without relocation
	PROTECTED_VERSION_1:	0x8,	// This segment is protected.	If the segment starts at file offset 0, the first page of the segment is not protected.	All other pages of the segment are protected.
};

function segment<T extends 32|64>(bits: T) {
	const type		= bin.asHex(bin.UINT(bits));
	const fields	= {
		data:		bin.Const<MappedMemory|undefined>(undefined),
		segname: 	fixed_string16,	// segment name
		vmaddr:		type,		// memory address of this segment
		vmsize:		type,		// memory size of this segment
		fileoff:	type,		// file offset of this segment
		filesize:	type,		// amount to map from the file
		maxprot:	uint32,		// maximum VM protection
		initprot:	uint32,		// initial VM protection
		nsects:		uint32,		// number of sections in segment
		flags:		bin.as(uint32, bin.Flags(SEGMENT_FLAGS,true)),			// flags
		sections:	bin.Const<Record<string, any>>({}),//binary.ReadType<typeof section(bits)>)),
	};
	return {
		get(s: mach_stream) {
			const o = bin.read(s, fields);

			async function load() {
				const data = await s.getmem(BigInt(Number(o.vmaddr)), Number(o.filesize)) ?? s.subdata(Number(o.fileoff), Number(o.filesize));
				o.data = new MappedMemory(data, BigInt(o.vmaddr.value), o.initprot | s.memflags);

				//const sect = section(bits);
				if (o.nsects) {
					o.sections = bin.objectWithNames(bin.Array(o.nsects, section(bits)), bin.field('sectname')).get(s);
					//o.sections = Object.fromEntries(Array.from({length: o.nsects}, (_,i)=>new sect(s)).map(s => [s.sectname, s]));
				}
			}
		
			load();
			return o;
		}
	};
}

/*
function segment(bits: 32|64) {
	const type		= binary.UINT(bits);
	return class extends binary.ReadWriteStruct({
		segname: 	fixed_string16,	// segment name
		vmaddr:		type,		// memory address of this segment
		vmsize:		type,		// memory size of this segment
		fileoff:	type,		// file offset of this segment
		filesize:	type,		// amount to map from the file
		maxprot:	uint32,		// maximum VM protection
		initprot:	uint32,		// initial VM protection
		nsects:		uint32,		// number of sections in segment
		flags:		binary.as(uint32, binary.Flags(SEGMENT_FLAGS,true)),			// flags
	}) {
		data?:		binary.MappedMemory;
		sections:	Record<string, any>	= {};

		constructor(s: mach_stream) {
			super(s);
			this.load(s);
		}
		async load(s: mach_stream) {
			const data = await s.getmem(BigInt(this.vmaddr), Number(this.filesize)) ?? s.subdata(Number(this.fileoff), Number(this.filesize));
			this.data = new binary.MappedMemory(data, Number(this.vmaddr), this.initprot);

			//const sect = section(bits);
			if (this.nsects) {
				this.sections = binary.objectWithNames(binary.Array(this.nsects, section(bits)), binary.field('sectname')).get(s);
				//o.sections = Object.fromEntries(Array.from({length: o.nsects}, (_,i)=>new sect(s)).map(s => [s.sectname, s]));
			}

		}
	};
}
*/

const fvmlib = {
	name:			str,	// library's target pathname
	minor_version:	xint32,	// library's minor version number
	header_addr:	xint32,	// library's header address
};

const	dylib = {
	name:					str,
	timestamp:				uint32,
	current_version:		version,
	compatibility_version:	version,
};

const thread_command = {
	flavor:			uint32,	// flavor of thread state
	count:			uint32, // count of longs in thread state
	// struct XXX_thread_state state	thread state for this flavor
	// ...
};


// SYMTAB
const nlist_flags = bin.BitFields(8, {
	ext: 1,
	type: bin.BitField(3, bin.Enum({
		UNDF:	0,		// undefined, n_sect == NO_SECT
		ABS:	1,		// absolute, n_sect == NO_SECT
		INDR:	5,		// indirect
		PBUD:	6,		// prebound undefined (defined in a dylib)
		SECT:	7,		// defined in section number n_sect
	})),
	pext: 1,
	stab: bin.BitField(3, bin.Enum({

	})),
});
/*
//masks
	//STAB	= 0xe0,		// if any of these bits set, a symbolic debugging entry
	PEXT	= 0x10,		// private external symbol bit
	//TYPE	= 0x0e,		// mask for the type bits
	EXT		= 0x01,		// external symbol bit, set for external symbols
	
	UNDF	= 0x00,		// undefined, n_sect == NO_SECT
	ABS		= 0x02,		// absolute, n_sect == NO_SECT
	INDR	= 0x0a,		// indirect
	PBUD	= 0x0c,		// prebound undefined (defined in a dylib)
	SECT	= 0x0e,		// defined in section number n_sect
// STAB values
	GSYM	= 0x20,		// global symbol: name,,NO_SECT,type,0
	FNAME	= 0x22,		// procedure name (f77 kludge): name,,NO_SECT,0,0
	FUN		= 0x24,		// procedure: name,,n_sect,linenumber,address
	STSYM	= 0x26,		// static symbol: name,,n_sect,type,address
	LCSYM	= 0x28,		// .lcomm symbol: name,,n_sect,type,address
	BNSYM	= 0x2e,		// begin nsect sym: 0,,n_sect,0,address
	OPT		= 0x3c,		// emitted with gcc2_compiled and in gcc source
	RSYM	= 0x40,		// register sym: name,,NO_SECT,type,register
	SLINE	= 0x44,		// src line: 0,,n_sect,linenumber,address
	ENSYM	= 0x4e,		// end nsect sym: 0,,n_sect,0,address
	SSYM	= 0x60,		// structure elt: name,,NO_SECT,type,struct_offset
	SO		= 0x64,		// source file name: name,,n_sect,0,address
	OSO		= 0x66,		// object file name: name,,0,0,st_mtime
	LSYM	= 0x80,		// local sym: name,,NO_SECT,type,offset
	BINCL	= 0x82,		// include file beginning: name,,NO_SECT,0,sum
	SOL		= 0x84,		// #included file name: name,,n_sect,0,address
	PARAMS	= 0x86,		// compiler parameters: name,,NO_SECT,0,0
	VERSION	= 0x88,		// compiler version: name,,NO_SECT,0,0
	OLEVEL	= 0x8A,		// compiler -O level: name,,NO_SECT,0,0
	PSYM	= 0xa0,		// parameter: name,,NO_SECT,type,offset
	EINCL	= 0xa2,		// include file end: name,,NO_SECT,0,0
	ENTRY	= 0xa4,		// alternate entry: name,,n_sect,linenumber,address
	LBRAC	= 0xc0,		// left bracket: 0,,NO_SECT,nesting level,address
	EXCL	= 0xc2,		// deleted include file: name,,NO_SECT,0,sum
	RBRAC	= 0xe0,		// right bracket: 0,,NO_SECT,nesting level,address
	BCOMM	= 0xe2,		// begin common: name,,NO_SECT,0,0
	ECOMM	= 0xe4,		// end common: name,,n_sect,0,0
	ECOML	= 0xe8,		// end common (local name): 0,,n_sect,0,address
	LENG	= 0xfe,		// second stab entry with length information
}
*/
const nlist_desc = bin.BitFields(16, {
	ref: bin.BitField(3, bin.Enum({
		UNDEFINED_NON_LAZY:			0,
		UNDEFINED_LAZY:				1,
		DEFINED:					2,
		PRIVATE_DEFINED:			3,
		PRIVATE_UNDEFINED_NON_LAZY:	4,
		PRIVATE_UNDEFINED_LAZY:		5,
	})),
	flags: bin.BitField(5, bin.Flags({
		ARM_THUMB_DEF:					1 << 0,	// symbol is a Thumb function (ARM)
		REF_DYNAMIC:					1 << 1,
		NO_DEAD_STRIP:					1 << 2,	// symbol is not to be dead stripped
		//DESC_DISCARDE:				1 << 2,	// symbol is discarded
		WEAK_REF:						1 << 3,	// symbol is weak referenced
		WEAK_DEF:						1 << 4,	// coalesed symbol is a weak definition
		//REF_TO_WEA					1 << 4,	// reference to a weak symbol
		//SYMBOL_RESOLVER:				0x0100,
	}, true)),
	align: 8
	//MAX_LIBRARY_ORDINAL				= 0xfd	<< 8,
	//DYNAMIC_LOOKUP_ORDINAL			= 0xfe	<< 8,
	//EXECUTABLE_ORDINAL				= 0xff	<< 8,
});

function nlist(bits:32|64) { return {
	strx:	uint32,	// index into the string table
	flags:	bin.as(bin.UINT8, nlist_flags),
	sect:	bin.UINT8,// section number or NO_SECT
	desc:	bin.as(uint16, nlist_desc),
	value:	bin.UINT(bits),
	
	//const char *name(const char *s) const { return s ? s + strx : ""; }
	//FLAGS		type()	const	{ return FLAGS(flags & TYPE); }
	//FLAGS		stab()	const	{ return FLAGS(flags & STAB); }
}; }

const symtab = {
	get(s: bin._stream) {
		const sym = bin.read(s, count_table(nlist(64)));
		const str = bin.read(s, blob) as Uint8Array;
		return sym?.map(v => [bin.utils.decodeTextTo0(str.subarray(v.strx), 'utf8'), v]);
	}
};

// DYSYMTAB

const INDIRECT = {
	INDIRECT_SYMBOL_LOCAL:	0x80000000,	// non-lazy symbol pointer section for a defined symbol which strip(1) has removed
	INDIRECT_SYMBOL_ABS:	0x40000000,
} as const;

const toc_entry = {
	symbol_index:	uint32,			// the defined external symbol (index into the symbol table)
	module_index:	uint32,			// index into the module table this symbol is defined in
};

function module(bits:32|64) {
	const fields = {
		module_name:	uint32,			// the module name (index into string table)
		extdefsym:		index_table,			// index into externally defined symbols
		refsym:			index_table,			// index into reference symbol table
		localsym:		index_table,			// index into symbols for local symbols
		extrel:			index_table,			// index into external relocation entries
		init_iterm:		index_table,			// low 16 bits are the index into the init section, high 16 bits are the index into the term section
	};
	return bits == 32 ? {...fields,
		objc_module_info_addr:	uint32,	// for this module address of the start of the (__OBJC,__module_info) section
		objc_module_info_size:	uint32,	// for this module size of the (__OBJC,__module_info) section
	} : {...fields,
		objc_module_info_size:	uint32,	// for this module size of the (__OBJC, __module_info) section
		objc_module_info_addr:	uint64,	// for this module address of the start of the (__OBJC, __module_info) section
	};
}

const symbol_ref = bin.as(uint32, bin.BitFields(32, {
	symbol_index: 24,	// index into the symbol table
	flags: 8
}));

const hint = bin.as(uint32, bin.BitFields(32, {
	sub_image: 8,	// index into the sub images
	toc: 24			// index into the table of contents
}));

const version_min = {
	version,
	reserved:	uint32,	// zero
};

const REBASE = bin.BitFields(8, {
	immediate: 4,
	opcode:		bin.BitField(4, bin.Enum({
		DONE:								0,
		SET_TYPE_IMM:						1,
		SET_SEGMENT_AND_OFFSET_ULEB:		2,
		ADD_ADDR_ULEB:						3,
		ADD_ADDR_IMM_SCALED:				4,
		DO_REBASE_IMM_TIMES:				5,
		DO_REBASE_ULEB_TIMES:				6,
		DO_REBASE_ADD_ADDR_ULEB:			7,
		DO_REBASE_ULEB_TIMES_SKIPPING_ULEB: 8,
	}))
	//TYPE_POINTER							= 1,
	//TYPE_TEXT_ABSOLUTE32					= 2,
	//TYPE_TEXT_PCREL32						= 3,
});

const BIND = bin.BitFields(8, {
	immediate: 4,
	opcode:		bin.BitField(4, bin.Enum({
		DONE:								0,
		SET_DYLIB_ORDINAL_IMM:				1,
		SET_DYLIB_ORDINAL_ULEB:				2,
		SET_DYLIB_SPECIAL_IMM:				3,
		SET_SYMBOL_TRAILING_FLAGS_IMM:		4,
		SET_TYPE_IMM:						5,
		SET_ADDEND_SLEB:					6,
		SET_SEGMENT_AND_OFFSET_ULEB:		7,
		ADD_ADDR_ULEB:						8,
		DO_BIND:							9,
		DO_BIND_ADD_ADDR_ULEB:				10,
		DO_BIND_ADD_ADDR_IMM_SCALED:		11,
		DO_BIND_ULEB_TIMES_SKIPPING_ULEB:	 12,
	}))
	//TYPE_POINTER							= 1,
	//TYPE_TEXT_ABSOLUTE32					= 2,
	//TYPE_TEXT_PCREL32						= 3,
	//SPECIAL_DYLIB_SELF					= 0,
	//SPECIAL_DYLIB_MAIN_EXECUTABLE			= -1,
	//SPECIAL_DYLIB_FLAT_LOOKUP				= -2,
	//SYMBOL_FLAGS_WEAK_IMPORT				= 0x1,
	//SYMBOL_FLAGS_NON_WEAK_DEFINITION		= 0x8,
});

const dyld_kind = {
	KIND_MASK:			0x03,
	KIND_REGULAR:		0x00,
	KIND_THREAD_LOCAL:	0x01,
	KIND_ABSOLUTE:		0x02,
	WEAK_DEFINITION:	0x04,
	REEXPORT:			0x08,
	STUB_AND_RESOLVER:	0x10,
} as const;

const dyldinfo = {
	rebase:		blob,
	bind:		blob,
	weak_bind:	blob,
	lazy_bind:	blob,
	exprt:		blob,
};

//BUILD_VERSION
const TOOL = {
	CLANG:	1,
	SWIFT:	2,
	LD:		3,
	LLD:	4,
} as const;

const PLATFORM = {
	MACOS:				1,
	IOS:				2,
	TVOS:				3,
	WATCHOS:			4,
	BRIDGEOS:			5,
	MACCATALYST:		6,
	IOSSIMULATOR:		7,
	TVOSSIMULATOR:		8,
	WATCHOSSIMULATOR:	9,
	DRIVERKIT:			10,
} as const;

//DYLD_CHAINED_FIXUPS

const dyld_chained_starts_in_segment = {
	size:				uint32,			///< Size of this, including chain_starts entries
	page_size:			uint16,		///< Page size in bytes (0x1000 or 0x4000)
	pointer_format:	 	bin.asEnum(uint16, {
		ARM64E:					1,
		'64':					2,
		'32':					3,
		'32_CACHE':				4,
		'32_FIRMWARE':			5,
		'64_OFFSET':			6,
		ARM64E_KERNEL:			7,
		'64_KERNEL_CACHE':		8,
		ARM64E_USERLAND:		9,
		ARM64E_FIRMWARE:		10,
		X86_64_KERNEL_CACHE:	11,
		ARM64E_USERLAND24:		12,
	}),
	segment_offset:	 	xint64,	// VM offset from the __TEXT segment
	max_valid_pointer:	xint32,	// Values beyond this are not pointers on 32-bit
	pages:				bin.Array(uint16, bin.asEnum(uint16, {
		NONE:		0xFFFF,
		MULTI: 	0x8000,	// page which has multiple starts
		LAST:		0x8000,	// last chain_start for a given page
	}))
};

const dyld_chained_starts_in_image	= bin.Array(uint32, bin.Offset(uint32, dyld_chained_starts_in_segment));

const dyld_chained_import = bin.as(uint32, bin.BitFields(32,{
	lib_ordinal : 8,
	weak_import : 1,
	name_offset : 23,
}));

const dyld_chained_import_addend = {
	import: dyld_chained_import,
	addend: int32,
};

const dyld_chained_import_addend64 = {
	import: bin.as(uint64, bin.BitFields(64, {
		lib_ordinal : 16,
		weak_import : 1,
		reserved	: 15,
		name_offset : 32,
	})),
	addend:	uint64,
};
/*
class dyld_chained_fixups extends bin.ReadClass({
	fixups_version:	uint32,	// currently 0
	starts:			bin.Offset(uint32, dyld_chained_starts_in_image),
	imports:		bin.Offset(uint32, bin.Remainder),	// offset of imports table in chain_data
	symbols:		bin.Offset(uint32, bin.Remainder),	// offset of symbol strings in chain_data
	imports_count:	uint32,	// number of imported symbol names
	imports_format:	bin.asEnum(uint32, {
		IMPORT:				1,
		IMPORT_ADDEND:	 	2,
		IMPORT_ADDEND64: 	3
	}),
	symbols_format:	bin.asEnum(uint32, {
		UNCOMPRESSED:		0,
		ZLIB:				1,
	}),
}) {
	imports2;
	constructor(s: bin.stream) {
		super(s);
		const imports = new bin.stream(this.imports, s.be);
		switch (this.imports_format) {
			case 'IMPORT': {
				this.imports2 = bin.withNames(bin.readn(imports, dyld_chained_import, this.imports_count), imp => bin.utils.decodeTextTo0(this.symbols.subarray(Number(imp.name_offset))));
				break;
			}
			case 'IMPORT_ADDEND':
				this.imports2 = bin.withNames(bin.readn(imports, dyld_chained_import_addend, this.imports_count), imp => bin.utils.decodeTextTo0(this.symbols.subarray(Number(imp.import.name_offset))));
				break;
			case 'IMPORT_ADDEND64':
				this.imports2 = bin.withNames(bin.readn(imports, dyld_chained_import_addend64, this.imports_count), imp => bin.utils.decodeTextTo0(this.symbols.subarray(Number(imp.import.name_offset))));
				break;
		}
	}
}
*/
const dyld_chained_ptr_64_bind = bin.as(uint64, bin.BitFields(64, {
	ordinal		: 24,
	addend	 	: 8,
	reserved 	: 19,
	next		: 12,
	bind		: 1, // set to 1
}));

const dyld_chained_ptr_64_rebase = bin.as(uint64, bin.BitFields(64, {
	target	 	: 36,
	high8		: 8,
	reserved 	: 7,
	next		: 12,
	bind		: 1, // set to 0
}));

//DATA_IN_CODE

const data_in_code_entry = {
	offset:	xint32,		// from header to start of data range
	length:	uint16,		// number of bytes in data range
	kind:	bin.as(uint16, bin.Enum({
		DATA:				0x0001,
		JUMP_TABLE8:		0x0002,
		JUMP_TABLE16:		0x0003,
		JUMP_TABLE32:		0x0004,
		ABS_JUMP_TABLE32: 	0x0005,
	})),
};

// Sections of type S_THREAD_LOCAL_VARIABLES contain an array of tlv_descriptor structures.
/*
const tlv_descriptor = {
	void*			(*thunk)(tlv_descriptor*);
	unsigned long	key;
	unsigned long	offset;
};
*/

function routines(bits:32|64) {
	const type		= bin.UINT(bits);
	return {
		init_address:	type,	// address of initialization routine
		init_module:	type,	// index into the module table that the init routine is defined in
		reserved1:		type,
		reserved2:		type,
		reserved3:		type,
		reserved4:		type,
		reserved5:		type,
		reserved6:		type,
	};
}



//const cmd_table : {[K in CMD]?: binary.TypeReader2} = {
const cmd_table = {//: Record<CMD, binary.TypeReader2> = {
	[CMD.SEGMENT]:					segment(32),
	[CMD.SEGMENT_64]:				segment(64),
	[CMD.LOADFVMLIB]:				fvmlib,
	[CMD.IDFVMLIB]:					fvmlib,

	[CMD.LOAD_DYLIB]:				dylib,
	[CMD.ID_DYLIB]:					dylib,
	[CMD.LOAD_WEAK_DYLIB]:			dylib,
	[CMD.REEXPORT_DYLIB]:			dylib,
	[CMD.LAZY_LOAD_DYLIB]:			dylib,
	[CMD.LOAD_UPWARD_DYLIB]:		dylib,

	[CMD.SUB_FRAMEWORK]:			str,
	[CMD.SUB_UMBRELLA]:				str,
	[CMD.SUB_CLIENT]:				str,
	[CMD.SUB_LIBRARY]:				str,
	[CMD.LOAD_DYLINKER]:			str,
	[CMD.ID_DYLINKER]:				str,
	[CMD.DYLD_ENVIRONMENT]:			str,
	[CMD.RPATH]:					str,

	[CMD.PREBOUND_DYLIB]:			{
		name:			str,
		nmodules:		uint32,
		linked_modules:	str,
	},

	[CMD.THREAD]:					thread_command,
	[CMD.UNIXTHREAD]:				thread_command,

	[CMD.ROUTINES]:					routines(32),
	[CMD.ROUTINES_64]:				routines(64),
	
	[CMD.SYMTAB]:					symtab,

	[CMD.TWOLEVEL_HINTS]:			count_table(hint),

	[CMD.PREBIND_CKSUM]:			{
		cksum:	uint32,
	},

	[CMD.UUID]:						{
		uuid:		bin.Buffer(16),
	},

	[CMD.CODE_SIGNATURE]:			blob,
	[CMD.SEGMENT_SPLIT_INFO]:		blob,
	[CMD.FUNCTION_STARTS]:			blobArray(bin.ULEB128),
	[CMD.DATA_IN_CODE]:				blobArray(data_in_code_entry),
	[CMD.DYLIB_CODE_SIGN_DRS]:		blob,
	[CMD.LINKER_OPTIMIZATION_HINT]:	blob,
	[CMD.DYLD_EXPORTS_TRIE]:		blob,
	[CMD.DYLD_CHAINED_FIXUPS]:		blob,//blobT(dyld_chained_fixups),

	[CMD.ENCRYPTION_INFO]:			{
		cryptoff:	uint32,	// file offset of encrypted range
		cryptsize:	uint32,	// file size of encrypted range
		cryptid:	uint32,	// which enryption system, 0 means not-encrypted yet
	},
	[CMD.ENCRYPTION_INFO_64]:		{
		cryptoff:	uint32,	// file offset of encrypted range
		cryptsize:	uint32,	// file size of encrypted range
		cryptid:	uint32,	// which enryption system, 0 means not-encrypted yet
		pad:		uint32,	// must be zero
	},

	[CMD.VERSION_MIN_MACOSX]:		version_min,
	[CMD.VERSION_MIN_IPHONEOS]:		version_min,
	[CMD.VERSION_MIN_TVOS]:			version_min,
	[CMD.VERSION_MIN_WATCHOS]:		version_min,

	[CMD.DYLD_INFO]:				dyldinfo,
	[CMD.DYLD_INFO_ONLY]:			dyldinfo,

	[CMD.SYMSEG]:					blob,//OBSOLETE

//	[CMD.IDENT]:					{},//OBSOLETE

	[CMD.FVMFILE]:					{//OBSOLETE
		name:			str,
		header_addr:	uint32,
	},

	[CMD.MAIN]:						{
		entryoff:		uint32,	// file (__TEXT) offset of entry point
		stacksize:		uint32,	// if not zero, initialize stack size
	},

	[CMD.SOURCE_VERSION]:			{
		version:		bin.as(bin.UINT64_BE, bin.BitFields(64, {a:24, b:10, c:10, d:10, e:10}))	// A.B.C.D.E packed as a24.b10.c10.d10.e10
	},
	[CMD.BUILD_VERSION]:			{
		platform:		bin.asEnum(uint32, PLATFORM),
		minos:			version,
		sdk:			version,
		tools:			bin.objectWithNames(bin.Array(uint32, {tool: bin.as(uint32, bin.Enum(TOOL)), version}), bin.field('tool')),
	},
	[CMD.LINKER_OPTION]:			{
		count:			uint32,	// number of strings following
	},
	[CMD.NOTE]:						{
		data_owner:		fixed_string16,	// owner name for this LC_NOTE
		data:			blob
	},
//	[CMD.PREPAGE]:					{},
	[CMD.DYSYMTAB]:					{
		localsym:		index_table,	// local symbols
		extdefsym:		index_table,	// externally defined symbols
		undefsym:		index_table,	// undefined symbols
		toc:			count_table(toc_entry),	// table of contents
		modtab:			count_table(module(64)),	// module table
		extrefsym:		count_table(symbol_ref),	// referenced symbol table
		indirectsym:	count_table(symbol_ref),	// indirect symbol table
		extrel:			count_table({address:uint32, symbol_ref}),	// external relocation entries
		locrel:			count_table({address:uint32, symbol_ref}),	// local relocation entries
	},
};

export class MachFile {
	static check(data: Uint8Array): boolean {
		switch (bin.UINT32_BE.get(new bin.stream(data))) {
			case 0xfeedface:
			case 0xcefaedfe:
			case 0xfeedfacf:
			case 0xcffaedfe:
				return true;
			default:
				return false;
		}
	}

	header!: bin.ReadType<typeof header>;
	commands:{cmd:CMD, data:any}[]	= [];

	constructor(data: Uint8Array, mem?: memory) {
		const magic	= bin.UINT32_LE.get(new bin.stream(data));
		switch (magic) {
			case 0xfeedface:	this.load(data, false, 32, mem); break;
			case 0xcefaedfe:	this.load(data, true,  32, mem); break;
			case 0xfeedfacf:	this.load(data, false, 64, mem); break;
			case 0xcffaedfe:	this.load(data, true,  64, mem); break;
			default:			throw new Error('not a mach file');
		}
	}

	load(data: Uint8Array, be: boolean, bits: 32|64, mem?: memory) {
		const file	= new bin.stream(data, be);
		const h 	= bin.read(file, header);
		const cpu	= CPU_TYPE[h.cputype as keyof typeof CPU_TYPE];
		h.cpusubtype = bin.Enum(CPU_SUBTYPES[cpu]).to(+h.cpusubtype);
		if (bits === 64)
			file.seek(file.tell() + 4);

		for (let i = 0; i < h.ncmds; ++i) {
			const cmd	= bin.read(file, command);
			const file2	= new mach_stream(data, file.view(Uint8Array, cmd.cmdsize - 8), file.be!, h.filetype === 'EXECUTE' ? 0: MappedMemory.RELATIVE, mem);
			const result = bin.read(file2, cmd_table[cmd.cmd] ?? {});
			this.commands.push({cmd: cmd.cmd, data: result});
		}
		this.header = h;

		const funcs = this.getCommand(CMD.FUNCTION_STARTS);
		if (funcs) {
			const array = funcs.contents;
			const text	= this.getSegment('__TEXT');
			let acc	= BigInt(text?.vmaddr.value ?? 0);
			for (const i in array)
				array[i] = (acc += BigInt(array[i]));
		}
	}
	
	getCommand<T extends CMD>(cmd: T) : bin.ReadType<typeof cmd_table[T]>;
	getCommand(cmd: CMD) {
		for (const i of this.commands) {
			if (i.cmd === cmd)
				return i.data;
		}
	}

	getSegment(name: string) {
		for (const i of this.commands) {
			if (i.cmd === CMD.SEGMENT && i.data.segname === name)
				return i.data as bin.ReadType<typeof cmd_table[CMD.SEGMENT]>;
			if (i.cmd === CMD.SEGMENT_64 && i.data.segname === name)
				return i.data as bin.ReadType<typeof cmd_table[CMD.SEGMENT_64]>;;
		}
	}
}

const FAT_MAGIC		= 0xcafebabe;
const FAT_CIGAM		= 0xbebafeca;

export class FATMachFile {
	archs:	bin.ReadType<typeof fat_arch>[] = [];

	static check(data: Uint8Array): boolean {
		switch (bin.UINT32_BE.get(new bin.stream(data))) {
			case FAT_MAGIC:
			case FAT_CIGAM:
				return true;
			default:
				return false;
		}
	}
	
	constructor(data: Uint8Array, mem?: memory) {
		switch (bin.UINT32_BE.get(new bin.stream(data))) {
			case FAT_MAGIC:		this.load(new bin.stream(data, true), mem); break;
			case FAT_CIGAM:		this.load(new bin.stream(data, false), mem); break;
			default:
				throw new Error('not a fat mach file');
		}
	}

	load(file: bin.stream, mem?: memory) {
		const header = bin.read(file, fat_header);
		this.archs = header.archs;
		for (const arch of header.archs) {
			const cpu	= CPU_TYPE[arch.cputype as keyof typeof CPU_TYPE];
			const data	= file.view_at(Uint8Array, arch.offset, arch. size);
			arch.cpusubtype = bin.Enum(CPU_SUBTYPES[cpu]).to(+arch.cpusubtype);
			arch.contents	= new MachFile(data, mem);
		}
	}
}
/*
export function freestanding<T extends CMD>(s: binary.stream, cmd: T) : binary.ReadType<typeof cmd_table[T]>;
export function freestanding(s: binary.stream, cmd: CMD) {
	return binary.read(s, cmd_table[cmd]);
}
*/