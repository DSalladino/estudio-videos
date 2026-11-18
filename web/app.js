const $ = (sel) => document.querySelector(sel);

const state = {
  styles: [],
  formats: [],
  voices: [],
  music: [],
  scenes: [],
  style: 'creme',
  format: '9:16',
  voice: 'pt-BR-FranciscaNeural',
  rate: 8,
  musicFile: '',
  jobId: null,
  source: null,
  busy: false,
  stream: null,
};

class ApiError extends Error {}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(data?.error || `Erro ${res.status}`);
  return data;
}

let toastTimer = null;
function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}

function rateToLabel(value) {
  return `${value >= 0 ? '+' : ''}${value}%`;
}

/* ---------------- estilo e formato ---------------- */

function renderStyles() {
  const wrap = $('#styleList');
  wrap.innerHTML = '';
  for (const style of state.styles) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-card';
    btn.setAttribute('aria-pressed', String(style.id === state.style));
    btn.innerHTML = `<strong>${escapeHtml(style.name)}</strong><small>${escapeHtml(style.description)}</small>`;
    btn.addEventListener('click', () => {
      state.style = style.id;
      renderStyles();
      saveDefaults();
    });
    wrap.appendChild(btn);
  }
}

function renderFormats() {
  const wrap = $('#formatSeg');
  wrap.innerHTML = '';
  for (const format of state.formats) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = format.id;
    btn.title = format.label;
    btn.setAttribute('aria-pressed', String(format.id === state.format));
    btn.addEventListener('click', () => {
      state.format = format.id;
      renderFormats();
      saveDefaults();
    });
    wrap.appendChild(btn);
  }
}

function renderVoices() {
  const select = $('#voice');
  select.innerHTML = '';
  const seen = new Set();
  const list = state.voices.filter((v) => {
    const locale = v.locale || (v.id || '').split('-').slice(0, 2).join('-');
    if (!/^pt/i.test(locale) && !/^pt/i.test(v.id || '')) return false;
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  if (!list.length) {
    list.push({ id: 'pt-BR-FranciscaNeural', label: 'Francisca · pt-BR' });
  }
  for (const voice of list) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = voice.label || voice.id;
    select.appendChild(option);
  }
  if (list.some((v) => v.id === state.voice)) select.value = state.voice;
  else state.voice = select.value;
}

function renderMusic() {
  const select = $('#music');
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = state.music.length ? 'Sem música' : 'Sem música (coloque arquivos em assets/music)';
  select.appendChild(none);
  for (const track of state.music) {
    const option = document.createElement('option');
    option.value = track.file;
    option.textContent = track.name;
    select.appendChild(option);
  }
  select.value = state.musicFile;
  updateMusicLabel();
}

function updateMusicLabel() {
  const track = state.music.find((m) => m.file === state.musicFile);
  $('#musicLabel').textContent = track ? track.name : 'desligada';
  $('#musicVolume').disabled = !track;
}

/* ---------------- roteiro ---------------- */

const KIND_LABEL = { hook: 'gancho', body: 'conteúdo', payoff: 'fechamento' };

function renderScenes() {
  const wrap = $('#scenes');
  wrap.innerHTML = '';
  if (!state.scenes.length) {
    const empty = document.createElement('div');
    empty.className = 'scene-empty';
    empty.innerHTML =
      'Nenhuma cena ainda.<br />Digite um tema e clique em <strong>Gerar roteiro</strong>, cole o seu roteiro ou adicione cenas na mão.';
    wrap.appendChild(empty);
    updateEstimate();
    return;
  }
  state.scenes.forEach((scene, index) => {
    const card = document.createElement('div');
    card.className = 'scene';

    const head = document.createElement('div');
    head.className = 'scene-head';
    head.innerHTML = `
      <span class="scene-num">${String(index + 1).padStart(2, '0')}</span>
      <span class="scene-kind">${KIND_LABEL[scene.kind] || 'conteúdo'}</span>
      <span class="grow"></span>
      <button type="button" class="icon-btn" title="Remover cena">×</button>`;

    const removeBtn = head.querySelector('.icon-btn');
    removeBtn.addEventListener('click', () => {
      state.scenes.splice(index, 1);
      renderScenes();
    });

    const say = document.createElement('textarea');
    say.value = scene.say || '';
    say.placeholder = 'O que a narração fala nesta cena';
    say.addEventListener('input', () => {
      scene.say = say.value;
      updateEstimate();
    });

    const onScreen = document.createElement('input');
    onScreen.value = scene.on_screen || '';
    onScreen.placeholder = 'Texto grande na tela (opcional)';
    onScreen.addEventListener('input', () => {
      scene.on_screen = onScreen.value;
    });

    card.append(head, say, onScreen);
    wrap.appendChild(card);
  });
  updateEstimate();
}

function updateEstimate() {
  const scenes = state.scenes.filter((s) => (s.say || '').trim());
  const words = scenes.reduce((acc, s) => acc + String(s.say).trim().split(/\s+/).length, 0);
  const seconds = Math.round((words / 2.6) * 1.0);
  const label = seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
  $('#estimate').textContent = `${scenes.length} cena${scenes.length === 1 ? '' : 's'} · ~${label}`;
}

async function generate() {
  const theme = $('#theme').value.trim();
  const script = $('#scriptText').value.trim();
  if (!theme && !script) {
    toast('Digite um tema ou cole um roteiro.', true);
    $('#theme').focus();
    return;
  }
  const btn = $('#generateBtn');
  btn.disabled = true;
  btn.textContent = script ? 'Dividindo roteiro…' : 'Escrevendo com IA…';
  $('#generateHint').textContent = '';
  try {
    const data = await api('/api/script', {
      method: 'POST',
      body: JSON.stringify({ theme, script }),
    });
    state.scenes = data.scenes || [];
    state.source = data.source;
    if (data.title && !$('#title').value.trim()) $('#title').value = data.title;
    renderScenes();
    if (data.source === 'skeleton') {
      $('#generateHint').textContent =
        data.warning
          ? `A IA não respondeu (${data.warning}). Deixei um roteiro base para você editar.`
          : 'Sem chave de IA: montei um roteiro base. Edite as cenas ou configure a IA no botão acima.';
    } else if (data.source === 'manual') {
      $('#generateHint').textContent = 'Roteiro dividido em cenas. Ajuste o que quiser e renderize.';
    } else {
      const seconds = Math.round(data.estimated || 0);
      $('#generateHint').textContent = `Roteiro pronto · ~${seconds}s de narração. Pode editar antes de renderizar.`;
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Gerar roteiro';
  }
}

/* ---------------- renderização ---------------- */

async function render() {
  const scenes = state.scenes
    .map((s) => ({
      say: (s.say || '').trim(),
      on_screen: (s.on_screen || '').trim(),
      emphasis: s.emphasis || [],
      kind: s.kind || 'body',
    }))
    .filter((s) => s.say);
  if (!scenes.length) {
    toast('Escreva o texto de pelo menos uma cena.', true);
    return;
  }

  const btn = $('#renderBtn');
  btn.disabled = true;
  btn.textContent = 'Renderizando…';
  setProgress({ progress: 0, stage: 'iniciando', message: 'Preparando…' });

  try {
    const data = await api('/api/render', {
      method: 'POST',
      body: JSON.stringify({
        title: $('#title').value.trim() || scenes[0].say.slice(0, 60),
        scenes,
        style: state.style,
        format: state.format,
        voice: state.voice,
        rate: rateToLabel(state.rate),
        music: state.musicFile || null,
        musicVolume: Number($('#musicVolume').value) / 100,
      }),
    });
    state.jobId = data.job.id;
    followJob(data.job.id);
  } catch (err) {
    toast(err.message, true);
    resetRenderButton();
  }
}

function followJob(jobId) {
  if (state.stream) state.stream.close();
  const stream = new EventSource(`/api/jobs/${jobId}/events`);
  state.stream = stream;
  stream.onmessage = (event) => {
    const job = JSON.parse(event.data);
    setProgress(job);
    if (job.status === 'done') {
      stream.close();
      state.stream = null;
      toast('Vídeo pronto!');
      resetRenderButton();
      loadVideos(job.result?.file);
    } else if (job.status === 'error' || job.status === 'cancelled') {
      stream.close();
      state.stream = null;
      toast(job.error || 'A renderização falhou.', true);
      resetRenderButton();
    }
  };
  stream.onerror = () => {
    stream.close();
    state.stream = null;
    resetRenderButton();
  };
}

function setProgress(job) {
  const wrap = $('#progress');
  wrap.classList.remove('hidden');
  const pct = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
  $('#progressFill').style.width = `${pct}%`;
  $('#progressPct').textContent = `${pct}%`;
  $('#progressStage').textContent = job.stage || 'renderizando';
  $('#progressMessage').textContent = job.message || '';
  $('#cancelBtn').style.display = job.status === 'running' || job.status === 'queued' ? '' : 'none';
}

function resetRenderButton() {
  const btn = $('#renderBtn');
  btn.disabled = false;
  btn.textContent = 'Renderizar vídeo';
}

/* ---------------- biblioteca ---------------- */

async function loadVideos(highlightFile = null) {
  try {
    const { videos } = await api('/api/videos');
    const wrap = $('#videos');
    wrap.innerHTML = '';
    $('#emptyLibrary').style.display = videos.length ? 'none' : '';
    for (const video of videos) {
      const card = document.createElement('div');
      card.className = `video-card${video.format === '16:9' ? ' wide' : ''}`;

      const el = document.createElement('video');
      el.src = video.url;
      el.controls = true;
      el.preload = 'metadata';
      el.playsInline = true;
      if (video.poster) el.poster = `/media/${encodeURIComponent(video.poster)}`;
      if (video.width && video.height) el.style.aspectRatio = `${video.width} / ${video.height}`;

      const meta = document.createElement('div');
      meta.className = 'video-meta';
      const title = document.createElement('strong');
      title.textContent = video.title || video.file;
      const tags = document.createElement('div');
      tags.className = 'video-tags';
      tags.innerHTML = `
        <span>${escapeHtml(video.format || '')}</span>
        <span>${Math.round(video.duration || 0)}s</span>
        <span>${(video.bytes / 1048576).toFixed(1)} MB</span>
        <span>${escapeHtml(video.style || '')}</span>`;

      const actions = document.createElement('div');
      actions.className = 'video-actions';
      const download = document.createElement('a');
      download.href = video.url;
      download.download = video.file;
      download.textContent = 'baixar mp4';
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = 'Apagar vídeo';
      del.textContent = '×';
      del.addEventListener('click', async () => {
        if (!confirm('Apagar este vídeo?')) return;
        await api(`/api/videos/${encodeURIComponent(video.file)}`, { method: 'DELETE' });
        loadVideos();
      });
      actions.append(download, del);

      meta.append(title, tags, actions);
      card.append(el, meta);
      if (highlightFile && video.file === highlightFile) card.style.borderColor = 'var(--mint)';
      wrap.appendChild(card);
    }
  } catch (err) {
    console.error(err);
  }
}

/* ---------------- configuração ---------------- */

async function saveDefaults() {
  try {
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        defaults: {
          style: state.style,
          format: state.format,
          voice: state.voice,
          rate: rateToLabel(state.rate),
          musicVolume: Number($('#musicVolume').value) / 100,
        },
      }),
    });
  } catch {
    /* silencioso */
  }
}

function openSettings() {
  const dialog = $('#settingsDialog');
  const llm = state.settings?.llm || {};
  $('#llmBaseUrl').value = llm.baseUrl || '';
  $('#llmModel').value = llm.model || '';
  $('#llmApiKey').value = llm.apiKey || '';
  dialog.showModal();
}

async function saveSettings() {
  const payload = {
    llm: {
      baseUrl: $('#llmBaseUrl').value.trim() || 'https://api.openai.com/v1',
      model: $('#llmModel').value.trim() || 'gpt-4o-mini',
      apiKey: $('#llmApiKey').value.trim(),
    },
  };
  try {
    const data = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
    state.settings.llm = data.llm;
    updateAiStatus();
    toast('Configuração salva.');
  } catch (err) {
    toast(err.message, true);
  }
}

function updateAiStatus() {
  const pill = $('#aiStatus');
  const ready = Boolean(state.settings?.llm?.ready);
  pill.textContent = ready ? `IA: ${state.settings.llm.model}` : 'IA: desligada';
  pill.classList.toggle('ok', ready);
  pill.classList.toggle('warn', !ready);
}

/* ---------------- bootstrap ---------------- */

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function boot() {
  try {
    const [stylesData, voicesData, settings] = await Promise.all([
      api('/api/styles'),
      api('/api/voices'),
      api('/api/settings'),
    ]);
    state.styles = stylesData.styles;
    state.voices = voicesData.voices || [];
    state.settings = settings;
    state.formats = settings.formats || [];
    state.music = settings.music || [];
    const defaults = settings.defaults || {};
    state.style = defaults.style || state.styles[0]?.id || 'creme';
    state.format = defaults.format || '9:16';
    state.voice = defaults.voice || 'pt-BR-FranciscaNeural';
    state.rate = parseInt(String(defaults.rate || '+8%').replace(/[^-\d]/g, ''), 10) || 0;
    state.musicFile = '';

    renderStyles();
    renderFormats();
    renderVoices();
    renderMusic();
    $('#rate').value = state.rate;
    $('#rateLabel').textContent = rateToLabel(state.rate);
    $('#musicVolume').value = Math.round((defaults.musicVolume ?? 0.1) * 100);
    updateAiStatus();
    renderScenes();
    loadVideos();
  } catch (err) {
    toast(`Não consegui falar com o servidor: ${err.message}`, true);
  }
}

function bindEvents() {
  $('#generateBtn').addEventListener('click', generate);
  $('#renderBtn').addEventListener('click', render);
  $('#addSceneBtn').addEventListener('click', () => {
    state.scenes.push({ say: '', on_screen: '', emphasis: [], kind: 'body' });
    renderScenes();
  });
  $('#rate').addEventListener('input', (event) => {
    state.rate = Number(event.target.value);
    $('#rateLabel').textContent = rateToLabel(state.rate);
  });
  $('#rate').addEventListener('change', saveDefaults);
  $('#voice').addEventListener('change', (event) => {
    state.voice = event.target.value;
    saveDefaults();
  });
  $('#music').addEventListener('change', (event) => {
    state.musicFile = event.target.value;
    updateMusicLabel();
  });
  $('#cancelBtn').addEventListener('click', async () => {
    if (!state.jobId) return;
    await api(`/api/jobs/${state.jobId}/cancel`, { method: 'POST' }).catch(() => {});
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#saveSettingsBtn').addEventListener('click', (event) => {
    event.preventDefault();
    saveSettings();
    $('#settingsDialog').close();
  });
  $('#refreshBtn').addEventListener('click', () => loadVideos());
  $('#settingsForm').addEventListener('submit', () => {});
}

bindEvents();
boot();
