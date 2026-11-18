import fs from 'node:fs';
import path from 'node:path';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { PATHS } from '../../config.mjs';
import { hashNumber, rng } from '../../lib/util.mjs';

let brollCache = null;
const imageCache = new Map();

export function listBroll() {
  if (brollCache) return brollCache;
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(PATHS.broll);
  brollCache = files;
  return files;
}

export function refreshBroll() {
  brollCache = null;
  return listBroll();
}

export async function loadCachedImage(file) {
  if (imageCache.has(file)) return imageCache.get(file);
  const img = await loadImage(file);
  imageCache.set(file, img);
  return img;
}

/** Escolhe um fundo determinístico para a cena. */
export async function pickBackground(seedText) {
  const files = listBroll();
  if (!files.length) return null;
  const index = hashNumber(seedText) % files.length;
  try {
    return await loadCachedImage(files[index]);
  } catch {
    return null;
  }
}

/** Cobre a tela com a imagem mantendo a proporção (crop central). */
export function drawCover(ctx, image, W, H, scale = 1, offsetX = 0, offsetY = 0) {
  const iw = image.width || image.naturalWidth;
  const ih = image.height || image.naturalHeight;
  if (!iw || !ih) return;
  const base = Math.max(W / iw, H / ih) * scale;
  const w = iw * base;
  const h = ih * base;
  ctx.drawImage(image, (W - w) / 2 + offsetX, (H - h) / 2 + offsetY, w, h);
}

let grainTile = null;
export function grainPattern(ctx, size = 220, alpha = 14) {
  if (!grainTile) {
    const tile = createCanvas(size, size);
    const tctx = tile.getContext('2d');
    const data = tctx.createImageData(size, size);
    for (let i = 0; i < data.data.length; i += 4) {
      const v = 128 + (Math.random() * 2 - 1) * 110;
      data.data[i] = v;
      data.data[i + 1] = v;
      data.data[i + 2] = v;
      data.data[i + 3] = alpha;
    }
    tctx.putImageData(data, 0, 0);
    grainTile = tile;
  }
  return ctx.createPattern(grainTile, 'repeat');
}

export function starfield(ctx, W, H, count = 90, seed = 7) {
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const s = 1 + Math.floor(rand() * 3);
    ctx.fillStyle = `rgba(255,255,255,${0.10 + rand() * 0.35})`;
    ctx.fillRect(Math.round(x), Math.round(y), s, s);
  }
}

export function vignette(ctx, W, H, strength = 0.75, color = '0,0,0') {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.78);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(1, `rgba(${color},${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

export function scanlines(ctx, W, H, step = 4, alpha = 0.05) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  for (let y = 0; y < H; y += step) ctx.fillRect(0, y, W, 1);
}
