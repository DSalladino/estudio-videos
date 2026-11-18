import { randomUUID } from 'node:crypto';
import { renderVideo } from './pipeline/render.mjs';

const jobs = new Map();
let queue = Promise.resolve();

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: Math.round(job.progress),
    stage: job.stage,
    message: job.message,
    error: job.error,
    result: job.result,
    createdAt: job.createdAt,
    title: job.title,
  };
}

function notify(job) {
  const payload = publicJob(job);
  for (const listener of job.listeners || []) {
    try {
      listener(payload);
    } catch {
      /* ignora */
    }
  }
}

export function getJob(id) {
  const job = jobs.get(id);
  return job ? publicJob(job) : null;
}

export function subscribe(id, listener) {
  const job = jobs.get(id);
  if (!job) return () => {};
  job.listeners.add(listener);
  listener(publicJob(job));
  return () => job.listeners.delete(listener);
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.cancelled = true;
  job.controller?.abort();
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.message = 'Cancelado';
    notify(job);
  }
  return true;
}

export function startJob(input) {
  const id = randomUUID().slice(0, 8);
  const job = {
    id,
    title: input.title || (input.scenes?.[0]?.say || 'vídeo').slice(0, 60),
    status: 'queued',
    progress: 0,
    stage: 'fila',
    message: 'Na fila para renderizar',
    error: null,
    result: null,
    createdAt: new Date().toISOString(),
    listeners: new Set(),
    controller: new AbortController(),
  };
  jobs.set(id, job);
  notify(job);

  queue = queue
    .then(() => run(job, input))
    .catch(() => {})
    .finally(() => {
      // mantém no máximo 40 jobs na memória
      if (jobs.size > 40) {
        const oldest = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        jobs.delete(oldest.id);
      }
    });

  return publicJob(job);
}

async function run(job, input) {
  if (job.cancelled) return;
  job.status = 'running';
  notify(job);
  try {
    const result = await renderVideo(input, {
      signal: job.controller.signal,
      onProgress: (p) => {
        job.progress = p.progress;
        job.stage = p.stage;
        job.message = p.message;
        notify(job);
      },
    });
    job.status = 'done';
    job.result = result;
    job.progress = 100;
  } catch (err) {
    job.status = job.cancelled ? 'cancelled' : 'error';
    job.error = job.controller.signal.aborted ? 'Renderização cancelada.' : err.message;
  }
  notify(job);
}
