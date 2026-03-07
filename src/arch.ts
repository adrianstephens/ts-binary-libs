import * as bin from '@isopodlabs/binary';

const _HEADER = {
	name:     	bin.as(bin.StringType(16),	x => {
		x = x.trim();
		return x.endsWith('/') ?  x.slice(0, -1) : x;
	}),
	date:     	bin.asInt(bin.StringType(12)),
	uid:      	bin.asInt(bin.StringType(6)),
	gid:      	bin.asInt(bin.StringType(6)),
	mode:     	bin.asInt(bin.StringType(8), 8),
	size:     	bin.asInt(bin.StringType(10)),
	fmag:     	bin.as(bin.StringType(2),	x => x.trim() == '`' ? '' : x),
	contents: 	bin.DontRead<any>()
};

export type HEADER = bin.ReadType<typeof _HEADER>;

const SYM64 = {
	name:     	bin.StringType(12),
	offset:   	bin.asInt(bin.StringType(4))
};

export class ArchFile {
	static check(data: Uint8Array): boolean {
		return bin.utils.decodeText(data.subarray(0, 8), 'utf8') == '!<arch>\n';
	}

	members: HEADER[] = [];

	constructor(data: Uint8Array) {
		const s = new bin.stream(data);
		const header = bin.read(s, bin.StringType(8));
		
		if (header !== '!<arch>\n')
			throw new Error('Invalid archive file format');

		const nullTerminatedString = bin.NullTerminatedStringType();
		let long_names;
		let blanks = 0;
		while (s.tell() < data.length) {
			const member = bin.read(s, _HEADER);
			const data = bin.read_buffer(s, member.size);
			bin.AlignType(2).get(s);//.align(2);

			if (member.name == '/') {
				long_names = bin.utils.decodeText(data, 'utf8');
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
						const offsets	= bin.ArrayType(bin.INT32_BE, bin.INT32_BE).get(s2);
						member.name = 'Symbols';
						member.contents = offsets.map(offset => [
							nullTerminatedString.get(s2),
							offset
						]);
						break;
					}

					case 2: { // microsoft symbols
						const _offsets	= bin.ArrayType(bin.INT32_LE, bin.INT32_LE).get(s2);
						const indices	= bin.ArrayType(bin.INT32_LE, bin.INT16_LE).get(s2);

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
				const syms	= bin.ArrayType(bin.INT32_BE, nullTerminatedString).get(s2);
				member.contents = syms.map(name => ({
					name,
					offset: bin.INT32_BE.get(s2)
				}));

			} else if (member.name == '/SYM64') {
				const s2 = new bin.stream(data);
				member.contents = bin.RemainingArrayType(SYM64).get(s2);
	
			} else {
				member.contents = data;
			}
			this.members.push(member);
		}
	}
}