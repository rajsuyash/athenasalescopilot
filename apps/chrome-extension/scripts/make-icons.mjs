/**
 * Minimal PNG encoder — emits a flat-color square with a stylised "A" using
 * solid pixels. Avoids pulling in sharp/canvas as a dev dep just for static
 * icon generation. Run this whenever the brand color changes.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'src', 'icons');
mkdirSync(outDir, { recursive: true });

// Brand colors (matches admin-web tailwind tokens). RGBA bytes.
const BG = [12, 21, 25, 255]; // ink-900-ish
const FG = [120, 220, 168, 255]; // accent (mint)

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Render a stylised "A" by drawing a triangle of FG pixels. The shape is
 * coarse — at 16px there are only ~256 pixels — but the silhouette reads.
 */
function isInsideA(x, y, size) {
  const cx = size / 2;
  const top = size * 0.18;
  const bottom = size * 0.82;
  const halfBaseTop = 0;
  const halfBaseBottom = size * 0.32;
  if (y < top || y > bottom) return false;
  const t = (y - top) / (bottom - top);
  const halfBase = halfBaseTop + (halfBaseBottom - halfBaseTop) * t;
  const dx = Math.abs(x + 0.5 - cx);
  const onLeg = Math.abs(dx - halfBase) <= Math.max(1, size * 0.08);
  const crossbar = y > size * 0.55 && y < size * 0.66 && dx <= halfBase;
  return onLeg || crossbar;
}

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = size * 4;
  const raw = Buffer.alloc((rowSize + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowSize + 1);
    raw[rowStart] = 0; // filter type none
    for (let x = 0; x < size; x++) {
      const inside = isInsideA(x, y, size);
      const px = inside ? FG : BG;
      const off = rowStart + 1 + x * 4;
      raw[off] = px[0];
      raw[off + 1] = px[1];
      raw[off + 2] = px[2];
      raw[off + 3] = px[3];
    }
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 32 added for the Chrome Web Store toolbar icon — manifest references all
// four sizes (16/32/48/128).
for (const size of [16, 32, 48, 128]) {
  const path = resolve(outDir, `icon-${size}.png`);
  writeFileSync(path, makePng(size));
  console.log('wrote', path);
}
