import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createCanvas } from '@napi-rs/canvas';
import ffmpegStatic from 'ffmpeg-static';
import { PATHS } from '../config.mjs';
import { initFonts } from '../lib/fonts.mjs';
import { metricsFor } from './render/layout.mjs';
import { pickBackground } from './render/assets.mjs';
import { synthesize } from './tts.mjs';
import { buildAudio } from './audio.mjs';
import { slugify } from '../lib/util.mjs';
import creme from './render/styles/creme.mjs';
import neon from './render/styles/neon.mjs';
import pixel from './render/styles/pixel.mjs';
import bold from './render/styles/bold.mjs';

// FFMPEG_BIN permite apontar para um ffmpeg do sistema.
const ffmpegPath = process.env.FFMPEG_BIN || ffmpegStatic;

export const STYLES = { creme, neon, pixel, bold };

export function listStyles() {
  return Object.values(STYLES).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    supports: s.supports,
  }));
}

const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Alinha as palavras exibidas com os tempos vindos do TTS.
 * O TTS às vezes junta/dividi números e siglas, então tentamos casar
 * por conteúdo e, se não der, distribuímos pelo tamanho das palavras.
 */
export function alignWords(displayWords, timing, duration) {
  const fallback = () => {
    const weights = displayWords.map((w) => Math.max(2, normalize(w).length) + 1);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let cursor = 0;
    return displayWords.map((w, i) => {
      const span = (weights[i] / total) * duration;
      const item = { text: w, start: cursor, end: cursor + span };
      cursor += span;
      return item;
    });
  };

  if (!timing?.length) return fallback();
  if (timing.length === displayWords.length) {
    return displayWords.map((w, i) => ({ text: w, start: timing[i].start, end: timing[i].end }));
  }

  const out = [];
  let j = 0;
  for (let i = 0; i < displayWords.length; i++) {
    const target = normalize(displayWords[i]);
    if (!target) {
      out.push({ text: displayWords[i], start: timing[Math.min(j, timing.length - 1)]?.start ?? 0, end: 0 });
      continue;
    }
    const startIndex = j;
    let acc = '';
    while (j < timing.length && j - startIndex < 4 && !acc.includes(target)) {
      acc += normalize(timing[j].text);
      j++;
    }
    if (acc.includes(target) && j > startIndex) {
      out.push({ text: displayWords[i], start: timing[startIndex].start, end: timing[j - 1].end });
    } else {
      // não casou: volta e distribui o restante
      j = startIndex;
      const remaining = displayWords.length - i;
      const restTiming = timing.slice(j);
      if (restTiming.length >= remaining) {
        const per = Math.ceil(restTiming.length / remaining);
        const chunk = restTiming.slice(0, per);
        out.push({ text: displayWords[i], start: chunk[0].start, end: chunk[chunk.length - 1].end });
        j += per;
      } else {
        const last = restTiming[restTiming.length - 1];
        out.push({ text: displayWords[i], start: last?.start ?? 0, end: last?.end ?? duration });
      }
    }
  }
  return out;
}

import { once } from 'node:events';

async function frameWriter(ff, buffer) {
  if (!ff.stdin.write(buffer)) await once(ff.stdin, 'drain');
}

/**
 * Renderiza o vídeo inteiro.
 * @param {{title:string, scenes:object[], style:string, format:string, voice:string,
 *          rate:string, pitch:string, fps:number, music:string|null, musicVolume:number}} input
 */
export async function renderVideo(input, { onProgress = () => {}, signal } = {}) {
  const isPath = /[/\\]/.test(String(ffmpegPath));
  if (!ffmpegPath || (isPath && !fs.existsSync(ffmpegPath))) {
    throw new Error(
      'ffmpeg não encontrado. Rode "npm rebuild ffmpeg-static" (ou "npm install --foreground-scripts") para baixar o binário.',
    );
  }
  const style = STYLES[input.style];
  if (!style) throw new Error(`Estilo desconhecido: ${input.style}`);
  const metrics = metricsFor(input.format);
  if (!style.supports.includes(metrics.format.id)) {
    throw new Error(`O estilo ${style.name} não suporta o formato ${metrics.format.id}.`);
  }

  const scenes = (input.scenes || []).filter((s) => String(s.say || '').trim());
  if (!scenes.length) throw new Error('Nenhuma cena para renderizar.');

  const fps = Math.min(60, Math.max(15, Number(input.fps) || 30));
  const warnings = [];
  const id = `${Date.now().toString(36)}-${slugify(input.title || scenes[0].say)}`;
  const workDir = path.join(PATHS.cache, 'render', id);
  fs.mkdirSync(workDir, { recursive: true });

  initFonts();

  // 1) narração
  const clips = [];
  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) throw new Error('Renderização cancelada.');
    onProgress({ stage: 'narração', progress: 2 + (i / scenes.length) * 38, message: `Narrando cena ${i + 1}/${scenes.length}` });
    const scene = scenes[i];
    const clip = await synthesize(scene.say, {
      voice: input.voice,
      rate: input.rate,
      pitch: input.pitch,
    });
    if (clip.warning) warnings.push(clip.warning);
    clips.push({ ...clip, text: scene.say });
  }

  // 2) trilha de áudio final
  onProgress({ stage: 'áudio', progress: 42, message: 'Montando a trilha de áudio' });
  const musicPath = input.music ? path.join(PATHS.music, path.basename(input.music)) : null;
  const audio = await buildAudio(ffmpegPath, clips, {
    gap: 0.26,
    leadIn: 0.32,
    tail: 0.6,
    musicPath: musicPath && fs.existsSync(musicPath) ? musicPath : null,
    musicVolume: Number(input.musicVolume) || 0.1,
    outFile: path.join(workDir, 'audio.wav'),
  });

  // 3) preparar cada cena (layout + fundo)
  onProgress({ stage: 'layout', progress: 48, message: 'Preparando cenas' });
  const canvas = createCanvas(metrics.W, metrics.H);
  const ctx = canvas.getContext('2d');
  const prepared = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const timing = audio.scenes[i];
    const displayWords = String(scene.say).split(/\s+/).filter(Boolean);
    const words = alignWords(displayWords, timing.words, timing.duration).map((w) => ({
      text: w.text,
      start: Math.max(0, w.start - timing.start),
      end: Math.max(0, w.end - timing.start),
    }));
    const enriched = { ...scene, words };
    const background = style.id === 'bold' ? await pickBackground(scene.say + i) : null;
    const state = await style.prepare({
      scene: enriched,
      ctx,
      metrics,
      index: i,
      total: scenes.length,
      format: metrics.format.id,
      background,
    });
    prepared.push({ scene: enriched, state, timing });
  }

  // 4) renderizar frames
  const totalFrames = Math.ceil(audio.duration * fps);
  const outName = `${id}.mp4`;
  const outFile = path.join(PATHS.output, outName);

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgba',
    '-s',
    `${metrics.W}x${metrics.H}`,
    '-r',
    String(fps),
    '-i',
    'pipe:0',
    '-i',
    audio.wavFile,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '19',
    '-pix_fmt',
    'yuv420p',
    '-g',
    String(fps * 2),
    '-threads',
    String(Math.min(8, Math.max(2, Math.floor(os.cpus().length / 2)))),
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    outFile,
  ];

  const ff = spawn(ffmpegPath, args, { windowsHide: true });
  let stderr = '';
  ff.stderr.on('data', (c) => {
    stderr += c.toString();
    if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
  });
  const closed = new Promise((resolve, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-800) || `ffmpeg saiu com ${code}`))));
  });
  ff.stdin.on('error', () => {});

  let sceneIndex = 0;
  let lastTick = 0;
  const posterFile = path.join(PATHS.output, `${id}.jpg`);
  const posterAt = Math.round((prepared[0].timing.start + Math.min(1.8, prepared[0].timing.duration * 0.6)) * fps);
  let posterSaved = false;
  for (let frame = 0; frame < totalFrames; frame++) {
    if (signal?.aborted) {
      ff.kill('SIGKILL');
      throw new Error('Renderização cancelada.');
    }
    const t = frame / fps;
    while (sceneIndex < prepared.length - 1 && t >= prepared[sceneIndex].timing.end) sceneIndex++;
    const current = prepared[sceneIndex];
    const localT = Math.max(0, t - current.timing.start);

    ctx.save();
    style.draw(ctx, {
      state: current.state,
      t: localT,
      duration: current.timing.duration,
      metrics,
      scene: current.scene,
      index: sceneIndex,
      total: prepared.length,
      globalT: t,
      fps,
    });
    ctx.restore();

    await frameWriter(ff, canvas.data());

    if (!posterSaved && frame >= posterAt) {
      try {
        fs.writeFileSync(posterFile, canvas.toBuffer('image/jpeg'));
        posterSaved = true;
      } catch {
        /* miniatura é opcional */
      }
    }

    if (frame - lastTick > 12) {
      lastTick = frame;
      onProgress({
        stage: 'render',
        progress: 50 + (frame / totalFrames) * 48,
        message: `Renderizando frame ${frame + 1}/${totalFrames}`,
      });
    }
  }

  ff.stdin.end();
  await closed;

  const stat = fs.statSync(outFile);
  const meta = {
    file: outName,
    title: input.title || scenes[0].say.slice(0, 60),
    style: style.id,
    format: metrics.format.id,
    duration: Math.round(audio.duration * 10) / 10,
    scenes: scenes.length,
    width: metrics.W,
    height: metrics.H,
    fps,
    bytes: stat.size,
    poster: posterSaved ? `${id}.jpg` : null,
    createdAt: new Date().toISOString(),
    voice: input.voice,
    music: input.music || null,
  };
  fs.writeFileSync(path.join(PATHS.output, `${id}.json`), JSON.stringify(meta, null, 2));
  fs.rmSync(workDir, { recursive: true, force: true });

  onProgress({ stage: 'pronto', progress: 100, message: 'Vídeo pronto' });
  return { ...meta, warnings };
}

export function listVideos() {
  const items = [];
  for (const file of fs.readdirSync(PATHS.output)) {
    if (!file.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(PATHS.output, file), 'utf8'));
      const mp4 = path.join(PATHS.output, meta.file);
      if (!fs.existsSync(mp4)) continue;
      items.push({ ...meta, url: `/media/${encodeURIComponent(meta.file)}` });
    } catch {
      /* ignora */
    }
  }
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
