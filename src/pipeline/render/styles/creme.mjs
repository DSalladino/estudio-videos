import { FONT } from '../../../lib/fonts.mjs';
import { clamp, easeOut, lerp, roundRect } from '../../../lib/util.mjs';
import { activeWord, fitText } from '../text.mjs';
import { grainPattern } from '../assets.mjs';

const PALETTE = [
  { bg: '#F4EBD7', ink: '#16120D', accent: '#DE4A28' },
  { bg: '#EFE7D2', ink: '#101820', accent: '#1D5AC7' },
  { bg: '#F2E9DC', ink: '#171310', accent: '#0E7B5B' },
  { bg: '#F6EDE3', ink: '#1A1316', accent: '#B5306F' },
];

const PAGE_SIZE = 7;

export default {
  id: 'creme',
  name: 'Kinetic Creme',
  description: 'Papel creme, tipografia gigante e palavras surgindo no ritmo da narração. O mais versátil.',
  supports: ['9:16', '16:9', '1:1'],

  prepare({ scene, ctx, metrics, index }) {
    const palette = PALETTE[index % PALETTE.length];
    const phrase = (scene.on_screen || '').trim();
    const hasHeadline = Boolean(phrase);
    const timing = scene.words || [];

    let headline = null;
    let caption = null;
    let pages = null;

    if (hasHeadline) {
      headline = fitText(ctx, phrase.toUpperCase(), {
        maxWidth: metrics.contentWidth,
        maxSize: metrics.fontSize(124),
        minSize: metrics.fontSize(40),
        maxLines: 3,
        family: FONT.black,
        lineHeightFactor: 1.03,
      });
      caption = fitText(ctx, scene.say, {
        maxWidth: Math.round(metrics.contentWidth * 0.96),
        maxSize: metrics.fontSize(44),
        minSize: metrics.fontSize(26),
        maxLines: 2,
        family: FONT.sansRegular,
        lineHeightFactor: 1.24,
      });
    } else {
      // modo karaokê: a narração aparece em blocos curtos, acompanhando a voz
      const list = timing.length ? timing.map((w) => w.text) : String(scene.say).split(/\s+/);
      const chunks = [];
      for (let i = 0; i < list.length; i += PAGE_SIZE) chunks.push({ start: i, words: list.slice(i, i + PAGE_SIZE) });
      pages = chunks.map((chunk) => ({
        start: chunk.start,
        end: chunk.start + chunk.words.length,
        layout: fitText(ctx, chunk.words.join(' ').toUpperCase(), {
          maxWidth: metrics.contentWidth,
          maxSize: metrics.fontSize(146),
          minSize: metrics.fontSize(46),
          maxLines: 3,
          family: FONT.black,
          lineHeightFactor: 1.02,
        }),
      }));
    }

    const top = metrics.top(hasHeadline ? 0.36 : 0.44);
    const captionTop = headline ? top + headline.height + metrics.fontSize(46) : top;

    return {
      palette,
      headline,
      caption,
      pages,
      top,
      captionTop,
      emphasis: (scene.emphasis || []).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')),
      timing,
      hasHeadline,
    };
  },

  draw(ctx, { state, t, duration, metrics, index }) {
    const { W, H, margin } = metrics;
    const { palette, headline, caption, pages, top, captionTop, timing } = state;
    const enter = easeOut(clamp(t / 0.3, 0, 1));
    const slide = lerp(metrics.fontSize(26), 0, enter);
    const active = activeWord(timing, t);

    // fundo
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.16, H * 0.1, 0, W * 0.16, H * 0.1, W * 1.0);
    glow.addColorStop(0, hexAlpha(palette.accent, 0.15));
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const glow2 = ctx.createRadialGradient(W * 0.88, H * 0.84, 0, W * 0.88, H * 0.84, W * 0.85);
    glow2.addColorStop(0, 'rgba(255,255,255,0.6)');
    glow2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // cabeçalho
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = palette.ink;
    ctx.font = `600 ${metrics.fontSize(23)}px ${FONT.mono}`;
    ctx.letterSpacing = `${metrics.fontSize(4)}px`;
    ctx.fillText(`CAP. ${String(index + 1).padStart(2, '0')}`, margin, margin + metrics.fontSize(18));
    ctx.restore();

    if (state.emphasis[0]) {
      const label = state.emphasis[0].toUpperCase();
      ctx.save();
      ctx.font = `600 ${metrics.fontSize(21)}px ${FONT.sans}`;
      const w = ctx.measureText(label).width + metrics.fontSize(24);
      ctx.fillStyle = hexAlpha(palette.accent, 0.15);
      roundRect(ctx, margin, margin + metrics.fontSize(42), w, metrics.fontSize(42), metrics.fontSize(8));
      ctx.fill();
      ctx.fillStyle = palette.accent;
      ctx.letterSpacing = `${metrics.fontSize(1.5)}px`;
      ctx.fillText(label, margin + metrics.fontSize(12), margin + metrics.fontSize(70));
      ctx.restore();
    }

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';

    if (headline) {
      ctx.font = `${headline.fontSize}px ${headline.family}`;
      drawBlock(ctx, headline.place(W / 2, top + slide), {
        fontSize: headline.fontSize,
        family: headline.family,
        ink: palette.ink,
        accent: palette.accent,
        dim: false,
        alpha: enter,
        emphasis: state.emphasis,
        activeIndex: -1,
        metrics,
      });

      if (caption) {
        const capEnter = easeOut(clamp((t - 0.12) / 0.34, 0, 1));
        ctx.font = `${caption.fontSize}px ${caption.family}`;
        const placed = caption.place(W / 2, captionTop + slide);
        placed.forEach((word, i) => {
          const isCurrent = i === active.index;
          const isSpoken = i < active.index;
          ctx.globalAlpha = capEnter;
          ctx.fillStyle = isCurrent
            ? palette.accent
            : isSpoken
              ? hexAlpha(palette.ink, 0.9)
              : hexAlpha(palette.ink, 0.4);
          ctx.fillText(word.text, word.x, word.y);
          ctx.globalAlpha = 1;
        });
      }
    } else if (pages?.length) {
      const pageIndex = Math.min(
        pages.length - 1,
        Math.max(0, pages.findIndex((p) => active.index >= p.start && active.index < p.end)),
      );
      const page = pages[pageIndex];
      const pageStart = timing[page.start]?.start ?? 0;
      const pageEnter = easeOut(clamp((t - pageStart) / 0.22, 0, 1));
      ctx.font = `${page.layout.fontSize}px ${page.layout.family}`;
      drawBlock(ctx, page.layout.place(W / 2, top + slide * 0.6), {
        fontSize: page.layout.fontSize,
        family: page.layout.family,
        ink: palette.ink,
        accent: palette.accent,
        dim: true,
        alpha: pageEnter,
        emphasis: state.emphasis,
        activeIndex: active.index - page.start,
        metrics,
      });
    }

    // barra de progresso
    const barY = H - margin - metrics.fontSize(8);
    ctx.fillStyle = hexAlpha(palette.ink, 0.1);
    roundRect(ctx, margin, barY, W - margin * 2, metrics.fontSize(8), metrics.fontSize(4));
    ctx.fill();
    ctx.fillStyle = palette.accent;
    roundRect(ctx, margin, barY, (W - margin * 2) * clamp(t / Math.max(0.001, duration), 0, 1), metrics.fontSize(8), metrics.fontSize(4));
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.font = `600 ${metrics.fontSize(19)}px ${FONT.mono}`;
    ctx.letterSpacing = `${metrics.fontSize(3)}px`;
    ctx.fillStyle = palette.ink;
    ctx.textAlign = 'right';
    ctx.fillText('ESTÚDIO', W - margin, barY - metrics.fontSize(20));
    ctx.restore();
    ctx.textAlign = 'left';
  },
};

function drawBlock(ctx, placed, opts) {
  const { fontSize, family, ink, accent, dim, alpha, emphasis, activeIndex, metrics } = opts;
  if (family) ctx.font = `${fontSize}px ${family}`;
  ctx.letterSpacing = '0px';
  placed.forEach((word, i) => {
    const clean = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const isCurrent = i === activeIndex;
    const isSpoken = activeIndex >= 0 && i < activeIndex;
    const isEmphasis = !dim && emphasis?.includes(clean);

    let color = dim && !isSpoken && !isCurrent ? hexAlpha(ink, 0.28) : ink;
    if (isEmphasis) color = accent;
    if (isCurrent) color = accent;

    if (isCurrent) {
      const pad = metrics.fontSize(14);
      ctx.save();
      ctx.globalAlpha = 0.18 * alpha;
      ctx.fillStyle = accent;
      roundRect(ctx, word.x - pad, word.y - fontSize * 0.82, word.width + pad * 2, fontSize * 1.0, metrics.fontSize(10));
      ctx.fill();
      ctx.restore();
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillText(word.text, word.x, word.y);
    ctx.globalAlpha = 1;

    if (isCurrent) {
      ctx.fillStyle = accent;
      roundRect(ctx, word.x, word.y + metrics.fontSize(12), word.width, metrics.fontSize(7), metrics.fontSize(4));
      ctx.fill();
    }
  });
}

function hexAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
