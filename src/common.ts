import path from 'path/posix';

export interface Cancellation {
	cancel: boolean;
}

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


//-----------------------------------------------------------------------------
// File Hierarchy
//-----------------------------------------------------------------------------

export const UnixMode = {
	NONE:		0,
	USER:		0o001,
	GROUP:		0o010,
	OTHER:		0o100,
	ALL:		0o111,
	R:			4,
	W:			2,
	X:			1,
	STICKY:		0o001000,
	SGID:		0o002000,
	SUID:		0o004000,
	TYPEMASK:	0o170000,
	DIRECTORY:	0o040000,
	FILE:		0o100000,
	SYMLINK:	0o120000,
	PERM_644:	0o000644,
	PERM_755:	0o000755,
} as const;

export const WindowsFileAttributes = {
	READONLY:				0x00000001,
	HIDDEN:					0x00000002,
	SYSTEM:					0x00000004,
	DIRECTORY:				0x00000010,
	ARCHIVE:				0x00000020,
//	DEVICE:					0x00000040,
	NORMAL:					0x00000080,
	TEMPORARY:				0x00000100,
	SPARSE_FILE:			0x00000200,
	REPARSE_POINT:			0x00000400,
	COMPRESSED:				0x00000800,
	
	OFFLINE:				0x00001000,
	NOT_CONTENT_INDEXED:	0x00002000,
	ENCRYPTED:				0x00004000,
	INTEGRITY_STREAM:		0x00008000,
//	VIRTUAL:				0x00010000,
	NO_SCRUB_DATA:			0x00020000,
//	EA:						0x00040000,
	PINNED:					0x00080000,
	UNPINNED:				0x00100000,
	RECALL_ON_OPEN:			0x00040000,
	RECALL_ON_DATA_ACCESS:	0x00400000,

	UNIX_EXTENSION:			0x8000
} as const;

export interface HierarchyNode<T extends HierarchyNode<T>> {
	filename: string;
	children?: Map<string, T>;
}

export class Hierarchy<T extends HierarchyNode<T>> {
	constructor(public root: T, private make: (filename: string) => T, private remove: (node: T) => void) {}

	protected add(entry: T) {
		const parts = entry.filename.split('/');
		let last = parts.pop()!;
		if (last === '') // directory
			last = parts.pop()!;
		
		const dir = this.getFolder(parts, true);
		if (!dir)
			return;
		if (!dir.children)
			dir.children = new Map<string, T>();
		dir.children.set(last, entry);
	}

	relative(entry: T, linkname: string) {
		return path.normalize(path.join(path.dirname(entry.filename), linkname));
	}

	protected fixLink(entry: T, linkname: string) {
		const target = this.relative(entry, linkname);
		const link = this.findEntry(target);
		if (link)
			entry.children = link.children;
	}

	protected getFolder(parts: string[], create = false) {
		let current: T | undefined = this.root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (!current)
				return;

			let next: T | undefined = current.children?.get(part);
			if (!next) {
				if (!create)
					return;
				next = this.make(parts.slice(0, i + 1).join('/') + '/');
				if (!current.children)
					current.children = new Map<string, T>();
				current.children.set(part, next);
			}
			current = next;
		}
		return current;
	}

	findEntry(filename: string): T | undefined {
		if (!filename)
			return this.root;
		const parts	= filename.split('/');
		const last	= parts.pop()!;
		const dir	= this.getFolder(parts, false);
		return last ? dir?.children!.get(last) : dir;
	}


	deleteEntry(filename: string): boolean {
		const parts	= filename.split('/');
		let last = parts.pop()!;
		if (last === '') // directory
			last = parts.pop()!;

		const dir = this.getFolder(parts, false);
		const e = dir?.children!.get(last);
		if (!e)
			return false;

		const recurse = (e: T) => {
			if (e.children) {
				e.children.forEach(v => recurse(v));
				e.children = undefined;
			}
			this.remove(e);
		};
		dir!.children!.delete(last);
		recurse(e);
		return true;
	}
	renameEntry(oldFilename: string, newFilename: string): T | undefined {
		const oldParts = oldFilename.split('/');
		let oldLast = oldParts.pop()!;
		if (oldLast === '') {
			oldLast = oldParts.pop()!;
			if (!newFilename.endsWith('/'))
				newFilename += '/';
		}

		const oldDir	= this.getFolder(oldParts, false);
		const children	= oldDir!.children!;
		const entry		= children.get(oldLast);
		if (!entry)
			return;

		const newParts = newFilename.split('/');
		let newLast = newParts.pop()!;
		if (newLast === '')
			newLast = newParts.pop()!;

		const newDir = this.getFolder(newParts, true);
		if (newDir!.children!.has(newLast))
			return; // collision

		entry.filename = newFilename;

		if (oldDir !== newDir) {
			children.delete(oldLast);
			newDir!.children!.set(newLast, entry);
		} else {
			const ordered	= Array.from(children.entries());
			const index		= ordered.findIndex(([k]) => k === oldLast);
			ordered[index][0] = newLast;
			oldDir!.children = new Map(ordered);
		}

		if (entry.children) {
			const recurse = (node: T) => {
				const prefix = node.filename;
				for (const [key, child] of node.children!.entries()) {
					child.filename = prefix + key;
					if (child.children) {
						child.filename += '/';
						recurse(child);
					}
				}
			};
			recurse(entry);
		}
		return entry;
	}
}