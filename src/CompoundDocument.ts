import * as bin from '@isopodlabs/binary';
import { promises as fs } from 'fs';

function shiftRound(value: number, shift: number) {
	return (value + (1 << shift) - 1) >> shift;
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
	fat:	Int32Array;
	freed:	number[] = [];
	dirty_fat	= new Set<number>();
	dirty_sec	= new Set<number>();

	constructor(size: number, public shift: number, public sectors: Uint8Array) {
		this.fat = new Int32Array(size);
		this.fat.fill(SecID.FREE);  // Mark all as free
	}

	private resize_sectors(size: number) {
		if (size > this.sectors.length) {
			const sectors = new Uint8Array(size);
			sectors.set(this.sectors);
			this.sectors = sectors;
		}
	}

	private free(id: number) {
		this.freed.push(id);
		this.fat[id] = SecID.FREE;
		this.dirty_fat.add(id >> (this.shift - 2));
	}
	alloc(type: number) {
		if (!this.freed.length) {
			for (let i = this.fat.length; i--;) {
				if (this.fat[i] === SecID.FREE)
					this.freed.push(i);
			}
		}
		const	id = this.freed.length ? this.freed.pop()! : this.fat.length;
		if (id >= this.fat.length) {
			// resize fat
			const cap	= this.fat.buffer.byteLength / 4;
			if (id >= cap) {
				const fat	= new Int32Array(Buffer.alloc(Math.max(this.fat.buffer.byteLength * 2, (id + 1) * 4)).buffer, 0, id + 1);
				fat.fill(SecID.FREE, this.fat.length);
				fat.set(this.fat);
				this.fat	= fat;
			} else {
				this.fat	= new Int32Array(this.fat.buffer, 0, id + 1);
			}
		}
		this.fat[id] = type;
		this.dirty_fat.add(id >> (this.shift - 2));
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
		const size = shiftRound(data_size, this.shift);

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

		} else {
			chain.push(SecID.ENDOFCHAIN);
		}
	}

	clear_dirty() {
		this.dirty_fat.clear();
		this.dirty_sec.clear();
	}

	read_chain(chain: number[], dest: Uint8Array) {
		chain.forEach((id, index) => {
			const id2		= id << this.shift;
			const index2	= index << this.shift;
			dest.set(this.sectors.subarray(id2, id2 + Math.min(dest.length - index2)), index2);
		});
	}
	read_chain_alloc(chain: number[]) {
		const dest	= new Uint8Array(chain.length << this.shift);
		this.read_chain(chain, dest);
		return dest;
	}
	read(id: number, dest: Uint8Array) {
		this.read_chain(this.get_chain(id), dest);
	}

	write_chain(chain: number[], source: Uint8Array) {
		const end = (chain.reduce((max, id) => max = Math.max(max, id)) + 1) << this.shift;
		this.resize_sectors(end);

		chain.forEach((id, index) => {
			this.sectors.set(source.subarray(index << this.shift, (index + 1) << this.shift), id  << this.shift);
			this.dirty_sec.add(id);
		});
	}
	dirty_sector(id: number) {
		if (id >= this.fat.length || this.fat[id] == SecID.FREE)
			return null;
		this.dirty_sec.add(id);
		const offset = id << this.shift, end = (id + 1) << this.shift;
		this.resize_sectors(end);
		return this.sectors.subarray(offset, end);
	}
	dirty_chain_part(chain: number[], offset: number) {
		const index = offset >> this.shift;
		if (index >= chain.length)
			this.resize_chain(chain, offset + 1);
		const sector = this.dirty_sector(chain[offset >> this.shift]);
		return sector?.subarray(offset & ((1 << this.shift) - 1));
	}
}

//-----------------------------------------------------------------------------
//	Compound Document Header
//-----------------------------------------------------------------------------

export class Header extends bin.Class({
	magic:			bin.Expect(bin.UINT64_BE, 0xD0CF11E0A1B11AE1n),
	id:				bin.Buffer(16),
	revision:		bin.UINT16_LE,
	version:		bin.UINT16_LE,
	byteorder:		bin.UINT16_LE,
	sector_shift:	bin.UINT16_LE,
	mini_shift:		bin.UINT16_LE,
	unused1:		bin.SkipType(6),
	num_directory:	bin.UINT32_LE,
	num_fat:		bin.UINT32_LE,
	first_directory:bin.INT32_LE,
	transaction:	bin.Expect(bin.UINT32_LE, 0),
	mini_cutoff:	bin.UINT32_LE,
	first_mini:		bin.INT32_LE,
	num_mini:		bin.UINT32_LE,
	first_difat:	bin.INT32_LE,
	num_difat:		bin.UINT32_LE,
	difat:			bin.Buffer(109, Int32Array),
}) {
	sector_size()				{ return 1 << this.sector_shift; }
	use_mini(size: number)		{ return size < this.mini_cutoff; }
//	valid()						{ return this.magic == 0xD0CF11E0A1B11AE1n; }
}

//-----------------------------------------------------------------------------
//	Compound Document Directories
//-----------------------------------------------------------------------------

const TYPE = {
	Empty:			0,
	UserStorage:	1,
	UserStream:		2,
	LockBytes:		3,
	Property:		4,
	RootStorage:	5,
} as const;

// Red-black constants
const RED = 0, BLACK = 1;

export class DirEntry  extends bin.Class({
	name:			bin.StringType(32, 'utf16le'),
	name_size:		bin.UINT16_LE,
	type:			bin.UINT8,
	colour:			bin.UINT8,
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
}) {

	constructor(name: string, type: number);
	constructor(r: bin.stream);
	constructor(arg1: string|bin.stream, type?: number) {
		if (type !== undefined) {
			super({
				name:		arg1 as string,
				name_size:	(arg1 as string).length * 2 + 2,
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
			});
		} else {
			super(arg1 as bin.stream);
		}
		this.name = this.name.substring(0, this.name_size / 2 - 1);
	}
	load(fat: FAT) {
		const data	= new Uint8Array(this.size);
		fat.read_chain(fat.get_chain(this.sec_id), data);
		return data;
	}
	is_directory() {
		return this.type == TYPE.UserStorage;
	}
}

//-----------------------------------------------------------------------------
//	Compound Document
//-----------------------------------------------------------------------------

class Master {
	fat: 			FAT;
	mini_fat: 		FAT;
	mini_chain:		number[];	//chain for mini stream data
	difat:			Int32Array;
	difat_chain:	number[] = [];
	dirty_header	= false;

	static create<T extends Master>(this: new (...args: any[]) => T): T {
		return new this(new Uint8Array(0), new Header({
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
		}));
	}

	constructor(sectors: Uint8Array, public header: Header) {
		const 	shift	= header.sector_shift;
		const	sat_per_difat = (1 << (shift - 2)) - 1;

		const 	num_fat	= header.num_fat;
		this.difat	= new Int32Array(header.num_fat);
		this.difat.set(header.difat.subarray(0, num_fat), 0);

		let 	next	= header.first_difat;
		for (let i = 0; i < this.header.num_difat; i++) {
			this.difat_chain.push(next);
			const data	= sectors.subarray(next << shift, (next + 1) << shift);
			next 		= new DataView(data.buffer).getUint32(sat_per_difat * 4, true);
			const offset = 109 + i * sat_per_difat;
			this.difat.set(new Int32Array(data.buffer, data.byteOffset, num_fat - offset), offset);
		}

		this.fat	= new FAT(num_fat << (shift - 2), shift, sectors);

		this.difat.forEach((id, index) => {
			const data	= sectors.subarray(id << shift, (id + 1) << shift);
			bin.utils.to8(this.fat.fat).set(data, index << shift);
		});


		if (header.first_directory !== SecID.ENDOFCHAIN) {
			const	root	= new DirEntry(new bin.stream(sectors.subarray(header.first_directory << shift)));
			this.mini_chain = this.fat.get_chain(root.sec_id);
		} else {
			this.mini_chain = [];
			this.fat.resize_chain(this.mini_chain, header.num_mini << shift);
		}
	
		this.mini_fat	= new FAT(header.num_mini << (shift - 2), header.mini_shift, this.fat.read_chain_alloc(this.mini_chain));
		this.fat.read(header.first_mini, bin.utils.to8(this.mini_fat.fat));

	}

	get_fat(mini: boolean) {
		return mini ? this.mini_fat : this.fat;
	}

	async flush(filename: string) {
		const 	shift	= this.header.sector_shift;

		// add new fat sectors if needed
		const num_fat		= shiftRound(this.fat.fat.length, shift - 2);
		if (num_fat > this.header.num_fat) {
			const difat = new Int32Array(num_fat);
			difat.set(this.difat);
			for (let i = this.header.num_fat; i < num_fat; i++) {
				difat[i] = this.fat.alloc(SecID.SAT);
				const sector = this.fat.dirty_sector(difat[i]);
				sector?.set(bin.utils.to8(this.fat.fat).subarray(i << shift, (i + 1) << shift));
			}

			this.difat			= difat;
			this.header.num_fat	= num_fat;
			this.dirty_header	= true;

			// update first 109 difat sectors to header
			this.header.difat.set(this.difat.subarray(0, Math.min(this.difat.length, 109)), 0);

			// add new difat sectors if needed
			const sat_per_difat	= (1 << (shift - 2)) - 1;
			const num_difat		= Math.ceil(Math.max(num_fat - 109, 0) / sat_per_difat);

			if (num_difat > this.header.num_difat) {
				const id = this.fat.alloc(SecID.MSAT);
				this.difat_chain.push(id);
				if (this.difat_chain.length > 1) {
					const sector = this.fat.dirty_sector(this.difat_chain.at(-2)!);
					new DataView(sector!.buffer).setUint32(sat_per_difat, id, true);
				} else {
					this.header.first_difat = id;
				}
				this.header.num_difat	= num_difat;
				this.dirty_header		= true;

				// update remaining difat sectors
				let 	p		= 109;
				for (let i = 0; i < this.difat_chain.length; i++) {
					const sector = this.fat.dirty_sector(this.difat_chain[i])!;
					new Int32Array(sector.buffer, sector.byteOffset, sat_per_difat).set(this.difat.subarray(p, p + sat_per_difat));
					new DataView(sector.buffer).setUint32(sat_per_difat * 4, this.difat_chain[i + 1] ?? SecID.ENDOFCHAIN, true);
					p += sat_per_difat;
				}
			}
		}

		const dirty	= new Set(this.fat.dirty_sec);

		for (const i of this.fat.dirty_fat.keys())
			dirty.add(this.difat[i]);

		const mini_extra = shift - this.header.mini_shift;
		for (const i of this.mini_fat.dirty_sec)
			dirty.add(this.mini_chain[i >> mini_extra]);

		const mini_chain = this.fat.get_chain(this.header.first_mini);
		for (const i of this.mini_fat.dirty_fat.keys())
			dirty.add(mini_chain[i >> mini_extra]);

		if (!this.dirty_header && !dirty.size)
			return;

		let fileHandle: fs.FileHandle|undefined;
		try {
			fileHandle = await fs.open(filename, fs.constants.O_RDWR | fs.constants.O_CREAT);

			if (this.dirty_header) {
				const header_buf = new Uint8Array(512);
				const header_stream = new bin.stream(header_buf);
				this.header.write(header_stream);
				await fileHandle.write(header_buf);
			}

			const	ss	= 1 << shift;
			for (const i of dirty.keys()) {
				const position = i << shift;
				await fileHandle.write(this.fat.sectors, position, ss, position + ss);
			}
			this.fat.clear_dirty();
			this.mini_fat.clear_dirty();

		} catch (error) {
			console.error('An error occurred:', error);
		} finally {
			if (fileHandle)
				await fileHandle.close();
		}
	}
}

//-----------------------------------------------------------------------------
//	Compound Document Reader/Writer
//-----------------------------------------------------------------------------

interface DirEntryRef {
	index:	number;
}

export class Reader extends Master {
	entries:	DirEntry[] = [];
	chain:		number[];
	root:		DirEntry;

	//static create() {
	//	const r = this._create();
	//	return r;
	//}

	static async load(filename: string) {
		return fs.readFile(filename).then(bytes => this.loadBuffer(bytes)).catch(() => undefined);
	}
	static loadBuffer(buffer: Buffer) {
		try {
			const h = new Header(new bin.stream(buffer));
			return new Reader(buffer.subarray(h.sector_size()), h);
		} catch {
			return undefined;
		}
	}

	constructor(sectors: Uint8Array, header: Header) {
		super(sectors, header);

		this.chain	= this.fat.get_chain(header.first_directory);
		const 	dir_buff 	= this.fat.read_chain_alloc(this.chain);
		const 	r2			= new bin.stream(dir_buff);
		for (let i = 0; i < dir_buff.length / 128; i++)
			this.entries[i] = new DirEntry(r2.seek(i * 128));
		
		if (this.entries.length > 0) {
			this.root = this.entries[0];
		} else {
			this.root = new DirEntry('Root Entry', TYPE.RootStorage);
			this.entries.push(this.root);
			this.root.sec_id	= this.mini_chain[0];
			this.root.size 		= this.header.num_mini << this.header.mini_shift;
			this.update_entry(0);
		}
	}

	*list(root: DirEntry): Generator<DirEntry> {
		const stack: number[] = [];
		let		sp = 0;

		for (let i = root.root;;) {
			const e	= this.entries[i];

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

	private rb_find(root: DirEntry, name: string): number {
		const stack: number[] = [];
		let		sp = 0;

		for (let i = root.root;;) {
			const e	= this.entries[i];
			if (e.name == name)
				return i;

			if (e.type == TYPE.RootStorage)
				stack[sp++] = e.root;

			if (e.right != -1)
				stack[sp++] = e.right;

			i = e.left;
			if (i == -1) {
				if (sp === 0)
					return -1;
				i = stack[--sp];
			}
		}
	}

	// Minimal BST insert for DirEntry array (not balanced, all BLACK)
	private unbalanced_insert(root: DirEntry, entry: DirEntry) {
		const index = this.entries.length;
		this.entries.push(entry);
		for (let i = root.root;;) {
			const parent = this.entries[i];
			if (entry.name < parent.name) {
				if (parent.left === -1) {
					parent.left = index;
					break;
				}
				i = parent.left;
			} else {
				if (parent.right === -1) {
					parent.right = index;
					break;
				}
				i = parent.right;
			}
		}
	}

	// Insert recursively, returns new subtree root index
	private rb_insert(root: DirEntry, entry: DirEntry) {
		const index = this.entries.length;
		this.entries.push(entry);

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
			}
			// Fix two reds in a row
			if (x?.colour === RED && this.entries[x.left]?.colour === RED) {
				//rotate_right
				[idx, n.left, x.right, x.colour, n.colour] = [n.left, x.right, idx, n.colour, RED];
			}
			// Split 4-nodes
			if (this.entries[n.left]?.colour === RED && this.entries[n.right]?.colour === RED) {
				//flip_colors
				n.colour = RED;
				this.entries[n.left].colour = BLACK;
				this.entries[n.right].colour = BLACK;
			}

			return idx;
		};

		entry.colour		= RED;
		root.root		= recurse(root.root);
		root.colour	= BLACK;
	}

	add_entry(root: DirEntry, name: string, type: number): number {
		const index = this.entries.length;
		const entry = new DirEntry(name, type);
		this.rb_insert(root, entry);
		return index;
	}

	private update_entry(index: number) {
		const dest = this.fat.dirty_chain_part(this.chain, index * 128)!;
		this.entries[index].write(new bin.stream(dest));
	}

	find(name: string): DirEntryRef|undefined {
		const parts = name.split('/').filter(p => p);

		let dir = this.root;
		for (let i = 0; i < parts.length - 1; i++) {
			const index = this.rb_find(dir, parts[i]);
			if (index < 0)
				return undefined;

			const entry = this.entries[index];
			if (!entry.is_directory())
				return undefined;

			dir = entry;
		}
		const index = this.rb_find(dir, parts[parts.length - 1]);
		return index >= 0 ? { index } : undefined;
	}

	read(ref: DirEntryRef) {
		const entry = this.entries[ref.index];
		const mini	= this.header.use_mini(entry.size);
		const fat	= this.get_fat(mini);
		return entry.load(fat);
	}

	write(ref: DirEntryRef, data: Uint8Array) {
		const entry = this.entries[ref.index];
		const mini1	= this.header.use_mini(entry.size);
		const fat1	= this.get_fat(mini1);
		const chain = fat1.get_chain(entry.sec_id);

		const mini2	= this.header.use_mini(data.length);
		const fat2	= this.get_fat(mini2);

		if (data.length != entry.size) {
			if (mini1 != mini2)
				fat1.resize_chain(chain, 0);
			fat2.resize_chain(chain, data.length);

			entry.size		= data.length;
			entry.sec_id	= chain[0];
			this.update_entry(ref.index);
		}

		fat2.write_chain(chain, data);
	}

	async flush(filename: string) {
		if (this.header.first_directory != this.chain[0] || this.header.num_directory != this.chain.length) {
			this.dirty_header = true;
			this.header.first_directory = this.chain[0];
			this.header.num_directory = this.chain.length;
		}

		return super.flush(filename);
	}
}
