/**
 * Removes metadata (EXIF, XMP, IPTC, comments) from a stored photo without
 * re-encoding it, so the picture is unchanged but things like GPS location are
 * gone. Also checks that the bytes really are the claimed image type.
 *
 * Photos the app takes are already clean (the canvas re-encode drops metadata);
 * this is for photos arriving from a backup file, which may come from anywhere.
 */

export class InvalidPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhotoError';
  }
}

export function stripPhotoMetadata(bytes: Uint8Array, ext: 'webp' | 'jpg'): Uint8Array {
  return ext === 'webp' ? stripWebp(bytes) : stripJpeg(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function ascii(b: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...b.subarray(start, end));
}

/* ---------- JPEG: a list of marker segments, then the compressed image after SOS ---------- */

const JPEG_SOI = 0xd8;
const JPEG_EOI = 0xd9;
const JPEG_SOS = 0xda;
/** APP1 holds EXIF and XMP, APP13 holds IPTC, COM is a free-text comment. APP2 (colour profile) is kept. */
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== JPEG_SOI) throw new InvalidPhotoError('not a JPEG image');
  const broken = () => new InvalidPhotoError('broken JPEG image');
  const kept: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw broken();
    let m = i + 1;
    while (m < b.length && b[m] === 0xff) m++; // fill bytes before a marker
    if (m >= b.length) throw broken();
    const marker = b[m];
    if (marker === JPEG_EOI) {
      kept.push(b.subarray(m - 1, m + 1));
      return concat(kept);
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      kept.push(b.subarray(m - 1, m + 1)); // marker with no length
      i = m + 1;
      continue;
    }
    if (m + 2 >= b.length) throw broken();
    const length = (b[m + 1] << 8) | b[m + 2];
    const end = m + 1 + length;
    if (length < 2 || end > b.length) throw broken();
    if (marker === JPEG_SOS) {
      // Everything from the first scan on is image data; metadata segments all come before it.
      kept.push(b.subarray(m - 1));
      return concat(kept);
    }
    if (!JPEG_DROP.has(marker)) kept.push(b.subarray(m - 1, end));
    i = end;
  }
  throw broken(); // no image data
}

/* ---------- WebP: a RIFF container of chunks ---------- */

/** VP8X flag bits for "has EXIF" and "has XMP". */
const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;
const WEBP_IMAGE_CHUNKS = new Set(['VP8 ', 'VP8L', 'ANIM']);

function readU32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function writeU32(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

function stripWebp(b: Uint8Array): Uint8Array {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 12) !== 'WEBP') {
    throw new InvalidPhotoError('not a WebP image');
  }
  const broken = () => new InvalidPhotoError('broken WebP image');
  const riffEnd = 8 + readU32(b, 4);
  if (riffEnd > b.length || riffEnd < 12) throw broken();
  const kept: Uint8Array[] = [];
  let hasImage = false;
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) throw broken();
    const id = ascii(b, i, i + 4);
    const size = readU32(b, i + 4);
    const dataEnd = i + 8 + size;
    if (dataEnd > riffEnd) throw broken();
    const next = Math.min(dataEnd + (size & 1), riffEnd); // chunks are padded to an even length
    if (id !== 'EXIF' && id !== 'XMP ') {
      const chunk = b.slice(i, next); // a copy, so the caller's bytes are never changed
      if (id === 'VP8X' && size >= 1) chunk[8] &= ~(VP8X_EXIF | VP8X_XMP);
      if (WEBP_IMAGE_CHUNKS.has(id)) hasImage = true;
      kept.push(chunk);
    }
    i = next;
  }
  if (!hasImage) throw broken();
  const body = concat(kept);
  return concat([new Uint8Array([0x52, 0x49, 0x46, 0x46]), writeU32(4 + body.length), new Uint8Array([0x57, 0x45, 0x42, 0x50]), body]);
}
