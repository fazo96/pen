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
