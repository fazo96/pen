// A small streaming zip writer: deflate or store, UTF-8 names, no ZIP64
// (so under 4 GB and 65,535 files). Each file is read and compressed whole,
// then written, so memory holds one file at a time.
//
// Kept free of pen imports so tests can load it with plain Node.
import { promisify } from "node:util";
import { crc32, deflateRaw } from "node:zlib";

const deflate = promisify(deflateRaw);

/** A file to add; `read` gives null for one that has gone, which is left out. */
export type ZipSource = { name: string; mtime: Date; read: () => Promise<Uint8Array | null> };

// Already compressed: deflating again only costs time.
const STORED = /\.(jpe?g|png|gif|webp|avif|zip|gz)$/i;
const MAX = 0xffffffff;

function dosTime(d: Date) {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** The zip of `files`, in order, as a byte stream. */
export async function* zip(files: AsyncIterable<ZipSource> | Iterable<ZipSource>): AsyncGenerator<Uint8Array> {
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  for await (const f of files) {
    const raw = await f.read();
    if (!raw) continue;
    const data = Buffer.from(raw);
    const packed = STORED.test(f.name) ? data : await deflate(data);
    const method = packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(data);
    const { time, date } = dosTime(f.mtime);
    if (offset + 30 + name.length + body.length > MAX || ++count > 0xffff) {
      throw new Error("too large for a zip without ZIP64");
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6); // needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42); // extra, comment, disk, attributes stay 0
    central.push(entry, name);

    yield Buffer.concat([local, name]);
    yield body;
    offset += 30 + name.length + body.length;
  }

  const dir = Buffer.concat(central);
  if (offset + dir.length > MAX) throw new Error("too large for a zip without ZIP64");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  yield dir;
  yield end;
}
