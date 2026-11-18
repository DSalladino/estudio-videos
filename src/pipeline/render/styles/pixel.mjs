import { createCanvas } from '@napi-rs/canvas';
import { FONT } from '../../../lib/fonts.mjs';
import { activeWord, fitText } from '../text.mjs';
import { starfield } from '../assets.mjs';

const PIX = 3; // desenha em 1/3 da resolução e amplia sem suavizar
const BG = '#0B0D22';
const LIME = '#A8E05F';
const PINK = '#FF6BD6';
const WHITE = '#F2F3F7';
const DIM = '#5A5F80';

const PAGE_SIZE = 6;

function scaled(metrics) {
  const f = 1 / PIX;
  return {
    W: Math.ceil(metrics.W * f),
    H: Math.ceil(metrics.H * f),
    margin: Math.max(3, Math.round(metrics.margin * f)),
    contentWidth: Math.round(metrics.contentWidth * f),
    fontSize: (n) => Math.max(4, Math.round(n * f)),
    top: (r) => Math.round(metrics.H * r * f),
    format: metrics.format,
    scale: f,
  };
}

function pixelBox(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.lineTo(x + w - r, y + r);
  ctx.lineTo(x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.lineTo(x + w - r, y + h - r);
  ctx.lineTo(x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.lineTo(x + r, y + h - r);
  ctx.lineTo(x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x + r, y + r);
  ctx.closePath();
}

export default {
  id: 'pixel',
  name: 'Pixel 8-bit',
  description: 'Estética de videogame retrô: caixa de diálogo, pixels grossos e neon. Bom para games, curiosidades e listas.',
  supports: ['9:16', '16:9', '1:1'],

  prepare({ scene, ctx, metrics, index }) {
    const m = scaled(metrics);
    const timing = scene.words || [];
    const phrase = (scene.on_screen || '').trim();
    const hasHeadline = Boolean(phrase);
    const padding = m.fontSize(58);
    const textWidth = m.contentWidth - padding * 2;

    let headline = null;
    let caption = null;
    let pages = null;

    if (hasHeadline) {
      headline = fitText(ctx, phrase.toUpperCase(), {
        maxWidth: m.contentWidth,
        maxSize: m.fontSize(320),
        minSize: m.fontSize(90),
        maxLines: 3,
        family: FONT.black,
        lineHeightFactor: 1.1,
      });
      caption = fitText(ctx, scene.say.toUpperCase(), {
        maxWidth: textWidth,
        maxSize: m.fontSize(190),
        minSize: m.fontSize(62),
        maxLines: 3,
        family: FONT.mono,
        lineHeightFactor: 1.24,
      });
    } else {
      const list = timing.length ? timing.map((w) => w.text) : String(scene.say).split(/\s+/);
      pages = [];
      for (let i = 0; i < list.length; i += PAGE_SIZE) {
        const chunk = list.slice(i, i + PAGE_SIZE);
        pages.push({
          start: i,
          end: i + chunk.length,
          layout: fitText(ctx, chunk.join(' ').toUpperCase(), {
            maxWidth: textWidth,
            maxSize: m.fontSize(230),
            minSize: m.fontSize(64),
            maxLines: 3,
            family: FONT.black,
            lineHeightFactor: 1.14,
          }),
        });
      }
    }

    const activeLayout = hasHeadline
      ? caption
      : pages.reduce((tallest, p) => (p.layout.height > tallest.height ? p.layout : tallest), pages[0].layout);
    const boxH = Math.round(activeLayout.height + padding * 2);
    const box = {
      x: m.margin,
      y: m.H - m.margin - m.fontSize(72) - boxH,
      w: m.contentWidth,
      h: boxH,
      padding,
    };

    return {
      m,
      box,
      headline,
      caption,
      pages,
      timing,
      hasHeadline,
      index,
      stars: 60 + index * 13,
      emphasis: (scene.emphasis || []).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')),
    };
  },

  draw(ctx, { state, t, duration, metrics, index, total }) {
    const m = state.m;
    if (!state.buffer) state.buffer = createCanvas(m.W, m.H);
    const bctx = state.buffer.getContext('2d');
    bctx.imageSmoothingEnabled = false;

    const active = activeWord(state.timing, t);

    bctx.fillStyle = BG;
    bctx.fillRect(0, 0, m.W, m.H);

    const grad = bctx.createLinearGradient(0, 0, 0, m.H);
    grad.addColorStop(0, 'rgba(60,80,180,0.38)');
    grad.addColorStop(0.45, 'rgba(20,22,60,0.10)');
    grad.addColorStop(1, 'rgba(120,30,120,0.30)');
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, m.W, m.H);

    starfield(bctx, m.W, m.H, state.stars, 11 + index);
    starfield(bctx, m.W, m.H, 26, 90 + index);

    // grade do chão
    const horizon = m.H * 0.5;
    bctx.strokeStyle = 'rgba(168,224,95,0.13)';
    bctx.lineWidth = 1;
    bctx.beginPath();
    for (let i = 0; i < 12; i++) {
      bctx.moveTo(m.W / 2 + (i - 5.5) * m.W * 0.03, horizon);
      bctx.lineTo(m.W / 2 + (i - 5.5) * m.W * 0.22, m.H);
    }
    for (let i = 1; i < 8; i++) {
      const y = horizon + Math.pow(i / 8, 2) * (m.H - horizon);
      bctx.moveTo(0, y);
      bctx.lineTo(m.W, y);
    }
    bctx.stroke();

    // HUD
    bctx.textBaseline = 'top';
    bctx.fillStyle = LIME;
    bctx.font = `${m.fontSize(60)}px ${FONT.mono}`;
    bctx.fillText(`FASE ${String(index + 1).padStart(2, '0')}`, m.margin, m.margin);
    bctx.fillStyle = DIM;
    bctx.textAlign = 'right';
    bctx.fillText(`${index + 1}/${total}`, m.W - m.margin, m.margin);
    bctx.textAlign = 'left';

    for (let i = 0; i < 3; i++) {
      const s = m.fontSize(26);
      bctx.fillStyle = i === 0 ? PINK : 'rgba(255,107,214,0.30)';
      bctx.fillRect(m.margin + i * (s + m.fontSize(10)), m.margin + m.fontSize(80), s, s);
    }

    bctx.textBaseline = 'alphabetic';

    if (state.headline) {
      bctx.font = `${state.headline.fontSize}px ${state.headline.family}`;
      const placed = state.headline.place(m.W / 2, m.top(0.30));
      placed.forEach((word) => {
        const clean = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const isEmphasis = state.emphasis.includes(clean);
        bctx.fillStyle = isEmphasis ? PINK : WHITE;
        bctx.fillText(word.text, word.x + m.fontSize(7), word.y + m.fontSize(7));
        bctx.fillStyle = isEmphasis ? PINK : LIME;
        bctx.fillText(word.text, word.x, word.y);
      });
      bctx.textBaseline = 'top';
    }

    // caixa de diálogo (retro, cantos retos)
    const { box } = state;
    bctx.fillStyle = "rgba(6,7,20,0.92)";
    bctx.fillRect(box.x, box.y, box.w, box.h);
    bctx.lineWidth = m.fontSize(10);
    bctx.strokeStyle = WHITE;
    bctx.strokeRect(box.x, box.y, box.w, box.h);
    bctx.lineWidth = m.fontSize(4);
    bctx.strokeStyle = LIME;
    bctx.strokeRect(box.x + m.fontSize(18), box.y + m.fontSize(18), box.w - m.fontSize(36), box.h - m.fontSize(36));

    const layout = state.hasHeadline ? state.caption : state.pages[
      Math.max(0, state.pages.findIndex((p) => active.index >= p.start && active.index < p.end))
    ]?.layout;

    if (layout) {
      const top = box.y + (box.h - layout.height) / 2 + layout.fontSize * 0.84;
      const placed = layout.place(box.x + box.w / 2, top);
      bctx.font = `${layout.fontSize}px ${layout.family}`;
      bctx.textBaseline = 'alphabetic';
      const pageStart = state.hasHeadline ? 0 : state.pages.find((p) => p.layout === layout)?.start ?? 0;

      placed.forEach((word, i) => {
        const globalIndex = pageStart + i;
        const isCurrent = globalIndex === active.index;
        const isSpoken = globalIndex < active.index;
        if (isCurrent) {
          const padX = m.fontSize(12);
          const padY = m.fontSize(6);
          bctx.fillStyle = LIME;
          bctx.fillRect(word.x - padX, word.y - layout.fontSize * 0.8, word.width + padX * 2, layout.fontSize * 0.96 + padY);
          bctx.fillStyle = '#101226';
        } else {
          bctx.fillStyle = isSpoken ? WHITE : DIM;
        }
        bctx.fillText(word.text, word.x, word.y);
      });
    }

    // barra de progresso em blocos
    const blocks = 34;
    const bw = (m.W - m.margin * 2) / blocks;
    const filled = Math.round((t / Math.max(0.001, duration)) * blocks);
    for (let i = 0; i < blocks; i++) {
      bctx.fillStyle = i < filled ? LIME : 'rgba(168,224,95,0.18)';
      bctx.fillRect(m.margin + i * bw + 1, m.H - m.margin - m.fontSize(14), bw - 3, m.fontSize(14));
    }

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(state.buffer, 0, 0, metrics.W, metrics.H);
    ctx.imageSmoothingEnabled = true;
  },
};
