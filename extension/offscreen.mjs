let worker;
let workerEngine;
let sequence = 0;
let active = null;
let audio;
let objectURL;
const jobs = new Map();
function notify(data) { chrome.runtime.sendMessage({target: 'speech-events', ...data}).catch(() => {}); }
function stop() {
  active = null;
  if (workerEngine === 'gemini') worker?.postMessage({type: 'cancel'});
  if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; }
  if (objectURL) { URL.revokeObjectURL(objectURL); objectURL = null; }
}
function getWorker(engine) {
  if (worker && workerEngine === engine) return worker;
  if (worker) {
    worker.terminate();
    for (const job of jobs.values()) job.resolve({error: '음성 엔진이 변경되었습니다.'});
    jobs.clear();
  }
  workerEngine = engine;
  worker = new Worker(engine === 'gemini' ? 'gemini-worker.mjs' : 'synthesis-worker.mjs', {type: 'module'});
  worker.onmessage = ({data}) => {
    const job = jobs.get(data.id);
    if (!job) return;
    if (data.type === 'progress') {
      if (active === job) notify({token: job.token, type: 'progress', text: data.text});
      return;
    }
    jobs.delete(data.id);
    if (data.type === 'error') {
      if (active === job) notify({token: job.token, type: 'error', error: data.error});
      job.resolve({error: data.error});
      return;
    }
    if (data.type === 'ready') { job.resolve({ready: true}); return; }
    job.resolve({ready: true});
    if (job.prepare || active !== job) return;
    objectURL = URL.createObjectURL(new Blob([data.wav], {type: 'audio/wav'}));
    audio = new Audio(objectURL);
    if (job.engine === 'gemini') {audio.playbackRate = job.rate; audio.preservesPitch = true;}
    audio.onended = () => {
      if (active !== job) return;
      stop();
      notify({token: job.token, type: 'end', speechId: job.speechId});
    };
    audio.onerror = () => {
      if (active !== job) return;
      stop();
      notify({token: job.token, type: 'error', error: '로컬 음성을 재생하지 못했습니다.'});
    };
    audio.play().then(() => {
      if (active === job) notify({token: job.token, type: 'start', speechId: job.speechId});
    }).catch(error => {
      if (active === job) {
        stop();
        notify({token: job.token, type: 'error', error: error.message});
      }
    });
  };
  worker.onerror = () => {
    for (const job of jobs.values()) job.resolve({error: '음성 엔진 실행에 실패했습니다. 확장을 새로고침해 주세요.'});
    jobs.clear();
    if (active) notify({token: active.token, type: 'error', error: '음성 엔진이 중단되었습니다.'});
    stop();
    worker.terminate();
    worker = null;
  };
  return worker;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.target !== 'local-speech' || sender.id !== chrome.runtime.id || sender.tab) return;
  if (msg.type === 'stop') { stop(); reply({ok: true}); return; }
  if (!['init', 'speak', 'prepare'].includes(msg.type)) return;
  if (msg.type !== 'prepare') stop();
  const engine = msg.voice?.startsWith('gemini:') ? 'gemini' : 'local';
  const selectedWorker = getWorker(engine);
  const id = ++sequence;
  const promise = new Promise(resolve => {
    const job = {engine, rate: [0.75, 0.9, 1, 1.1].includes(msg.rate) ? msg.rate : 0.9, resolve, token: msg.token, speechId: msg.speechId, prepare: msg.type === 'prepare'};
    jobs.set(id, job);
    if (!job.prepare) active = job;
  });
  selectedWorker.postMessage({...msg, id});
  promise.then(reply);
  return true;
});
