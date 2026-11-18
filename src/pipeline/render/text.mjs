import { clamp } from '../../lib/util.mjs';

export function words(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function measureWord(ctx, word) {
  const m = ctx.measureText(word);
  return { width: m.width, ascent: m.actualBoundingBoxAscent || 0, descent: m.actualBoundingBoxDescent || 0 };
}

function wrap(ctx, list, maxWidth) {
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = [];
  let width = 0;
  for (const word of list) {
    const w = { text: word, width: ctx.measureText(word).width };
    const added = line.length ? space + w.width : w.width;
    if (line.length && width + added > maxWidth) {
      lines.push({ words: line, width });
      line = [{ text: word, width: w.width }];
      width = w.width;
    } else {
      line.push(w);
      width += added;
    }
  }
  if (line.length) lines.push({ words: line, width });
  return lines;
}

/**
 * Ajusta o texto ao bloco: escolhe o maior tamanho de fonte que cabe em
 * maxLines linhas e maxWidth de largura.
 */
export function fitText(ctx, text, options) {
  const {
    maxWidth,
    maxSize = 140,
    minSize = 28,
    maxLines = 3,
    family,
    weight = '',
    lineHeightFactor = 1.08,
    step = 2,
  } = options;

  const list = words(text);
  let chosen = null;
  for (let size = maxSize; size >= minSize; size -= step) {
    ctx.font = `${weight} ${size}px ${family}`.trim();
    const lines = wrap(ctx, list, maxWidth);
    const fits = lines.length <= maxLines && lines.every((l) => l.width <= maxWidth + 1);
    if (fits) {
      chosen = { size, lines };
      break;
    }
    if (!chosen) chosen = { size: minSize, lines: wrap(ctx, list, maxWidth) };
  }
  if (!chosen) {
    ctx.font = `${weight} ${minSize}px ${family}`.trim();
    chosen = { size: minSize, lines: wrap(ctx, list, maxWidth) };
  }

  const { size, lines } = chosen;
  const spaceWidth = ctx.measureText(' ').width;
  const lineHeight = Math.round(size * lineHeightFactor);
  const height = lineHeight * lines.length;

  return {
    fontSize: size,
    lineHeight,
    height,
    maxWidth,
    family,
    weight,
    lines,
    spaceWidth,
    // posiciona as palavras em coordenadas absolutas
    place(cx, top, align = 'center') {
      const out = [];
      let y = top;
      for (const line of lines) {
        const startX = align === 'center' ? cx - line.width / 2 : align === 'right' ? cx - line.width : cx;
        let x = startX;
        line.words.forEach((w) => {
          out.push({ text: w.text, x, y, width: w.width, line: y });
          x += w.width + spaceWidth;
        });
        y += lineHeight;
      }
      return out;
    },
  };
}

/** Divide as palavras em páginas de N palavras (estilo legenda viral). */
export function paginate(list, perPage = 4) {
  const pages = [];
  for (let i = 0; i < list.length; i += perPage) pages.push(list.slice(i, i + perPage));
  return pages;
}

/**
 * Descobre qual palavra está sendo falada em `t` (segundos).
 * Devolve o índice e o progresso da palavra atual.
 */
export function activeWord(timingWords, t) {
  if (!timingWords?.length) return { index: -1, progress: 0 };
  let index = -1;
  for (let i = 0; i < timingWords.length; i++) {
    if (t >= timingWords[i].start) index = i;
    else break;
  }
  if (index < 0) return { index: -1, progress: 0 };
  const w = timingWords[index];
  const span = Math.max(0.0001, w.end - w.start);
  return { index, progress: clamp((t - w.start) / span, 0, 1) };
}

export function drawCenterText(ctx, text, x, y, { font, color, align = 'center', baseline = 'alphabetic' } = {}) {
  if (font) ctx.font = font;
  if (color) ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
