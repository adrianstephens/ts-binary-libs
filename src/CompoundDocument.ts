import * as bin from '@isopodlabs/binary';

function shiftRound(value: number, shift: number) {
	return (value + (1 << shift) - 1) >> shift;
}

//-----------------------------------------------------------------------------
//	Caching SectorStore with optional backing store
//-----------------------------------------------------------------------------

export interface Backing {
	readAt(offset: number, data: Uint8Array): Promise<number>;
	writeAt(offset: number, data: Uint8Array): Promise<void>;
}

export class Sectors {
	sectors: 	Uint8Array[] = [];
	dirty		= new Set<number>();

	constructor(
		public shift: number,
		private offset = 512,
		private backing?: Backing
	) {}

	size() {
		return this.sectors.length << this.shift;
	}

	async sector(id: number) {
		if (!this.sectors[id]) {
			this.sectors[id] = new Uint8Array(1 << this.shift);
			await this.backing?.readAt(this.offset + (id << this.shift), this.sectors[id]);
		}
		return this.sectors[id];
	}

	async dirty_sector(id: number) {
		this.dirty.add(id);
		return this.sector(id);
	}

	async writeHeader(data: Uint8Array) {
		await this.backing?.writeAt(0, data);
	}

	async flush() {
		for (const i of this.dirty.keys()) {
			const offset = this.offset + (i << this.shift);
			await this.backing?.writeAt(offset, this.sectors[i]);
		}
		this.dirty.clear();
	}

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

	constructor(public fat: bin.utils.TypedArray<number>, public fat_shift: number, public data: Sectors) {
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
				const size1	= shiftRound(size0 + 1, this.fat_shift) << this.fat_shift;
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
		const size = shiftRound(data_size, this.data.shift);
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

	clear_dirty() {
		this.dirty.clear();
	}

	async sector(id: number) {
		if (id >= this.fat.length || this.fat[id] == SecID.FREE)
			return null;
		return this.data.sector(id);
	}
	async chain_part(chain: number[], offset: number) {
		const index = offset >> this.data.shift;
		if (index >= chain.length)
			this.resize_chain(chain, offset + 1);
		return (await this.sector(chain[index]))?.subarray(offset & ((1 << this.data.shift) - 1));
	}

	async dirty_sector(id: number) {
		if (id >= this.fat.length || this.fat[id] == SecID.FREE)
			return null;
		return this.data.dirty_sector(id);
	}
	async dirty_chain_part(chain: number[], offset: number) {
		const index = offset >> this.data.shift;
		if (index >= chain.length)
			this.resize_chain(chain, offset + 1);
		return (await this.dirty_sector(chain[index]))?.subarray(offset & ((1 << this.data.shift) - 1));
	}
	
	async read_chain(chain: number[], dest: Uint8Array) {
		for (const i in chain) {
			const offset	= +i << this.data.shift;
			if (offset >= dest.length)
				break;
			const sector = await this.sector(chain[i]);
			if (sector)
				dest.set(sector.subarray(0, dest.length - offset), offset);
		}
	}

	async write_chain(chain: number[], source: Uint8Array) {
		for (const i in chain) {
			const offset	= +i << this.data.shift;
			if (offset >= source.length)
				break;
			const sector = await this.dirty_sector(chain[i]);
			if (sector)
				sector.set(source.subarray(offset, offset + (1 << this.data.shift)), 0);
		}
	}

	async write(id: number, source: Uint8Array) {
		const chain = this.get_chain(id);
		this.resize_chain(chain, source.length);
		await this.write_chain(chain, source);
		return chain[0];
	}

}

//-----------------------------------------------------------------------------
//	Compound Document Header
//-----------------------------------------------------------------------------

export class Header extends bin.Class({
	magic:				bin.Expect(bin.UINT64_BE, 0xD0CF11E0A1B11AE1n),
	id:					bin.Buffer(16),
	revision:			bin.UINT16_LE,
	version:			bin.UINT16_LE,
	byteorder:			bin.UINT16_LE,
	sector_shift:		bin.UINT16_LE,
	mini_shift:			bin.UINT16_LE,
	unused1:			bin.SkipType(6),
	num_directory:		bin.UINT32_LE,
	num_fat:			bin.UINT32_LE,
	first_directory:	bin.INT32_LE,
	transaction:		bin.Expect(bin.UINT32_LE, 0),
	mini_cutoff:		bin.UINT32_LE,
	first_mini:			bin.INT32_LE,
	num_mini:			bin.UINT32_LE,
	first_difat:		bin.INT32_LE,
	num_difat:			bin.UINT32_LE,
	difat:				bin.Buffer(109, Int32Array),
}) {
	sector_size()				{ return 1 << this.sector_shift; }
	use_mini(size: number)		{ return size < this.mini_cutoff; }
}

//-----------------------------------------------------------------------------
//	Compound Document
//-----------------------------------------------------------------------------

class Master {
	static async load<T extends Master>(this: new (...args: any[]) => T, header: Header, sectors: Sectors) {
		const 	shift	= header.sector_shift;
		const	sat_per_difat = (1 << (shift - 2)) - 1;

		const 	num_fat	= header.num_fat;
		const	fat_chain = Array.from(header.difat.subarray(0, num_fat));
		const	difat_chain: number[] = [];

		let 	next	= header.first_difat;
		for (let i = 0; i < header.num_difat; i++) {
			difat_chain.push(next);
			const data	= bin.utils.as32(await sectors.sector(next));
			next 		= data[sat_per_difat];
			fat_chain.push(...Array.from(data.subarray(0, Math.min(sat_per_difat, num_fat - fat_chain.length))));
		}

		const fat		= new FAT(
			bin.utils.as32s(await read_chain_alloc(sectors, fat_chain)),
			shift - 2, sectors
		);
		const mini_fat	= new FAT(
			bin.utils.as32s(await read_chain_alloc(sectors, fat.get_chain(header.first_mini))),
			shift - 2, new Sectors(header.mini_shift, 0)
		);

		return new this(header, fat, mini_fat, fat_chain, difat_chain);
	}

	constructor(public header: Header, public fat: FAT, public mini_fat: FAT, public fat_chain: number[], public difat_chain: number[]) {
	}

	get_fat(mini: boolean) {
		return mini ? this.mini_fat : this.fat;
	}

	async flush(dirty_header = false) {
		const 	shift	= this.header.sector_shift;

		// update mini fat
		const num_mini		= shiftRound(this.mini_fat.fat.length, shift - 2);
		const mini_chain	= this.fat.get_chain(this.header.first_mini);
		if (num_mini > this.header.num_mini) {
			this.fat.resize_chain(mini_chain, num_mini << shift);
			this.fat.write_chain(mini_chain, bin.utils.as8(this.mini_fat.fat));

			this.header.first_mini	= mini_chain[0];
			this.header.num_mini	= num_mini;
			dirty_header		= true;
		}

		// add new fat sectors if needed
		const num_fat		= shiftRound(this.fat.fat.length, shift - 2);
		if (num_fat > this.header.num_fat) {
			for (let i = this.header.num_fat; i < num_fat; i++) {
				const id = this.fat.alloc(SecID.SAT);
				this.fat_chain.push(id);
				const sector = await this.fat.dirty_sector(id);
				sector?.set(bin.utils.as8(this.fat.fat).subarray(i << shift, (i + 1) << shift));
			}

			this.header.num_fat	= num_fat;
			dirty_header		= true;

			// update first 109 difat sectors to header
			this.header.difat.set(this.fat_chain.slice(0, Math.min(this.fat_chain.length, 109)), 0);

			// add new difat sectors if needed
			const sat_per_difat	= (1 << (shift - 2)) - 1;
			const num_difat		= Math.ceil(Math.max(num_fat - 109, 0) / sat_per_difat);

			if (num_difat > this.header.num_difat) {
				const id = this.fat.alloc(SecID.MSAT);
				this.difat_chain.push(id);
				if (this.difat_chain.length > 1) {
					const sector = bin.utils.as32s((await this.fat.dirty_sector(this.difat_chain.at(-2)!))!);
					sector[sat_per_difat] = id;
				} else {
					this.header.first_difat = id;
				}
				this.header.num_difat	= num_difat;
				dirty_header		= true;

				// update remaining difat sectors
				let 	p		= 109;
				for (let i = 0; i < this.difat_chain.length; i++) {
					const sector = bin.utils.as32s((await this.fat.dirty_sector(this.difat_chain[i]))!);
					sector.set(this.fat_chain.slice(p, p + sat_per_difat));
					sector[sat_per_difat] = this.difat_chain[i + 1] ?? SecID.ENDOFCHAIN;
					p += sat_per_difat;
				}
			}
		}


		const dirty	= this.fat.data.dirty;

		for (const i of this.fat.dirty.keys())
			dirty.add(this.fat_chain[i]);

		for (const i of this.mini_fat.dirty.keys())
			dirty.add(mini_chain[i]);

		if (dirty_header || dirty.size) {
			if (dirty_header) {
				const header_buf = new Uint8Array(512);
				const header_stream = new bin.stream(header_buf);
				this.header.write(header_stream);
				await this.fat.data.writeHeader(header_buf);
			}
			await this.fat.data.flush();
			this.fat.clear_dirty();
			this.mini_fat.clear_dirty();
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

const DirEntrySpec = {
	name:			bin.StringType(32, 'utf16le'),
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
			this.reader.rbInsert(this.dir, this);
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
		let		sp = 0;

		for (let i = this.root;;) {
			const e	= entries[i];
			e.dir = this;

			yield e;

			if (e.right != -1)
				stack[sp++] = e.right;

			i = e.left;
			if (i == -1) {
				if (sp === 0)
					break;
				i = stack[--sp];
			}
		}
	}
	private _addEntry(name: string, type: TYPE) {
		const e = makeEntry(this.reader, name, type);
		e.dir = this;
		this.reader.rbInsert(this, e);
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
	entries:	DirEntry[]	= [];
	chain:		number[]	= [];
	pending	= Promise.resolve();
	free 	= -1;
/*
	static async create(backing: Backing, shift = 9): Promise<Reader> {
		return this.load1(await this.load0(new Header({
			id:					new Uint8Array(16),
			revision:			0x003E,
			version:			3,
			byteorder:			0xFFFE,
			sector_shift:		shift,
			mini_shift:			6,
			unused1:			0 as unknown as void,
			num_directory:		0,
			num_fat:			0,
			first_directory:	SecID.ENDOFCHAIN,
			mini_cutoff:		4096,
			first_mini:			SecID.ENDOFCHAIN,
			num_mini:			0,
			first_difat:		SecID.ENDOFCHAIN,
			num_difat:			0,
			difat:				(new Int32Array(109)).fill(SecID.FREE),
		}), new Sectors(shift, 512, backing)));
	}
*/
	static async loadBacking(backing: Backing): Promise<Reader> {
		const buffer = new Uint8Array(512);
		const read = await backing.readAt(0, buffer);
		const h = read ? new Header(new bin.stream(buffer)) : new Header({
			id:					new Uint8Array(16),
			revision:			0x003E,
			version:			3,
			byteorder:			0xFFFE,
			sector_shift:		9,
			mini_shift:			6,
			unused1:			0 as unknown as void,
			num_directory:		0,
			num_fat:			0,
			first_directory:	SecID.ENDOFCHAIN,
			mini_cutoff:		4096,
			first_mini:			SecID.ENDOFCHAIN,
			num_mini:			0,
			first_difat:		SecID.ENDOFCHAIN,
			num_difat:			0,
			difat:				(new Int32Array(109)).fill(SecID.FREE),
		});
		return this.load1(await this.load(h, new Sectors(h.sector_shift, 512, backing)));
	}

	static async loadBuffer(buffer: Buffer) {
		const h		= new Header(new bin.stream(buffer));
		return this.load1(await this.load(h, new Sectors(
			h.sector_shift, 512, {
				readAt:		async (offset, data) => { const sub = buffer.subarray(offset, offset + data.length); data.set(sub); return sub.length; },
				writeAt:	async (offset, data) => { buffer.set(data, offset); }
			}
		)));
	}

	static async load1(me: Reader) {
		me.chain	= me.fat.get_chain(me.header.first_directory);
		const 	dir_buff	= new Uint8Array(me.chain.length << me.header.sector_shift);
		await me.fat.read_chain(me.chain, dir_buff);
		const 	r2			= new bin.stream(dir_buff);
		me.entries = bin.readn(r2, DirEntry.reader(me), dir_buff.length / 128);

		if (me.entries.length > 0) {
			// make chain of free entries
			for (let i = 0; i < me.entries.length; i++) {
				const entry = me.entries[i];
				if (entry.type === TYPE.Empty) {
					entry.right = me.free;
					me.free = i;
				}
			}

			const root	= me.entries[0];
			const data	= new Uint8Array(root.size);
			await me.fat.read_chain(me.fat.get_chain(root.sec_id), data);
			me.mini_fat.data = new Sectors(
				me.header.mini_shift, 0, {
				readAt: async (offset, dest)	=> { const sub = data.subarray(offset, offset + dest.length); dest.set(sub); return sub.length; },
				writeAt: async (offset, chunk)	=> { data.set(chunk, offset); }
			});

		} else {
			me.entries.push(makeEntry(me, 'Root Entry', TYPE.RootStorage));
			await me.updateIndex(0);
		}
		return me;
	}

	get root() {
		return this.entries[0] as Directory;
	}

	async updateIndex(index: number) {
		return this.pending = this.pending.then(async () => {
			const dest = await this.fat.dirty_chain_part(this.chain, index * 128);
			DirEntry.reader(this).put(new bin.stream(dest!), this.entries[index]);
		});
	}
	async updateEntry(entry: DirEntry) {
		const index = this.entries.indexOf(entry);
		return this.pending = this.pending.then(async () => {
			const dest = await this.fat.dirty_chain_part(this.chain, index * 128);
			DirEntry.reader(this).put(new bin.stream(dest!), entry);
		});
	}
	/*async updateAllEntries() {
		const data = new Uint8Array((this.entries.length) * 128);
		bin.writen(new bin.stream(data), DirEntry.reader(this), this.entries);
		this.fat.resize_chain(this.chain, data.length);
		this.fat.write_chain(this.chain, data);
	}*/
	async clearEntry(index: number) {
		this.entries[index] = makeEntry(this, '', TYPE.Empty);
		return this.updateIndex(index).then(() => {
			this.entries[index].right = this.free;
			this.free = index;
		});
	}
	addEntry(entry: DirEntry) {
		let index = this.free;
		if (index < 0)
			index = this.entries.length;
		else
			this.free = this.entries[index].right;
		this.entries[index] = entry;
		return index;
	}

	rbFind(root: number, name: string) {
		let parent	= -1;
		let cur		= root;
		while (cur !== -1 && name !== this.entries[cur].name) {
			parent	= cur;
			cur		= name < this.entries[cur].name ? this.entries[cur].left : this.entries[cur].right;
		}
		return [cur, parent] as const;
	}

	rbInsert(root: DirEntry, entry: DirEntry) {
		const index = this.addEntry(entry);

		const recurse = (idx: number): number => {
			if (idx === -1)
				return index;

			const n = this.entries[idx];
			if (entry.name < n.name)
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

		entry.colour	= RED;
		root.root		= recurse(root.root);
		//root.colour		= BLACK;
		return index;
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
			this.clearEntry(idx);

		// single child: move child into target slot and clear child
		} else if (entry.left < 0 || entry.right < 0) {
			const src = entry.left < 0 ? entry.right : entry.left;
			this.entries[idx] = this.entries[src];
			this.updateIndex(idx);
			this.clearEntry(src);

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
			this.clearEntry(succ);
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

	async read(entry: DirEntry) {
		const mini	= this.header.use_mini(entry.size);
		const fat	= this.get_fat(mini);
		const data	= new Uint8Array(entry.size);
		return this.pending.then(() => fat.read_chain(fat.get_chain(entry.sec_id), data)).then(() => data);
	}

	async write(entry: DirEntry, data: Uint8Array) {
		const mini1	= this.header.use_mini(entry.size);
		const fat1	= this.get_fat(mini1);
		const chain = fat1.get_chain(entry.sec_id);

		const mini2	= this.header.use_mini(data.length);
		const fat2	= this.get_fat(mini2);

		if (mini1 != mini2)
			fat1.resize_chain(chain, 0);
		fat2.resize_chain(chain, data.length);

		entry.size		= data.length;
		entry.sec_id	= chain[0];
		this.updateEntry(entry);

		return this.pending = this.pending.then(() => fat2.write_chain(chain, data));
	}

	async flush() {
		// update directory chain in header if needed
		let dirty_header = false;
		if (this.header.first_directory != this.chain[0] || this.header.num_directory != this.chain.length) {
			this.header.first_directory = this.chain[0];
			this.header.num_directory = this.chain.length;
			dirty_header = true;
		}

		// update mini data chain
		const root = this.entries[0];
		const mini_extra = this.header.sector_shift - this.header.mini_shift;
		const chain = this.fat.get_chain(root.sec_id);
		for (const i of this.mini_fat.data.dirty) {
			const srce = await this.mini_fat.sector(i);
			const dest = await this.fat.dirty_chain_part(chain, i >> mini_extra);
			dest!.set(srce!);
		}
		this.mini_fat.data.dirty.clear();
		if (root.size != this.mini_fat.data.size() || root.sec_id != chain[0]) {
			root.sec_id	= chain[0];
			root.size	= this.mini_fat.data.size();
			this.updateIndex(0);
		}
		await this.pending;
		return super.flush(dirty_header);
	}
}
