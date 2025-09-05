# Binary Libs
[![npm version](https://img.shields.io/npm/v/@isopodlabs/binary_libs.svg)](https://www.npmjs.com/package/@isopodlabs/binary_libs)
[![GitHub stars](https://img.shields.io/github/stars/adrianstephens/binary_libs.svg?style=social)](https://github.com/adrianstephens/binary_libs)
[![License](https://img.shields.io/npm/l/@isopodlabs/binary_libs.svg)](LICENSE.txt)

This package provides readers for various library formats, using the @isopodlabs/binary binary file loading library

## ☕ Support My Work  
If you use this package, consider [buying me a cup of tea](https://coff.ee/adrianstephens) to support future updates!  

## Supported File Types

### elf
ELF
```typescript
class ELFFile {
    static check(data: Uint8Array): boolean;
    segments: [string, Segment][];
    sections: [string, Section][];
    header: Header;
    getSymbols(): [string, Symbol][];
    getDynamicSymbols(): [string, Symbol][];
    getSegmentByType(type: string): Segment | undefined;
    getSectionByType(type: string): Section | undefined;
}
```

### pe
Portable Executable
```typescript
class PE {
    static check(data: Uint8Array): boolean;
    header: Header;
    opt?:   OptHeader;
    sections: Section[];
    get directories(): {
        [k: string]: any;
    } | undefined;
    FindSectionRVA(rva: number): Section | undefined;
    FindSectionRaw(addr: number): Section | undefined;
    GetDataRVA(rva: number, size?: number): binary.utils.MappedMemory | undefined;
    GetDataRaw(addr: number, size: number): Uint8Array | undefined;
    GetDataDir(dir: { VirtualAddress: number; Size: number; } & {}): binary.utils.MappedMemory | undefined;
    ReadDirectory(name: string): any;
}
```

### clr
Common Language Runtime (embedded in pe files)
```typescript
class CLR {
    header: Header;
    table_info: TableInfo;
    heaps: Uint8Array[];
    tables: Record<TABLE, Table>;
    Resources?: Uint8Array;
    getEntry(t: TABLE, i: number): any;
    getTable(t: TABLE): any;
    getResources(block: string): Record<string, any> | undefined;
    getResource(block: string, name: string): any;
    allResources(): any;
}
```
### mach
Apple libraries
```typescript
interface Segment {
    data: binary.utils.MappedMemory | undefined;
    segname: string;
    vmaddr: number | bigint;
    vmsize: number | bigint;
    fileoff: number | bigint;
    filesize: number | bigint;
    maxprot: number;
    initprot: number;
    nsects: number;
    flags: Record<string, bigint | boolean> | Record<string, number | boolean>;
    sections: Record<string, any> | undefined;
};
class MachFile {
    static check(data: Uint8Array): boolean;
    header: Header;
    commands: { cmd: CMD; data: any; }[];
    constructor(data: Uint8Array, mem?: binary.utils.memory);
    getCommand(cmd: CMD): any;
    getSegment(name: string): Segment;
}
class FATMachFile {
    archs:  {
        cputype: string;
        cpusubtype: string | number;
        offset: number;
        size: number;
        align: number;
        contents: MachFile | undefined;
    }[];
    static check(data: Uint8Array): boolean;
    constructor(data: Uint8Array, mem?: binary.utils.memory);
    load(file: binary.stream_endian, mem?: binary.utils.memory): void;
}
```

### arch
Archive files for static linking

```typescript
declare class ArchFile {
    static check(data: Uint8Array): boolean;
    members: {
        name: string;
        date: number;
        uid: number;
        gid: number;
        mode: number;
        size: number;
        fmag: string;
        contents: any;
    }[];
    constructor(data: Uint8Array);
}
```

### CompoundDocument
Not a library format at all, but useful for loading some related files
```typescript
class Reader {
    entries: DirEntry[];
    private entry_chain;
    constructor(sectors: Uint8Array, header: Header);
    find(name: string, i?: number): DirEntry | undefined;
    read(e: DirEntry): Uint8Array;
    write(e: DirEntry, data: Uint8Array): void;
}
```
## License

This project is licensed under the MIT License. See the LICENSE file for more details.