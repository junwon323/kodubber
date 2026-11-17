import * as ort from './vendor/ort/ort.wasm.min.mjs';
import {TextToSpeech, UnicodeProcessor, Style, writeWavFile} from './vendor/supertonic.mjs';

ort.env.wasm.wasmPaths = new URL('./vendor/ort/', import.meta.url).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const base = 'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/';
let engine;
let files;
const voices = new Map();
const audioCache = new Map();
let currentJob;
const progress = text => postMessage({type: 'progress', id: currentJob, text});

async function asset(name) {
  files ||= await fetch('./model-assets.json').then(r => r.json());
  const expected = files[name];
  if (!expected) throw Error('알 수 없는 모델 파일입니다.');
  const cache = await caches.open('supertonic-3-aafc6e32');
  const url = base + name;
  const cached = await cache.match(url);
  if (cached) return cached.arrayBuffer();
  progress('음성 모델 다운로드 · ' + name);
  const response = await fetch(url, {signal: AbortSignal.timeout(300000)});
  if (!response.ok || !response.body) throw Error('모델 다운로드 실패 · 인터넷 연결을 확인하고 다시 시도해 주세요.');
  const reader = response.body.getReader();
  const chunks = [];
  let count = 0, reported = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    count += value.byteLength;
    if (count > expected.bytes) { await reader.cancel(); throw Error('모델 파일 크기가 일치하지 않습니다.'); }
    if (Date.now() - reported > 1000) {
      progress('음성 모델 다운로드 · ' + name.split('/').at(-1) + ' · ' + Math.floor(count / expected.bytes * 100) + '%');
      reported = Date.now();
    }
  }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    b => b.toString(16).padStart(2, '0')).join('');
  if (count !== expected.bytes || hash !== expected.sha256) throw Error('모델 파일 검증에 실패했습니다. 다시 시도해 주세요.');
  await cache.put(url, new Response(bytes));
  return bytes.buffer;
}
async function json(name) { return JSON.parse(new TextDecoder().decode(await asset(name))); }

async function load() {
  if (engine) return engine;
  const sessions = [];
  try {
    const cfg = await json('onnx/tts.json');
    const processor = new UnicodeProcessor(await json('onnx/unicode_indexer.json'));
    for (const name of ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']) {
      const bytes = await asset('onnx/' + name + '.onnx');
      progress('음성 모델 준비 중 · ' + name);
      sessions.push(await ort.InferenceSession.create(bytes, {executionProviders: ['wasm']}));
    }
    engine = new TextToSpeech(cfg, processor, ...sessions);
    return engine;
  } catch (error) {
    await Promise.allSettled(sessions.map(s => s.release()));
    throw error;
  }
}
async function voice(name) {
  if (!/^[MF][1-5]$/.test(name)) throw Error('목소리를 확인해 주세요.');
  if (!voices.has(name)) {
    const data = await json('voice_styles/' + name + '.json');
    voices.set(name, new Style(
      new ort.Tensor('float32', Float32Array.from(data.style_ttl.data.flat(Infinity)), data.style_ttl.dims),
      new ort.Tensor('float32', Float32Array.from(data.style_dp.data.flat(Infinity)), data.style_dp.dims)
    ));
  }
  return voices.get(name);
}
let queue = Promise.resolve();
self.onmessage = ({data}) => {
  queue = queue.then(async () => {
    currentJob = data.id;
    try {
      const tts = await load();
      const style = await voice(data.voice);
      if (data.type === 'init') return postMessage({type: 'ready', id: data.id});
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 2400) throw Error('읽을 문장 길이를 확인해 주세요.');
      const key = JSON.stringify([data.voice, data.rate, data.text]);
      if (audioCache.has(key)) {
        const wav = audioCache.get(key).slice(0);
        return postMessage({type: 'audio', id: data.id, wav}, [wav]);
      }
      progress('한국어 음성 생성 중');
      const rate = [0.75, 0.9, 1, 1.1].includes(data.rate) ? data.rate : 0.9;
      const result = await tts.call(data.text, 'ko', style, 2, rate);
      const samples = result.wav.slice(0, Math.floor(result.duration[0] * tts.sampleRate));
      const wav = writeWavFile(samples, tts.sampleRate);
      audioCache.set(key, wav.slice(0));
      while (audioCache.size > 3) audioCache.delete(audioCache.keys().next().value);
      postMessage({type: 'audio', id: data.id, wav}, [wav]);
    } catch (error) { postMessage({type: 'error', id: data.id, error: error.message}); }
  });
};
