// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { JPEG_QUALITY, WEBP_QUALITY, fitSize, processImage, type ImageDeps } from './processImage';

describe('fitSize', () => {
  it('scales the longer side down to 800', () => {
    expect(fitSize(3024, 4032)).toEqual({ width: 600, height: 800 });
    expect(fitSize(4000, 1000)).toEqual({ width: 800, height: 200 });
  });

  it('never enlarges small photos', () => {
    expect(fitSize(300, 200)).toEqual({ width: 300, height: 200 });
  });

  it('rejects empty images', () => {
    expect(() => fitSize(0, 10)).toThrow('no size');
  });
});

function deps(overrides: Partial<ImageDeps> = {}) {
  const release = vi.fn();
  const releaseFrame = vi.fn();
  const toJpeg = vi.fn().mockResolvedValue(new Blob(['jpeg'], { type: 'image/jpeg' }));
  const imageData = { width: 600, height: 800 } as ImageData;
  const base: ImageDeps = {
    decode: vi.fn().mockResolvedValue({ width: 3024, height: 4032, release }),
    draw: vi.fn().mockReturnValue({ imageData, toJpeg, release: releaseFrame }),
    encodeWebp: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  };
  return { release, releaseFrame, toJpeg, imageData, deps: { ...base, ...overrides } };
}

describe('processImage', () => {
  it('resizes and encodes WebP', async () => {
    const d = deps();
    const result = await processImage(new Blob(['raw']), d.deps);
    expect(d.deps.draw).toHaveBeenCalledWith(expect.anything(), { width: 600, height: 800 });
    expect(d.deps.encodeWebp).toHaveBeenCalledWith(d.imageData, WEBP_QUALITY);
    expect(result.ext).toBe('webp');
    expect(result.blob.type).toBe('image/webp');
    expect(result.blob.size).toBe(3);
    expect(d.release).toHaveBeenCalled();
    expect(d.releaseFrame).toHaveBeenCalledOnce();
  });

  it('frees the canvas only after the JPEG fallback has used it', async () => {
    const order: string[] = [];
    const d = deps({ encodeWebp: vi.fn().mockRejectedValue(new Error('wasm failed')) });
    d.toJpeg.mockImplementation(async () => {
      order.push('jpeg');
      return new Blob(['jpeg'], { type: 'image/jpeg' });
    });
    d.releaseFrame.mockImplementation(() => order.push('release'));
    await processImage(new Blob(['raw']), d.deps);
    expect(order).toEqual(['jpeg', 'release']);
  });

  it('frees the canvas even when the JPEG fallback fails too', async () => {
    const d = deps({ encodeWebp: vi.fn().mockRejectedValue(new Error('wasm failed')) });
    d.toJpeg.mockRejectedValue(new Error('JPEG encode failed'));
    await expect(processImage(new Blob(['raw']), d.deps)).rejects.toThrow('JPEG encode failed');
    expect(d.releaseFrame).toHaveBeenCalledOnce();
    expect(d.release).toHaveBeenCalled();
  });

  it.each([
    ['the encoder throws', vi.fn().mockRejectedValue(new Error('wasm failed'))],
    ['the encoder returns nothing', vi.fn().mockResolvedValue(new ArrayBuffer(0))],
  ])('falls back to JPEG when %s', async (_label, encodeWebp) => {
    const d = deps({ encodeWebp });
    const result = await processImage(new Blob(['raw']), d.deps);
    expect(result.ext).toBe('jpg');
    expect(d.toJpeg).toHaveBeenCalledWith(JPEG_QUALITY);
    expect(d.release).toHaveBeenCalled();
  });

  it('releases the decoded image even if drawing fails', async () => {
    const d = deps({
      draw: vi.fn(() => {
        throw new Error('no canvas');
      }),
    });
    await expect(processImage(new Blob(['raw']), d.deps)).rejects.toThrow('no canvas');
    expect(d.release).toHaveBeenCalled();
  });
});
