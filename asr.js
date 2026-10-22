// Inera Edit Flow — speech-to-text orchestration: voice-activity chunking, Whisper worker,
// segment refinement and word-level timing (energy-weighted syllable alignment).
import { clamp, checkAbort, AbortError } from './utils.js';

export const ASR_MODELS = {
  base: { name: 'base', label: 'Accurate (Whisper base, ~160 MB, one-time download)', sizeMB: 160 },
  tiny: { name: 'tiny', label: 'Fast (Whisper tiny, ~100 MB, one-time download)', sizeMB: 100 },
};
// Public, key-free model hosting (Hugging Face mirrors of the k2-fsa/sherpa-onnx Whisper export).
export function defaultModelBase(name) {
  const override = (typeof localStorage !== 'undefined' && safeGet('inera-model-base')) || '';
  if (override) return override.replace(/\/?$/, '/');
  return `https://huggingface.co/csukuangfj/sherpa-onnx-whisper-${name}/resolve/main/`;
}
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

let worker = null, seq = 0;
const pending = new Map();
let progressCb = null;
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./asr-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { progressCb && progressCb(m); return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error('Speech engine crashed: ' + (e.message || 'out of memory'))); pending.clear(); worker = null; loading = null; };
  return worker;
}
function call(msg, transfer) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); getWorker().postMessage({ ...msg, id }, transfer || []); });
}
export function terminateAsr() { if (worker) { worker.terminate(); worker = null; loading = null; for (const p of pending.values()) p.reject(new AbortError()); pending.clear(); } }

// One load per model: a background pre-load (started when a video is dropped) and the real run share it.
let loading = null, forceCpu = false;
export async function loadAsr(modelName = 'base', onProgress) {
  if (onProgress) progressCb = onProgress;
  if (loading && loading.name === modelName && loading.cpu === forceCpu) return loading.p;
  const base = defaultModelBase(modelName);
  const ep = forceCpu ? 'wasm' : (safeGet('inera-asr-ep') || 'auto'); // auto = graphics card when available
  const p = call({ type: 'init', base, name: modelName, ep }).catch((e) => {
    if (loading && loading.p === p) loading = null;
    throw new Error(`Could not load the speech model (${e.message}). Check your internet connection for the one-time download (from huggingface.co). After the first download it is cached and works offline.`);
  });
  loading = { name: modelName, p, cpu: forceCpu };
  return p;
}
// Start downloading/initialising the speech model in the background (no UI, errors ignored).
export function preloadAsr(modelName = 'auto', language) { loadAsr(modelName === 'auto' ? (language && language !== 'en' ? 'base' : 'tiny') : modelName).catch(() => {}); }

// ---------- Voice-activity detection on 16 kHz mono PCM (Int16 or Float32) ----------
const HOP = 0.02; // 20 ms frames
export function speechFrames(pcm) {
  const hop = 320, n = Math.floor(pcm.length / hop);
  const scale = pcm instanceof Int16Array ? 1 / 32768 : 1;
  const e = new Float32Array(n);
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) { const v = pcm[i] * scale; s += v * v; } e[f] = Math.sqrt(s / hop); }
  const sorted = Float32Array.from(e).filter((x) => x > 1e-5).sort();
  const noise = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : 1e-4;
  const thr = Math.max(noise * 3, 0.004);
  const act = new Uint8Array(n);
  for (let f = 0; f < n; f++) act[f] = e[f] > thr ? 1 : 0;
  // hangover 200 ms, fill gaps < 160 ms
  const fill = 8; let last = -1e9;
  for (let f = 0; f < n; f++) { if (act[f]) { if (f - last <= fill) for (let k = last + 1; k < f; k++) act[k] = 1; last = f; } }
  return { energy: e, active: act, hop: HOP, noise, thr };
}
export function speechRegions(vad, minGap = 0.35) {
  const out = []; const { active, hop } = vad; let f = 0;
  while (f < active.length) {
    if (!active[f]) { f++; continue; }
    let e = f; while (e < active.length && active[e]) e++;
    const s = f * hop, en = e * hop;
    const last = out[out.length - 1];
    if (last && s - last.e < minGap) last.e = en; else if (en - s >= 0.12) out.push({ s, e: en });
    f = e;
  }
  return out;
}
// Merge speech regions into Whisper-sized chunks (<= maxLen s), splitting at quiet points.
function buildChunks(regions, vad, total, maxLen = 26) {
  const chunks = [];
  let cur = null;
  for (const r of regions) {
    if (cur && r.e - cur.s <= maxLen && r.s - cur.e < 2.0) { cur.e = r.e; continue; }
    if (cur) chunks.push(cur);
    cur = { s: r.s, e: r.e };
  }
  if (cur) chunks.push(cur);
  const out = [];
  for (const c of chunks) {
    let s = c.s;
    while (c.e - s > maxLen) {
      // split at the lowest-energy frame between s+maxLen*0.6 and s+maxLen
      const a = Math.floor((s + maxLen * 0.6) / vad.hop), b = Math.floor((s + maxLen) / vad.hop);
      let bi = b, bv = Infinity; for (let f = a; f < b; f++) if (vad.energy[f] < bv) { bv = vad.energy[f]; bi = f; }
      out.push({ s, e: bi * vad.hop }); s = bi * vad.hop;
    }
    out.push({ s, e: c.e });
  }
  return out.map((c) => ({ s: Math.max(0, c.s - 0.25), e: Math.min(total, c.e + 0.3) }));
}

// ---------- word timing ----------
function syllables(w) {
  const x = w.toLowerCase().replace(/[^a-zÀ-ɏ]/g, '');
  if (!x) return Math.max(1, Math.round(w.replace(/\s/g, '').length / 3)); // numbers / other scripts
  const m = x.replace(/e$/, '').match(/[aeiouyà-ÿ]+/g);
  return Math.max(1, m ? m.length : 1);
}
// Distribute words over [s,e] following where the speech energy actually is.
function alignWords(text, s, e, vad) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const f0 = Math.max(0, Math.floor(s / vad.hop)), f1 = Math.min(vad.energy.length, Math.ceil(e / vad.hop));
  const mass = []; let tot = 0;
  for (let f = f0; f < f1; f++) { const v = vad.active[f] ? Math.max(vad.energy[f], vad.thr) : 0; tot += v; mass.push(tot); }
  const weights = words.map((w) => syllables(w) + (/[,.!?;:]$/.test(w) ? 0.6 : 0));
  const W = weights.reduce((a, b) => a + b, 0);
  // strict=true: first frame where speech mass EXCEEDS m (a word starts where speech starts);
  // strict=false: first frame where mass reaches m (a word ends where its speech ends)
  const timeAtMass = (m, strict) => {
    let lo = 0, hi = mass.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (strict ? mass[mid] <= m : mass[mid] < m) lo = mid + 1; else hi = mid; }
    return (f0 + lo + (strict ? 0 : 1)) * vad.hop;
  };
  const out = []; let acc = 0;
  for (let i = 0; i < words.length; i++) {
    const a = tot > 0 ? timeAtMass((acc / W) * tot, true) : s + ((e - s) * acc) / W;
    acc += weights[i];
    const b = tot > 0 ? timeAtMass((acc / W) * tot - 1e-9, false) : s + ((e - s) * acc) / W;
    out.push({ w: words[i], s: +a.toFixed(3), e: +Math.max(a + 0.08, b).toFixed(3) });
  }
  return out;
}
// Snap a coarse Whisper segment to the actual speech boundaries nearby.
function refineSegment(seg, vad) {
  const near = (t, dir) => {
    const f = Math.round(t / vad.hop), R = Math.round(0.7 / vad.hop);
    if (dir > 0) { for (let k = 0; k <= R; k++) { const a = f + k, b = f - k; if (vad.active[a] && !vad.active[a - 1]) return a * vad.hop; if (b > 0 && vad.active[b] && !vad.active[b - 1]) return b * vad.hop; } }
    else { for (let k = 0; k <= R; k++) { const a = f - k, b = f + k; if (vad.active[a - 1] && !vad.active[a]) return a * vad.hop; if (vad.active[b - 1] && !vad.active[b]) return b * vad.hop; } }
    return t;
  };
  const s = near(seg.start, 1), e = near(seg.end, -1);
  return e - s > 0.15 ? { ...seg, start: s, end: e } : seg;
}

// pcm: Int16Array or Float32Array at 16 kHz mono. Returns {language, segments:[{start,end,text,words}]}
// model: 'auto' (fast "tiny" for English, accurate "base" for other languages), 'base' or 'tiny'.
export async function transcribe(pcm, { model = 'auto', language, onProgress, signal, onDownload } = {}) {
  const total = pcm.length / 16000;
  const vad = speechFrames(pcm);
  const regions = speechRegions(vad);
  if (!regions.length) return { language: language || null, segments: [], speechSeconds: 0, vad };
  let name = model === 'auto' ? (language && language !== 'en' ? 'base' : 'tiny') : model;
  let info = await loadAsr(name, onDownload);
  checkAbort(signal);
  const chunks = buildChunks(regions, vad, total);
  const speechSeconds = chunks.reduce((a, c) => a + (c.e - c.s), 0);
  const segments = [];
  const timings = [];
  let lang = language || null;
  let done = 0;
  const onAbort = () => terminateAsr();
  signal && signal.addEventListener('abort', onAbort);
  try {
    const slice = (c) => { const a = Math.floor(c.s * 16000), b = Math.floor(c.e * 16000); const f = new Float32Array(b - a); if (pcm instanceof Int16Array) for (let i = 0; i < f.length; i++) f[i] = pcm[a + i] / 32768; else f.set(pcm.subarray(a, b)); return f; };
    const runOne = (c, lg) => { const f = slice(c); return call({ type: 'transcribe', pcm: f, language: lg || undefined }, [f.buffer]); };
    const handle = (c, r) => {
      if (r.timing) timings.push({ ...r.timing, ep: info && info.ep, model: name });
      const hallucinated = r.noSpeech > 0.6 && r.avgLogprob < -1;
      if (!hallucinated) {
        for (const sg of r.segments) {
          const seg = refineSegment({ start: c.s + sg.start, end: Math.min(c.e, c.s + Math.max(sg.end, sg.start + 0.3)), text: sg.text }, vad);
          if (!seg.text || /^\[.*\]$|^\(.*\)$/.test(seg.text)) continue; // [music], (applause) etc.
          seg.words = alignWords(seg.text, seg.start, seg.end, vad);
          if (seg.words.length) { seg.start = seg.words[0].s; seg.end = Math.max(seg.start + 0.2, seg.words[seg.words.length - 1].e); }
          segments.push(seg);
        }
      }
      done += c.e - c.s;
      onProgress && onProgress(clamp(done / speechSeconds, 0, 1));
    };
    // GPU watchdog: if the graphics card turns out slow (old / weak GPU), finish on the CPU instead
    const watch = async (r, remaining) => {
      if (!info || info.ep !== 'webgpu' || !r.timing || remaining < 2) return;
      const perTok = r.timing.dec / Math.max(1, r.timing.steps);
      if (perTok > 50 || r.timing.enc > 3000) { forceCpu = true; info = await loadAsr(name, onDownload); } // a good CPU does ~20-40 ms per token
    };
    let k = 0;
    if (!lang) { // detect the language once, on the first chunk
      checkAbort(signal);
      let r = await runOne(chunks[0]);
      lang = r.language;
      if (model === 'auto' && name === 'tiny' && lang && lang !== 'en') { // not English: the accurate model handles it far better
        name = 'base'; info = await loadAsr(name, onDownload); checkAbort(signal);
        r = await runOne(chunks[0], lang);
      }
      handle(chunks[0], r); k = 1;
      await watch(r, chunks.length - k);
    }
    while (k < chunks.length) {
      checkAbort(signal);
      const r = await runOne(chunks[k], lang);
      handle(chunks[k], r); k++;
      if (k === 1 || k === 2) await watch(r, chunks.length - k);
    }
  } finally { signal && signal.removeEventListener('abort', onAbort); }
  // de-overlap consecutive segments
  segments.sort((x, y) => x.start - y.start);
  for (let i = 1; i < segments.length; i++) if (segments[i].start < segments[i - 1].end) segments[i - 1].end = Math.max(segments[i - 1].start + 0.2, segments[i].start);
  return { language: lang, segments, speechSeconds, vad, timings, engine: { model: name, ep: info ? info.ep : 'wasm' } };
}

// ---------- caption file exports ----------
const ts = (t, sep) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), ms = Math.round((t % 1) * 1000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms).padStart(3, '0')}`; };
export function toSRT(segments) { return segments.map((s, i) => `${i + 1}\n${ts(s.start, ',')} --> ${ts(s.end, ',')}\n${s.text}\n`).join('\n'); }
export function toVTT(segments) { return 'WEBVTT\n\n' + segments.map((s) => `${ts(s.start, '.')} --> ${ts(s.end, '.')}\n${s.text}\n`).join('\n'); }
