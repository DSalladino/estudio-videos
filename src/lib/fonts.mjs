import fs from 'node:fs';
import path from 'node:path';
import { GlobalFonts } from '@napi-rs/canvas';
import { PATHS } from '../config.mjs';

// Aliases fixos para as fontes do sistema. Assim os estilos nao dependem
// do nome exato da familia instalada na maquina.
const SYSTEM_FONTS = [
  ['black', 'C:/Windows/Fonts/ariblk.ttf'],
  ['impact', 'C:/Windows/Fonts/impact.ttf'],
  ['mono', 'C:/Windows/Fonts/consolab.ttf'],
  ['serif', 'C:/Windows/Fonts/georgiab.ttf'],
  ['sans', 'C:/Windows/Fonts/seguibl.ttf'],
  ['sansRegular', 'C:/Windows/Fonts/segoeui.ttf'],
];

const LINUX_FALLBACKS = {
  black: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  impact: ['/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'],
  mono: ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'],
  serif: ['/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'],
  sans: ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'],
  sansRegular: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],
};

export const FONT = {
  black: 'EstudioBlack',
  impact: 'EstudioImpact',
  mono: 'EstudioMono',
  serif: 'EstudioSerif',
  sans: 'EstudioSans',
  sansRegular: 'EstudioSansRegular',
  custom: [],
};

export const fontStack = (family, size, weight = '') => `${weight} ${size}px ${family}`.trim();

export function initFonts() {
  for (const [alias, winPath] of SYSTEM_FONTS) {
    const candidates = [winPath, ...(LINUX_FALLBACKS[alias] || [])];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) continue;
    try {
      GlobalFonts.registerFromPath(found, FONT[alias]);
    } catch (err) {
      console.warn(`[fontes] falha ao carregar ${found}: ${err.message}`);
    }
  }

  // Fontes extras: qualquer .ttf/.otf em assets/fonts ganha o nome do arquivo.
  if (fs.existsSync(PATHS.fonts)) {
    for (const file of fs.readdirSync(PATHS.fonts)) {
      if (!/\.(ttf|otf)$/i.test(file)) continue;
      const family = `Custom:${path.basename(file, path.extname(file))}`;
      try {
        GlobalFonts.registerFromPath(path.join(PATHS.fonts, file), family);
        FONT.custom.push(family);
      } catch (err) {
        console.warn(`[fontes] falha ao carregar ${file}: ${err.message}`);
      }
    }
  }

  return GlobalFonts.families.map((f) => f.family);
}
