import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { estimateWordTimings } from './tts.mjs';

export const SAMPLE_RATE = 48000;

export function runFfmpeg(ffmpegPath, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const out = [];
    let err = '';
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => {
      err += c.toString();
      if (err.length > 60_000) err = err.slice(-30_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg falhou (${code}): ${err.slice(-900)}`));
    });
    if (input) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

/** Decodifica qualquer áudio para PCM mono 16 bits. */
export async function decodePcm(ffmpegPath, inputFile, sampleRate = SAMPLE_RATE) {
  return runFfmpeg(ffmpegPath, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputFile,
    '-vn',
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    '-ac',
    '1',
    '-ar',
    String(sampleRate),
    'pipe:1',
  ]);
}

export function pcmDuration(pcm, sampleRate = SAMPLE_RATE) {
  return pcm.length / 2 / sampleRate;
}

export function writeWav(file, pcm, sampleRate = SAMPLE_RATE, channels = 1) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

function silence(seconds, sampleRate = SAMPLE_RATE) {
  return Buffer.alloc(Math.max(0, Math.round(seconds * sampleRate)) * 2);
}

function peakOf(pcm) {
  const view = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  let peak = 0;
  for (let i = 0; i < view.length; i++) {
    const v = Math.abs(view[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

function applyGain(pcm, gain) {
  const out = Buffer.from(pcm);
  const view = new Int16Array(out.buffer, out.byteOffset, Math.floor(out.length / 2));
  for (let i = 0; i < view.length; i++) view[i] = Math.max(-32768, Math.min(32767, Math.round(view[i] * gain)));
  return out;
}

function mix(base, extra, extraGain) {
  const out = Buffer.from(base);
  const b = new Int16Array(out.buffer, out.byteOffset, Math.floor(out.length / 2));
  const e = new Int16Array(extra.buffer, extra.byteOffset, Math.floor(extra.length / 2));
  const n = Math.min(b.length, e.length);
  for (let i = 0; i < n; i++) {
    const v = b[i] + e[i] * extraGain;
    // limitador suave
    b[i] = v > 30000 ? 30000 : v < -30000 ? -30000 : Math.round(v);
  }
  return out;
}

/**
 * Monta a faixa de áudio final e devolve os tempos absolutos de cada palavra.
 * @param {string} ffmpegPath
 * @param {{file:string, words:{text:string,start:number,end:number}[]}[]} clips
 */
export async function buildAudio(
  ffmpegPath,
  clips,
  { gap = 0.28, leadIn = 0.35, tail = 0.7, musicPath = null, musicVolume = 0.1, outFile } = {},
) {
  const parts = [silence(leadIn)];
  const timeline = [];
  let cursor = leadIn;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const pcm = await decodePcm(ffmpegPath, clip.file);
    const duration = pcmDuration(pcm);
    const words = clip.words?.length ? clip.words : estimateWordTimings(splitPlain(clip.text), duration);

    timeline.push({
      index: i,
      start: cursor,
      end: cursor + duration,
      duration,
      words: words.map((w) => ({ text: w.text, start: cursor + w.start, end: cursor + w.end })),
    });

    parts.push(pcm);
    cursor += duration;
    if (i < clips.length - 1) {
      parts.push(silence(gap));
      cursor += gap;
    }
  }

  parts.push(silence(tail));
  let voice = Buffer.concat(parts);

  const peak = peakOf(voice);
  const gain = peak > 0 ? (0.90 * 32767) / peak : 1;
  voice = applyGain(voice, gain);

  if (musicPath && fs.existsSync(musicPath) && musicVolume > 0) {
    try {
      const music = await decodePcm(ffmpegPath, musicPath);
      if (music.length > 0) {
        const targetLen = voice.length;
        const looped = Buffer.alloc(targetLen);
        for (let offset = 0; offset < targetLen; offset += music.length) {
          music.copy(looped, offset, 0, Math.min(music.length, targetLen - offset));
        }
        const musicPeak = peakOf(looped);
        const musicNorm = musicPeak > 0 ? (0.9 * 32767) / musicPeak : 1;
        const faded = applyGain(looped, musicNorm);
        // fade in/out da música
        const view = new Int16Array(faded.buffer, faded.byteOffset, Math.floor(faded.length / 2));
        const fadeIn = Math.round(1.2 * SAMPLE_RATE);
        const fadeOut = Math.round(1.8 * SAMPLE_RATE);
        for (let i = 0; i < fadeIn && i < view.length; i++) view[i] = Math.round(view[i] * (i / fadeIn));
        for (let i = 0; i < fadeOut && i < view.length; i++) {
          const idx = view.length - 1 - i;
          view[idx] = Math.round(view[idx] * (i / fadeOut));
        }
        voice = mix(voice, faded, musicVolume);
      }
    } catch (err) {
      console.warn('[audio] música ignorada:', err.message);
    }
  }

  const wavFile = outFile;
  writeWav(wavFile, voice);
  return {
    wavFile,
    duration: pcmDuration(voice),
    scenes: timeline,
  };
}

function splitPlain(text) {
  return String(text || '')
    .split(/\s+/)
    .filter(Boolean);
}
