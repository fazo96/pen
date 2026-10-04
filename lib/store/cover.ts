import "server-only";
import { readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../files";
import { isValidId } from "../ids";
import { dirOf, isMissing, projectExists, ready, serialize, trashPath } from "./core";

// The book's cover art: <project>/cover.<ext>, at most one.

export const MAX_COVER_BYTES = 10 * 1024 * 1024;
const COVER_TYPES = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
} as const;
export type CoverExt = keyof typeof COVER_TYPES;
const coverFile = (id: string, ext: CoverExt) => path.join(dirOf(id), `cover.${ext}`);

/** Sniff the format from the first bytes; the name and MIME type sent can't be trusted. */
export function coverExtOf(data: Uint8Array): CoverExt | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp" && /^avi[fs]$/.test(ascii(8, 12))) return "avif";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "gif";
  return null;
}

export async function findCover(id: string): Promise<{ file: string; ext: CoverExt; mtime: number } | null> {
  for (const ext of Object.keys(COVER_TYPES) as CoverExt[]) {
    const file = coverFile(id, ext);
    try {
      return { file, ext, mtime: (await stat(file)).mtimeMs };
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }
  return null;
}

export async function readCover(id: string): Promise<{ data: Buffer; type: string } | null> {
  if (!isValidId(id)) return null;
  await ready();
  const cover = await findCover(id);
  if (!cover) return null;
  try {
    return { data: await readFile(coverFile(id, cover.ext)), type: COVER_TYPES[cover.ext] };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function trashCover(id: string): Promise<boolean> {
  const cover = await findCover(id);
  if (!cover) return false;
  await rename(cover.file, await trashPath(`${id}--cover`, `.${cover.ext}`));
  return true;
}

/** Set a project's cover, trashing the old one. False if the project is missing. */
export function writeCover(id: string, data: Uint8Array, ext: CoverExt): Promise<boolean> {
  return serialize(async () => {
    if (!(await projectExists(id))) return false;
    await trashCover(id);
    await writeAtomic(coverFile(id, ext), data);
    return true;
  });
}

/** Move a project's cover to .trash/. False if it had none. */
export function removeCover(id: string): Promise<boolean> {
  return serialize(() => trashCover(id));
}
