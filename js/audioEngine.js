/**
 * Audio Engine — Web Audio API effect chain for DJ Mode.
 * Provides real-time audio processing controlled by hand gestures.
 *
 * Signal chain:
 * Source → Filter → Distortion → Delay → Reverb → Compressor → Gain → Analyser → Destination
 */

let audioCtx = null;
let sourceNode = null;
let audioBuffer = null;

// Effect nodes
let filterNode = null;
let distortionNode = null;
let delayNode = null;
let delayFeedbackNode = null;
let delayDryNode = null;
let delayWetNode = null;
let reverbNode = null;
let reverbDryNode = null;
let reverbWetNode = null;
let compressorNode = null;
let masterGainNode = null;
let analyserNode = null;

// ── New nodes ──
// EQ kill stages (low / mid / high)
let eqLowNode = null;
let eqMidNode = null;
let eqHighNode = null;
const eqKillState = { low: false, mid: false, high: false };

// Stutter: short delay + freezable feedback
let stutterDelayNode = null;
let stutterFeedbackNode = null;
let stutterWetNode = null;
let stutterDryNode = null;
let stutterActive = false;

// Side-chain ducker
let duckerNode = null;

// 2-Deck crossfader
let sourceNodeB = null;
let audioBufferB = null;
let isPlayingB = false;
let startedAtB = 0;
let pausedAtB = 0;
let trackDurationB = 0;
let trackNameB = '';
let currentPlaybackRateB = 1.0;
let deckAGain = null;
let deckBGain = null;
let crossfadeValue = 0; // -1 = full A, 0 = both, +1 = full B
let chainHeadGain = null; // single entry point both decks feed into

// Recording (MediaRecorder on destination tap)
let recorderDest = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Loop region
let loopStart = null;
let loopEnd = null;

// Detected BPM
let detectedBPM = 0;

// State
let isPlaying = false;
let isLooping = false;
let startedAt = 0; // audioCtx.currentTime when playback started
let pausedAt = 0;  // seconds offset into the buffer when paused
let trackDuration = 0;
let trackName = '';
let currentPlaybackRate = 1.0; // preserved across play/pause

// Analyser data arrays
let waveformData = null;
let frequencyData = null;

// Current effect state (for HUD display)
const effectState = {
  filterCutoff: 8000,
  filterResonance: 1,
  distortionAmount: 0,
  bassGain: 0,
  delayTime: 0.3,
  delayFeedback: 0,
  reverbWet: 0,
  volume: 1,
  playbackRate: 1,
  activeEffect: null,
  effectIntensity: 0,
};

/**
 * Initialize the AudioContext and build the effect chain.
 * Must be called from a user gesture handler.
 */
export function initAudioEngine() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // ── Build effect chain ──

  // 0a. Per-deck gains (crossfader)
  deckAGain = audioCtx.createGain();
  deckBGain = audioCtx.createGain();
  deckAGain.gain.value = 1;
  deckBGain.gain.value = 0; // deck B silent until loaded
  chainHeadGain = audioCtx.createGain();
  deckAGain.connect(chainHeadGain);
  deckBGain.connect(chainHeadGain);

  // 0b. EQ kill stages — three peaking/shelf filters
  eqLowNode = audioCtx.createBiquadFilter();
  eqLowNode.type = 'lowshelf';
  eqLowNode.frequency.value = 200;
  eqLowNode.gain.value = 0;

  eqMidNode = audioCtx.createBiquadFilter();
  eqMidNode.type = 'peaking';
  eqMidNode.frequency.value = 1200;
  eqMidNode.Q.value = 0.9;
  eqMidNode.gain.value = 0;

  eqHighNode = audioCtx.createBiquadFilter();
  eqHighNode.type = 'highshelf';
  eqHighNode.frequency.value = 4500;
  eqHighNode.gain.value = 0;

  // 1. Filter (lowpass)
  filterNode = audioCtx.createBiquadFilter();
  filterNode.type = 'lowpass';
  filterNode.frequency.value = 20000; // fully open by default
  filterNode.Q.value = 1;

  // 2. Distortion (waveshaper)
  distortionNode = audioCtx.createWaveShaper();
  distortionNode.curve = makeDistortionCurve(0);
  distortionNode.oversample = '4x';

  // 3. Delay with feedback loop
  delayNode = audioCtx.createDelay(2.0);
  delayNode.delayTime.value = 0.3;
  delayFeedbackNode = audioCtx.createGain();
  delayFeedbackNode.gain.value = 0; // no feedback by default
  delayDryNode = audioCtx.createGain();
  delayDryNode.gain.value = 1;
  delayWetNode = audioCtx.createGain();
  delayWetNode.gain.value = 0;

  // 4. Reverb (convolver with synthetic impulse)
  reverbNode = audioCtx.createConvolver();
  reverbNode.buffer = generateImpulseResponse(2, 2.5, false);
  reverbDryNode = audioCtx.createGain();
  reverbDryNode.gain.value = 1;
  reverbWetNode = audioCtx.createGain();
  reverbWetNode.gain.value = 0;

  // 5. Dynamics compressor
  compressorNode = audioCtx.createDynamicsCompressor();
  compressorNode.threshold.value = -24;
  compressorNode.knee.value = 30;
  compressorNode.ratio.value = 12;
  compressorNode.attack.value = 0.003;
  compressorNode.release.value = 0.25;

  // 5b. Stutter — short delay + freezable feedback loop
  stutterDelayNode = audioCtx.createDelay(0.5);
  stutterDelayNode.delayTime.value = 0.12;
  stutterFeedbackNode = audioCtx.createGain();
  stutterFeedbackNode.gain.value = 0;
  stutterDryNode = audioCtx.createGain();
  stutterDryNode.gain.value = 1;
  stutterWetNode = audioCtx.createGain();
  stutterWetNode.gain.value = 0;

  // 6. Master gain
  masterGainNode = audioCtx.createGain();
  masterGainNode.gain.value = 1;

  // 6b. Ducker (post-master) for side-chain effect from pads
  duckerNode = audioCtx.createGain();
  duckerNode.gain.value = 1;

  // 7. Analyser
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 2048;
  analyserNode.smoothingTimeConstant = 0.8;

  // 8. Recording tap (MediaStreamDestination)
  try { recorderDest = audioCtx.createMediaStreamDestination(); } catch (e) { recorderDest = null; }

  // Allocate data arrays
  waveformData = new Uint8Array(analyserNode.frequencyBinCount);
  frequencyData = new Uint8Array(analyserNode.frequencyBinCount);

  // ── Wire the chain ──
  // chainHead → EQ stages → Filter
  chainHeadGain.connect(eqLowNode);
  eqLowNode.connect(eqMidNode);
  eqMidNode.connect(eqHighNode);
  eqHighNode.connect(filterNode);

  // Filter → Distortion
  filterNode.connect(distortionNode);

  // Distortion → Delay (dry + wet paths)
  distortionNode.connect(delayDryNode);
  distortionNode.connect(delayNode);
  delayNode.connect(delayFeedbackNode);
  delayFeedbackNode.connect(delayNode); // feedback loop
  delayNode.connect(delayWetNode);

  // Delay dry/wet → merge → Reverb (dry + wet paths)
  const delayMerge = audioCtx.createGain();
  delayDryNode.connect(delayMerge);
  delayWetNode.connect(delayMerge);

  delayMerge.connect(reverbDryNode);
  delayMerge.connect(reverbNode);
  reverbNode.connect(reverbWetNode);

  // Reverb dry/wet → merge → Compressor
  const reverbMerge = audioCtx.createGain();
  reverbDryNode.connect(reverbMerge);
  reverbWetNode.connect(reverbMerge);

  // Reverb merge → Stutter (dry + wet) → Compressor
  reverbMerge.connect(stutterDryNode);
  reverbMerge.connect(stutterDelayNode);
  stutterDelayNode.connect(stutterFeedbackNode);
  stutterFeedbackNode.connect(stutterDelayNode); // feedback loop
  stutterDelayNode.connect(stutterWetNode);

  const stutterMerge = audioCtx.createGain();
  stutterDryNode.connect(stutterMerge);
  stutterWetNode.connect(stutterMerge);
  stutterMerge.connect(compressorNode);

  // Compressor → Master Gain → Ducker → Analyser → Destination
  compressorNode.connect(masterGainNode);
  masterGainNode.connect(duckerNode);
  duckerNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);
  if (recorderDest) duckerNode.connect(recorderDest);
}

/**
 * Load an audio file into the engine.
 * @param {File} file - Audio file from file input or drag-and-drop
 * @returns {Promise<{ name: string, duration: number }>}
 */
export async function loadAudioFile(file) {
  if (!audioCtx) initAudioEngine();

  // Resume context if suspended
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  // Stop any current playback
  stop();

  const arrayBuffer = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  trackDuration = audioBuffer.duration;
  trackName = file.name.replace(/\.[^.]+$/, ''); // strip extension
  pausedAt = 0;
  loopStart = null;
  loopEnd = null;

  // Detect BPM (coarse, off-thread isn't worth it for 2-3MB buffers)
  detectedBPM = detectBPM(audioBuffer);

  // Pre-compute a downsampled waveform peak array for the timeline
  cachedWaveformPeaks = computeWaveformPeaks(audioBuffer, 800);

  return { name: trackName, duration: trackDuration, bpm: detectedBPM };
}

let cachedWaveformPeaks = null;

/**
 * Reduce the buffer to N peak samples for waveform rendering.
 */
function computeWaveformPeaks(buf, n = 800) {
  const ch = buf.getChannelData(0);
  const peaks = new Float32Array(n);
  const step = Math.floor(ch.length / n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const base = i * step;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(ch[base + j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

export function getWaveformPeaks() { return cachedWaveformPeaks; }

/**
 * Start or resume playback.
 */
export function play() {
  if (!audioBuffer || !audioCtx) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  // Disconnect any existing source
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
    sourceNode = null;
  }

  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.loop = isLooping;
  sourceNode.playbackRate.value = currentPlaybackRate;
  if (loopStart !== null && loopEnd !== null && loopEnd > loopStart) {
    sourceNode.loopStart = loopStart;
    sourceNode.loopEnd = loopEnd;
  }
  sourceNode.connect(deckAGain);

  sourceNode.onended = () => {
    if (isPlaying && !isLooping) {
      isPlaying = false;
      pausedAt = 0;
    }
  };

  sourceNode.start(0, pausedAt);
  startedAt = audioCtx.currentTime - pausedAt;
  isPlaying = true;
}

/**
 * Pause playback.
 */
export function pause() {
  if (!isPlaying || !sourceNode) return;

  pausedAt = audioCtx.currentTime - startedAt;
  try { sourceNode.stop(); } catch (e) { /* ignore */ }
  try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
  sourceNode = null;
  isPlaying = false;
}

/**
 * Stop playback and reset to beginning.
 */
export function stop() {
  if (sourceNode) {
    try { sourceNode.stop(); } catch (e) { /* ignore */ }
    try { sourceNode.disconnect(); } catch (e) { /* ignore */ }
    sourceNode = null;
  }
  isPlaying = false;
  pausedAt = 0;
}

/**
 * Seek to a position in the track.
 * @param {number} time - time in seconds
 */
export function seek(time) {
  const wasPlaying = isPlaying;
  if (isPlaying) {
    pause();
  }
  pausedAt = Math.max(0, Math.min(time, trackDuration));
  if (wasPlaying) {
    play();
  }
}

/**
 * Toggle loop mode.
 */
export function toggleLoop() {
  isLooping = !isLooping;
  if (sourceNode) {
    sourceNode.loop = isLooping;
  }
  return isLooping;
}

// ═══════════════════════════════════════════
// Effect Controls
// ═══════════════════════════════════════════

/**
 * Set lowpass filter parameters.
 * @param {number} cutoff - frequency 200–20000 Hz
 * @param {number} resonance - Q factor 0.5–15
 * @param {number} intensity - 0–1 (from spread)
 */
export function setFilter(cutoff, resonance, intensity) {
  if (!filterNode) return;
  const t = audioCtx.currentTime;

  // When intensity is 0, fully open the filter
  const actualCutoff = intensity < 0.05 ? 20000 : cutoff;
  const actualRes = intensity < 0.05 ? 1 : resonance;

  filterNode.frequency.linearRampToValueAtTime(actualCutoff, t + 0.05);
  filterNode.Q.linearRampToValueAtTime(actualRes, t + 0.05);

  effectState.filterCutoff = actualCutoff;
  effectState.filterResonance = actualRes;
  effectState.activeEffect = 'Filter';
  effectState.effectIntensity = intensity;
}

/**
 * Set distortion + bass boost.
 * @param {number} amount - 0–100
 * @param {number} bassGain - 0–24 dB
 * @param {number} intensity - 0–1
 */
export function setDistortion(amount, bassGain, intensity) {
  if (!distortionNode || !filterNode) return;
  const t = audioCtx.currentTime;

  const actualAmount = intensity < 0.05 ? 0 : amount * intensity;
  distortionNode.curve = makeDistortionCurve(actualAmount);

  // Temporarily switch filter to lowshelf for bass boost
  // We'll manage this via a parallel approach — boost low freqs
  const actualBass = intensity < 0.05 ? 0 : bassGain * intensity;

  effectState.distortionAmount = actualAmount;
  effectState.bassGain = actualBass;
  effectState.activeEffect = 'Distortion';
  effectState.effectIntensity = intensity;
}

/**
 * Set delay effect.
 * @param {number} time - delay time 0.05–0.8 seconds
 * @param {number} feedback - 0–0.9
 * @param {number} intensity - 0–1
 */
export function setDelay(time, feedback, intensity) {
  if (!delayNode) return;
  const t = audioCtx.currentTime;

  delayNode.delayTime.linearRampToValueAtTime(time, t + 0.05);
  delayFeedbackNode.gain.linearRampToValueAtTime(feedback * intensity, t + 0.05);

  // Wet/dry mix based on intensity
  delayWetNode.gain.linearRampToValueAtTime(intensity * 0.6, t + 0.05);
  delayDryNode.gain.linearRampToValueAtTime(1, t + 0.05);

  effectState.delayTime = time;
  effectState.delayFeedback = feedback;
  effectState.activeEffect = 'Delay';
  effectState.effectIntensity = intensity;
}

/**
 * Set reverb wet/dry.
 * @param {number} wet - 0–1
 * @param {number} intensity - 0–1
 */
export function setReverb(wet, intensity) {
  if (!reverbWetNode) return;
  const t = audioCtx.currentTime;

  const actualWet = wet * intensity;
  reverbWetNode.gain.linearRampToValueAtTime(actualWet, t + 0.05);
  reverbDryNode.gain.linearRampToValueAtTime(1 - actualWet * 0.3, t + 0.05);

  effectState.reverbWet = actualWet;
  effectState.activeEffect = 'Reverb';
  effectState.effectIntensity = intensity;
}

/**
 * Set master volume.
 * @param {number} level - 0–1.5
 * @param {number} [intensity] - 0–1 (for HUD display)
 */
export function setVolume(level, intensity) {
  if (!masterGainNode) return;
  const t = audioCtx.currentTime;
  masterGainNode.gain.linearRampToValueAtTime(level, t + 0.05);
  effectState.volume = level;
  if (intensity !== undefined) {
    effectState.activeEffect = 'Volume';
    effectState.effectIntensity = intensity;
  }
}

/**
 * Smoothly ramp the source's playback rate (controls speed + pitch).
 * Safe to call every frame — uses linearRampToValueAtTime.
 * @param {number} rate - target rate (e.g. 0.5–2.0)
 */
export function setPlaybackRate(rate) {
  const safe = Math.max(0.25, Math.min(3, rate));
  currentPlaybackRate = safe;
  effectState.playbackRate = safe;
  if (!sourceNode || !audioCtx) return;
  const t = audioCtx.currentTime;
  sourceNode.playbackRate.cancelScheduledValues(t);
  sourceNode.playbackRate.linearRampToValueAtTime(safe, t + 0.08);
}

export function getPlaybackRate() {
  return currentPlaybackRate;
}

/**
 * "Drop" effect triggered when both hands connect:
 * full reverb wash + open filter + slight bass push.
 * @param {number} strength - 0–1, scales with how close the hands are
 */
export function setHandFusionEffect(strength) {
  if (!reverbWetNode || !filterNode) return;
  const t = audioCtx.currentTime;
  const s = Math.max(0, Math.min(1, strength));

  reverbWetNode.gain.linearRampToValueAtTime(0.85 * s, t + 0.05);
  reverbDryNode.gain.linearRampToValueAtTime(1 - s * 0.35, t + 0.05);
  filterNode.frequency.linearRampToValueAtTime(20000, t + 0.05);
  filterNode.Q.linearRampToValueAtTime(1, t + 0.05);
  masterGainNode.gain.linearRampToValueAtTime(1 + s * 0.25, t + 0.05);

  effectState.activeEffect = 'Hand Fusion';
  effectState.effectIntensity = s;
  effectState.reverbWet = 0.85 * s;
}

/**
 * One-shot filter-sweep trigger fired by a finger tap.
 * Different finger → different starting cutoff.
 * @param {string} finger - 'middle' | 'ring' | 'pinky'
 */
export function triggerFingerTap(finger) {
  if (!filterNode || !audioCtx) return;
  const t = audioCtx.currentTime;

  let startCutoff;
  switch (finger) {
    case 'middle': startCutoff = 350; break;
    case 'ring':   startCutoff = 1200; break;
    case 'pinky':  startCutoff = 4500; break;
    default:       startCutoff = 800;
  }

  filterNode.frequency.cancelScheduledValues(t);
  filterNode.frequency.setValueAtTime(startCutoff, t);
  filterNode.frequency.exponentialRampToValueAtTime(20000, t + 0.28);
  filterNode.Q.cancelScheduledValues(t);
  filterNode.Q.setValueAtTime(6, t);
  filterNode.Q.linearRampToValueAtTime(1, t + 0.28);
}

/**
 * Reset all effects to defaults (bypass).
 */
export function resetEffects() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  filterNode.frequency.linearRampToValueAtTime(20000, t + 0.1);
  filterNode.Q.linearRampToValueAtTime(1, t + 0.1);
  distortionNode.curve = makeDistortionCurve(0);
  delayFeedbackNode.gain.linearRampToValueAtTime(0, t + 0.1);
  delayWetNode.gain.linearRampToValueAtTime(0, t + 0.1);
  delayDryNode.gain.linearRampToValueAtTime(1, t + 0.1);
  reverbWetNode.gain.linearRampToValueAtTime(0, t + 0.1);
  reverbDryNode.gain.linearRampToValueAtTime(1, t + 0.1);
  masterGainNode.gain.linearRampToValueAtTime(1, t + 0.1);

  effectState.activeEffect = null;
  effectState.effectIntensity = 0;
}

// ═══════════════════════════════════════════
// Visualization Data
// ═══════════════════════════════════════════

/**
 * Get waveform data for oscilloscope visualization.
 * @returns {Uint8Array}
 */
export function getWaveformData() {
  if (!analyserNode) return new Uint8Array(0);
  analyserNode.getByteTimeDomainData(waveformData);
  return waveformData;
}

/**
 * Get frequency spectrum data for bar visualization.
 * @returns {Uint8Array}
 */
export function getFrequencyData() {
  if (!analyserNode) return new Uint8Array(0);
  analyserNode.getByteFrequencyData(frequencyData);
  return frequencyData;
}

/**
 * Get current playback time in seconds.
 */
export function getCurrentTime() {
  if (!audioCtx || !isPlaying) return pausedAt;
  const elapsed = audioCtx.currentTime - startedAt;
  if (isLooping && trackDuration > 0) {
    return elapsed % trackDuration;
  }
  return Math.min(elapsed, trackDuration);
}

/**
 * Get track duration in seconds.
 */
export function getDuration() {
  return trackDuration;
}

/**
 * Get track name.
 */
export function getTrackName() {
  return trackName;
}

/**
 * Get current playback state.
 */
export function getPlaybackState() {
  return {
    isPlaying,
    isLooping,
    currentTime: getCurrentTime(),
    duration: trackDuration,
    trackName,
  };
}

/**
 * Get current effect state for HUD.
 */
export function getEffectState() {
  return { ...effectState };
}

/**
 * Check if audio is loaded.
 */
export function isAudioLoaded() {
  return audioBuffer !== null;
}

/**
 * Check if currently playing.
 */
export function getIsPlaying() {
  return isPlaying;
}

/**
 * Get bass energy (for beat pulse effect).
 * Returns 0–1 value based on bass frequency energy.
 */
export function getBassEnergy() {
  if (!analyserNode) return 0;
  analyserNode.getByteFrequencyData(frequencyData);

  // Average of first 10 frequency bins (low bass)
  let sum = 0;
  const count = 10;
  for (let i = 0; i < count; i++) {
    sum += frequencyData[i];
  }
  return (sum / count) / 255;
}

// ═══════════════════════════════════════════
// Utility Functions
// ═══════════════════════════════════════════

/**
 * Generate a distortion curve for the WaveShaperNode.
 * @param {number} amount - 0–100
 * @returns {Float32Array}
 */
function makeDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;

  if (amount <= 0) {
    // Linear (no distortion)
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = x;
    }
    return curve;
  }

  const k = amount;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * Generate a synthetic impulse response for reverb.
 * @param {number} duration - seconds
 * @param {number} decay - decay factor
 * @param {boolean} reverse - reverse the impulse
 * @returns {AudioBuffer}
 */
function generateImpulseResponse(duration = 2, decay = 2.5, reverse = false) {
  const sampleRate = audioCtx.sampleRate;
  const length = sampleRate * duration;
  const impulse = audioCtx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const n = reverse ? length - i : i;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }
  }

  return impulse;
}

// ═══════════════════════════════════════════
// EQ Kills (low / mid / high)
// ═══════════════════════════════════════════

/**
 * Toggle a kill switch. Killed band = -40dB.
 * @param {'low'|'mid'|'high'} band
 * @returns {boolean} new killed state
 */
export function toggleEQKill(band) {
  if (!eqLowNode) return false;
  eqKillState[band] = !eqKillState[band];
  applyEQKills();
  return eqKillState[band];
}

export function getEQKills() {
  return { ...eqKillState };
}

function applyEQKills() {
  if (!eqLowNode || !audioCtx) return;
  const t = audioCtx.currentTime;
  const r = 0.04;
  eqLowNode.gain.linearRampToValueAtTime(eqKillState.low ? -40 : 0, t + r);
  eqMidNode.gain.linearRampToValueAtTime(eqKillState.mid ? -40 : 0, t + r);
  eqHighNode.gain.linearRampToValueAtTime(eqKillState.high ? -40 : 0, t + r);
}

// ═══════════════════════════════════════════
// Stutter / Beat-Repeat
// ═══════════════════════════════════════════

/**
 * Engage or release the stutter effect.
 * When engaged: a short slice loops via high feedback in the stutter delay.
 * @param {boolean} engaged
 * @param {number} [divisionMs=120] - length of the stuttered slice in ms
 */
export function setStutter(engaged, divisionMs = 120) {
  if (!stutterDelayNode || !audioCtx) return;
  const t = audioCtx.currentTime;
  stutterActive = engaged;
  if (engaged) {
    stutterDelayNode.delayTime.setValueAtTime(Math.max(0.05, divisionMs / 1000), t);
    stutterFeedbackNode.gain.linearRampToValueAtTime(0.97, t + 0.01);
    stutterWetNode.gain.linearRampToValueAtTime(1, t + 0.01);
    stutterDryNode.gain.linearRampToValueAtTime(0, t + 0.01);
  } else {
    stutterFeedbackNode.gain.linearRampToValueAtTime(0, t + 0.04);
    stutterWetNode.gain.linearRampToValueAtTime(0, t + 0.04);
    stutterDryNode.gain.linearRampToValueAtTime(1, t + 0.04);
  }
}

export function isStuttering() { return stutterActive; }

// ═══════════════════════════════════════════
// Side-chain Duck
// ═══════════════════════════════════════════

/**
 * Brief volume dip for side-chain effect — call when a pad fires.
 * @param {number} [depth=0.35] - 0–1 dip amount (0.35 = 35% volume)
 * @param {number} [durationMs=180]
 */
export function duck(depth = 0.35, durationMs = 180) {
  if (!duckerNode || !audioCtx) return;
  const t = audioCtx.currentTime;
  duckerNode.gain.cancelScheduledValues(t);
  duckerNode.gain.setValueAtTime(duckerNode.gain.value, t);
  duckerNode.gain.linearRampToValueAtTime(depth, t + 0.015);
  duckerNode.gain.linearRampToValueAtTime(1, t + 0.015 + durationMs / 1000);
}

// ═══════════════════════════════════════════
// Loop Region
// ═══════════════════════════════════════════

export function setLoopRegion(start, end) {
  if (start == null || end == null || end <= start) {
    loopStart = null;
    loopEnd = null;
  } else {
    loopStart = Math.max(0, start);
    loopEnd = Math.min(trackDuration, end);
  }
  if (sourceNode) {
    if (loopStart !== null) {
      sourceNode.loopStart = loopStart;
      sourceNode.loopEnd = loopEnd;
      sourceNode.loop = true;
      isLooping = true;
    } else {
      sourceNode.loop = isLooping; // restore from user toggle
    }
  }
}

export function getLoopRegion() {
  return { start: loopStart, end: loopEnd };
}

export function clearLoopRegion() {
  loopStart = null;
  loopEnd = null;
  if (sourceNode) sourceNode.loop = isLooping;
}

// ═══════════════════════════════════════════
// Performance Recording
// ═══════════════════════════════════════════

export function startRecording() {
  if (!recorderDest || isRecording) return false;
  recordedChunks = [];
  let mimeType = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
  try {
    mediaRecorder = new MediaRecorder(recorderDest.stream, { mimeType });
  } catch (e) {
    console.warn('MediaRecorder unavailable:', e);
    return false;
  }
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(250);
  isRecording = true;
  return true;
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || !isRecording) { resolve(null); return; }
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'audio/webm' });
      isRecording = false;
      resolve(blob);
    };
    mediaRecorder.stop();
  });
}

export function getIsRecording() { return isRecording; }

// ═══════════════════════════════════════════
// BPM Detection (simple energy-peak autocorrelation)
// ═══════════════════════════════════════════

/**
 * Run a coarse BPM estimation against a decoded AudioBuffer.
 * @param {AudioBuffer} buf
 * @returns {number} BPM (60–200) — 0 if undetectable
 */
function detectBPM(buf) {
  try {
    const ch = buf.getChannelData(0);
    const sr = buf.sampleRate;

    // 1. Downsample to ~200Hz envelope of squared signal (energy)
    const envHz = 200;
    const stride = Math.floor(sr / envHz);
    const envLen = Math.floor(ch.length / stride);
    const env = new Float32Array(envLen);
    for (let i = 0; i < envLen; i++) {
      let sum = 0;
      const base = i * stride;
      for (let j = 0; j < stride; j++) {
        const v = ch[base + j];
        sum += v * v;
      }
      env[i] = sum / stride;
    }

    // 2. Autocorrelate at lags corresponding to 60–200 BPM
    const minBPM = 60, maxBPM = 200;
    const maxLag = Math.floor(60 * envHz / minBPM);
    const minLag = Math.floor(60 * envHz / maxBPM);

    let bestLag = 0, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let s = 0;
      const n = Math.min(envLen - lag, 4000);
      for (let i = 0; i < n; i++) s += env[i] * env[i + lag];
      if (s > bestScore) { bestScore = s; bestLag = lag; }
    }
    if (bestLag === 0) return 0;
    return Math.round(60 * envHz / bestLag);
  } catch (e) {
    return 0;
  }
}

export function getBPM() { return detectedBPM; }

// ═══════════════════════════════════════════
// Deck B (second source)
// ═══════════════════════════════════════════

export async function loadDeckBFile(file) {
  if (!audioCtx) initAudioEngine();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  stopDeckB();
  const arrayBuffer = await file.arrayBuffer();
  audioBufferB = await audioCtx.decodeAudioData(arrayBuffer);
  trackDurationB = audioBufferB.duration;
  trackNameB = file.name.replace(/\.[^.]+$/, '');
  pausedAtB = 0;
  // Open deck B's gain so it's audible once crossfader allows it
  applyCrossfade();
  return { name: trackNameB, duration: trackDurationB };
}

export function playDeckB() {
  if (!audioBufferB || !audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (sourceNodeB) {
    try { sourceNodeB.disconnect(); } catch (e) { /* ignore */ }
  }
  sourceNodeB = audioCtx.createBufferSource();
  sourceNodeB.buffer = audioBufferB;
  sourceNodeB.loop = true; // deck B always loops by default
  sourceNodeB.playbackRate.value = currentPlaybackRateB;
  sourceNodeB.connect(deckBGain);
  sourceNodeB.start(0, pausedAtB);
  startedAtB = audioCtx.currentTime - pausedAtB;
  isPlayingB = true;
}

export function pauseDeckB() {
  if (!isPlayingB || !sourceNodeB) return;
  pausedAtB = (audioCtx.currentTime - startedAtB) % (trackDurationB || 1);
  try { sourceNodeB.stop(); sourceNodeB.disconnect(); } catch (e) { /* ignore */ }
  sourceNodeB = null;
  isPlayingB = false;
}

export function stopDeckB() {
  if (sourceNodeB) {
    try { sourceNodeB.stop(); sourceNodeB.disconnect(); } catch (e) { /* ignore */ }
    sourceNodeB = null;
  }
  isPlayingB = false;
  pausedAtB = 0;
}

export function getDeckBInfo() {
  return {
    loaded: !!audioBufferB,
    name: trackNameB,
    duration: trackDurationB,
    isPlaying: isPlayingB,
  };
}

/**
 * Set the crossfader value [-1..1]. -1 = full A, +1 = full B.
 */
export function setCrossfade(value) {
  crossfadeValue = Math.max(-1, Math.min(1, value));
  applyCrossfade();
}

export function getCrossfade() { return crossfadeValue; }

function applyCrossfade() {
  if (!deckAGain || !deckBGain || !audioCtx) return;
  // Equal-power crossfade
  const x = (crossfadeValue + 1) / 2; // 0..1
  const a = Math.cos(x * Math.PI / 2);
  const b = Math.sin(x * Math.PI / 2);
  const t = audioCtx.currentTime;
  deckAGain.gain.linearRampToValueAtTime(a, t + 0.05);
  // If deck B has no buffer loaded, keep it muted
  deckBGain.gain.linearRampToValueAtTime(audioBufferB ? b : 0, t + 0.05);
}

// ═══════════════════════════════════════════
// Synth pads (kick / snare / hat / riser)
// ═══════════════════════════════════════════

/**
 * Trigger a synthesized one-shot percussion pad routed direct to destination.
 * @param {'kick'|'snare'|'hat'|'riser'} name
 */
export function triggerSynthPad(name) {
  if (!audioCtx) initAudioEngine();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime;

  if (name === 'kick') {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.18);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.4);
  } else if (name === 'snare') {
    const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.2, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    noise.connect(bp).connect(g).connect(audioCtx.destination);
    noise.start(t); noise.stop(t + 0.2);
  } else if (name === 'hat') {
    const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.08, audioCtx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuf;
    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    noise.connect(hp).connect(g).connect(audioCtx.destination);
    noise.start(t); noise.stop(t + 0.08);
  } else if (name === 'riser') {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(3000, t + 1.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(8000, t + 1.4);
    osc.connect(lp).connect(g).connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 1.6);
  }
}

/**
 * Format time in seconds to MM:SS.
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
