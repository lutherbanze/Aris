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

// State
let isPlaying = false;
let isLooping = false;
let startedAt = 0; // audioCtx.currentTime when playback started
let pausedAt = 0;  // seconds offset into the buffer when paused
let trackDuration = 0;
let trackName = '';

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

  // 6. Master gain
  masterGainNode = audioCtx.createGain();
  masterGainNode.gain.value = 1;

  // 7. Analyser
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 2048;
  analyserNode.smoothingTimeConstant = 0.8;

  // Allocate data arrays
  waveformData = new Uint8Array(analyserNode.frequencyBinCount);
  frequencyData = new Uint8Array(analyserNode.frequencyBinCount);

  // ── Wire the chain ──
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

  reverbMerge.connect(compressorNode);

  // Compressor → Master Gain → Analyser → Destination
  compressorNode.connect(masterGainNode);
  masterGainNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);
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

  return { name: trackName, duration: trackDuration };
}

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
  sourceNode.connect(filterNode);

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
