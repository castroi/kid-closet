import type { StoredImage } from '../storage/repository';

export const MAX_SIDE = 800;
/** The doll is sent to the AI as the base picture, so it keeps more detail than a garment photo. */
export const DOLL_MAX_SIDE = 1024;
export const WEBP_QUALITY = 75;
export const JPEG_QUALITY = 0.8;

export interface Size {
  width: number;
  height: number;
}

export interface DecodedImage extends Size {
  release(): void;
}

export interface DrawnFrame {
  imageData: ImageData;
  toJpeg(quality: number): Promise<Blob>;
  /** Frees the canvas memory now; iOS caps total canvas memory and frees it late on its own. */
  release(): void;
}

export interface ImageDeps {
  decode(file: Blob): Promise<DecodedImage>;
  draw(image: DecodedImage, size: Size): DrawnFrame;
  encodeWebp(data: ImageData, quality: number): Promise<ArrayBuffer>;
}

/** Scales so the longer side is at most `max`, never enlarging. */
export function fitSize(width: number, height: number, max = MAX_SIDE): Size {
  if (width <= 0 || height <= 0) throw new Error('Image has no size');
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Resizes a photo on the device and encodes it as WebP. Safari cannot encode
 * WebP itself, so a WebAssembly encoder does it; if that fails, JPEG is used.
 */
export async function processImage(file: Blob, deps: ImageDeps, maxSide = MAX_SIDE): Promise<StoredImage> {
  const image = await deps.decode(file);
  try {
    const frame = deps.draw(image, fitSize(image.width, image.height, maxSide));
    try {
      const buffer = await deps.encodeWebp(frame.imageData, WEBP_QUALITY);
      if (buffer.byteLength === 0) throw new Error('Empty WebP output');
      return { blob: new Blob([buffer], { type: 'image/webp' }), ext: 'webp' };
    } catch {
      return { blob: await frame.toJpeg(JPEG_QUALITY), ext: 'jpg' };
    } finally {
      frame.release();
    }
  } finally {
    image.release();
  }
}
