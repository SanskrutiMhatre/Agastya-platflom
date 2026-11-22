// A small ZIP writer (stored/deflated entries, no ZIP64): enough for project backups
// without adding a dependency. Entries are written as they are added, so a large
// workspace is never held in memory all at once.

import zlib from 'zlib';

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n & 0xffff); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function dosTime(d: Date): { time: number; date: number } {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export class ZipWriter {
  private offset = 0;
  private central: Buffer[] = [];
  private count = 0;
  constructor(private write: (b: Buffer) => void) {}

  add(name: string, data: Buffer, mtime = new Date()): void {
    const nameBuf = Buffer.from(name.replace(/\\/g, '/'), 'utf8');
    const crc = zlib.crc32(data);
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const { time, date } = dosTime(mtime);
    const head = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf]);
    this.write(head); this.write(body);
    this.central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(time), u16(date), u32(crc), u32(body.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(this.offset), nameBuf]));
    this.offset += head.length + body.length;
    this.count++;
  }

  end(): void {
    const dir = Buffer.concat(this.central);
    this.write(dir);
    this.write(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(this.count), u16(this.count), u32(dir.length), u32(this.offset), u16(0)]));
  }
}
