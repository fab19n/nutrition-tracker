#!/usr/bin/env node
/**
 * Generates the PWA app icons (design/README.md › Assets): a --bg tile with a "570" hero numeral in
 * --text and a two-segment bar under it in --accent + --accent-soft, after the 72px icon on the
 * direction board (option 6a).
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes public/icons/icon-192.png, icon-512.png and icon-maskable-512.png. No dependencies: shapes
 * are signed-distance functions sampled per pixel (anti-aliased), encoded as PNG with node:zlib.
 * Colours come from the light :root block of src/styles/tokens.css.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

function readTokens() {
  const css = readFileSync(join(ROOT, 'src', 'styles', 'tokens.css'), 'utf8');
  const block = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1];
  if (!block) throw new Error('No :root block in tokens.css');
  const pick = (name) => {
    const hex = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];
    if (!hex) throw new Error(`Token --${name} is not a 6-digit hex colour`);
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  };
  return { bg: pick('bg'), text: pick('text'), accent: pick('accent'), accentSoft: pick('accent-soft') };
}

// ---------------------------------------------------------------------------
// Signed distance functions (negative inside), in pixels
// ---------------------------------------------------------------------------

/** Rounded box centred at (cx, cy) with half sizes (hw, hh) and corner radius r. */
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

/** Axis-aligned rectangle [x0, x1] × [y0, y1] with corner radius r. */
function sdRect(px, py, x0, y0, x1, y1, r = 0) {
  return sdRoundBox(px, py, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, r);
}

/** Thick segment a→b with round ends, half thickness ht. */
function sdCapsule(px, py, ax, ay, bx, by, ht) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(Math.max((pax * bax + pay * bay) / (bax * bax + bay * bay), 0), 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - ht;
}

/** Circular arc (centre, radius R) from angle a0 to a1 (radians, y down, clockwise), round caps. */
function sdArc(px, py, cx, cy, R, a0, a1, ht) {
  let a = Math.atan2(py - cy, px - cx);
  while (a < a0) a += Math.PI * 2;
  if (a <= a1) return Math.abs(Math.hypot(px - cx, py - cy) - R) - ht;
  const e0 = Math.hypot(px - (cx + R * Math.cos(a0)), py - (cy + R * Math.sin(a0)));
  const e1 = Math.hypot(px - (cx + R * Math.cos(a1)), py - (cy + R * Math.sin(a1)));
  return Math.min(e0, e1) - ht;
}

// ---------------------------------------------------------------------------
// The "570" numeral: heavy geometric digits in a box (x, y, w, h), stroke t
// ---------------------------------------------------------------------------

function digit5(px, py, x, y, w, h, t) {
  const r = t * 0.12;
  const bowlOuter = h * 0.33; // outer radius of the bowl
  const bowlTop = y + h - 2 * bowlOuter;
  const cx = x + w - bowlOuter;
  const cy = y + h - bowlOuter;
  const R = bowlOuter - t / 2;
  const top = sdRect(px, py, x + w * 0.06, y, x + w * 0.96, y + t, r);
  const stem = sdRect(px, py, x + w * 0.06, y, x + w * 0.06 + t, bowlTop + t, r);
  const join = sdRect(px, py, x + w * 0.06, bowlTop, cx, bowlTop + t, r);
  const bowl = sdArc(px, py, cx, cy, R, -Math.PI / 2, Math.PI * 0.74, t / 2);
  return Math.min(top, stem, join, bowl);
}

function digit7(px, py, x, y, w, h, t) {
  const r = t * 0.12;
  const top = sdRect(px, py, x, y, x + w, y + t, r);
  const leg = Math.max(
    sdCapsule(px, py, x + w - t * 0.55, y + t * 0.5, x + w * 0.3, y + h + t, t / 2),
    py - (y + h), // flat foot on the baseline
  );
  return Math.min(top, leg);
}

function digit0(px, py, x, y, w, h, t) {
  const hw = w / 2 - t / 2;
  const hh = h / 2 - t / 2;
  return Math.abs(sdRoundBox(px, py, x + w / 2, y + h / 2, hw, hh, hw)) - t / 2;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/**
 * Lays the mark out like the 72px design tile (padding 14, "570" at 26px/800, a 7px bar split 2:1
 * with a 2px gap), scaled to `size`; `scale` < 1 shrinks it into the maskable safe zone.
 */
function drawIcon(size, colours, scale = 1) {
  const u = size / 72; // one design pixel
  const em = 26 * u * scale;
  const digitH = 0.7 * em;
  const digitW = 0.54 * em;
  const spacing = 0.04 * em;
  const stroke = 0.17 * em;
  const markW = 44 * u * scale;
  const barH = 7 * u * scale;
  const barGap = 2 * u * scale;
  const gapBelow = 9 * u * scale;
  const markH = digitH + gapBelow + barH;
  const left = (size - markW) / 2;
  const top = (size - markH) / 2;
  const numeralW = 3 * digitW + 2 * spacing;
  const numeralLeft = left + (markW - numeralW) / 2;
  const barTop = top + digitH + gapBelow;
  const segW = (markW - barGap) / 3;

  const digits = [digit5, digit7, digit0].map((fn, i) => ({ fn, x: numeralLeft + i * (digitW + spacing) }));
  const pixels = Buffer.alloc(size * size * 3);
  const blend = (base, over, alpha) => base.map((c, i) => Math.round(c + (over[i] - c) * alpha));
  const coverage = (d) => Math.min(Math.max(0.5 - d, 0), 1);

  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const px = i + 0.5;
      const py = j + 0.5;
      let colour = colours.bg;

      const strong = sdRect(px, py, left, barTop, left + 2 * segW, barTop + barH, barH / 2);
      const soft = sdRect(px, py, left + 2 * segW + barGap, barTop, left + markW, barTop + barH, barH / 2);
      colour = blend(colour, colours.accent, coverage(strong));
      colour = blend(colour, colours.accentSoft, coverage(soft));

      let numeral = Infinity;
      for (const { fn, x } of digits) numeral = Math.min(numeral, fn(px, py, x, top, digitW, digitH, stroke));
      colour = blend(colour, colours.text, coverage(numeral));

      pixels.set(colour, (j * size + i) * 3);
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// PNG encoding (8-bit RGB, no filtering)
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  header[10] = 0; // compression
  header[11] = 0; // filter method
  header[12] = 0; // no interlace
  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

const colours = readTokens();
// Opaque, full-bleed squares: launchers apply their own mask, and iOS (apple-touch-icon → 192)
// fills transparency with black. The maskable mark shrinks into the central 80% safe zone.
const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78 },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const { file, size, scale } of ICONS) {
  const png = encodePng(size, drawIcon(size, colours, scale));
  writeFileSync(join(OUT_DIR, file), png);
  console.log(`public/icons/${file}  ${size}×${size}  ${png.length.toLocaleString('en')} bytes`);
}
