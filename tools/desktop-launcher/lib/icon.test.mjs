import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildIcon } from './icon.mjs';
import { readIco } from './ico.mjs';
import { decodePng } from './png.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const brandDir = join(repoRoot, 'design/brand');
const committedIcon = join(brandDir, 'ledgerline.ico');

/** Sum of premultiplied channels: independent of how the scaler averages, so it checks the result. */
function colourMass(image) {
  const totals = [0, 0, 0, 0];
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3];
    totals[0] += image.data[i] * alpha;
    totals[1] += image.data[i + 1] * alpha;
    totals[2] += image.data[i + 2] * alpha;
    totals[3] += alpha;
  }
  return totals.map((total) => total / (image.width * image.height));
}

describe('desktop icon', () => {
  const icon = readIco(readFileSync(committedIcon));

  // A shortcut that shows a generic or blurry icon at one of Windows' sizes fails the card.
  it('holds one image for each of 16, 32, 48, 64, 128 and 256 px, square', () => {
    assert.deepEqual(
      icon.map(({ width, height }) => [width, height]),
      [16, 32, 48, 64, 128, 256].map((size) => [size, size]),
    );
  });

  // The small sizes must be the heavier-stroke favicon artwork, not a scaled-down app icon.
  it('uses the supplied favicon PNGs, byte for byte, at 16, 32 and 48 px', () => {
    for (const size of [16, 32, 48]) {
      const supplied = readFileSync(join(brandDir, 'png', `favicon-${size}.png`));
      const embedded = icon.find((image) => image.width === size);
      assert.ok(embedded.png.equals(supplied), `${size} px image differs from favicon-${size}.png`);
    }
  });

  // Catches a scaler that darkens, fades or shifts colour, or an image taken from the wrong source.
  it('scales 64, 128 and 256 px from the 1024 px app icon without changing its colour or opacity', () => {
    const source = colourMass(decodePng(readFileSync(join(brandDir, 'png/app-icon-1024.png'))));
    for (const size of [64, 128, 256]) {
      const mass = colourMass(decodePng(icon.find((image) => image.width === size).png));
      mass.forEach((value, channel) => {
        assert.ok(
          Math.abs(value - source[channel]) <= source[channel] * 0.002,
          `${size} px channel ${channel}: ${value.toFixed(2)} vs source ${source[channel].toFixed(2)}`,
        );
      });
    }
  });

  // A regenerated icon that drifted from the committed one means the file in Git is not the artwork's.
  it('rebuilds to the committed icon from the brand folder, the same every time', () => {
    const first = buildIcon(brandDir);
    assert.ok(first.equals(buildIcon(brandDir)), 'two builds differ');
    const rebuilt = readIco(first);
    rebuilt.forEach((image, index) => {
      assert.equal(image.width, icon[index].width);
      // Compare pixels rather than bytes, so a different zlib version cannot fail this.
      assert.ok(decodePng(image.png).data.equals(decodePng(icon[index].png).data));
    });
  });

  // A favicon of the wrong size must stop the build rather than land in the wrong slot of the icon.
  it('refuses to build when a favicon is not the size its name says', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'ledgerline-icon-'));
    try {
      mkdirSync(join(scratch, 'png'));
      for (const name of ['favicon-32.png', 'favicon-48.png', 'app-icon-1024.png']) {
        copyFileSync(join(brandDir, 'png', name), join(scratch, 'png', name));
      }
      copyFileSync(join(brandDir, 'png/favicon-32.png'), join(scratch, 'png/favicon-16.png'));
      assert.throws(() => buildIcon(scratch), /favicon-16\.png is 32x32, not 16x16/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
