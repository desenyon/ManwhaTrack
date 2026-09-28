// Procedural cover and page art for fixture sites and README screenshots:
// a gradient sky, a sun/moon and layered ridgelines, encoded as PNG with no dependencies.

import { deflateSync } from "node:zlib";

type RGB = [number, number, number];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

export function encodePng(w: number, h: number, px: (x: number, y: number) => RGB): Buffer {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) raw.set(px(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTES: { sky: [RGB, RGB]; sun: RGB; ridges: RGB[] }[] = [
  { sky: [[255, 190, 140], [233, 102, 92]], sun: [255, 236, 200], ridges: [[176, 72, 86], [118, 44, 76], [62, 26, 58]] },
  { sky: [[22, 30, 62], [74, 64, 140]], sun: [236, 234, 255], ridges: [[52, 50, 110], [34, 32, 78], [16, 16, 40]] },
  { sky: [[196, 232, 214], [88, 164, 150]], sun: [250, 252, 236], ridges: [[58, 128, 118], [34, 90, 88], [18, 54, 58]] },
  { sky: [[250, 214, 120], [226, 128, 60]], sun: [255, 248, 220], ridges: [[164, 84, 48], [110, 52, 40], [60, 30, 30]] },
  { sky: [[210, 222, 255], [120, 150, 230]], sun: [255, 255, 255], ridges: [[82, 108, 188], [52, 70, 140], [28, 38, 88]] },
  { sky: [[70, 18, 30], [190, 48, 58]], sun: [255, 200, 170], ridges: [[120, 24, 40], [78, 14, 28], [36, 8, 16]] },
  { sky: [[236, 214, 250], [168, 120, 214]], sun: [255, 246, 255], ridges: [[122, 82, 170], [84, 54, 128], [46, 28, 78]] },
  { sky: [[30, 46, 44], [80, 124, 102]], sun: [226, 244, 200], ridges: [[44, 84, 70], [28, 58, 50], [14, 32, 28]] },
];

const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB;

/** A 2:3 illustrated cover, deterministic per seed. */
export function coverArt(seed: string, w = 300, h = 450, palette?: number): Buffer {
  const r = rng(hash(seed));
  const pal = PALETTES[(palette ?? hash(seed)) % PALETTES.length]!;
  const sunX = w * (0.25 + r() * 0.5);
  const sunY = h * (0.22 + r() * 0.18);
  const sunR = w * (0.12 + r() * 0.1);
  const ridges = pal.ridges.map((col, i) => ({
    col,
    base: h * (0.52 + i * 0.14),
    amp: h * (0.05 + r() * 0.06),
    f1: 0.004 + r() * 0.01,
    f2: 0.015 + r() * 0.02,
    ph: r() * 10,
  }));
  return encodePng(w, h, (x, y) => {
    let c = mix(pal.sky[0], pal.sky[1], y / h);
    const d = Math.hypot(x - sunX, y - sunY);
    if (d < sunR) c = pal.sun;
    else if (d < sunR * 1.8) c = mix(pal.sun, c, (d - sunR) / (sunR * 0.8) * 0.6 + 0.4);
    for (const rg of ridges) {
      const top = rg.base - rg.amp * (Math.sin(x * rg.f1 + rg.ph) * 0.7 + Math.sin(x * rg.f2 + rg.ph * 2) * 0.3);
      if (y > top) c = rg.col;
    }
    // Subtle grain so covers don't look flat.
    const n = (hash(`${x},${y}`) % 9) - 4;
    return c.map((v) => Math.max(0, Math.min(255, v + n))) as RGB;
  });
}

/** A tall reader page: panels with sky gradients, like a vertical webtoon strip. */
export function pageArt(seed: string, w = 800, h = 1400): Buffer {
  const r = rng(hash(seed));
  const pal = PALETTES[hash(seed) % PALETTES.length]!;
  const cuts = [0, Math.round(h * (0.3 + r() * 0.1)), Math.round(h * (0.62 + r() * 0.1)), h];
  return encodePng(w, h, (x, y) => {
    const panel = cuts.findIndex((c, i) => y >= c && y < (cuts[i + 1] ?? h));
    const inGutter = y - cuts[panel]! < 18 || x < 24 || x > w - 24;
    if (inGutter) return [250, 250, 248];
    const t = (y - cuts[panel]!) / ((cuts[panel + 1] ?? h) - cuts[panel]!);
    const ridge = pal.ridges[panel % pal.ridges.length]!;
    const horizon = 0.65 + Math.sin(x * 0.01 + panel * 2) * 0.08;
    return t > horizon ? ridge : mix(pal.sky[0], pal.sky[1], t);
  });
}
