import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * geography(Point,4326): ST_DWithin/ST_Distance تعمل بالأمتار مباشرة.
 * القراءة تتم عبر ST_Y/ST_X في الاستعلامات التي تحتاج الإحداثيات؛
 * fromDriver يفك ترميز EWKB السداسي للاستخدامات المباشرة.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return 'geography(Point,4326)';
  },
  toDriver(value: GeoPoint) {
    return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`;
  },
  fromDriver(value: string): GeoPoint {
    return parseHexEwkbPoint(value);
  },
});

/** EWKB hex little-endian: 01 01000020 E6100000 <lng float64> <lat float64> */
export function parseHexEwkbPoint(hex: string): GeoPoint {
  const buf = Buffer.from(hex, 'hex');
  const littleEndian = buf.readUInt8(0) === 1;
  // 1 byte endian + 4 bytes type + 4 bytes SRID = offset 9
  const lng = littleEndian ? buf.readDoubleLE(9) : buf.readDoubleBE(9);
  const lat = littleEndian ? buf.readDoubleLE(17) : buf.readDoubleBE(17);
  return { lat, lng };
}
