import * as bin from '@isopodlabs/binary';

const _HEADER = {
	name:     	bin.as(bin.String(16),	x => {
		x = x.trim();
		return x.endsWith('/') ?  x.slice(0, -1) : x;
	}),
	date:     	bin.asInt(bin.String(12)),
	uid:      	bin.asInt(bin.String(6)),
	gid:      	bin.asInt(bin.String(6)),
	mode:     	bin.asInt(bin.String(8), 8),
	size:     	bin.asInt(bin.String(10)),
	fmag:     	bin.as(bin.String(2),	x => x.trim() == '`' ? '' : x),
	contents: 	bin.Const<unknown>(undefined)
};

export type HEADER = bin.ReadType<typeof _HEADER>;

const SYM64 = {
	name:     	bin.String(12),
	offset:   	bin.asInt(bin.String(4))
};

export class ArchFile {
	static check(data: Uint8Array): boolean {
		return bin.text.decode(data.subarray(0, 8), 'utf8') == '!<arch>\n';
	}

	members: HEADER[] = [];

	constructor(data: Uint8Array) {
		const s = new bin.stream(data);
		const header = bin.read(s, bin.String(8));
		
		if (header !== '!<arch>\n')
			throw new Error('Invalid archive file format');

		const nullTerminatedString = bin.NullTerminatedString();
		let long_names;
		let blanks = 0;
		while (s.tell() < data.length) {
			const member = bin.read(s, _HEADER);
			const data = s.view(Uint8Array, member.size);
			s.align(2);

			if (member.name == '/') {
				long_names = bin.text.decode(data, 'utf8');
				continue;
			}
			if (member.name[0] == '/' && long_names) {
				const offset = +member.name.substring(1);
				member.name = long_names.substring(offset, long_names.indexOf('/', offset));
			}

			if (member.name == '') {
				const s2		= new bin.stream(data);
				switch (++blanks) {
					case 1: {
						const offsets	= bin.Array(bin.INT32_BE, bin.INT32_BE).get(s2);
						member.name = 'Symbols';
						member.contents = offsets.map(offset => [
							nullTerminatedString.get(s2),
							offset
						]);
						break;
					}

					case 2: { // microsoft symbols
						const _offsets	= bin.Array(bin.INT32_LE, bin.INT32_LE).get(s2);
						const indices	= bin.Array(bin.INT32_LE, bin.INT16_LE).get(s2);

						member.name = 'Symbols2';
						member.contents = indices.map(i => [
							nullTerminatedString.get(s2),
							i
						]);
						break;
					}
				}

			} else if (member.name == '/SYM') {
				const s2	= new bin.stream(data);
				const syms	= bin.Array(bin.INT32_BE, nullTerminatedString).get(s2);
				member.contents = syms.map(name => ({
					name,
					offset: bin.INT32_BE.get(s2)
				}));

			} else if (member.name == '/SYM64') {
				const s2 = new bin.stream(data);
				member.contents = bin.RemainingArray(SYM64).get(s2);
	
			} else {
				member.contents = data;
			}
			this.members.push(member);
		}
	}
}