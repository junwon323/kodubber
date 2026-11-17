const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
test('PCM conversion preserves over-range waveform shape without clipping', async () => {
  const {writeWavFile} = await import(pathToFileURL(path.join(__dirname, '../extension/vendor/supertonic.mjs')));
  const samples = Array.from({length: 1000}, (_, i) => 1.8 * Math.sin(i * 0.1));
  const wav = writeWavFile(samples, 44100);
  const pcm = new Int16Array(wav, 44);
  assert.ok(Math.max(...pcm.map(Math.abs)) <= Math.ceil(0.89 * 32767));
  assert.equal(pcm[0], 0);
  assert.equal(pcm.at(-1), 0);
  const gain = 0.89 / Math.max(...samples.map(Math.abs));
  assert.ok(Math.abs(pcm[400] - samples[400] * gain * 32767) <= 1);
  assert.throws(() => writeWavFile([NaN], 44100), /Invalid audio/);
});
