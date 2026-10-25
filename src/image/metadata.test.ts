// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { testPhoto } from '../test/data';
import { InvalidPhotoError, stripPhotoMetadata } from './metadata';

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
const segment = (marker: number, data: number[]) => [0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data];
const SCAN = [...segment(0xda, []), 0x11, 0x22];

function riff(chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  const size = 4 + body.length;
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, 0, 0, 0x57, 0x45, 0x42, 0x50, ...body]);
}
function chunk(id: string, data: number[]): number[] {
  const pad = data.length % 2 === 1 ? [0] : [];
  return [...[...id].map((c) => c.charCodeAt(0)), data.length, 0, 0, 0, ...data, ...pad];
}
const VP8L = chunk('VP8L', [0x2f, 0, 0, 0, 0]);

describe('stripPhotoMetadata: JPEG', () => {
  it('removes EXIF/XMP (APP1), IPTC (APP13) and comments, and keeps everything else', () => {
    const app0 = segment(0xe0, [0x4a, 0x46]);
    const iccProfile = segment(0xe2, [7, 7]);
    const quantTable = segment(0xdb, [1, 2, 3]);
    const input = new Uint8Array([
      ...SOI,
      ...app0,
      ...segment(0xe1, [0x47, 0x50, 0x53]), // EXIF with GPS
      ...iccProfile,
      ...segment(0xed, [9]), // IPTC
      ...segment(0xfe, [0x68, 0x69]), // comment
      ...quantTable,
      ...SCAN,
      ...EOI,
    ]);
    expect(stripPhotoMetadata(input, 'jpg')).toEqual(
      new Uint8Array([...SOI, ...app0, ...iccProfile, ...quantTable, ...SCAN, ...EOI]),
    );
  });

  it('keeps a clean JPEG byte for byte', () => {
    expect(stripPhotoMetadata(testPhoto('jpg'), 'jpg')).toEqual(testPhoto('jpg'));
  });

  it('copies everything after the first scan as image data', () => {
    // A later APP1-looking byte run inside the image data is not a segment and stays.
    const input = new Uint8Array([...SOI, ...SCAN, 0xff, 0xe1, 0x00, 0x02, ...EOI]);
    expect(stripPhotoMetadata(input, 'jpg')).toEqual(input);
  });

  it('skips fill bytes and keeps markers that have no length', () => {
    const input = new Uint8Array([...SOI, 0xff, 0xff, 0xe1, 0x00, 0x02, 0xff, 0xd0, ...SCAN, ...EOI]);
    expect(stripPhotoMetadata(input, 'jpg')).toEqual(new Uint8Array([...SOI, 0xff, 0xd0, ...SCAN, ...EOI]));
  });

  it('accepts a file that ends right after its header segments', () => {
    const input = new Uint8Array([...SOI, ...segment(0xe1, [1]), ...EOI]);
    expect(stripPhotoMetadata(input, 'jpg')).toEqual(new Uint8Array([...SOI, ...EOI]));
  });

  it.each([
    ['not a JPEG', [0x89, 0x50, 0x4e, 0x47], 'not a JPEG image'],
    ['too short', [0xff, 0xd8], 'not a JPEG image'],
    ['junk between segments', [...SOI, 0x00, 0x00, ...EOI], 'broken JPEG'],
    ['a segment longer than the file', [...SOI, 0xff, 0xe0, 0x00, 0x40, 0x00], 'broken JPEG'],
    ['a length below 2', [...SOI, 0xff, 0xe0, 0x00, 0x01, 0x00, ...EOI], 'broken JPEG'],
    ['no image data', [...SOI, ...segment(0xe0, [0])], 'broken JPEG'],
    ['only fill bytes at the end', [...SOI, 0xff, 0xff], 'broken JPEG'],
  ])('rejects %s', (_label, bytes, message) => {
    expect(() => stripPhotoMetadata(new Uint8Array(bytes), 'jpg')).toThrow(InvalidPhotoError);
    expect(() => stripPhotoMetadata(new Uint8Array(bytes), 'jpg')).toThrow(message);
  });
});

describe('stripPhotoMetadata: WebP', () => {
  it('removes EXIF and XMP chunks, clears their VP8X flags and fixes the size', () => {
    const vp8x = chunk('VP8X', [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // ICC + EXIF + XMP flags
    const iccp = chunk('ICCP', [1, 2]);
    const input = riff([vp8x, iccp, VP8L, chunk('EXIF', [0x47, 0x50, 0x53]), chunk('XMP ', [0x3c])]);
    const expectedVp8x = chunk('VP8X', [0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // only ICC left
    expect(stripPhotoMetadata(input, 'webp')).toEqual(riff([expectedVp8x, iccp, VP8L]));
  });

  it('keeps a clean WebP byte for byte and never changes the input', () => {
    const input = riff([chunk('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]), VP8L]);
    const before = input.slice();
    stripPhotoMetadata(input, 'webp');
    expect(input).toEqual(before);
    expect(stripPhotoMetadata(testPhoto('webp'), 'webp')).toEqual(testPhoto('webp'));
  });

  it('accepts a lossy or animated image', () => {
    expect(() => stripPhotoMetadata(riff([chunk('VP8 ', [1, 2])]), 'webp')).not.toThrow();
    expect(() => stripPhotoMetadata(riff([chunk('ANIM', [0, 0, 0, 0, 0, 0])]), 'webp')).not.toThrow();
  });

  it('tolerates a missing final padding byte', () => {
    const unpadded = riff([VP8L]).subarray(0, -1);
    unpadded[4] -= 1; // RIFF size without the pad
    expect(() => stripPhotoMetadata(unpadded, 'webp')).not.toThrow();
  });

  it.each([
    ['not a WebP', testPhoto('jpg'), 'not a WebP image'],
    ['a RIFF file of another kind', new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]), 'not a WebP image'],
    ['a RIFF size larger than the file', riff([VP8L]).subarray(0, 20), 'broken WebP'],
    ['a chunk larger than the file', riff([[0x56, 0x50, 0x38, 0x4c, 99, 0, 0, 0, 1, 2]]), 'broken WebP'],
    ['a truncated chunk header', riff([VP8L, [0x45, 0x58]]), 'broken WebP'],
    ['no image chunk', riff([chunk('EXIF', [1, 2])]), 'broken WebP'],
  ])('rejects %s', (_label, bytes, message) => {
    expect(() => stripPhotoMetadata(bytes, 'webp')).toThrow(InvalidPhotoError);
    expect(() => stripPhotoMetadata(bytes, 'webp')).toThrow(message);
  });
});
