import * as bin from '@isopodlabs/binary';
export * as ole from './ole';

function shiftCeil(value: number, shift: number) {
	return (value + (1 << shift) - 1) >> shift;
}

export interface Backing {
	readAt(offset: number, size: number): Promise<Uint8Array>;
	writeAt(offset: number, data: Uint8Array): Promise<void>;
}

export interface Sectors {
	shift: number;
	sector(id: number)			: Promise<Uint8Array>;
	dirty_sector(id: number)	: Promise<Uint8Array>;
}

async function read_chain(sectors: Sectors, chain: number[], dest: Uint8Array) {
	for (const i in chain) {
		const offset	= +i << sectors.shift;
		if (offset >= dest.length)
			break;
		const sector = await sectors.sector(chain[i]);
		dest.set(sector.subarray(0, dest.length - offset), offset);
	}
}

async function read_chain_alloc(sectors: Sectors, chain: number[]) {
	const dest = new Uint8Array(chain.length << sectors.shift);
	await read_chain(sectors, chain, dest);
	return dest;
}

async function write_chain(sectors: Sectors, chain: number[], source: Uint8Array) {
	for (const i in chain) {
		const offset	= +i << sectors.shift;
		if (offset >= source.length)
			break;
		const sector = await sectors.dirty_sector(chain[i]);
		if (sector)
			sector.set(source.subarray(offset, offset + (1 << sectors.shift)), 0);
	}
}

//-----------------------------------------------------------------------------
//	Master sector allocation table (MSAT) and sector allocation table (SAT)
//-----------------------------------------------------------------------------

const enum SecID {
	FREE		= -1,	// Free sector, may exist in the file, but is not part of any stream
	ENDOFCHAIN	= -2,	// Trailing SecID in a SecID chain
	SAT			= -3,	// Sector is used by the sector allocation table
	MSAT		= -4,	// Sector is used by the master sector allocation table
}

class FAT {
	freed:	number[] = [];
	dirty	= new Set<number>();

	constructor(public fat: Int32Array, public fat_shift: number, public sectors: Sectors) {
	}

	private free(id: number) {
		this.freed.push(id);
		this.fat[id] = SecID.FREE;
		this.dirty.add(id >> this.fat_shift);
	}

	alloc(type: number) {
		if (!this.freed.length) {
			const size0 = this.fat.length;
			for (let i = size0; i--;) {
				if (this.fat[i] === SecID.FREE)
					this.freed.push(i);
			}
			if (!this.freed.length) {
				// resize fat
				let fatbuff = this.fat.buffer;
				const size1	= shiftCeil(size0 + 1, this.fat_shift) << this.fat_shift;
				if (size1 >= fatbuff.byteLength / 4) {
					fatbuff	= new ArrayBuffer(Math.max(fatbuff.byteLength * 2, size1 * 4));
					new Int32Array(fatbuff).set(this.fat);
				}
				this.fat	= new Int32Array(fatbuff, 0, size1);
				this.fat.fill(SecID.FREE, size0);
				for (let i = size1; i-- > size0;)
					this.freed.push(i);
			}
		}
		const	id = this.freed.pop()!;
		this.fat[id] = type;
		this.dirty.add(id >> this.fat_shift);
		return id;
	}

	get_chain(id: number): number[] {
		const	chain: number[] = [];
		while (id != SecID.ENDOFCHAIN) {
			chain.push(id);
			id	= this.fat[id];
		}
		return chain;
	}

	resize_chain(chain: number[], data_size: number) {
		const size = shiftCeil(data_size, this.sectors.shift);
		while (chain.length > size)
			this.free(chain.pop()!);

		if (size) {
			let last = chain.at(-1) ?? SecID.ENDOFCHAIN;
			while (chain.length < size) {
				const id = this.alloc(SecID.ENDOFCHAIN);
				if (last != SecID.ENDOFCHAIN)
					this.fat[last] = id;
				chain.push(last = id);
			}
		}
	}
	async flush(to: FAT, chain: number[]) {
		for (const i of this.dirty.keys()) {
			const sector = await to.dirty_sector(chain[i]);
			sector?.set(bin.utils.as8(this.fat.subarray(i << this.fat_shift, (i + 1) << this.fat_shift)));
		}
		this.dirty.clear();
	}

	async sector(id: number) {
		if (id < this.fat.length && this.fat[id] !== SecID.FREE)
			return this.sectors.sector(id);
	}
	async chain_part(chain: number[], offset: number) {
		const index = offset >> this.sectors.shift;
		if (index >= chain.length)
			this.resize_chain(chain, offset + 1);
		return (await this.sector(chain[index]))?.subarray(offset & ((1 << this.sectors.shift) - 1));
	}

	async dirty_sector(id: number) {
		if (id < this.fat.length && this.fat[id] !== SecID.FREE)
			return this.sectors.dirty_sector(id);
	}
	async dirty_chain_part(chain: number[], offset: number) {
		const index = offset >> this.sectors.shift;
		if (index >= chain.length)
			this.resize_chain(chain, offset + 1);
		return (await this.dirty_sector(chain[index]))?.subarray(offset & ((1 << this.sectors.shift) - 1));
	}
	
	read_chain(chain: number[], dest: Uint8Array) {
		return read_chain(this.sectors, chain, dest);
	}

	read_chain_alloc(chain: number[]) {
		return read_chain_alloc(this.sectors, chain);
	}

	write_chain(chain: number[], source: Uint8Array) {
		return write_chain(this.sectors, chain, source);
	}
}

//-----------------------------------------------------------------------------
//	Compound Document Header
//-----------------------------------------------------------------------------

//export class Header extends bin.Class({
const Header = {
	magic:				bin.Expect(bin.UINT64_BE, 0xD0CF11E0A1B11AE1n),
	id:					bin.Buffer(16),
	revision:			bin.UINT16_LE,
	version:			bin.UINT16_LE,
	byteorder:			bin.UINT16_LE,
	sector_shift:		bin.UINT16_LE,
	mini_shift:			bin.UINT16_LE,
	num_directory:		bin.AfterSkip(6, bin.UINT32_LE),
	num_fat:			bin.UINT32_LE,
	first_directory:	bin.INT32_LE,
	transaction:		bin.Expect(bin.UINT32_LE, 0),
	mini_cutoff:		bin.UINT32_LE,
	first_mini:			bin.INT32_LE,
	num_mini:			bin.UINT32_LE,
	first_difat:		bin.INT32_LE,
	num_difat:			bin.UINT32_LE,
	difat:				bin.Buffer(109, Int32Array),
};

type Header = bin.ReadType<typeof Header>;

//-----------------------------------------------------------------------------
//	Compound Document
//-----------------------------------------------------------------------------

class MasterSectors implements Sectors {
	sectors: 	Uint8Array[] = [];
	dirty		= new Set<number>();

	constructor(public shift: number, private backing: Backing) {}

	async sector(id: number) {
		if (!this.sectors[id])
			this.sectors[id] = await this.backing.readAt(512 + (id << this.shift), 1 << this.shift);
		return this.sectors[id];
	}

	async dirty_sector(id: number) {
		this.dirty.add(id);
		return this.sector(id);
	}

	async writeHeader(data: Uint8Array) {
		await this.backing.writeAt(0, data);
	}

	async flush() {
		for (const i of this.dirty.keys())
			await this.backing.writeAt(512 + (i << this.shift), this.sectors[i]);
		this.dirty.clear();
	}
}

class Master {
	sectors:	MasterSectors;
	fat!: FAT;
	fat_chain:	number[] = [];
	difat_chain: number[] = [];

	constructor(public header: Header, backing: Backing) {
		this.sectors = new MasterSectors(this.header.sector_shift, backing);
	}

	async load() {
		const 	num_fat		= this.header.num_fat;
		
		this.fat_chain	= Array.from(this.header.difat.subarray(0, num_fat));

		// read difat chain
		const	sat_per_difat = (1 << (this.header.sector_shift - 2)) - 1;
		let 	next	= this.header.first_difat;
		for (let i = 0; i < this.header.num_difat; i++) {
			this.difat_chain.push(next);
			const difat	= bin.utils.as32(await this.sectors.sector(next));
			next 		= difat[sat_per_difat];
			this.fat_chain.push(...Array.from(difat.subarray(0, Math.min(sat_per_difat, num_fat - this.fat_chain.length))));
		}

		this.fat = new FAT(
			bin.utils.as32s(await read_chain_alloc(this.sectors, this.fat_chain)),
			this.header.sector_shift - 2,
			this.sectors
		);
	}

	async flush(dirty_header = false) {
		const 	shift	= this.header.sector_shift;

		// add new fat sectors if needed
		const num_fat		= shiftCeil(this.fat.fat.length, shift - 2);
		if (num_fat > this.header.num_fat) {
			for (let i = this.header.num_fat; i < num_fat; i++)
				this.fat_chain.push(this.fat.alloc(SecID.SAT));

			this.header.num_fat	= num_fat;
			dirty_header		= true;

			// update first 109 difat sectors to header
			this.header.difat.set(this.fat_chain.slice(0, Math.min(this.fat_chain.length, 109)), 0);

			// add new difat sectors if needed
			const sat_per_difat	= (1 << (shift - 2)) - 1;
			const num_difat		= Math.ceil(Math.max(num_fat - 109, 0) / sat_per_difat);
			
			// Allocate and chain as many new DIFAT sectors as needed
			for (let i = this.header.num_difat; i < num_difat; i++)
				this.difat_chain[i] = this.fat.alloc(SecID.MSAT);

			for (let i = Math.max(this.header.num_difat - 1, 0); i < num_difat; i++) {
				const p = 109 + i * sat_per_difat;
				const difat = bin.utils.as32s(await this.fat.dirty_sector(this.difat_chain[i]));
				if (difat) {
					difat.set(this.fat_chain.slice(p, p + sat_per_difat));
					difat[sat_per_difat] = this.difat_chain[i + 1] ?? SecID.ENDOFCHAIN;
				}
			};

			this.header.first_difat = this.difat_chain[0] ?? SecID.ENDOFCHAIN;
			this.header.num_difat	= num_difat;
		}

		await this.fat.flush(this.fat, this.fat_chain);

		if (dirty_header || this.sectors.dirty.size) {
			if (dirty_header) {
				const header_buf = new Uint8Array(512);
				const header_stream = new bin.stream(header_buf);
				header_stream.write(Header, this.header);//.write(header_stream);
				await this.sectors.writeHeader(header_buf);
			}
			await this.sectors.flush();
		}
	}
}

//-----------------------------------------------------------------------------
//	Compound Document Directories
//-----------------------------------------------------------------------------

export const TYPE = {
	Empty:			0,
	UserStorage:	1,
	UserStream:		2,
	LockBytes:		3,
	Property:		4,
	RootStorage:	5,
} as const;

type TYPE = typeof TYPE[keyof typeof TYPE];

const RED = 0, BLACK = 1;
type COLOUR = 0 | 1;

function compare(a: any, b: any) {
	return a < b ? -1 : a > b ? 1 : 0;
}

function cmpName(a: string, b: string) {
	return compare(a.length, b.length) || compare(a.toUpperCase(), b.toUpperCase());
}

const DirEntrySpec = {
	name:			bin.String(32, 'utf16le'),
	name_size:		bin.UINT16_LE,
	type:			bin.as(bin.UINT8, x => x as TYPE),
	colour:			bin.as(bin.UINT8, x => x as COLOUR),
	left:			bin.INT32_LE,
	right:			bin.INT32_LE,
	root:			bin.INT32_LE,
	guid:			bin.Buffer(16),
	flags:			bin.UINT32_LE,
	creation:		bin.UINT64_LE,
	modification:	bin.UINT64_LE,
	sec_id:			bin.INT32_LE,
	size:			bin.UINT32_LE,
	unused:			bin.UINT32_LE
};

function Class<T>() {
	return class Class {
		constructor(contents: T) {
			return Object.assign(this, contents);
		}
	} as new(contents: T) => T;
}

export class DirEntry extends Class<bin.ReadType<typeof DirEntrySpec>>() {
	dir?: Directory;
	constructor(public reader: Reader, contents: bin.ReadType<typeof DirEntrySpec>) {
		super(contents);
		this.name = this.name.substring(0, this.name_size / 2 - 1);
	}
	static reader(reader: Reader) {
		return {
			get: (s: bin._stream) => {
				const entry = bin.read(s, DirEntrySpec);
				return new DirEntryTypes[entry.type](reader, entry);
			},
			put: (s: bin._stream, entry: DirEntry) => {
				bin.write(s, DirEntrySpec, entry);
			}
		};
	}
	is<T extends TYPE>(type: T): this is InstanceType<typeof DirEntryTypes[T]> {
		return this.type == type;
	}
	is_directory(): this is Directory	{ return this.is(TYPE.UserStorage); }
	is_data():		this is Stream		{ return this.is(TYPE.UserStream); }

	rename(name: string) {
		if (this.dir) {
			this.reader.rbRemove(this.dir, this);
			this.name		= name;
			this.name_size	= name.length * 2 + 2;
			this.dir.root	= this.reader.rbInsert(this.dir.root, this.reader.addEntry(this));
		}
	}
	remove() {
		if (this.is_directory()) {
			for (const e of this.entries())
				e.remove();
		}
		if (this.dir)
			this.reader.rbRemove(this.dir, this);
	}
}

export class Directory extends DirEntry {
	find(name: string): DirEntry|undefined {
		const [index, _] = this.reader.rbFind(this.root, name);
		if (index === -1)
			return undefined;
		const entry = this.reader.entries[index];
		entry.dir = this;
		return entry;
	}
	*entries(): Generator<DirEntry> {
		const entries = this.reader.entries;
		const stack: number[] = [];
		let i = this.root;

		while (i != -1 || stack.length) {
			while (i != -1) {
				stack.push(i);
				i = entries[i].left;
			}

			i = stack.pop()!;
			const e = entries[i];
			e.dir = this;
			yield e;

			i = e.right;
		}
	}
	private _addEntry(name: string, type: TYPE) {
		const e = makeEntry(this.reader, name, type);
		e.dir = this;
		this.root = this.reader.rbInsert(this.root, this.reader.addEntry(e));
		return e;
	}
	addEntry<T extends TYPE>(name: string, type: T) {
		return this._addEntry(name, type) as InstanceType<typeof DirEntryTypes[T]>;
	}
	addStream(name: string, data: Uint8Array) {
		return this.reader.write(this._addEntry(name, TYPE.UserStream), data);
	}
}

export class Stream extends DirEntry {
	read() {
		return this.reader.read(this);
	}
	write(data: Uint8Array) {
		return this.reader.write(this, data);
	}
}

const DirEntryTypes = {
    [TYPE.Empty]:       DirEntry,
    [TYPE.UserStorage]: Directory,
    [TYPE.UserStream]:  Stream,
    [TYPE.LockBytes]:   DirEntry,
    [TYPE.Property]:    DirEntry,
    [TYPE.RootStorage]: Directory,
} as const;

function makeEntry<T extends TYPE>(reader: Reader, name: string, type: T) {
	return new DirEntryTypes[type](reader, {
		name:		name,
		name_size:	name.length * 2 + 2,
		type,
		colour: 	1, // BLACK
		left: 		-1,
		right: 		-1,
		root: 		-1,
		guid:		new Uint8Array(16),
		flags:		0,
		creation: 	0n,
		modification: 0n,
		size: 		0,
		sec_id: 	SecID.ENDOFCHAIN,
		unused:		0
	}) as InstanceType<typeof DirEntryTypes[T]>;
}

//-----------------------------------------------------------------------------
//	Compound Document Reader/Writer
//-----------------------------------------------------------------------------

export class Reader extends Master {
	mini_fat!:	FAT;
	entries:	DirEntry[]	= [];
	dir_chain:	number[]	= [];
	mini_chain:	number[]	= [];
	dir_free 	= -1;
	pending		= Promise.resolve();

	static async load(backing: Backing): Promise<Reader> {
		const buffer	= await backing.readAt(0, 512);
		let h : Header;
		try {
			//h = new Header(new bin.stream(buffer));
			h = new bin.stream(buffer).read(Header);
		} catch (_e) {
			h = {
				id:					new Uint8Array(16),
				revision:			0x003E,
				version:			3,
				byteorder:			0xFFFE,
				sector_shift:		9,
				mini_shift:			6,
				num_directory:		0,
				num_fat:			0,
				first_directory:	SecID.ENDOFCHAIN,
				mini_cutoff:		4096,
				first_mini:			SecID.ENDOFCHAIN,
				num_mini:			0,
				first_difat:		SecID.ENDOFCHAIN,
				num_difat:			0,
				difat:				(new Int32Array(109)).fill(SecID.FREE),
			};
		}
		const me = new this(h, backing);
		await me.load();
		return me;
	}

	async load() {
		await super.load();
		this.dir_chain	= this.fat.get_chain(this.header.first_directory);
		const dir_buff	= await this.fat.read_chain_alloc(this.dir_chain);
		this.entries	= bin.readn(new bin.stream(dir_buff), DirEntry.reader(this), dir_buff.length / 128);

		if (this.entries.length > 0) {
			// make chain of free entries
			for (let i = 0; i < this.entries.length; i++) {
				const entry = this.entries[i];
				if (entry.type === TYPE.Empty) {
					entry.right = this.dir_free;
					this.dir_free = i;
				}
			}
		} else {
			this.entries.push(makeEntry(this, 'Root Entry', TYPE.RootStorage));
			await this.updateIndex(0);
		}

		this.mini_chain = this.fat.get_chain(this.entries[0].sec_id);
		this.mini_fat	= new FAT(
			bin.utils.as32s(await this.fat.read_chain_alloc(this.fat.get_chain(this.header.first_mini))),
			this.header.sector_shift - 2, {
				shift: this.header.mini_shift,
				sector:			async (id: number) => (await this.fat.chain_part(this.mini_chain, id << this.header.mini_shift))!,
				dirty_sector:	async (id: number) => (await this.fat.dirty_chain_part(this.mini_chain, id << this.header.mini_shift))!
			}
		);
	}

	get root() {
		return this.entries[0] as Directory;
	}

	async updateIndex(index: number) {
		return this.pending = this.pending.then(async () => {
			const dest = await this.fat.dirty_chain_part(this.dir_chain, index * 128);
			DirEntry.reader(this).put(new bin.stream(dest!), this.entries[index]);
		});
	}
	async clearIndex(index: number) {
		this.entries[index] = makeEntry(this, '', TYPE.Empty);
		return this.updateIndex(index).then(() => {
			this.entries[index].right = this.dir_free;
			this.dir_free = index;
		});
	}
	addEntry(entry: DirEntry) {
		let index = this.dir_free;
		if (index < 0)
			index = this.entries.length;
		else
			this.dir_free = this.entries[index].right;
		this.entries[index] = entry;
		return index;
	}

	rbFind(root: number, name: string) {
		let parent	= -1;
		let cur		= root;
		for (let cmp; cur !== -1 && (cmp = cmpName(name, this.entries[cur].name)); cur = cmp < 0 ? this.entries[cur].left : this.entries[cur].right)
			parent	= cur;
		return [cur, parent] as const;
	}

	rbInsert(root: number, index: number) {
		const name = this.entries[index].name;
		const recurse = (idx: number): number => {
			if (idx === -1)
				return index;

			const n = this.entries[idx];
			if (cmpName(name, n.name) < 0)
				n.left = recurse(n.left);
			else
				n.right = recurse(n.right);

			const x = this.entries[n.left];
			const y = this.entries[n.right];

			// Fix right-leaning red links
			if (y?.colour === RED && (!x || x.colour === BLACK)) {
				//rotate_left
				[idx, n.right, y.left, y.colour, n.colour] = [n.right, y.left, idx, n.colour, RED];
				this.updateIndex(idx);
				this.updateIndex(n.right);
			}
			// Fix two reds in a row
			if (x?.colour === RED && this.entries[x.left]?.colour === RED) {
				//rotate_right
				[idx, n.left, x.right, x.colour, n.colour] = [n.left, x.right, idx, n.colour, RED];
				this.updateIndex(idx);
				this.updateIndex(n.left);
			}
			// Split 4-nodes
			if (this.entries[n.left]?.colour === RED && this.entries[n.right]?.colour === RED) {
				//flip_colors
				n.colour = RED;
				this.entries[n.left].colour = BLACK;
				this.entries[n.right].colour = BLACK;
				this.updateIndex(n.left);
				this.updateIndex(n.right);
			}

			return idx;
		};
		return recurse(root);
	}

	rbRemove(root: DirEntry, entry: DirEntry) {
		const name	= entry.name;
		const [idx, parent] = this.rbFind(root.root, name);
		if (this.entries[idx] !== entry)
			return; // not found

		// leaf
		if (entry.left < 0 && entry.right < 0) {
			if (parent < 0) {
				root.root = -1;
			} else {
				if (this.entries[parent].left === idx)
					this.entries[parent].left = -1;
				else
					this.entries[parent].right = -1;
				this.updateIndex(parent);
			}
			this.clearIndex(idx);

		// single child: move child into target slot and clear child
		} else if (entry.left < 0 || entry.right < 0) {
			const src = entry.left < 0 ? entry.right : entry.left;
			this.entries[idx] = this.entries[src];
			this.updateIndex(idx);
			this.clearIndex(src);

		} else {
			// two children: find successor (leftmost of right subtree)
			let cur = idx;
			let succ = entry.right;
			while (this.entries[succ].left !== -1) {
				cur		= succ;
				succ	= this.entries[succ].left;
			}
			const succRight = this.entries[succ].right;
			// move successor into target
			this.entries[idx] = this.entries[succ];
			this.updateIndex(idx);
			
			// fix parent of successor
			if (cur === idx)
				this.entries[cur].right = succRight;
			else
				this.entries[cur].left = succRight;
			this.updateIndex(cur);
			
			// clear successor slot
			this.clearIndex(succ);
		}
	}

	find(name: string, create = false) {
		const parts = name.split('/').filter(p => p);

		let dir = this.root;
		for (let i = 0; i < parts.length - 1; i++) {
			const entry = dir.find(parts[i]);
			if (!entry && create)
				dir = dir.addEntry(parts[i], TYPE.UserStorage);
			else if (entry && entry.is_directory())
				dir = entry;
			else
				return undefined;
		}
		name = parts.at(-1)!;
		const entry = dir.find(name);
		return !entry && create ? dir.addEntry(name, TYPE.UserStream) : entry;
	}

	private use_mini(size: number) {
		return size < this.header.mini_cutoff;
	}
	private get_fat(mini: boolean) {
		return mini ? this.mini_fat : this.fat;
	}

	async read(entry: DirEntry) {
		const mini	= this.use_mini(entry.size);
		const fat	= this.get_fat(mini);
		const data	= new Uint8Array(entry.size);
		return this.pending.then(() => fat.read_chain(fat.get_chain(entry.sec_id), data)).then(() => data);
	}

	async write(entry: DirEntry, data: Uint8Array) {
		const mini1	= this.use_mini(entry.size);
		const fat1	= this.get_fat(mini1);
		const chain = fat1.get_chain(entry.sec_id);

		const mini2	= this.use_mini(data.length);
		const fat2	= this.get_fat(mini2);

		if (mini1 != mini2)
			fat1.resize_chain(chain, 0);
		fat2.resize_chain(chain, data.length);

		entry.size		= data.length;
		entry.sec_id	= chain[0];

		this.updateIndex(this.entries.indexOf(entry));

		return this.pending = this.pending.then(() => fat2.write_chain(chain, data));
	}

	async flush() {
		let dirty_header = false;

		// update directory chain
		if (this.header.first_directory != this.dir_chain[0] || this.header.num_directory != this.dir_chain.length) {
			this.header.first_directory = this.dir_chain[0];
			this.header.num_directory	= this.dir_chain.length;
			dirty_header = true;
		}

		// update mini data chain
		const root		= this.entries[0];
		const mini_size = this.mini_chain.length << this.mini_fat.sectors.shift;
		if (root.size != mini_size || root.sec_id != this.mini_chain[0]) {
			root.sec_id	= this.mini_chain[0];
			root.size	= mini_size;
			this.updateIndex(0);
		}
		await this.pending;

		// update mini fat
		const shift			= this.header.sector_shift;
		const num_mini		= shiftCeil(this.mini_fat.fat.length, shift - 2);
		const mini_chain	= this.fat.get_chain(this.header.first_mini);
		if (num_mini > this.header.num_mini) {
			this.fat.resize_chain(mini_chain, num_mini << shift);
			this.header.first_mini	= mini_chain[0];
			this.header.num_mini	= num_mini;
			dirty_header			= true;
		}

		await this.mini_fat.flush(this.fat, mini_chain);

		return super.flush(dirty_header);
	}
}
