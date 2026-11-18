import { FONT } from '../../../lib/fonts.mjs';
import { clamp, easeOut, hashNumber, lerp, rng, roundRect } from '../../../lib/util.mjs';
import { activeWord, fitText } from '../text.mjs';
import { drawCover, grainPattern, vignette } from '../assets.mjs';

const RED = '#F0312A';
const INK = '#FFFFFF';

const PAGE_SIZE = 3;

export default {
  id: 'bold',
  name: 'Documental Bold',
  description: 'Fundo de imagens com zoom lento, texto gigante estilo Impact e palavras destacadas em vermelho. Cara de canal dark.',
  supports: ['9:16', '16:9', '1:1'],

  async prepare({ scene, ctx, metrics, index, background }) {
    const timing = scene.words || [];
    const list = timing.length ? timing.map((w) => w.text) : String(scene.say).split(/\s+/);
    const phrase = (scene.on_screen || '').trim();

    const pages = [];
    for (let i = 0; i < list.length; i += PAGE_SIZE) {
      const chunk = list.slice(i, i + PAGE_SIZE);
      pages.push({
        start: i,
        end: i + chunk.length,
        layout: fitText(ctx, chunk.join(' ').toUpperCase(), {
          maxWidth: Math.round(metrics.contentWidth * 1.0),
          maxSize: metrics.fontSize(148),
          minSize: metrics.fontSize(56),
          maxLines: 2,
          family: FONT.impact,
          lineHeightFactor: 1.02,
        }),
      });
    }

    const kicker = phrase
      ? fitText(ctx, phrase.toUpperCase(), {
          maxWidth: metrics.contentWidth,
          maxSize: metrics.fontSize(64),
          minSize: metrics.fontSize(28),
          maxLines: 2,
          family: FONT.black,
          lineHeightFactor: 1.05,
        })
      : null;

    const rand = rng(hashNumber(scene.say + index));
    const zoomStart = 1.06 + rand() * 0.06;
    const zoomEnd = zoomStart + 0.07 + rand() * 0.05;
    const panX = (rand() * 2 - 1) * metrics.fontSize(40);
    const panY = (rand() * 2 - 1) * metrics.fontSize(30);
    const hue = rand() * 360;

    return {
      pages,
      timing,
      kicker,
      background,
      emphasis: (scene.emphasis || []).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')),
      zoomStart,
      zoomEnd,
      panX,
      panY,
      hue,
      index,
    };
  },

  draw(ctx, { state, t, duration, metrics, index, total, globalT }) {
    const { W, H, margin } = metrics;
    const progress = clamp(t / Math.max(0.001, duration), 0, 1);
    const active = activeWord(state.timing, t);

    // fundo
    if (state.background) {
      const scale = lerp(state.zoomStart, state.zoomEnd, easeOut(progress));
      drawCover(ctx, state.background, W, H, scale, state.panX * progress, state.panY * progress);
      const shade = ctx.createLinearGradient(0, 0, 0, H);
      shade.addColorStop(0, 'rgba(4,4,6,0.72)');
      shade.addColorStop(0.42, 'rgba(4,4,6,0.45)');
      shade.addColorStop(0.72, 'rgba(4,4,6,0.82)');
      shade.addColorStop(1, 'rgba(4,4,6,0.95)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, `hsl(${state.hue}, 32%, 8%)`);
      g.addColorStop(0.55, '#0A0A0C');
      g.addColorStop(1, `hsl(${(state.hue + 40) % 360}, 38%, 12%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W * 0.2, H * 0.25, 0, W * 0.2, H * 0.25, W * 0.9);
      glow.addColorStop(0, `hsla(${state.hue}, 60%, 45%, 0.25)`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // número gigante apagado atrás do texto
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = '#ffffff';
      ctx.font = `${metrics.fontSize(520)}px ${FONT.impact}`;
      ctx.textAlign = 'center';
      ctx.fillText(String(index + 1).padStart(2, '0'), W / 2, metrics.top(0.52));
      ctx.restore();

      // luz suave descendo do topo
      ctx.save();
      const spot = ctx.createRadialGradient(W / 2, -H * 0.15, 0, W / 2, -H * 0.15, H * 0.95);
      spot.addColorStop(0, `hsla(${state.hue}, 70%, 62%, 0.16)`);
      spot.addColorStop(0.55, `hsla(${state.hue}, 70%, 62%, 0.05)`);
      spot.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spot;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    vignette(ctx, W, H, 0.8, '0,0,0');

    // barra de progresso no topo
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(0, 0, W, metrics.fontSize(7));
    ctx.fillStyle = RED;
    ctx.fillRect(0, 0, W * progress, metrics.fontSize(7));

    // etiqueta
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${metrics.fontSize(24)}px ${FONT.mono}`;
    ctx.letterSpacing = `${metrics.fontSize(4)}px`;
    ctx.fillStyle = INK;
    const label = `CAP. ${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
    const top = margin + metrics.fontSize(10);
        ctx.fillStyle = RED;
    roundRect(ctx, margin, top, metrics.fontSize(10), metrics.fontSize(30), metrics.fontSize(3));
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(label, margin + metrics.fontSize(22), top + metrics.fontSize(24));
    ctx.restore();

    // kicker (texto de apoio)
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';

    const baseY = metrics.top(0.72);
    if (state.kicker) {
      ctx.font = `${state.kicker.fontSize}px ${state.kicker.family}`;
      ctx.lineJoin = 'round';
      const placed = state.kicker.place(W / 2, metrics.top(0.42));
      placed.forEach((word) => {
        ctx.lineWidth = metrics.fontSize(10);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(word.text, word.x, word.y);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillText(word.text, word.x, word.y);
      });
    }

    // legendas em blocos de 3 palavras
    const pageIndex = Math.max(0, state.pages.findIndex((p) => active.index >= p.start && active.index < p.end));
    const page = state.pages[Math.min(pageIndex, state.pages.length - 1)];
    if (page) {
      const layout = page.layout;
      const pageStart = state.timing[page.start]?.start ?? 0;
      const pageEnter = easeOut(clamp((t - pageStart) / 0.14, 0, 1));
      const y = baseY + lerp(metrics.fontSize(24), 0, pageEnter);
      ctx.font = `${layout.fontSize}px ${layout.family}`;
      const placed = layout.place(W / 2, y);
      ctx.lineJoin = 'round';

      placed.forEach((word, i) => {
        const globalIndex = page.start + i;
        const isCurrent = globalIndex === active.index;
        const isSpoken = globalIndex < active.index;
        const clean = word.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        const isEmphasis = state.emphasis.includes(clean);

        if (isCurrent) {
          const padX = metrics.fontSize(13);
          const padY = metrics.fontSize(14);
          ctx.fillStyle = RED;
          roundRect(
            ctx,
            word.x - padX,
            word.y - layout.fontSize * 0.82,
            word.width + padX * 2,
            layout.fontSize * 1.02 + padY,
            metrics.fontSize(10),
          );
          ctx.fill();
        }

        ctx.lineWidth = metrics.fontSize(11);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(word.text, word.x, word.y);

        if (isCurrent) ctx.fillStyle = INK;
        else if (isSpoken) ctx.fillStyle = 'rgba(255,255,255,0.95)';
        else if (isEmphasis) ctx.fillStyle = "rgba(255,255,255,0.55)";
        else ctx.fillStyle = 'rgba(255,255,255,0.35)';

        ctx.globalAlpha = pageEnter;
        ctx.fillText(word.text, word.x, word.y);
        ctx.globalAlpha = 1;
      });
    }

    // assinatura
    ctx.save();
    ctx.font = `700 ${metrics.fontSize(20)}px ${FONT.mono}`;
    ctx.letterSpacing = `${metrics.fontSize(3)}px`;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.fillText('ESTÚDIO', W - margin, H - margin + metrics.fontSize(4));
    ctx.restore();
    ctx.textAlign = 'left';
  },
};
