// The Windows .ico container: a directory of images, each stored as a PNG.
import { readPngSize } from './png.mjs';

/** Pack PNG buffers into one .ico, smallest first. Every image must be square and at most 256 px. */
export function packIco(pngs) {
  const images = pngs
    .map((png) => ({ png, ...readPngSize(png) }))
    .sort((a, b) => a.width - b.width);
  for (const { width, height } of images) {
    if (width !== height || width > 256) {
      throw new Error(`An icon image must be square and at most 256 px, not ${width}x${height}.`);
    }
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ png, width }, index) => {
    const entry = directory.subarray(index * 16, (index + 1) * 16);
    entry[0] = width === 256 ? 0 : width; // 0 means 256
    entry[1] = width === 256 ? 0 : width;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...images.map(({ png }) => png)]);
}

/** List the images in an .ico as { width, height, png } without decoding them. */
export function readIco(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('Not an .ico file.');
  }
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 16;
    const size = buffer.readUInt32LE(at + 8);
    const offset = buffer.readUInt32LE(at + 12);
    const png = buffer.subarray(offset, offset + size);
    const { width, height } = readPngSize(png);
    entries.push({ width, height, png });
  }
  return entries;
}
