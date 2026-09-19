/**
 * Inline image descriptors for `image` template elements.
 *
 * Format: `"width,height,byte,byte,..."` — the packed 1-bit rows (MSB-first)
 * as comma-separated decimal bytes. Keeps a bitmap inside the template JSON
 * with no base64 dependency. `parseBitmap` and `bitmapToDescriptor` are exact
 * inverses, so producers (e.g. the template builder) and this compiler cannot
 * drift.
 */

import type { MonochromeBitmap } from "portakal-lite";
import { TemplateError } from "./templating.js";

/** Parse an image descriptor into a MonochromeBitmap. */
export function parseBitmap(src: string): MonochromeBitmap {
  const parts = src.split(",");
  const width = Number(parts[0]);
  const height = Number(parts[1]);
  const bytes = parts.slice(2).map(Number);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new TemplateError(`invalid image src (expected "width,height,byte,..."): ${src.slice(0, 40)}`);
  }
  const bytesPerRow = Math.ceil(width / 8);
  if (bytes.length !== bytesPerRow * height) {
    throw new TemplateError(
      `image src byte count ${bytes.length} does not match ${bytesPerRow * height} bytes for ${width}x${height}`,
    );
  }
  const data = Uint8Array.from(bytes);
  return { data, width, height, bytesPerRow };
}

/** Serialize a MonochromeBitmap into an image descriptor. */
export function bitmapToDescriptor(bitmap: MonochromeBitmap): string {
  const parts: string[] = [String(bitmap.width), String(bitmap.height)];
  for (let i = 0; i < bitmap.data.length; i++) parts.push(String(bitmap.data[i]));
  return parts.join(",");
}
