// Renders the bookmark into public/icons as PNGs. Matches ui/Brand.tsx.
// Run: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [71, 38, 206];
const FG = [247, 243, 232];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Coverage of a pixel by a shape, 4x4 supersampled for smooth edges.
function coverage(x, y, inside) {
  let n = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++;
  return n / 16;
}

function tile(px, py, s) {
  const r = s * 0.1875;
  const cx = Math.min(Math.max(px, r), s - r);
  const cy = Math.min(Math.max(py, r), s - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function bookmark(px, py, s) {
  const x = px / s * 32, y = py / s * 32;
  return x >= 10 && x <= 22 && y >= 7 && y <= 22 + Math.abs(x - 16) * 2 / 3;
}

mkdirSync("public/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const img = png(size, (x, y, s) => {
    const t = coverage(x, y, (a, b) => tile(a, b, s));
    const m = coverage(x, y, (a, b) => bookmark(a, b, s));
    const c = BG.map((v, i) => Math.round(v * (1 - m) + FG[i] * m));
    return [...c, Math.round(255 * t)];
  });
  writeFileSync(`public/icons/icon${size}.png`, img);
}
console.log("icons written");
