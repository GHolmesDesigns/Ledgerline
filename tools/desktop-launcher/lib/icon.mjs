// Builds the desktop icon from the supplied brand artwork. Nothing is redrawn, recoloured or cropped:
// the small sizes are the favicon PNGs as supplied, and the larger ones are the 1024 px app icon
// averaged down by a whole factor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packIco } from './ico.mjs';
import { decodePng, downscale, encodePng, readPngSize } from './png.mjs';

export const FAVICON_SIZES = [16, 32, 48];
export const APP_ICON_SIZES = [64, 128, 256];
export const APP_ICON_SOURCE = 'app-icon-1024.png';

/** Build the multi-size .ico from `<brandDir>/png`. Returns the file's bytes. */
export function buildIcon(brandDir) {
  const pngDirectory = join(brandDir, 'png');
  const favicons = FAVICON_SIZES.map((size) => {
    const png = readFileSync(join(pngDirectory, `favicon-${size}.png`));
    const found = readPngSize(png);
    if (found.width !== size || found.height !== size) {
      throw new Error(
        `favicon-${size}.png is ${found.width}x${found.height}, not ${size}x${size}.`,
      );
    }
    return png;
  });
  const source = decodePng(readFileSync(join(pngDirectory, APP_ICON_SOURCE)));
  const scaled = APP_ICON_SIZES.map((size) => encodePng(downscale(source, size)));
  return packIco([...favicons, ...scaled]);
}
