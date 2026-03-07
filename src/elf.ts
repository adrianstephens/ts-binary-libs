import * as bin from '@isopodlabs/binary';
import { MappedMemory } from './common';

//--------------------	FILE HEADER

const CLASS = {
	CLASSNONE:	0,				// Invalid class
	CLASS32:	1,				// 32-bit objects
	CLASS64:	2,				// 64-bit objects
} as const;

const DATA = {
	NONE:		0,				// Invalid data encoding
	LSB:		1,				// little endian
	MSB:		2,				// big endian
} as const;

const OSABI = {
	SYSV:		0,				// System V ABI
	HPUX:		1,				// HP-UX operating system
	STANDALONE:	255,			// Standalone (embedded)application
} as const;

const Ident = {
	//enum {MAGIC = '\177ELF'};
	magic:		bin.UINT32_LE,
	file_class:	bin.asEnum(bin.UINT8, CLASS),
	encoding:	bin.asEnum(bin.UINT8, DATA),
	version:	bin.UINT8,
	_: bin.If(s => s.obj.file_class === 'CLASS64', {
		//64 bit only
		osabi: 		bin.asEnum(bin.UINT8, OSABI),
		abiversion: bin.UINT8,
		pad:		bin.ArrayType(7, bin.UINT8),
	})
};

const ET = {
	NONE:		0,				// No file type
	REL:		1,				// Relocatable file
	EXEC:		2,				// Executable file
	DYN:		3,				// Shared object file
	CORE:		4,				// Core file
	LOOS:		0xfe00,			// Environment-specific use
	HIOS:		0xfeff,			// Environment-specific use
	LOPROC:		0xff00,			// Processor-specific
	HIPROC:		0xffff,			// Processor-specific
} as const;

const EM = {
	NONE:			0,				// e_machine
	M32:			1,				// AT&T WE 32100
	SPARC:	 		2,				// Sun SPARC
	'386':			3,				// Intel 80386
	'68K':			4,				// Motorola 68000
	'88K':			5,				// Motorola 88000
	'486':			6,				// Intel 80486
	'860':			7,				// Intel i860
	MIPS:			8,				// MIPS RS3000 Big-Endian
	S370:			9,				// IBM System/370 Processor
	MIPS_RS3_LE:	10,				// MIPS RS3000 Little-Endian
	RS6000:			11,				// RS6000
	UNKNOWN12:		12,
	UNKNOWN13:		13,
	UNKNOWN14:		14,
	PA_RISC:		15,				// PA-RISC
	nCUBE:			16,				// nCUBE
	VPP500:			17,				// Fujitsu VPP500
	SPARC32PLUS:	18,				// Sun SPARC 32+
	'960':			19,				// Intel 80960
	PPC:			20,				// PowerPC
	PPC64:			21,				// 64-bit PowerPC
	S390:			22,				// IBM System/390 Processor
	SPE:			23,
	UNKNOWN24:		24,
	UNKNOWN25:		25,
	UNKNOWN26:		26,
	UNKNOWN27:		27,
	UNKNOWN28:		28,
	UNKNOWN29:		29,
	UNKNOWN30:		30,
	UNKNOWN31:		31,
	UNKNOWN32:		32,
	UNKNOWN33:		33,
	UNKNOWN34:		34,
	UNKNOWN35:		35,
	V800:			36,				// NEX V800
	FR20:			37,				// Fujitsu FR20
	RH32:			38,				// TRW RH-32
	RCE:			39,				// Motorola RCE
	ARM:			40,				// Advanced RISC Marchines ARM
	ALPHA:			41,				// Digital Alpha
	SH:				42,				// Hitachi SH
	SPARCV9:		43,				// Sun SPARC V9 (64-bit)
	TRICORE:		44,				// Siemens Tricore embedded processor
	ARC:			45,				// Argonaut RISC Core, Argonaut Technologies Inc.
	H8_300:			46,				// Hitachi H8/300
	H8_300H:		47,				// Hitachi H8/300H
	H8S:			48,				// Hitachi H8S
	H8_500:			49,				// Hitachi H8/500
	IA_64:			50,				// Intel IA64
	MIPS_X:			51,				// Stanford MIPS-X
	COLDFIRE:		52,				// Motorola ColdFire
	'68HC12':		53,				// Motorola M68HC12
	MMA:			54,				// Fujitsu MMA Mulimedia Accelerator
	PCP:			55,				// Siemens PCP
	NCPU:			56,				// Sony nCPU embedded RISC processor
	NDR1:			57,				// Denso NDR1 microprocessor
	STARCORE:		58,				// Motorola Star*Core processor
	ME16:			59,				// Toyota ME16 processor
	ST100:			60,				// STMicroelectronics ST100 processor
	TINYJ:			61,				// Advanced Logic Corp. TinyJ embedded processor family
	AMD64:			62,				// AMDs x86-64 architecture
	PDSP:			63,				// Sony DSP Processor
	UNKNOWN64:		64,
	UNKNOWN65:		65,
	FX66:			66,				// Siemens FX66 microcontroller
	ST9PLUS:		67,				// STMicroelectronics ST9+8/16 bit microcontroller
	ST7:			68,				// STMicroelectronics ST7 8-bit microcontroller
	'68HC16':		69,				// Motorola MC68HC16 Microcontroller
	'68HC11':		70,				// Motorola MC68HC11 Microcontroller
	'68HC08':		71,				// Motorola MC68HC08 Microcontroller
	'68HC05':		72,				// Motorola MC68HC05 Microcontroller
	SVX:			73,				// Silicon Graphics SVx
	ST19:			74,				// STMicroelectronics ST19 8-bit microcontroller
	VAX:			75,				// Digital VAX
	CRIS:			76,				// Axis Communications 32-bit embedded processor
	JAVELIN:		77,				// Infineon Technologies 32-bit embedded processor
	FIREPATH:		78,				// Element 14 64-bit DSP Processor
	ZSP:			79,				// LSI Logic 16-bit DSP Processor
	MMIX:			80,				// Donald Knuth's educational 64-bit processor
	HUANY:			81,				// Harvard University machine-independent object files
	PRISM:			82,				// SiTera Prism
	AVR:			83,				// Atmel AVR 8-bit microcontroller
	FR30:			84,				// Fujitsu FR30
	D10V:			85,				// Mitsubishi D10V
	D30V:			86,				// Mitsubishi D30V
	V850:			87,				// NEC v850
	M32R:			88,				// Mitsubishi M32R
	MN10300:		89,				// Matsushita MN10300
	MN10200:		90,				// Matsushita MN10200
	PJ:				91,				// picoJava
	OPENRISC:		92,				// OpenRISC 32-bit embedded processor
	ARC_A5:			93,				// ARC Cores Tangent-A5
	XTENSA:			94,				// Tensilica Xtensa architecture
} as const;

const EV = {
	NONE:			0,				// Invalid version
	CURRENT:		1,				// Current version
} as const;


//--------------------	PROGRAM HEADER

const PT = {
	NULL:			0,			//Unused - nables the program header table to contain ignored entries
	LOAD:			1,			//loadable segment, described by p_filesz and p_memsz. The bytes from the file are mapped to the beginning of the memory segment
	DYNAMIC:		2,			//dynamic linking information
	INTERP:			3,			//null-terminated path name to invoke as an interpreter
	NOTE:			4,			//auxiliary information
	SHLIB:			5,			//Reserved but has unspecified semantics
	PHDR:			6,			//program header table in the file and in the memory image of the program
	TLS:			7,			//thread-local storage template
//OS-specific semantics.
	LOOS:			0x60000000,
	UNWIND:			0x6464e550,	//stack unwind tables.
	EH_FRAME:		0x6474e550,	//stack unwind table - equivalent to UNWIND
	GNU_STACK:		0x6474e551,	//stack flags
	GNU_RELRO:		0x6474e552,	//read only after relocation
	OS_SCE:			0x6fffff00,
	HIOS:			0x6fffffff,
//processor-specific semantics.
	LOPROC:			0x70000000,
	HIPROC:			0x7fffffff,
} as const;

const PF = {
	X:			0x1,					//Execute
	W:			0x2,					//Write
	R:			0x4,					//Read
	MASKPROC:	0xf0000000,			//Unspecified
} as const;

//--------------------	SECTIONS

const SHN = {
	UNDEF:		0,				//undefined
//	LORESERVE	= 0xff00,			//lower bound of the range of reserved indexes
	LOPROC:		0xff00,			//reserved for processor-specific semantics
	HIPROC:		0xff1f,			//	"
	LOOS:		0xff20,			//Environment-specific use
	HIOS:		0xff3f,			//Environment-specific use
	ABS:		0xfff1,			//
	COMMON:		0xfff2,			//common symbols
	HIRESERVE:	0xffff,			//upper bound of the range of reserved indexes
} as const;

const SHT = {
	NULL:		0,				//section header as inactive
	PROGBITS:	1,				//information defined by the program
	SYMTAB:		2,				//symbol table
	STRTAB:		3,				//string table
	RELA:		4,				//relocation entries with explicit addends
	HASH:		5,				//hash table
	DYNAMIC:	6,				//information for dynamic linking
	NOTE:		7,				//marks the file in some way
	NOBITS:		8,				//occupies no space in file
	REL:		9,				//relocation entries without explicit addends
	SHLIB:		10,				//reserved
	DYNSYM:		11,				//symbol table for linking only
	LOOS:		0x60000000,		//Environment-specific use
	HIOS:		0x6fffffff,		//Environment-specific use
	LOPROC:		0x70000000,		//Processor- specific
	HIPROC:		0x7fffffff,	 	//Processor- specific
	LOUSER:		0x80000000,
	HIUSER:		0xffffffff,

	PS3_RELA:	0x70000000 + 0xa4,
} as const;

const SHF = {
	WRITE:		0x1,				//contains writable data
	ALLOC:		0x2,				//occupies memory during xecution
	EXECINSTR:	0x4,				//contains executable machine instructions
	MASKOS:		0x0f000000,		//environment-specific use
	MASKPROC:	0xf0000000,		//processor-specific semantics
} as const;

//--------------------	SYMBOLS

const ST_INFO = bin.BitFields({
	type:		[4, bin.Enum({
		NOTYPE:		0,				//The symbol's type is not specified
		OBJECT:		1,				//associated with a data object
		FUNC:		2,				//associated with a function
		SECTION:	3,				//associated with a section
		FILE:		4,				//name of the source file
		LOOS:		10,				//environment-specific use
		HIOS:		12,
		LOPROC:		13,
		HIPROC:		15,
	
	})],
	binding:	[4, bin.Enum({
		LOCAL:		0,				//not visible outside the object file containing their definition
		GLOBAL:		1,				//visible to all object files being combined
		WEAK:		2,				//like global symbols, but lower precedence
		LOOS:		10,				//environment-specific use
		HIOS:		12,
		LOPROC:		13,
		HIPROC:		15,
	})],
});

const ST_OTHER = bin.BitFields({
	visibility:	[2, bin.Enum({
		DEFAULT:	0,
		HIDDEN:		1,
		PROTECTED:	2,
	})],
	other:		6,
});

//--------------------	DYNAMIC

const DT_TAG = {
	//Name				Value		d_un			Executable	Shared Object
	DT_NULL:			0,			//ignored		mandatory 	mandatory
	DT_NEEDED:			1,			//d_val			optional 	optional
	DT_PLTRELSZ:		2,			//d_val			optional 	optional
	DT_PLTGOT:			3,			//d_ptr			optional 	optional
	DT_HASH:			4,			//d_ptr			mandatory 	mandatory
	DT_STRTAB:			5,			//d_ptr			mandatory 	mandatory
	DT_SYMTAB:			6,			//d_ptr			mandatory 	mandatory
	DT_RELA:			7,			//d_ptr			mandatory 	optional
	DT_RELASZ:			8,			//d_val			mandatory 	optional
	DT_RELAENT:			9,			//d_val			mandatory 	optional
	DT_STRSZ:			10,			//d_val			mandatory 	mandatory
	DT_SYMENT:			11,			//d_val			mandatory 	mandatory
	DT_INIT:			12,			//d_ptr			optional 	optional
	DT_FINI:			13,			//d_ptr			optional 	optional
	DT_SONAME:			14,			//d_val			ignored 	optional
	DT_RPATH:			15,			//d_val			optional 	ignored (LEVEL2)
	DT_SYMBOLIC:		16,			//ignored		ignored 	optional  (LEVEL2)
	DT_REL:				17,			//d_ptr			mandatory 	optional
	DT_RELSZ:			18,			//d_val			mandatory 	optional
	DT_RELENT:			19,			//d_val			mandatory 	optional
	DT_PLTREL:			20,			//d_val			optional 	optional
	DT_DEBUG:			21,			//d_ptr			optional 	ignored
	DT_TEXTREL:			22,			//ignored		optional 	optional (LEVEL2)
	DT_JMPREL:			23,			//d_ptr			optional 	optional
	DT_BIND_NOW:		24,			//ignored		optional 	optional (LEVEL2)
	DT_INIT_ARRAY:		25,			//d_ptr			optional 	optional
	DT_FINI_ARRAY:		26,			//d_ptr			optional 	optional
	DT_INIT_ARRAYSZ:	27,			//d_val			optional 	optional
	DT_FINI_ARRAYSZ:	28,			//d_val			optional 	optional
	DT_RUNPATH:			29,			//d_val			optional 	optional
	DT_FLAGS:			30,			//d_val			optional 	optional
	DT_ENCODING:		32,			//unspecified 	unspecified unspecified
//	DT_PREINIT_ARRAY:	32,			//d_ptr			optional 	ignored
	DT_PREINIT_ARRAYSZ:	33,			//d_val			optional 	ignored
	DT_LOOS:			0x6000000D,	//unspecified 	unspecified unspecified
	DT_HIOS:			0x6ffff000,	//unspecified 	unspecified unspecified
	DT_LOPROC:			0x70000000,	//unspecified 	unspecified unspecified
	DT_HIPROC:			0x7fffffff,	//unspecified 	unspecified unspecified
} as const;
/*
const DT_FLAGS = {
	DF_ORIGIN:		0x1,
	DF_SYMBOLIC:	0x2,
	DF_TEXTREL:		0x4,
	DF_BIND_NOW:	0x8,
	DF_STATIC_TLS:	0x10,
} as const;
*/
//--------------------	RELOC

const RELOC = {
	'386':	{
		R_386_NONE:				0,
		R_386_32:				1,
		R_386_PC32:				2,
		R_386_GOT32:			3,
		R_386_PLT32:			4,
		R_386_COPY:				5,
		R_386_GLOB_DAT:			6,
		R_386_JMP_SLOT:			7,
		R_386_RELATIVE:			8,
		R_386_GOTOFF:			9,
		R_386_GOTPC:			10,
		R_386_32PLT:			11,
		R_386_TLS_GD_PLT:		12,
		R_386_TLS_LDM_PLT:		13,
		R_386_TLS_TPOFF:		14,
		R_386_TLS_IE:			15,
		R_386_TLS_GOTIE:		16,
		R_386_TLS_LE:			17,
		R_386_TLS_GD:			18,
		R_386_TLS_LDM:			19,
		R_386_16:				20,
		R_386_PC16:				21,
		R_386_8:				22,
		R_386_PC8:				23,
		R_386_UNKNOWN24:		24,
		R_386_UNKNOWN25:		25,
		R_386_UNKNOWN26:		26,
		R_386_UNKNOWN27:		27,
		R_386_UNKNOWN28:		28,
		R_386_UNKNOWN29:		29,
		R_386_UNKNOWN30:		30,
		R_386_UNKNOWN31:		31,
		R_386_TLS_LDO_32:		32,
		R_386_UNKNOWN33:		33,
		R_386_UNKNOWN34:		34,
		R_386_TLS_DTPMOD32:		35,
		R_386_TLS_DTPOFF32:		36,
		R_386_UNKNOWN37:		37,
		R_386_SIZE32:			38,
		R_386_NUM:				39
	},
	'PPC': {
		R_PPC_NONE:				0,
		R_PPC_ADDR32:			1,
		R_PPC_ADDR24:			2,
		R_PPC_ADDR16:			3,
		R_PPC_ADDR16_LO:		4,
		R_PPC_ADDR16_HI:		5,
		R_PPC_ADDR16_HA:		6,
		R_PPC_ADDR14:			7,
		R_PPC_ADDR14_BRTAKEN:	8,
		R_PPC_ADDR14_BRNTAKEN:	9,
		R_PPC_REL24:			10,
		R_PPC_REL14:			11,
		R_PPC_REL14_BRTAKEN:	12,
		R_PPC_REL14_BRNTAKEN:	13,
		R_PPC_GOT16:			14,
		R_PPC_GOT16_LO:			15,
		R_PPC_GOT16_HI:			16,
		R_PPC_GOT16_HA:			17,
		R_PPC_PLTREL24:			18,
		R_PPC_COPY:				19,
		R_PPC_GLOB_DAT:			20,
		R_PPC_JMP_SLOT:			21,
		R_PPC_RELATIVE:			22,
		R_PPC_LOCAL24PC:		23,
		R_PPC_UADDR32:			24,
		R_PPC_UADDR16:			25,
		R_PPC_REL32:			26,
		R_PPC_PLT32:			27,
		R_PPC_PLTREL32:			28,
		R_PPC_PLT16_LO:			29,
		R_PPC_PLT16_HI:			30,
		R_PPC_PLT16_HA:			31,
		R_PPC_SDAREL16:			32,
		R_PPC_SECTOFF:			33,
		R_PPC_SECTOFF_LO:		34,
		R_PPC_SECTOFF_HI:		35,
		R_PPC_SECTOFF_HA:		36,
		R_PPC_ADDR30:			37,
	// Relocs added to support TLS.
		R_PPC_TLS:				67,
		R_PPC_DTPMOD32:			68,
		R_PPC_TPREL16:			69,
		R_PPC_TPREL16_LO:		70,
		R_PPC_TPREL16_HI:		71,
		R_PPC_TPREL16_HA:		72,
		R_PPC_TPREL32:			73,
		R_PPC_DTPREL16:			74,
		R_PPC_DTPREL16_LO:		75,
		R_PPC_DTPREL16_HI:		76,
		R_PPC_DTPREL16_HA:		77,
		R_PPC_DTPREL32:			78,
		R_PPC_GOT_TLSGD16:		79,
		R_PPC_GOT_TLSGD16_LO:	80,
		R_PPC_GOT_TLSGD16_HI:	81,
		R_PPC_GOT_TLSGD16_HA:	82,
		R_PPC_GOT_TLSLD16:		83,
		R_PPC_GOT_TLSLD16_LO:	84,
		R_PPC_GOT_TLSLD16_HI:	85,
		R_PPC_GOT_TLSLD16_HA:	86,
		R_PPC_GOT_TPREL16:		87,
		R_PPC_GOT_TPREL16_LO:	88,
		R_PPC_GOT_TPREL16_HI:	89,
		R_PPC_GOT_TPREL16_HA:	90,
		R_PPC_GOT_DTPREL16:		91,
		R_PPC_GOT_DTPREL16_LO:	92,
		R_PPC_GOT_DTPREL16_HI:	93,
		R_PPC_GOT_DTPREL16_HA:	94,
		// The remaining relocs are from the Embedded ELF ABI and are not in the SVR4 ELF ABI
		R_PPC_EMB_NADDR32:		101,
		R_PPC_EMB_NADDR16:		102,
		R_PPC_EMB_NADDR16_LO:	103,
		R_PPC_EMB_NADDR16_HI:	104,
		R_PPC_EMB_NADDR16_HA:	105,
		R_PPC_EMB_SDAI16:		106,
		R_PPC_EMB_SDA2I16:		107,
		R_PPC_EMB_SDA2REL:		108,
		R_PPC_EMB_SDA21:		109,
		R_PPC_EMB_MRKREF:		110,
		R_PPC_EMB_RELSEC16:		111,
		R_PPC_EMB_RELST_LO:		112,
		R_PPC_EMB_RELST_HI:		113,
		R_PPC_EMB_RELST_HA:		114,
		R_PPC_EMB_BIT_FLD:		115,
		R_PPC_EMB_RELSDA:		116,
	},
	'PPC64': {
		R_PPC64_NONE:				0,
		R_PPC64_ADDR32:				1,
		R_PPC64_ADDR24:				2,
		R_PPC64_ADDR16:				3,
		R_PPC64_ADDR16_LO:			4,
		R_PPC64_ADDR16_HI:			5,
		R_PPC64_ADDR16_HA:			6,
		R_PPC64_ADDR14:				7,
		R_PPC64_ADDR14_BRTAKEN:		8,
		R_PPC64_ADDR14_BRNTAKEN:	9,
		R_PPC64_REL24:				10,
		R_PPC64_REL14:				11,
		R_PPC64_REL14_BRTAKEN:		12,
		R_PPC64_REL14_BRNTAKEN:		13,
		R_PPC64_GOT16:				14,
		R_PPC64_GOT16_LO:			15,
		R_PPC64_GOT16_HI:			16,
		R_PPC64_GOT16_HA:			17,
		// 18 unused.	= 32-bit reloc is R_PPC_PLTREL24.
		R_PPC64_COPY:				19,
		R_PPC64_GLOB_DAT:			20,
		R_PPC64_JMP_SLOT:			21,
		R_PPC64_RELATIVE:			22,
		// 23 unused.	= 32-bit reloc is R_PPC_LOCAL24PC.
		R_PPC64_UADDR32:			24,
		R_PPC64_UADDR16:			25,
		R_PPC64_REL32:				26,
		R_PPC64_PLT32:				27,
		R_PPC64_PLTREL32:			28,
		R_PPC64_PLT16_LO:			29,
		R_PPC64_PLT16_HI:			30,
		R_PPC64_PLT16_HA:			31,
		// 32 unused.	= 32-bit reloc is R_PPC_SDAREL16.
		R_PPC64_SECTOFF:			33,
		R_PPC64_SECTOFF_LO:			34,
		R_PPC64_SECTOFF_HI:			35,
		R_PPC64_SECTOFF_HA:			36,
		R_PPC64_REL30:				37,
		R_PPC64_ADDR64:				38,
		R_PPC64_ADDR16_HIGHER:		39,
		R_PPC64_ADDR16_HIGHERA:		40,
		R_PPC64_ADDR16_HIGHEST:		41,
		R_PPC64_ADDR16_HIGHESTA:	42,
		R_PPC64_UADDR64:			43,
		R_PPC64_REL64:				44,
		R_PPC64_PLT64:				45,
		R_PPC64_PLTREL64:			46,
		R_PPC64_TOC16:				47,
		R_PPC64_TOC16_LO:			48,
		R_PPC64_TOC16_HI:			49,
		R_PPC64_TOC16_HA:			50,
		R_PPC64_TOC:				51,
		R_PPC64_PLTGOT16:			52,
		R_PPC64_PLTGOT16_LO:		53,
		R_PPC64_PLTGOT16_HI:		54,
		R_PPC64_PLTGOT16_HA:		55,
		// The following relocs were added in the 64-bit PowerPC ELF ABI revision 1.2.
		R_PPC64_ADDR16_DS:			56,
		R_PPC64_ADDR16_LO_DS:		57,
		R_PPC64_GOT16_DS:			58,
		R_PPC64_GOT16_LO_DS:		59,
		R_PPC64_PLT16_LO_DS:		60,
		R_PPC64_SECTOFF_DS:			61,
		R_PPC64_SECTOFF_LO_DS:		62,
		R_PPC64_TOC16_DS:			63,
		R_PPC64_TOC16_LO_DS:		64,
		R_PPC64_PLTGOT16_DS:		65,
		R_PPC64_PLTGOT16_LO_DS:		66,
		// Relocs added to support TLS.	PowerPC64 ELF ABI revision 1.5.
		R_PPC64_TLS:				67,
		R_PPC64_DTPMOD64:			68,
		R_PPC64_TPREL16:			69,
		R_PPC64_TPREL16_LO:			70,
		R_PPC64_TPREL16_HI:			71,
		R_PPC64_TPREL16_HA:			72,
		R_PPC64_TPREL64:			73,
		R_PPC64_DTPREL16:			74,
		R_PPC64_DTPREL16_LO:		75,
		R_PPC64_DTPREL16_HI:		76,
		R_PPC64_DTPREL16_HA:		77,
		R_PPC64_DTPREL64:			78,
		R_PPC64_GOT_TLSGD16:		79,
		R_PPC64_GOT_TLSGD16_LO:		80,
		R_PPC64_GOT_TLSGD16_HI:		81,
		R_PPC64_GOT_TLSGD16_HA:		82,
		R_PPC64_GOT_TLSLD16:		83,
		R_PPC64_GOT_TLSLD16_LO:		84,
		R_PPC64_GOT_TLSLD16_HI:		85,
		R_PPC64_GOT_TLSLD16_HA:		86,
		R_PPC64_GOT_TPREL16_DS:		87,
		R_PPC64_GOT_TPREL16_LO_DS:	88,
		R_PPC64_GOT_TPREL16_HI:		89,
		R_PPC64_GOT_TPREL16_HA:		90,
		R_PPC64_GOT_DTPREL16_DS:	91,
		R_PPC64_GOT_DTPREL16_LO_DS:	92,
		R_PPC64_GOT_DTPREL16_HI:	93,
		R_PPC64_GOT_DTPREL16_HA:	94,
		R_PPC64_TPREL16_DS:			95,
		R_PPC64_TPREL16_LO_DS:		96,
		R_PPC64_TPREL16_HIGHER:		97,
		R_PPC64_TPREL16_HIGHERA:	98,
		R_PPC64_TPREL16_HIGHEST:	99,
		R_PPC64_TPREL16_HIGHESTA:	100,
		R_PPC64_DTPREL16_DS:		101,
		R_PPC64_DTPREL16_LO_DS:		102,
		R_PPC64_DTPREL16_HIGHER:	103,
		R_PPC64_DTPREL16_HIGHERA:	104,
		R_PPC64_DTPREL16_HIGHEST:	105,
		R_PPC64_DTPREL16_HIGHESTA:	106,
		// These are GNU extensions to enable C++ vtable garbage collection.
		R_PPC64_GNU_VTINHERIT:		253,
		R_PPC64_GNU_VTENTRY:		254,
	},
	'AMD64': {
		R_AMD64_NONE:			0,	// No reloc
		R_AMD64_64:				1,	// Direct 64 bit
		R_AMD64_PC32:			2,	// PC relative 32 bit signed
		R_AMD64_GOT32:			3,	// 32 bit GOT entry
		R_AMD64_PLT32:			4,	// 32 bit PLT address
		R_AMD64_COPY:			5,	// Copy symbol at runtime
		R_AMD64_GLOB_DAT:		6,	// Create GOT entry
		R_AMD64_JUMP_SLOT:		7,	// Create PLT entry
		R_AMD64_RELATIVE:		8,	// Adjust by program base
		R_AMD64_GOTPCREL:		9,	// 32 bit signed PC relative offset to GOT
		R_AMD64_32:				10,	// Direct 32 bit zero extended
		R_AMD64_32S:			11,	// Direct 32 bit sign extended
		R_AMD64_16:				12,	// Direct 16 bit zero extended
		R_AMD64_PC16:			13,	// 16 bit sign extended pc relative
		R_AMD64_8:				14,	// Direct 8 bit sign extended
		R_AMD64_PC8:			15,	// 8 bit sign extended pc relative

		// TLS relocations
		R_AMD64_DTPMOD64:		16,	// ID of module containing symbol
		R_AMD64_DTPOFF64:		17,	// Offset in module's TLS block
		R_AMD64_TPOFF64:		18,	// Offset in initial TLS block
		R_AMD64_TLSGD:			19,	// 32 bit signed PC relative offset to two GOT entries for GD symbol
		R_AMD64_TLSLD:			20,	// 32 bit signed PC relative offset to two GOT entries for LD symbol
		R_AMD64_DTPOFF32:		21,	// Offset in TLS block
		R_AMD64_GOTTPOFF:		22,	// 32 bit signed PC relative offset to GOT entry for IE symbol
		R_AMD64_TPOFF32:		23,	// Offset in initial TLS block

		R_AMD64_PC64:			24,	// 64-bit PC relative
		R_AMD64_GOTOFF64:		25,	// 64-bit GOT offset
		R_AMD64_GOTPC32:		26,	// 32-bit PC relative offset to GOT

		R_AMD64_GOT64:			27,	// 64-bit GOT entry offset
		R_AMD64_GOTPCREL64:		28,	// 64-bit PC relative offset to GOT entry
		R_AMD64_GOTPC64:		29,	// 64-bit PC relative offset to GOT
		R_AMD64_GOTPLT64:		30,	// Like GOT64, indicates that PLT entry needed
		R_AMD64_PLTOFF64:		31,	// 64-bit GOT relative offset to PLT entry

		R_AMD64_SIZE32:			32,
		R_AMD64_SIZE64:			33,

		R_AMD64_GOTPC32_TLSDESC:34,	// 32-bit PC relative to TLS descriptor in GOT
		R_AMD64_TLSDESC_CALL:	35,	// Relaxable call through TLS descriptor
		R_AMD64_TLSDESC:		36,	// 2 by 64-bit TLS descriptor
		R_AMD64_IRELATIVE:		37,	// Adjust indirectly by program base
		// GNU vtable garbage collection extensions.
		R_AMD64_GNU_VTINHERIT:	250,
		R_AMD64_GNU_VTENTRY:	251
	}
};

//-----------------------------------------------------------------------------
//	ELF
//-----------------------------------------------------------------------------

function Pair(top: bin.Type, bottom: bin.Type, be: boolean) {
	return be ? {top, bottom} : {bottom, top};
}
function readDataAs<T extends bin.Type>(data: MappedMemory | undefined, type: T) {
	if (data)
		return bin.RemainingArrayType(type).get(new bin.stream(data.data));
}

export class ELFFile {
	static check(data: Uint8Array): boolean {
		return bin.utils.decodeText(data.subarray(0, 4), 'utf8') === '\x7fELF';
	}

	segments;
	sections;
	header;
	getDynamic;
	getRel;
	getRelA;
	getSymbols;
	getDynamicSymbols;

	constructor(data: Uint8Array) {
		const s		= new bin.stream(data);
		const ident = bin.read(s, Ident);
		if (ident.magic != bin.utils.stringCode("\x7fELF"))
			throw new Error('Not an ELF file');

		const	be		= ident.encoding	== 'MSB';
		const	bits	= ident.file_class	== 'CLASS32' ? 32 : 64;

		const	Half	= bin.UINT(16, be);
		const	Sword	= bin.INT(32, be);
		const	Word	= bin.UINT(32, be);
		
		const	Addr	= bin.asHex(bin.UINT(bits, be));
		const	Off		= bin.UINT(bits, be);
		const	Xword	= bin.INT(bits, be);
		const	Sxword	= bin.UINT(bits, be);
		const	PairHalf= bin.UINT(bits == 32 ? 8 : 32, be);

		const Ehdr = {
			e_type:			bin.asEnum(Half, ET),		//Object file type (ET_..)
			e_machine:		bin.asEnum(Half, EM),		//specifies the required architecture (EM_...)
			e_version:		bin.asEnum(Word, EV),		//object file version (EV_...)
			e_entry:		Addr,		//run address
			e_phoff:		Off,		//program header table's file offset
			e_shoff:		Off,		//section header table's file offset
			e_flags:		Word,		//processor-specific flags (EF_...)
			e_ehsize:		Half,		//ELF header's size
			e_phentsize:	Half,		//size of each entry in the program header table
			e_phnum:		Half,		//number of entries in the program header table
			e_shentsize:	Half,		//size of each section header
			e_shnum:		Half,		//number of entries in the section header table
			e_shstrndx:		Half,		//section header table index of section name string table
		};

		class Phdr extends bin.ReadClass(bits == 32 ? {
			p_type:			bin.asEnum(Word, PT),		//kind of segment this array element describes
			p_offset:		Off,		//offset from the beginning of the file at which the first byte of the segment resides
			p_vaddr:		Addr,		//virtual address at which the first byte of the segment resides in memory
			p_paddr:		Addr,		//segment's physical address (when relevant)
			p_filesz:		Word,		//number of bytes in the file image of the segment
			p_memsz:		Word,		//number of bytes in the memory image of the segment
			p_flags:		bin.asFlags(Word, PF),
			p_align:		Word,
		} : {	
			p_type:			bin.asEnum(Word, PT),
			p_flags:		bin.asFlags(Word, PF),
			p_offset:		Off,
			p_vaddr:		Addr,
			p_paddr:		Addr,
			p_filesz:		Xword,
			p_memsz:		Xword,
			p_align:		Xword,
		}) {
			data: MappedMemory;
			constructor(s: bin.stream) {
				super(s);
				const flags = MappedMemory.RELATIVE
							| (this.p_flags.R ? MappedMemory.READ : 0)
							| (this.p_flags.W ? MappedMemory.WRITE : 0)
							| (this.p_flags.X ? MappedMemory.EXECUTE : 0);
				this.data = new MappedMemory(bin.buffer_at(s, Number(this.p_offset), Number(this.p_filesz)), BigInt(this.p_vaddr.value), flags);
			}
		}

		class Shdr extends bin.ReadClass({
			sh_name:		Word,		//name of the section
			sh_type:		bin.asEnum(Word, SHT),		//categorizes the section's contents and semantics
			sh_flags:		bin.asFlags(Xword, SHF),		//miscellaneous attributes
			sh_addr:		Addr,		//address
			sh_offset:		Off,		//file offset to first byte in section
			sh_size:		Off,		//section's size in bytes
			sh_link:		Word,		//section header table index link
			sh_info:		Word,		//extra information
			sh_addralign:	Off,		//address alignment constraints
			sh_entsize:		Off,		//size in bytes of each entry (when appropriate)
		}) {
			data: MappedMemory;
			constructor(s: bin.stream) {
				super(s);
				const flags = MappedMemory.RELATIVE | MappedMemory.READ
							| (this.sh_flags.WRITE ? MappedMemory.WRITE : 0)
							| (this.sh_flags.EXECINSTR ? MappedMemory.EXECUTE : 0);
				const buffer = this.sh_type === 'NOBITS' ? new Uint8Array(0) : bin.buffer_at(s, Number(this.sh_offset), Number(this.sh_size));
				this.data = new MappedMemory(buffer, BigInt(this.sh_addr.value), flags);
			}
		}

		const	h = bin.read(s, Ehdr);
		this.header = h;

		s.seek(Number(h.e_phoff));
		const	ph = Array.from({length: h.e_phnum}, () => new Phdr(s));

		s.seek(Number(h.e_shoff));
		const	sh = Array.from({length: h.e_shnum}, () => new Shdr(s));

		//set segment names
		this.segments	= ph.map(i => [`${i.p_type} @ 0x${i.p_offset.toString(16)}`, i] as [string, typeof i]);

		//set section names
		const shnames	= sh[h.e_shstrndx].data.data;
		this.sections	= sh.map(i => [bin.utils.decodeTextTo0(shnames.subarray(i.sh_name), 'utf8'), i] as [string, typeof i]);

		const Dyn = {
			d_tag:	bin.asEnum(Sword, DT_TAG),
			d_val:	Xword,
		};
		const Rel = {
			r_offset:	Addr,
			r_info:		Pair(bin.asEnum(PairHalf, RELOC[h.e_machine as keyof typeof RELOC]), PairHalf, be),
		};
		const Rela =  {
			...Rel,
			r_addend:	Sxword,
		};
		this.getDynamic = () => readDataAs(ph.find(i => i.p_type === 'DYNAMIC')?.data, Dyn);
		this.getRel		= () => readDataAs(sh.find(i => i.sh_type === 'REL')?.data, Rel);
		this.getRelA	= () => readDataAs(sh.find(i => i.sh_type === 'RELA')?.data, Rela);

		const Sym = {
			data:		bin.DontRead<MappedMemory>(),
			st_name:	Word,			//index into the object file's symbol string table
			...(bits === 32 ? {
				st_value:	Addr,			//value of the associated symbol
				st_size:	Word,			//associated size
				st_info:	bin.as(bin.UINT8, ST_INFO),	//symbol's type and binding attributes
				st_other:	bin.as(bin.UINT8, ST_OTHER),
				st_shndx:	bin.asEnum(Half, SHN),			//section header table index
			}: {
				st_info:	bin.as(bin.UINT8, ST_INFO),
				st_other:	bin.as(bin.UINT8, ST_OTHER),
				st_shndx:	bin.asEnum(Half, SHN),
				st_value:	Addr,
				st_size:	Off,
			})
		};

		function getSymbols(name: string) {
			const sect = sh.find(i => i.sh_type === name);
			if (sect) {
				const names = sh[sect.sh_link].data.data;
				const syms = readDataAs(sect.data, Sym)!;
				return syms.filter(sym => sym.st_name).map(sym => {
					if (+sym.st_shndx) {
						const section = sh[+sym.st_shndx];
						const offset = Number(sym.st_value.value) - Number(section.sh_addr.value);
						const flags	= sym.st_info.type === 'FUNC' ? section.data.flags : section.data.flags & ~MappedMemory.EXECUTE;
						sym.data = new MappedMemory(section.data.data.subarray(offset, offset + Number(sym.st_size)), BigInt(sym.st_value.value), flags);
					}
					return [bin.utils.decodeTextTo0(names.subarray(sym.st_name), 'utf8'), sym] as [string, typeof sym];
				});
			}
		}

		this.getSymbols			= () => getSymbols('SYMTAB');
		this.getDynamicSymbols	= () => getSymbols('DYNSYM');
	}

	getSegmentByType(type: keyof typeof PT) {
		return this.segments.find(i => i[1].p_type === type)?.[1];
	}
	getSectionByType(type: keyof typeof SHT) {
		return this.sections.find(i => i[1].sh_type === type)?.[1];
	}
}
