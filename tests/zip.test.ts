import assert from "node:assert/strict";
import { test } from "node:test";
import { crc32, inflateRawSync } from "node:zlib";
import { zip, type ZipSource } from "../lib/zip.ts";

async function bytes(files: ZipSource[]) {
  const chunks: Uint8Array[] = [];
  for await (const c of zip(files)) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Read a zip back through its central directory, checking each local header and CRC. */
function unzip(buf: Buffer) {
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50);
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, { text: Buffer; method: number }> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26);
    const body = buf.subarray(start, start + size);
    const text = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(text), crc, name);
    out[name] = { text, method };
    at += 46 + nameLen;
  }
  return out;
}

const file = (name: string, content: string | Buffer): ZipSource => ({
  name,
  mtime: new Date(2026, 8, 30, 12, 34, 56),
  read: async () => (typeof content === "string" ? Buffer.from(content) : content),
});

test("files come back out as they went in", async () => {
  const long = "All work and no play. ".repeat(500);
  const buf = await bytes([
    file("book/manuscript.md", long),
    file("book/codex/mara-voss.md", "# Mara Voss — ünïcode\n"),
    file("book/empty.json", ""),
    file("book/cover.jpg", Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3])),
  ]);
  const out = unzip(buf);
  assert.deepEqual(Object.keys(out), ["book/manuscript.md", "book/codex/mara-voss.md", "book/empty.json", "book/cover.jpg"]);
  assert.equal(out["book/manuscript.md"].text.toString(), long);
  assert.equal(out["book/manuscript.md"].method, 8, "text is deflated");
  assert.equal(out["book/codex/mara-voss.md"].text.toString(), "# Mara Voss — ünïcode\n");
  assert.equal(out["book/empty.json"].text.length, 0);
  assert.equal(out["book/cover.jpg"].method, 0, "images are stored");
});

test("an empty zip is valid", async () => {
  assert.deepEqual(unzip(await bytes([])), {});
});

test("a file that has gone is left out", async () => {
  const gone: ZipSource = { name: "book/gone.md", mtime: new Date(), read: async () => null };
  assert.deepEqual(Object.keys(unzip(await bytes([gone, file("book/here.md", "x")]))), ["book/here.md"]);
});
