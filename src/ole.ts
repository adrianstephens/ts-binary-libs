
import * as bin from '@isopodlabs/binary';

const GUIDspec = [bin.UINT32_LE, bin.UINT16_LE, bin.UINT16_LE, bin.UINT16_BE, bin.UINT(48, true)] as const;

class GUID {
	constructor(public data: Uint8Array) {
	}
	static fromString(s: string) {
		const parts = s.split('-');
		if (parts.length != 5)
			throw "invalid GUID format";
		const data = new Uint8Array(16);
		bin.write(new bin.stream(data), GUIDspec, parts.map(i => parseInt(i, 16)));
		return new GUID(data);
	}
	toString() {
		const parts = bin.read(new bin.stream(this.data), GUIDspec);
		return Object.values(parts).map((b, i) => b.toString(16).padStart([8,4,4,4,12][i], '0')).join('-');
	}
	static get(s: bin.stream) {
		return new GUID(s.view(Uint8Array, 16));
	}
	static put(s: bin.stream, v: GUID) {
		s.write_view(v.data);
	}
}

class DECIMAL extends bin.Class({
	unused:		bin.UINT16_LE,
	scale:		bin.UINT8,
	sign:		bin.UINT16_LE,
	hi:			bin.UINT32_LE,
	mid:		bin.UINT32_LE,
	lo:			bin.UINT32_LE,
}) {
	toString() {
		const m = (BigInt(this.hi) << 64n) | (BigInt(this.mid) << 32n) | BigInt(this.lo);
		return (this.sign ? '-' : '') + m.toString();
	}
}

// CF_DIB (8): BITMAPINFOHEADER + optional palette + pixel data
export const BITMAPINFOHEADER = {
	biSize:				bin.UINT32_LE,	// 40
	biWidth:			bin.INT32_LE,
	biHeight:			bin.INT32_LE,	// negative = top-down
	biPlanes:			bin.UINT16_LE,
	biBitCount:			bin.UINT16_LE,
	biCompression:		bin.UINT32_LE,	// 0=BI_RGB, 1=BI_RLE8, 2=BI_RLE4, 3=BI_BITFIELDS
	biSizeImage:		bin.UINT32_LE,
	biXPelsPerMeter:	bin.INT32_LE,
	biYPelsPerMeter:	bin.INT32_LE,
	biClrUsed:			bin.UINT32_LE,
	biClrImportant:		bin.UINT32_LE,
	palette:			bin.Array(s => s.obj.biClrUsed || (s.obj.biBitCount <= 8 ? 1 << s.obj.biBitCount : 0), {b: bin.UINT8, g: bin.UINT8, r: bin.UINT8, a: bin.UINT8}),
	pixels:				bin.Remainder,
};

// CF_DIBV5 (17): extended DIB header + optional profile + pixel data
export const BITMAPV5HEADER = {
	bV5Size:			bin.UINT32_LE,	// 124
	bV5Width:			bin.INT32_LE,
	bV5Height:			bin.INT32_LE,
	bV5Planes:			bin.UINT16_LE,
	bV5BitCount:		bin.UINT16_LE,
	bV5Compression:		bin.UINT32_LE,
	bV5SizeImage:		bin.UINT32_LE,
	bV5XPelsPerMeter:	bin.INT32_LE,
	bV5YPelsPerMeter:	bin.INT32_LE,
	bV5ClrUsed:			bin.UINT32_LE,
	bV5ClrImportant:	bin.UINT32_LE,
	bV5RedMask:			bin.UINT32_LE,
	bV5GreenMask:		bin.UINT32_LE,
	bV5BlueMask:		bin.UINT32_LE,
	bV5AlphaMask:		bin.UINT32_LE,
	bV5CSType:			bin.UINT32_LE,
	bV5Endpoints:		bin.Buffer(36),	// CIEXYZTRIPLE (9×LONG)
	bV5GammaRed:		bin.UINT32_LE,
	bV5GammaGreen:		bin.UINT32_LE,
	bV5GammaBlue:		bin.UINT32_LE,
	bV5Intent:			bin.UINT32_LE,
	bV5ProfileData:		bin.UINT32_LE,
	bV5ProfileSize:		bin.UINT32_LE,
	bV5Reserved:		bin.UINT32_LE,
	data:				bin.Remainder,	// palette + pixel data (+ embedded ICC profile)
};

// CF_ENHMETAFILE (14): EMF header record prefix
export const ENHMETAHEADER = {
	iType:				bin.UINT32_LE,		// 1 = EMR_HEADER
	nSize:				bin.UINT32_LE,
	rclBounds:			[bin.INT32_LE, bin.INT32_LE, bin.INT32_LE, bin.INT32_LE] as const,	// left,top,right,bottom
	rclFrame:			[bin.INT32_LE, bin.INT32_LE, bin.INT32_LE, bin.INT32_LE] as const,	// in MM_HIMETRIC units
	dSignature:			bin.Expect(bin.UINT32_LE, 0x464D4520),	// ' EMF'
	nVersion:			bin.UINT32_LE,
	nBytes:				bin.UINT32_LE,		// total EMF size in bytes
	nRecords:			bin.UINT32_LE,
	nHandles:			bin.UINT16_LE,
	sReserved:			bin.UINT16_LE,
	nDescription:		bin.UINT32_LE,		// chars in description string
	offDescription:		bin.UINT32_LE,		// offset to description string
	nPalEntries:		bin.UINT32_LE,
	szlDevice:			[bin.UINT32_LE, bin.UINT32_LE] as const,		// device size in pixels
	szlMillimeters:		[bin.UINT32_LE, bin.UINT32_LE] as const,		// device size in mm
	data:				bin.Remainder,		// remaining EMF records
};

// CF_METAFILEPICT (3): 4×WORD header + WMF byte stream
export const PACKEDMETA = {
	mm:					bin.UINT16_LE,		// mapping mode (e.g. MM_ANISOTROPIC=8)
	xExt:				bin.UINT16_LE,		// width in MM_HIMETRIC units
	yExt:				bin.UINT16_LE,		// height in MM_HIMETRIC units
	reserved:			bin.UINT16_LE,

//	METAHEADER	
    mtType:         	bin.UINT16_LE,
    mtHeaderSize:   	bin.UINT16_LE,
    mtVersion:      	bin.UINT16_LE,
    mtSize:         	bin.UINT32_LE,      // in WORDs
    mtNoObjects:    	bin.UINT16_LE,
    mtMaxRecord:    	bin.UINT32_LE,      // in WORDs
    mtNoParameters: 	bin.UINT16_LE,
    records:        	bin.RemainingArray(bin.Size(bin.as(bin.UINT32_LE, x => x * 2 - 4), {
		rdFunction:	bin.UINT16_LE,
		rdParm:		bin.Switch(s => s.obj.rdFunction, {
			0x020B: {mapMode: bin.UINT16_LE},			// META_SETMAPMODE
			0x020C: {y: bin.INT16_LE, x: bin.INT16_LE},	// META_SETWINDOWORG
			0x020E: {y: bin.INT16_LE, x: bin.INT16_LE},	// META_SETWINDOWEXT
			0x0107: {stretchMode: bin.UINT16_LE},		// META_SETSTRETCHBLTMODE
			0x0B41:	{// META_STRETCHDIB: fixed params then inline DIB
				rasterOp:	bin.UINT32_LE,
				srcY:		bin.INT16_LE,
				srcX:		bin.INT16_LE,
				srcHeight:	bin.INT16_LE,
				srcWidth:	bin.INT16_LE,
				dstY:		bin.INT16_LE,
				dstX:		bin.INT16_LE,
				dstHeight:	bin.INT16_LE,
				dstWidth:	bin.INT16_LE,
				dib:		BITMAPINFOHEADER,
			},
			default: bin.Remainder
		})
	}))
};


const CF = bin.Size(bin.UINT32_LE, {
	ulClipFmt:	bin.INT32_LE,			// clipboard format.
	data:		bin.FuncType(s => {
		const fmt = s.obj.ulClipFmt;
		if (fmt > 0)
			return {fmt: bin.String(fmt, 'utf8', true), data: bin.Remainder};
		switch (fmt) {
			case -1:	return bin.Switch(bin.UINT32_LE, {
				0: 			bin.Remainder,
				1: 			bin.RemainingString('utf8', true),		// CF_TEXT
				2: 			bin.Remainder,								// CF_BITMAP
				3: 			PACKEDMETA,									// CF_METAFILEPICT
				8: 			BITMAPINFOHEADER,							// CF_DIB
				13:			bin.RemainingString('utf16le', true),	// CF_TEXT
				17:			BITMAPV5HEADER,								// CF_DIBV5
				default:	bin.Remainder,								// other CF_*
			});
			case -2:	return {fmt: bin.UINT32_LE, data: bin.Remainder};	// Macintosh clipboard format
			case -3:	return {fmt: GUID, data: bin.Remainder};			// GUID/FMTID clipboard format identifier
			case 0:		return bin.Remainder;		// No clipboard format data
			default:	throw "unknown clipboard format";
		}
	}),
});

const VARIANTS/*: Record<string, {tag: number, type: bin.TypeT<any>}>*/ = {
	EMPTY:			   {tag: 0,      type: bin.UINT16_LE},
	NULL:			   {tag: 1,      type: bin.UINT16_LE},
	I2:			       {tag: 2,      type: bin.INT16_LE},
	I4:			       {tag: 3,      type: bin.INT32_LE},
	R4:			       {tag: 4,      type: bin.Float32_LE},
	R8:			       {tag: 5,      type: bin.Float64_LE},
	CY:			       {tag: 6,      type: bin.asScaled(bin.INT64_LE, 10000n, 4)},
	DATE:			   {tag: 7,      type: bin.as(bin.Float64_LE, i => new Date(i * 86400000 - 2209161600000))},
	BSTR:			   {tag: 8,      type: bin.String(bin.UINT32_LE, 'utf16le')},
//	DISPATCH:		   {tag: 9,      type: bin.UINT16_LE},
//	ERROR:			   {tag: 10,     type: bin.UINT16_LE},
	BOOL:			   {tag: 11,     type: bin.UINT16_LE},
	VARIANT:		   {tag: 12,     type: Variant(bin.UINT32_LE)},
//	UNKNOWN:		   {tag: 13,     type: bin.UINT16_LE},
	DECIMAL:		   {tag: 14,     type: DECIMAL},
	I1:			       {tag: 16,     type: bin.INT8},
	UI1:			   {tag: 17,     type: bin.UINT8},
	UI2:			   {tag: 18,     type: bin.UINT16_LE},
	UI4:			   {tag: 19,     type: bin.UINT32_LE},
	I8:			       {tag: 20,     type: bin.INT64_LE},
	UI8:			   {tag: 21,     type: bin.UINT64_LE},
	INT:			   {tag: 22,     type: bin.INT32_LE},
	UINT:			   {tag: 23,     type: bin.UINT32_LE},
//	VOID:			   {tag: 24,     type: bin.UINT32_LE},
	HRESULT:		   {tag: 25,     type: bin.UINT32_LE},
//	PTR:			   {tag: 26,     type: bin.UINT32_LE},
//	SAFEARRAY:		   {tag: 27,     type: bin.UINT32_LE},
//	CARRAY:			   {tag: 28,     type: bin.UINT32_LE},
//	USERDEFINED:	   {tag: 29,     type: bin.UINT32_LE},
	LPSTR:			   {tag: 30,     type: bin.String(bin.UINT32_LE, 'utf8', true)},
	LPWSTR:			   {tag: 31,     type: bin.String(bin.UINT32_LE, 'utf16le', true)},
//	RECORD:			   {tag: 36,     type: bin.UINT32_LE},
//	INT_PTR:		   {tag: 37,     type: bin.UINT32_LE},
//	UINT_PTR:		   {tag: 38,     type: bin.UINT32_LE},
	FILETIME:		   {tag: 64,     type: bin.as(bin.UINT64_LE, i => new Date(Number(i / 10000n - 11644473600000n)))},
//	BLOB:			   {tag: 65,     type: bin.UINT32_LE},
//	STREAM:			   {tag: 66,     type: bin.UINT32_LE},
//	STORAGE:		   {tag: 67,     type: bin.UINT32_LE},
//	STREAMED_OBJECT:   {tag: 68,     type: bin.UINT32_LE},
//	STORED_OBJECT:	   {tag: 69,     type: bin.UINT32_LE},
//	BLOB_OBJECT:	   {tag: 70,     type: bin.UINT32_LE},
	CF:			       {tag: 71,     type: bin.Struct(CF)},
	CLSID:			   {tag: 72,     type: GUID},
//	VERSIONED_STREAM:  {tag: 73,     type: bin.UINT32_LE},
//	BSTR_BLOB:		   {tag: 0xfff,  type: bin.UINT32_LE},
} as const;

const VARIANT_BY_TAG: Record<number, bin.TypeT<any>> = Object.fromEntries(Object.values(VARIANTS).map(i => [i.tag, i.type]));

const VT = {
	...Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, v.tag])) as Record<keyof typeof VARIANTS, number>,
	VECTOR:	0x1000,
	ARRAY:	0x2000,
	BYREF:	0x4000,
} as const;

export function Variant(tagtype: bin.Type) {
	return {
		get(s: bin.stream) {
			const tag	= bin.read(s, tagtype);
			const type	= VARIANT_BY_TAG[tag & 0x7ff];
			if (type) {
				if (tag & VT.VECTOR)
					return bin.readn(s, type, bin.read(s, bin.UINT32_LE));
				if (tag & VT.ARRAY)
					return bin.readn(s, type, bin.read(s, bin.UINT32_LE));
				return type.get(s);
			} else {
				return String.fromCharCode(tag);
			}
		},	
		put(s: bin.stream, value: any) {
			let tag;
			switch (typeof value) {
				case 'number':	tag = 3; break;	//VT_I4
				case 'string':
					if (value.length == 1) {
						bin.write(s, bin.UINT16_LE, value.charCodeAt(0));
						return;
					}
					tag = 8; // VT_BSTR
					break;
				case 'object':
					if (Array.isArray(value)) {
						switch (typeof value[0]) {
							case 'number':	tag = VT.VECTOR | VT.I4; break;
							case 'string':	tag = VT.VECTOR | VT.BSTR; break;
							default:	throw "bad array type";
						}
						bin.write(s, {tag: tagtype, value: bin.Array(bin.UINT32_LE, VARIANT_BY_TAG[tag & 0x7ff])}, {tag, value});
					}
					// fallthrough
				default:
					throw "bad token";
			}
			bin.write(s, {tag: tagtype, value: VARIANT_BY_TAG[tag]}, {tag, value});
		}
	};
}

//-----------------------------------------------------------------------------
//	OLE Property Set Structures
//-----------------------------------------------------------------------------

// Common FMTID GUIDs
export const FMTID = {
	SummaryInformation:			GUID.fromString('F29F85E0-4FF9-1068-AB91-08002B27B3D9'),
	DocumentSummaryInformation:	GUID.fromString('D5CDD502-2E9C-101B-9397-08002B2CF9AE')
};

// Common property IDs for SummaryInformation
export const PIDSI = {
	DICTIONARY:		0,	// Property dictionary
	CODEPAGE:		1,	// Code page
	TITLE:			2,	// Title
	SUBJECT:		3,	// Subject
	AUTHOR:			4,	// Author
	KEYWORDS:		5,	// Keywords
	COMMENTS:		6,	// Comments
	TEMPLATE:		7,	// Template
	LASTAUTHOR:		8,	// Last saved by
	REVNUMBER:		9,	// Revision number
	EDITTIME:		10,	// Total editing time
	LASTPRINTED:	11,	// Last printed
	CREATE_DTM:		12,	// Create time/date
	LASTSAVE_DTM:	13,	// Last saved time/date
	PAGECOUNT:		14,	// Number of pages
	WORDCOUNT:		15,	// Number of words
	CHARCOUNT:		16,	// Number of characters
	THUMBNAIL:		17,	// Thumbnail
	APPNAME:		18,	// Creating application
	SECURITY:		19	// Security
};

// PropertySection: header + property directory
const PropertySection = {
	cbSection:		bin.UINT32_LE,								// Section byte size
	properties:		bin.as(bin.Array(bin.UINT32_LE, [
		bin.as(bin.UINT32_LE, bin.EnumString( PIDSI)),
		bin.Offset(bin.UINT32_LE, Variant(bin.UINT32_LE))
	]), i => Object.fromEntries(i))
};
// PropertySetStream: OLE Property Set Stream structure
export const PropertySetStream = {
	wByteOrder:	bin.Expect(bin.UINT16_LE, 0xFFFE),				// Byte order (little-endian)
	wFormat:	bin.UINT16_LE,									// Format version (0 or 1)
	dwOSVer:	bin.UINT32_LE,									// OS version
	clsid:		GUID,											// Class ID (often zeros)
	sections:	bin.Array(bin.UINT32_LE, {
		fmtid:		GUID,										// GUID identifying property set type
		section:	bin.Offset(bin.UINT32_LE, PropertySection)
	})
};

