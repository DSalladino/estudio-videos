import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export const PATHS = {
  root: ROOT,
  output: path.join(ROOT, 'output'),
  cache: path.join(ROOT, '.cache'),
  assets: path.join(ROOT, 'assets'),
  fonts: path.join(ROOT, 'assets', 'fonts'),
  broll: path.join(ROOT, 'assets', 'broll'),
  music: path.join(ROOT, 'assets', 'music'),
  web: path.join(ROOT, 'web'),
  config: path.join(ROOT, 'config.json'),
};

for (const dir of [PATHS.output, PATHS.cache, PATHS.assets, PATHS.fonts, PATHS.broll, PATHS.music]) {
  fs.mkdirSync(dir, { recursive: true });
}

const DEFAULTS = {
  llm: {
    // Qualquer endpoint compativel com OpenAI (OpenAI, Groq, OpenRouter, DeepSeek, Gemini via proxy, Ollama...)
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  defaults: {
    style: 'creme',
    format: '9:16',
    voice: 'pt-BR-FranciscaNeural',
    rate: '+8%',
    pitch: '+0Hz',
    music: false,
    musicVolume: 0.10,
    fps: 30,
  },
};

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

export function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(PATHS.config, 'utf8'));
  } catch {
    saved = {};
  }
  return deepMerge(DEFAULTS, saved);
}

export function saveConfig(patch) {
  const next = deepMerge(loadConfig(), patch || {});
  fs.writeFileSync(PATHS.config, JSON.stringify(next, null, 2));
  return next;
}

export function isLlmReady(cfg = loadConfig()) {
  return Boolean(cfg.llm?.apiKey && cfg.llm?.baseUrl && cfg.llm?.model);
}
