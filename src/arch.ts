import * as binary from '@isopodlabs/binary';

const _HEADER = {
	name:     	binary.as(binary.StringType(16),	x => {
		x = x.trim();
		return x.endsWith('/') ?  x.slice(0, -1) : x;
	}),
	date:     	binary.asInt(binary.StringType(12)),
	uid:      	binary.asInt(binary.StringType(6)),
	gid:      	binary.asInt(binary.StringType(6)),
	mode:     	binary.asInt(binary.StringType(8), 8),
	size:     	binary.asInt(binary.StringType(10)),
	fmag:     	binary.as(binary.StringType(2),	x => x.trim() == '`' ? '' : x),
	contents: 	binary.DontRead<any>()
};

export type HEADER = binary.ReadType<typeof _HEADER>;

const SYM64 = {
	name:     	binary.StringType(12),
	offset:   	binary.asInt(binary.StringType(4))
};

export class ArchFile {
	static check(data: Uint8Array): boolean {
		return binary.utils.decodeText(data.subarray(0, 8), 'utf8') == '!<arch>\n';
	}

	members: HEADER[] = [];

	constructor(data: Uint8Array) {
		const s = new binary.stream(data);
		const header = binary.read(s, binary.StringType(8));
		
		if (header !== '!<arch>\n')
			throw new Error('Invalid archive file format');

		const nullTerminatedString = binary.NullTerminatedStringType();
		let long_names;
		let blanks = 0;
		while (s.remaining() > 0) {
			const member = binary.read(s, _HEADER);
			const data = s.read_buffer(member.size);
			s.align(2);

			if (member.name == '/') {
				long_names = binary.utils.decodeText(data, 'utf8');
				continue;
			}
			if (member.name[0] == '/' && long_names) {
				const offset = +member.name.substring(1);
				member.name = long_names.substring(offset, long_names.indexOf('/', offset));
			}

			if (member.name == '') {
				const s2		= new binary.stream(data);
				switch (++blanks) {
					case 1: {
						const offsets	= binary.ArrayType(binary.INT32_BE, binary.INT32_BE).get(s2);
						member.name = 'Symbols';
						member.contents = offsets.map(offset => [
							nullTerminatedString.get(s2),
							offset
						]);
						break;
					}

					case 2: { // microsoft symbols
						const _offsets	= binary.ArrayType(binary.INT32_LE, binary.INT32_LE).get(s2);
						const indices	= binary.ArrayType(binary.INT32_LE, binary.INT16_LE).get(s2);

						member.name = 'Symbols2';
						member.contents = indices.map(i => [
							nullTerminatedString.get(s2),
							i
						]);
						break;
					}
				}

			} else if (member.name == '/SYM') {
				const s2	= new binary.stream(data);
				const syms	= binary.ArrayType(binary.INT32_BE, nullTerminatedString).get(s2);
				member.contents = syms.map(name => ({
					name,
					offset: binary.INT32_BE.get(s2)
				}));

			} else if (member.name == '/SYM64') {
				const s2 = new binary.stream(data);
				member.contents = binary.RemainingArrayType(SYM64).get(s2);
	
			} else {
				member.contents = data;
			}
			this.members.push(member);
		}
	}
}