import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

export const MAX_PROPERTY_PHOTO_BYTES = 10 * 1024 * 1024;

const extensionByType: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function propertyPhotoDirectory() {
  const databasePath = resolve(process.env.LEDGERLINE_DATA_PATH ?? 'data/ledgerline.sqlite');
  return resolve(process.env.LEDGERLINE_PHOTOS_PATH ?? `${dirname(databasePath)}/photos`);
}

export function photoFilePath(filename: string) {
  if (!/^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(filename)) return null;
  return resolve(propertyPhotoDirectory(), filename);
}

export function validatePhoto(bytes: Buffer, mimeType: string) {
  if (!(mimeType in extensionByType)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (bytes.length === 0) throw new Error('The selected image is empty.');
  if (bytes.length > MAX_PROPERTY_PHOTO_BYTES)
    throw new Error('Image is too large. Choose a file no larger than 10 MB.');
  const valid =
    (mimeType === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (mimeType === 'image/png' &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mimeType === 'image/webp' &&
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP');
  if (!valid) throw new Error('The file contents do not match a JPEG, PNG, or WebP image.');
  return extensionByType[mimeType];
}

export function savePropertyPhoto(bytes: Buffer, mimeType: string) {
  const extension = validatePhoto(bytes, mimeType);
  mkdirSync(propertyPhotoDirectory(), { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  const path = photoFilePath(filename)!;
  writeFileSync(path, bytes, { flag: 'wx' });
  return { filename, path };
}

export function readPropertyPhoto(filename: string) {
  const path = photoFilePath(filename);
  return path && existsSync(path) ? readFileSync(path) : null;
}

export function propertyPhotoExists(filename: string) {
  const path = photoFilePath(filename);
  return path !== null && existsSync(path);
}

export function deletePropertyPhotoFile(filename: string) {
  const path = photoFilePath(filename);
  if (path && existsSync(path)) unlinkSync(path);
}

export function photoMimeType(filename: string) {
  const extension = extname(filename).toLowerCase();
  return extension === '.jpg' ? 'image/jpeg' : extension === '.png' ? 'image/png' : 'image/webp';
}
