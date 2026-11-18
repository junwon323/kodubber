const speechRates = [1, 1.025, 1.05, 1.075, 1.1];
const legacyRates = {1.04: 1, 1.06: 1.05, 1.08: 1.1, 1.5: 1.05, 2: 1.1};

function normalizedSpeechRate(saved) {
  const rate = legacyRates[saved] ?? saved;
  return speechRates.includes(rate) ? rate : 1.05;
}

function voiceKey(voice) {
  return JSON.stringify([voice.extensionId || '', voice.voiceName, voice.lang]);
}
