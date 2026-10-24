import type { DecodedImage, DrawnFrame, ImageDeps, Size } from './processImage';

interface ElementImage extends DecodedImage {
  element: HTMLImageElement;
}

function decode(file: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      const image: ElementImage = {
        element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
      resolve(image);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the photo'));
    };
    element.src = url;
  });
}

function draw(image: DecodedImage, size: Size): DrawnFrame {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage((image as ElementImage).element, 0, 0, size.width, size.height);
  return {
    imageData: ctx.getImageData(0, 0, size.width, size.height),
    toJpeg: (quality) =>
      new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))), 'image/jpeg', quality),
      ),
  };
}

async function encodeWebp(data: ImageData, quality: number): Promise<ArrayBuffer> {
  const { encode } = await import('@jsquash/webp');
  return encode(data, { quality });
}

export const browserImageDeps: ImageDeps = { decode, draw, encodeWebp };
