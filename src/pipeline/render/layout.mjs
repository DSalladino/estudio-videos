export const FORMATS = {
  '9:16': { id: '9:16', width: 1080, height: 1920, label: '9:16 · Reels, Shorts, TikTok' },
  '16:9': { id: '16:9', width: 1920, height: 1080, label: '16:9 · YouTube' },
  '1:1': { id: '1:1', width: 1080, height: 1080, label: '1:1 · Feed' },
};

export function getFormat(id) {
  return FORMATS[id] || FORMATS['9:16'];
}

export function metricsFor(formatId) {
  const format = getFormat(formatId);
  const { width: W, height: H } = format;
  const unit = Math.min(W, H) / 1080;
  const margin = Math.round(W * (format.id === '16:9' ? 0.075 : 0.085));
  return {
    W,
    H,
    unit,
    format,
    margin,
    contentWidth: W - margin * 2,
    fontSize: (size) => Math.round(size * unit),
    top: (ratio) => Math.round(H * ratio),
  };
}
