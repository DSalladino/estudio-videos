import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { PATHS, loadConfig, saveConfig, isLlmReady } from './config.mjs';
import { generateScript, splitScript, estimateDuration } from './pipeline/script.mjs';
import { listStyles } from './pipeline/render.mjs';
import { listVideos } from './pipeline/render.mjs';
import { listVoices, presetVoices } from './pipeline/tts.mjs';
import { listBroll, refreshBroll } from './pipeline/render/assets.mjs';
import { getJob, startJob, subscribe, cancelJob } from './jobs.mjs';
import { initFonts } from './lib/fonts.mjs';

const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4_000_000) {
        reject(new Error('Corpo da requisição muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('JSON inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, baseDir, urlPath) {
  const safe = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(baseDir, safe);
  if (!file.startsWith(baseDir)) {
    res.writeHead(403).end('Proibido');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404).end('Não encontrado');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveMedia(req, res, fileName) {
  const safe = path.basename(decodeURIComponent(fileName));
  const file = path.join(PATHS.output, safe);
  if (!fs.existsSync(file)) {
    res.writeHead(404).end('Não encontrado');
    return;
  }
  const stat = fs.statSync(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range && mime === 'video/mp4') {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(file).pipe(res);
}

function listMusic() {
  if (!fs.existsSync(PATHS.music)) return [];
  return fs
    .readdirSync(PATHS.music)
    .filter((f) => /\.(mp3|wav|m4a|ogg|opus)$/i.test(f))
    .map((f) => ({ file: f, name: path.basename(f, path.extname(f)) }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (pathname === '/' || pathname === '/index.html') {
      serveStatic(res, path.join(PATHS.web), '/index.html');
      return;
    }

    if (pathname.startsWith('/media/')) {
      serveMedia(req, res, pathname.replace('/media/', ''));
      return;
    }

    if (pathname.startsWith('/assets/')) {
      const rel = pathname.replace('/assets/', '');
      if (rel.startsWith('broll/') || rel.startsWith('music/') || rel.startsWith('fonts/')) {
        res.writeHead(403).end('Proibido');
        return;
      }
      serveStatic(res, PATHS.assets, rel);
      return;
    }

    if (!pathname.startsWith('/api/')) {
      serveStatic(res, PATHS.web, pathname);
      return;
    }

    // ---- API ----
    if (pathname === '/api/health') {
      json(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/styles') {
      json(res, 200, { styles: listStyles() });
      return;
    }

    if (pathname === '/api/voices') {
      const voices = await listVoices();
      json(res, 200, { voices, presets: presetVoices() });
      return;
    }

    if (pathname === '/api/settings' && req.method === 'GET') {
      const cfg = loadConfig();
      json(res, 200, {
        llm: { ...cfg.llm, ready: isLlmReady(cfg) },
        defaults: cfg.defaults,
        music: listMusic(),
        broll: listBroll().length,
        formats: [
          { id: '9:16', label: '9:16 · Reels, Shorts, TikTok' },
          { id: '16:9', label: '16:9 · YouTube' },
          { id: '1:1', label: '1:1 · Feed' },
        ],
      });
      return;
    }

    if (pathname === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = saveConfig({
        llm: body.llm || undefined,
        defaults: body.defaults || undefined,
      });
      json(res, 200, { ok: true, llm: { ...cfg.llm, ready: isLlmReady(cfg) }, defaults: cfg.defaults });
      return;
    }

    if (pathname === '/api/script' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await generateScript(body);
      json(res, 200, {
        title: result.title,
        scenes: result.scenes,
        source: result.source,
        warning: result.warning || null,
        estimated: estimateDuration(result.scenes),
      });
      return;
    }

    if (pathname === '/api/script/split' && req.method === 'POST') {
      const body = await readBody(req);
      const scenes = splitScript(body.script || '');
      json(res, 200, { scenes, estimated: estimateDuration(scenes) });
      return;
    }

    if (pathname === '/api/render' && req.method === 'POST') {
      const body = await readBody(req);
      const cfg = loadConfig();
      const scenes = (body.scenes || []).filter((s) => s && String(s.say || '').trim());
      if (!scenes.length) {
        json(res, 400, { error: 'Escreva pelo menos uma cena com narração.' });
        return;
      }
      const job = startJob({
        title: body.title || scenes[0].say.slice(0, 60),
        scenes,
        style: body.style || cfg.defaults.style,
        format: body.format || cfg.defaults.format,
        voice: body.voice || cfg.defaults.voice,
        rate: body.rate || cfg.defaults.rate,
        pitch: body.pitch || cfg.defaults.pitch,
        fps: Number(body.fps) || cfg.defaults.fps,
        music: body.music || null,
        musicVolume: body.musicVolume ?? cfg.defaults.musicVolume,
      });
      json(res, 200, { job });
      return;
    }

    const jobMatch = /^\/api\/jobs\/([a-z0-9-]+)(\/events|\/cancel)?$/.exec(pathname);
    if (jobMatch) {
      const [, id, action] = jobMatch;
      if (action === '/cancel') {
        json(res, 200, { ok: cancelJob(id) });
        return;
      }
      if (action === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
        const unsubscribe = subscribe(id, send);
        const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);
        req.on('close', () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
        return;
      }
      const job = getJob(id);
      if (!job) {
        json(res, 404, { error: 'Job não encontrado.' });
        return;
      }
      json(res, 200, { job });
      return;
    }

    if (pathname === '/api/videos' && req.method === 'GET') {
      json(res, 200, { videos: listVideos() });
      return;
    }

    if (pathname.startsWith('/api/videos/') && req.method === 'DELETE') {
      const file = path.basename(decodeURIComponent(pathname.replace('/api/videos/', '')));
      const mp4 = path.join(PATHS.output, file);
      if (fs.existsSync(mp4)) fs.unlinkSync(mp4);
      const sidecar = mp4.replace(/\.mp4$/i, '.json');
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      const poster = mp4.replace(/\.mp4$/i, '.jpg');
      if (fs.existsSync(poster)) fs.unlinkSync(poster);
      json(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/broll/refresh' && req.method === 'POST') {
      json(res, 200, { count: refreshBroll().length });
      return;
    }

    json(res, 404, { error: 'Rota não encontrada.' });
  } catch (err) {
    console.error('[api]', err);
    json(res, 500, { error: err.message || 'Erro interno.' });
  }
});

initFonts();
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ESTÚDIO DE VÍDEOS');
  console.log(`  Abra no navegador: http://${HOST}:${PORT}`);
  console.log('');
  const topics = listBroll();
  if (topics.length) console.log(`  ${topics.length} imagens de fundo encontradas em assets/broll`);
  const music = listMusic();
  if (music.length) console.log(`  ${music.length} músicas encontradas em assets/music`);
  console.log('  Para parar, feche esta janela ou aperte Ctrl+C.');
  console.log('');
});
