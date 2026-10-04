// Covers are shown a couple of inches tall, so phone photos are shrunk in
// the browser before upload: the shelf stays light, the server stays simple.
const MAX_W = 800;
const MAX_H = 1200;

export const COVER_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";

export const isImage = (file: File) => file.type.startsWith("image/");

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
}

/** The file to upload as a cover: downscaled WebP (JPEG where unsupported), or the original. */
export async function prepareCover(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file; // keep the animation
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file; // undecodable here; let the server judge it
  }
  const scale = Math.min(1, MAX_W / bitmap.width, MAX_H / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await encode(canvas, "image/webp");
  // Browsers that can't encode WebP fall back to PNG, which is heavier than a JPEG.
  if (blob?.type !== "image/webp") blob = await encode(canvas, "image/jpeg");
  if (!blob || (scale === 1 && blob.size >= file.size)) return file;
  return blob;
}

// Photos of handwritten notes, for the Codex to transcribe: big enough for
// Claude to read every word (it scales anything larger down to ~1568px
// anyway), small enough to send a few pages at once.
const NOTE_MAX = 2000;

/** A note's photo as a JPEG at most NOTE_MAX on its long side, base64; or the original's bytes. */
export async function prepareNote(file: File): Promise<string> {
  let blob: Blob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, NOTE_MAX / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fff"; // transparent PNGs: ink on white, not on black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    bitmap.close();
    const jpeg = await encode(canvas, "image/jpeg");
    if (jpeg && (scale < 1 || jpeg.size < file.size)) blob = jpeg;
  } catch {
    // undecodable here (HEIC on most browsers); the server says if it can't take it
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
