import { FONT } from '../../../lib/fonts.mjs';
import { clamp, easeOut, lerp, roundRect, secondsLabel } from '../../../lib/util.mjs';
import { activeWord, fitText } from '../text.mjs';
import { scanlines, vignette } from '../assets.mjs';

const CYAN = '#4FF3E4';
const MAGENTA = '#FF4FA8';
const INK = '#EAFBFF';
const BG = '#05060C';

const PAGE_SIZE = 8;

export default {
  id: 'neon',
  name: 'HUD Cyberpunk',
  description: 'Painel futurista, grade neon, texto em máquina de escrever e brilho digital. Tech, mistério e IA.',
  supports: ['9:16', '16:9', '1:1'],

  prepare({ scene, ctx, metrics }) {
    const phrase = (scene.on_screen || '').trim();
    const hasHeadline = Boolean(phrase);
    const timing = scene.words || [];
    const text = hasHeadline ? phrase : scene.say;

    let headline = null;
    let pages = null;

    if (hasHeadline) {
      headline = fitText(ctx, text.toUpperCase(), {
        maxWidth: metrics.contentWidth,
        maxSize: metrics.fontSize(92),
        minSize: metrics.fontSize(34),
        maxLines: 3,
        family: FONT.mono,
        weight: '700',
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
            maxWidth: metrics.contentWidth,
            maxSize: metrics.fontSize(104),
            minSize: metrics.fontSize(38),
            maxLines: 3,
            family: FONT.mono,
            weight: '700',
            lineHeightFactor: 1.2,
          }),
        });
      }
    }

    const caption = hasHeadline
      ? fitText(ctx, scene.say.toUpperCase(), {
          maxWidth: metrics.contentWidth,
          maxSize: metrics.fontSize(34),
          minSize: metrics.fontSize(22),
          maxLines: 2,
          family: FONT.mono,
          weight: '400',
          lineHeightFactor: 1.35,
        })
      : null;

    return {
      headline,
      caption,
      pages,
      timing,
      emphasis: (scene.emphasis || []).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')),
      hasHeadline,
    };
  },

  draw(ctx, { state, t, duration, metrics, index, total, globalT }) {
    const { W, H, margin } = metrics;
    const active = activeWord(state.timing, t);

    // fundo
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const g1 = ctx.createRadialGradient(W * 0.15, H * 0.12, 0, W * 0.15, H * 0.12, W * 0.9);
    g1.addColorStop(0, 'rgba(79,243,228,0.16)');
    g1.addColorStop(1, 'rgba(79,243,228,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);

    const g2 = ctx.createRadialGradient(W * 0.9, H * 0.9, 0, W * 0.9, H * 0.9, W * 0.9);
    g2.addColorStop(0, 'rgba(255,79,168,0.14)');
    g2.addColorStop(1, 'rgba(255,79,168,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);

    // grade
    const grid = metrics.fontSize(54);
    const drift = (globalT * 12) % grid;
    ctx.strokeStyle = 'rgba(79,243,228,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -drift; x < W + grid; x += grid) {
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, H);
    }
    for (let y = -drift; y < H + grid; y += grid) {
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(W, Math.round(y) + 0.5);
    }
    ctx.stroke();

    scanlines(ctx, W, H, Math.max(3, metrics.fontSize(4)), 0.06);

    // HUD superior
    const hudSize = metrics.fontSize(24);
    ctx.save();
    ctx.font = `700 ${hudSize}px ${FONT.mono}`;
    ctx.letterSpacing = `${metrics.fontSize(3)}px`;
    ctx.textBaseline = 'alphabetic';

    const blink = Math.floor(globalT * 2) % 2 === 0;
    ctx.fillStyle = blink ? MAGENTA : 'rgba(255,79,168,0.35)';
    ctx.beginPath();
    ctx.arc(margin + hudSize * 0.4, margin + hudSize * 0.45, hudSize * 0.32, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = CYAN;
    ctx.fillText('REC', margin + hudSize * 1.1, margin + hudSize * 0.7);
    ctx.fillStyle = 'rgba(234,251,255,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText(`${secondsLabel(globalT)}`, W - margin, margin + hudSize * 0.7);
    ctx.textAlign = 'left';
    ctx.restore();

    // cantos
    const corner = metrics.fontSize(46);
    ctx.strokeStyle = 'rgba(79,243,228,0.55)';
    ctx.lineWidth = metrics.fontSize(3);
    const cy = margin + hudSize * 1.4;
    ctx.beginPath();
    ctx.moveTo(margin, cy + corner);
    ctx.lineTo(margin, cy);
    ctx.lineTo(margin + corner, cy);
    ctx.moveTo(W - margin - corner, cy);
    ctx.lineTo(W - margin, cy);
    ctx.lineTo(W - margin, cy + corner);
    ctx.stroke();

    const top = metrics.top(state.hasHeadline ? 0.4 : 0.42);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';

    if (state.headline) {
      const layout = state.headline;
      ctx.font = `700 ${layout.fontSize}px ${layout.family}`;
      const placed = layout.place(W / 2, top);
      const totalChars = placed.reduce((a, w) => a + w.text.length, 0);
      const reveal = Math.floor(totalChars * easeOut(clamp((t - 0.05) / Math.min(1.1, duration * 0.5), 0, 1)));
      // glitch só no começo da cena (abertura), depois o texto fica limpo
      const glitch = t < 0.34 ? 1 - t / 0.34 : 0;
      const jitter = glitch ? Math.sin(t * 90) * metrics.fontSize(5) * glitch : 0;
      let drawn = 0;

      ctx.save();
      placed.forEach((word) => {
        const remaining = Math.max(0, reveal - drawn);
        const slice = word.text.slice(0, remaining);
        drawn += word.text.length;
        if (!slice) return;
        const clean = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const isEmphasis = state.emphasis.includes(clean);
        // brilho
        ctx.shadowColor = isEmphasis ? MAGENTA : CYAN;
        ctx.shadowBlur = metrics.fontSize(26);
        ctx.fillStyle = isEmphasis ? MAGENTA : INK;
        ctx.fillText(slice, word.x + jitter, word.y);
        ctx.shadowBlur = 0;
        if (glitch > 0.02) {
          const shift = metrics.fontSize(2.4) * glitch;
          ctx.globalAlpha = 0.4 * glitch;
          ctx.fillStyle = MAGENTA;
          ctx.fillText(slice, word.x + jitter - shift, word.y);
          ctx.fillStyle = CYAN;
          ctx.fillText(slice, word.x + jitter + shift, word.y);
          ctx.globalAlpha = 1;
        }
      });
      ctx.restore();

      // cursor
      if (t < 2.5 && Math.floor(t * 3) % 2 === 0) {
        const last = placed[placed.length - 1];
        ctx.fillStyle = CYAN;
        ctx.fillRect(last.x + last.width + metrics.fontSize(6), top - layout.fontSize * 0.7, metrics.fontSize(14), layout.fontSize * 0.8);
      }

      if (state.caption) {
        const capTop = metrics.top(0.62);
        ctx.font = `400 ${state.caption.fontSize}px ${state.caption.family}`;
        const placedCap = state.caption.place(W / 2, capTop);
        placedCap.forEach((word, i) => {
          const isCurrent = i === active.index;
          const isSpoken = i < active.index;
          ctx.fillStyle = isCurrent ? CYAN : isSpoken ? 'rgba(234,251,255,0.85)' : 'rgba(234,251,255,0.28)';
          ctx.fillText(word.text, word.x, word.y);
        });
      }
    } else if (state.pages?.length) {
      const pageIndex = Math.max(0, state.pages.findIndex((p) => active.index >= p.start && active.index < p.end));
      const page = state.pages[Math.min(pageIndex, state.pages.length - 1)];
      const layout = page.layout;
      ctx.font = `700 ${layout.fontSize}px ${layout.family}`;
      const placed = layout.place(W / 2, top);
      placed.forEach((word, i) => {
        const globalIndex = page.start + i;
        const isCurrent = globalIndex === active.index;
        const isSpoken = globalIndex < active.index;
        const clean = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        let color = isCurrent ? CYAN : isSpoken ? 'rgba(234,251,255,0.9)' : 'rgba(234,251,255,0.22)';
        if (!isCurrent && state.emphasis.includes(clean)) color = MAGENTA;
        ctx.shadowColor = isCurrent ? CYAN : 'rgba(0,0,0,0)';
        ctx.shadowBlur = isCurrent ? metrics.fontSize(24) : 0;
        ctx.fillStyle = color;
        ctx.fillText(word.text, word.x, word.y);
      });
      ctx.shadowBlur = 0;
    }

    // barra inferior
    const barY = H - margin - metrics.fontSize(6);
    ctx.fillStyle = 'rgba(79,243,228,0.18)';
    ctx.fillRect(margin, barY, W - margin * 2, metrics.fontSize(3));
    ctx.fillStyle = CYAN;
    ctx.fillRect(margin, barY, (W - margin * 2) * clamp(t / Math.max(0.001, duration), 0, 1), metrics.fontSize(3));

    ctx.save();
    ctx.font = `700 ${metrics.fontSize(20)}px ${FONT.mono}`;
    ctx.letterSpacing = `${metrics.fontSize(3)}px`;
    ctx.fillStyle = 'rgba(234,251,255,0.45)';
    ctx.fillText(`CENA ${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`, margin, barY - metrics.fontSize(18));
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,79,168,0.6)';
    ctx.fillText('ESTÚDIO', W - margin, barY - metrics.fontSize(18));
    ctx.restore();
    ctx.textAlign = 'left';

    vignette(ctx, W, H, 0.85, '0,0,0');
  },
};
