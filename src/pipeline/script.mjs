import { loadConfig } from '../config.mjs';

const MAX_WORDS_PER_SCENE = 30;
const MAX_ONSCREEN_WORDS = 8;

const SYSTEM_PROMPT = `Você é roteirista de vídeos curtos e virais em português do Brasil para canais "dark" (sem aparecer).
Escreva roteiros que prendem do primeiro segundo: gancho forte, ritmo de fala natural, frases curtas, zero enrolação.

Responda SOMENTE com JSON válido, neste formato exato:
{"title":"titulo curto do video","scenes":[{"say":"frase narrada","on_screen":"texto curto na tela","emphasis":["palavra"],"kind":"hook"}]}

Regras:
- 8 a 14 cenas.
- "say" é o texto falado, no máximo 26 palavras por cena, linguagem falada, sem emojis, sem markdown, sem numeração.
- "on_screen" é o texto grande da tela: 2 a 6 palavras, impactante, sem repetir o "say" inteiro.
- "emphasis" são 1 a 3 palavras exatas (como aparecem em "say") que devem ganhar destaque visual.
- "kind": "hook" na primeira cena, "body" no meio, "payoff" na última.
- Primeira cena é um gancho que faz a pessoa parar de rolar.
- Última cena fecha com uma virada ou pergunta que gera comentário.
- Nada de introduções do tipo "hoje vamos falar sobre".`;

function stripMarkdown(text) {
  return String(text || '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const wordCount = (s) => (String(s).trim() ? String(s).trim().split(/\s+/).length : 0);

export function normalizeScenes(scenes) {
  return (scenes || [])
    .map((raw, index) => {
      const scene = typeof raw === 'string' ? { say: raw } : raw || {};
      let say = stripMarkdown(scene.say || scene.text || '');
      if (!say) return null;
      const words = say.split(/\s+/);
      if (words.length > MAX_WORDS_PER_SCENE) say = words.slice(0, MAX_WORDS_PER_SCENE).join(' ');
      let onScreen = stripMarkdown(scene.on_screen || scene.onScreen || '');
      const onWords = onScreen.split(/\s+/).filter(Boolean);
      if (onWords.length > MAX_ONSCREEN_WORDS) onScreen = onWords.slice(0, MAX_ONSCREEN_WORDS).join(' ');
      const emphasis = (Array.isArray(scene.emphasis) ? scene.emphasis : [])
        .map((w) => stripMarkdown(String(w || '')).toLowerCase())
        .filter(Boolean)
        .slice(0, 3);
      const kind = ['hook', 'body', 'payoff'].includes(scene.kind)
        ? scene.kind
        : index === 0
          ? 'hook'
          : 'body';
      return { say, on_screen: onScreen, emphasis, kind };
    })
    .filter(Boolean);
}

// Divide um roteiro colado em cenas.
export function splitScript(text) {
  const clean = stripMarkdown(text);
  if (!clean) return [];
  const sentences = clean
    .replace(/([.!?…])\s+/g, '$1\u0000')
    .split('\u0000')
    .map((s) => s.trim())
    .filter(Boolean);

  const scenes = [];
  let buffer = [];
  const flush = () => {
    const say = buffer.join(' ').trim();
    if (say) {
      const words = say.split(/\s+/);
      if (words.length > MAX_WORDS_PER_SCENE) {
        for (let i = 0; i < words.length; i += MAX_WORDS_PER_SCENE) {
          scenes.push({ say: words.slice(i, i + MAX_WORDS_PER_SCENE).join(' ') });
        }
      } else {
        scenes.push({ say });
      }
    }
    buffer = [];
  };

  for (const sentence of sentences) {
    buffer.push(sentence);
    if (buffer.join(' ').split(/\s+/).length >= 20) flush();
  }
  flush();
  return normalizeScenes(scenes);
}

function offlineSkeleton(theme) {
  const t = theme.trim();
  const guide = [
    ['hook', `Você já parou para pensar: ${t}?`],
    ['body', `A explicação mais óbvia não é a que convence quem estuda o assunto.`],
    ['body', `Existe um detalhe que quase ninguém nota no começo.`],
    ['body', `Quando você olha para os números, o desenho muda de forma.`],
    ['body', `E aí aparece a parte que realmente explica ${t}.`],
    ['payoff', `Agora que você sabe disso, a pergunta muda de lugar.`],
  ];
  return {
    title: t,
    scenes: guide.map(([kind, say]) => ({ say, kind })),
    offline: true,
  };
}

function extractJson(text) {
  const clean = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1));
      } catch {
        /* ignora */
      }
    }
    return null;
  }
}

async function callLlm({ theme, brief, sceneCount, tone }) {
  const cfg = loadConfig();
  const { baseUrl, apiKey, model } = cfg.llm;
  if (!apiKey) throw new Error('API key da IA não configurada.');

  const user = [
    `Tema: ${theme.trim()}`,
    sceneCount ? `Quantidade de cenas: ${sceneCount}` : 'Quantidade de cenas: 10',
    tone ? `Tom: ${tone}` : 'Tom: curioso, direto, sem sensacionalismo barato',
    brief ? `Observações do autor: ${brief.trim()}` : '',
    'Escreva o roteiro agora, em JSON.',
  ]
    .filter(Boolean)
    .join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.85,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`A IA respondeu ${res.status}: ${body.slice(0, 300) || res.statusText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? data?.message?.content ?? '';
  const parsed = extractJson(typeof content === 'string' ? content : JSON.stringify(content));
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('A IA não devolveu um roteiro no formato esperado. Tente gerar de novo.');
  }

  return {
    title: stripMarkdown(parsed.title || theme).slice(0, 90),
    scenes: normalizeScenes(parsed.scenes),
    offline: false,
  };
}

export async function generateScript({ theme, brief, sceneCount, tone, script }) {
  if (script && String(script).trim()) {
    const scenes = splitScript(script);
    if (!scenes.length) throw new Error('O roteiro colado está vazio.');
    return { title: (theme || scenes[0].say).slice(0, 90), scenes, offline: false, source: 'manual' };
  }

  const cleanTheme = String(theme || '').trim();
  if (!cleanTheme) throw new Error('Digite um tema para gerar o roteiro.');

  const cfg = loadConfig();
  if (!cfg.llm.apiKey) {
    return { ...offlineSkeleton(cleanTheme), source: 'skeleton' };
  }

  try {
    const result = await callLlm({ theme: cleanTheme, brief, sceneCount, tone });
    return { ...result, source: 'llm' };
  } catch (err) {
    // Sem IA o painel continua utilizável: devolve um esqueleto para o usuário editar.
    return { ...offlineSkeleton(cleanTheme), offline: true, source: 'skeleton', warning: err.message };
  }
}

export function estimateDuration(scenes) {
  // ~2.6 palavras por segundo é uma fala natural em pt-BR.
  const words = scenes.reduce((acc, s) => acc + wordCount(s.say), 0);
  return Math.round((words / 2.6) * 10) / 10;
}
