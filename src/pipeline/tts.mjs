import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EdgeTTS } from '@andresaya/edge-tts';
import { PATHS } from '../config.mjs';
import { sha1 } from '../lib/util.mjs';

const CACHE = path.join(PATHS.cache, 'tts');
fs.mkdirSync(CACHE, { recursive: true });

const PT_VOICES = [
  { id: 'pt-BR-FranciscaNeural', label: 'Francisca — feminina, natural (padrão)' },
  { id: 'pt-BR-ThalitaMultilingualNeural', label: 'Thalita — feminina, multilíngue' },
  { id: 'pt-BR-AntonioNeural', label: 'Antônio — masculina, grave' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tts = new EdgeTTS({ timeout: 45_000 });

let voiceCache = null;

export async function listVoices({ refresh = false } = {}) {
  if (voiceCache && !refresh) return voiceCache;
  const file = path.join(PATHS.cache, 'voices.json');
  try {
    const stat = fs.statSync(file);
    if (!refresh && Date.now() - stat.mtimeMs < 86_400_000) {
      voiceCache = JSON.parse(fs.readFileSync(file, 'utf8'));
      return voiceCache;
    }
  } catch {
    /* sem cache */
  }
  try {
    const voices = await tts.getVoices();
    const map = voices.map((v) => ({
      id: v.ShortName,
      label: `${v.ShortName.replace('Neural', '')} · ${v.Locale} · ${v.Gender === 'Male' ? 'M' : 'F'}`,
      locale: v.Locale,
      gender: v.Gender,
    }));
    voiceCache = map;
    fs.writeFileSync(file, JSON.stringify(map));
    return map;
  } catch {
    voiceCache = PT_VOICES.map((v) => ({ ...v, locale: 'pt-BR' }));
    return voiceCache;
  }
}

export function presetVoices() {
  return PT_VOICES;
}

function run(cmd, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = [];
    let err = '';
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(err.slice(-500) || `processo ${cmd} saiu com código ${code}`));
    });
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

// Fallback offline: voz do Windows (SAPI). Sem timestamps de palavra,
// então o tempo de cada palavra é estimado pelo tamanho.
async function sapiSynthesize(text, voiceHint = 'pt-BR') {
  if (process.platform !== 'win32') throw new Error('Fallback de voz disponível apenas no Windows.');
  const txtFile = path.join(CACHE, `sapi-${sha1(text)}.txt`);
  const wavFile = path.join(CACHE, `sapi-${sha1(text)}.wav`);
  fs.writeFileSync(txtFile, text, 'utf8');
  if (fs.existsSync(wavFile)) return wavFile;

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = Get-Content -LiteralPath '${txtFile.replace(/'/g, "''")}' -Raw -Encoding UTF8
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$pt = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like '${voiceHint}*' } | Select-Object -First 1
if ($pt) { $s.SelectVoice($pt.VoiceInfo.Name) }
$s.SetOutputToWaveFile('${wavFile.replace(/'/g, "''")}')
$s.Speak($text)
$s.Dispose()
`;
  const psFile = path.join(CACHE, `sapi-${sha1(text)}.ps1`);
  fs.writeFileSync(psFile, ps, 'utf8');
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile]);
  return wavFile;
}

function estimateWordTimings(words, duration) {
  const weights = words.map((w) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return words.map((w, i) => {
    const dur = (weights[i] / total) * duration;
    const item = { text: w, start: t, end: t + dur };
    t += dur;
    return item;
  });
}

export function splitWords(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Sintetiza uma cena.
 * @returns {Promise<{file:string, words:{text:string,start:number,end:number}[], engine:string}>}
 * start/end em segundos, relativos ao começo da cena.
 */
export async function synthesize(text, { voice, rate, pitch, engine = 'edge' } = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('Texto vazio para narração.');

  const key = sha1(`${engine}|${voice}|${rate}|${pitch}|${clean}`);
  const audioFile = path.join(CACHE, `${key}.mp3`);
  const metaFile = path.join(CACHE, `${key}.json`);

  if (fs.existsSync(audioFile) && fs.existsSync(metaFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      return { file: audioFile, ...meta };
    } catch {
      /* regenera */
    }
  }

  if (engine === 'sapi') {
    const wav = await sapiSynthesize(clean);
    return { file: wav, buffer: null, words: [], engine: 'sapi' };
  }

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await tts.generate(clean, voice, {
        rate: rate || '+0%',
        pitch: pitch || '+0Hz',
      });
      const buffer = Buffer.from(result.audio);
      if (!buffer.length) throw new Error('áudio vazio');
      fs.writeFileSync(audioFile, buffer);

      const boundaries = (result.wordBoundaries || []).map((b) => ({
        text: b.text,
        start: b.offset / 1e7,
        end: (b.offset + b.duration) / 1e7,
      }));

      const meta = {
        words: boundaries,
        duration: result.duration || (boundaries.at(-1)?.end ?? 0),
        engine: 'edge',
      };
      fs.writeFileSync(metaFile, JSON.stringify(meta));
      return { file: audioFile, ...meta };
    } catch (err) {
      lastError = err;
      await sleep(700 * (attempt + 1));
    }
  }

  // Última tentativa: voz do Windows, para o vídeo não deixar de sair.
  try {
    const wav = await sapiSynthesize(clean);
    return { file: wav, words: [], engine: 'sapi', warning: `Edge TTS falhou (${lastError?.message}); usei a voz do Windows.` };
  } catch {
    throw new Error(`Não foi possível gerar a narração: ${lastError?.message || 'erro desconhecido'}`);
  }
}

export { estimateWordTimings, run };
