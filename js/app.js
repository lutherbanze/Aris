/**
 * Main Application Orchestrator.
 * Supports two modes: Anti-Gravity (particles) and DJ (audio effects).
 */

import { initHandTracker, detectHands } from './handTracker.js';
import {
  getGesture, getPalmCenter, getSpread, getForceType, getIndexTip,
  getHandConnection, getFingerTaps, getHandSpan, GESTURES,
} from './gestures.js';
import { ParticleSystem } from './particles.js';
import { Renderer } from './renderer.js';
import { DJRenderer } from './djRenderer.js';
import { themes, defaultTheme } from './themes.js';
import * as audio from './audioEngine.js';

// ── DOM Elements ──
const video = document.getElementById('webcam-video');
const cameraCanvas = document.getElementById('camera-canvas');
const particleCanvas = document.getElementById('particle-canvas');
const loadingScreen = document.getElementById('loading-screen');
const loadingText = document.querySelector('.loading-text');
const instructionsOverlay = document.getElementById('instructions-overlay');
const startBtn = document.getElementById('start-btn');
const errorOverlay = document.getElementById('error-overlay');
const errorMessage = document.getElementById('error-message');

// HUD elements
const hudHandsDetected = document.getElementById('hud-hands');
const hudFPS = document.getElementById('hud-fps');
const hudGesture = document.getElementById('hud-gesture-text');
const hudSpread = document.getElementById('hud-spread');

// Mode switcher
const modeButtons = document.querySelectorAll('.mode-btn');

// DJ-specific elements
const djInstructionsOverlay = document.getElementById('dj-instructions-overlay');
const djStartBtn = document.getElementById('dj-start-btn');
const uploadZone = document.getElementById('upload-zone');
const audioFileInput = document.getElementById('audio-file-input');
const djEffectName = document.getElementById('dj-effect-name');
const djEffectIntensity = document.getElementById('dj-effect-intensity');
const djTrackName = document.getElementById('dj-track-name');

// Transport controls
const transportPlay = document.getElementById('transport-play');
const transportStop = document.getElementById('transport-stop');
const transportLoop = document.getElementById('transport-loop');
const transportUpload = document.getElementById('transport-upload');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const transportCurrent = document.getElementById('transport-current');
const transportDuration = document.getElementById('transport-duration');

// Theme buttons
const themeButtons = document.querySelectorAll('.theme-btn');
const naturalModeToggle = document.getElementById('natural-mode-toggle');
const minimalUIToggle = document.getElementById('minimal-ui-toggle');

// Mixer mode
const mixerStage = document.getElementById('mixer-stage');
const mixerFadersEl = document.getElementById('mixer-faders');
const mixerInstructionsOverlay = document.getElementById('mixer-instructions-overlay');
const mixerStartBtn = document.getElementById('mixer-start-btn');
const mixerLayoutBtn = document.getElementById('mixer-layout-btn');
const mixerLayoutIcon = document.getElementById('mixer-layout-icon');
const mixerUploadBtn = document.getElementById('mixer-upload-btn');
const mixerPlayBtn = document.getElementById('mixer-play-btn');
const mixerFaderEls = document.querySelectorAll('.mixer-fader');

// Sound pads (DJ floating samples)
const soundPadElements = document.querySelectorAll('.sound-pad');
const soundPadAudios = {
  fah: document.getElementById('sound-pad-fah-audio'),
};
const soundPadCooldowns = {}; // padId → last-trigger timestamp (ms)
const SOUND_PAD_COOLDOWN_MS = 250;

// Advanced DJ toolbar
const audioFileInputB = document.getElementById('audio-file-input-b');
const btnTapTempo = document.getElementById('btn-tap-tempo');
const btnRecord = document.getElementById('btn-record');
const btnMacroRec = document.getElementById('btn-macro-rec');
const btnMacroPlay = document.getElementById('btn-macro-play');
const btnLoopIn = document.getElementById('btn-loop-in');
const btnLoopOut = document.getElementById('btn-loop-out');
const btnLoopClear = document.getElementById('btn-loop-clear');
const btnDeckB = document.getElementById('btn-deck-b');
const presetSelect = document.getElementById('preset-select');
const midiSelect = document.getElementById('midi-select');
const crossfaderPanel = document.getElementById('crossfader-panel');
const crossfaderSlider = document.getElementById('crossfader-slider');
const xfadeValueLabel = document.getElementById('xfade-value');
const djBpmEl = document.getElementById('dj-bpm');
const djTrackNameB = document.getElementById('dj-track-name-b');
const eqPills = document.querySelectorAll('.eq-pill');
const waveformCanvas = document.getElementById('waveform-canvas');
const waveformCtx = waveformCanvas.getContext('2d');
const loopMarkerIn = document.getElementById('loop-marker-in');
const loopMarkerOut = document.getElementById('loop-marker-out');
const loopRegionEl = document.getElementById('loop-region');

// ── State ──
let currentTheme = defaultTheme;
let currentMode = 'antigravity'; // 'antigravity' | 'dj'
let isRunning = false;
let cameraStarted = false;
let animFrameId = null;
let lastTime = 0;
let djTrackLoaded = false;
let wasHandsConnected = false;
const tapBursts = []; // { x, y, age, maxAge }

// Tap tempo
const tapTempoStamps = [];
let manualBPM = 0;

// Preset mapping
let currentPreset = 'default';
const PRESETS = {
  default: { filterMax: 8000, distMax: 80, bassMax: 24, delayMax: 0.8, delayFbMax: 0.85, reverbMax: 1.0, volumeMax: 1.5 },
  house:   { filterMax: 12000, distMax: 40, bassMax: 18, delayMax: 0.5, delayFbMax: 0.7,  reverbMax: 0.6, volumeMax: 1.4 },
  dnb:     { filterMax: 14000, distMax: 100, bassMax: 28, delayMax: 0.25, delayFbMax: 0.6, reverbMax: 0.4, volumeMax: 1.6 },
  ambient: { filterMax: 6000, distMax: 20, bassMax: 12, delayMax: 1.5, delayFbMax: 0.9,  reverbMax: 1.2, volumeMax: 1.3 },
};

// Macro recorder
let isMacroRecording = false;
let macroStartTime = 0;
let macroSnapshots = [];
let macroPlayback = null; // { startTime, snapshots, index }
const MACRO_SNAPSHOT_INTERVAL_MS = 40;
let lastMacroSnapshotTime = 0;

// MIDI
let midiAccess = null;
let midiOutput = null;
const lastMidiCC = {};

// Stutter state
let bothFistFrames = 0;
const STUTTER_HOLD_FRAMES = 4;

// Crossfade-by-gesture state
let bothOpenForXfade = false;

// Last bass energy for reactive UI
let smoothedBass = 0;

// ── Mixer state ──
let mixerLayout = 'vertical'; // 'vertical' | 'horizontal'
const mixerFaders = []; // populated in init: { el, param, value, touched }
const MIXER_DEFAULTS = {
  volume: 0.67,
  low: 0.5,
  mid: 0.5,
  high: 0.5,
  filter: 1.0,
  reverb: 0.0,
};

// ── Systems ──
const particleSystem = new ParticleSystem();
const renderer = new Renderer(cameraCanvas, particleCanvas);
const djRenderer = new DJRenderer(renderer.partCtx);

// ═══════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════

async function init() {
  setTheme(defaultTheme);

  // Instructions start hidden behind loading screen
  instructionsOverlay.classList.add('hidden');
  djInstructionsOverlay.classList.add('hidden');

  // Mode switcher
  modeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (mode) switchMode(mode);
    });
  });

  // Theme buttons
  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const themeName = btn.dataset.theme;
      if (themeName && themes[themeName]) {
        setTheme(themeName);
      }
    });
  });

  // Start button (Anti-Gravity)
  startBtn.addEventListener('click', startExperience);

  // DJ start button
  djStartBtn.addEventListener('click', startDJExperience);

  // File upload handlers
  setupFileUpload();

  // Transport controls
  setupTransportControls();

  // Sound pads: click fallback
  soundPadElements.forEach((el) => {
    el.addEventListener('click', () => triggerSoundPad(el.dataset.pad, el.dataset.kind));
  });

  // Natural / Vivid camera mode
  naturalModeToggle.addEventListener('click', toggleNaturalMode);
  minimalUIToggle.addEventListener('click', toggleMinimalUI);

  // Mixer
  setupMixer();

  // Advanced DJ toolbar
  setupDJToolbar();

  // Keyboard shortcuts
  setupKeyboard();

  // MIDI (best-effort, async)
  initMIDI();

  // Handle resize
  window.addEventListener('resize', handleResize);
  handleResize();

  // Load hand tracker
  loadingText.textContent = 'Loading hand tracking model...';
  try {
    await initHandTracker();
    loadingText.textContent = 'Model loaded — ready!';

    setTimeout(() => {
      loadingScreen.classList.add('hidden');
      instructionsOverlay.classList.remove('hidden');
    }, 600);
  } catch (err) {
    console.error('Failed to init hand tracker:', err);
    loadingText.textContent = 'Failed to load model. Please refresh.';
  }
}

// ═══════════════════════════════════════════
// Mode Switching
// ═══════════════════════════════════════════

function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  // Update button states
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Toggle body classes
  document.body.classList.toggle('dj-mode', mode === 'dj');
  document.body.classList.toggle('mixer-mode', mode === 'mixer');

  // Update title badge
  const titleMain = document.querySelector('.title-main');
  const titleSub = document.querySelector('.title-sub');
  if (mode === 'dj') {
    titleMain.textContent = 'DJ Controller';
    titleSub.textContent = 'Hand Tracking • Audio FX';
  } else if (mode === 'mixer') {
    titleMain.textContent = 'Simple Mixer';
    titleSub.textContent = 'Slide fingers on faders';
  } else {
    titleMain.textContent = 'Anti-Gravity Controller';
    titleSub.textContent = 'Hand Tracking • MediaPipe AI';
  }

  // Hide all instruction overlays first
  instructionsOverlay.classList.add('hidden');
  djInstructionsOverlay.classList.add('hidden');
  mixerInstructionsOverlay.classList.add('hidden');

  // Show the appropriate instructions if camera isn't running yet
  if (!cameraStarted) {
    if (mode === 'dj') djInstructionsOverlay.classList.remove('hidden');
    else if (mode === 'mixer') mixerInstructionsOverlay.classList.remove('hidden');
    else instructionsOverlay.classList.remove('hidden');
  } else {
    // Camera already running
    if (mode === 'dj' && !djTrackLoaded) djInstructionsOverlay.classList.remove('hidden');
    if (mode === 'mixer' && !djTrackLoaded) mixerStage.classList.remove('has-track');
  }

  // Reset effects on Anti-Gravity (no audio there)
  if (mode === 'antigravity') {
    audio.resetEffects();
  } else if (mode === 'mixer') {
    // Apply current mixer values immediately so the audio matches what's on screen
    if (djTrackLoaded) {
      mixerStage.classList.add('has-track');
      mixerFaders.forEach((f) => applyMixerValue(f.param, f.value));
    }
  }
}

// ═══════════════════════════════════════════
// Camera & Experience Start
// ═══════════════════════════════════════════

async function startCamera() {
  if (cameraStarted) return;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  video.srcObject = stream;
  await video.play();
  cameraStarted = true;
}

async function startExperience() {
  try {
    await startCamera();
    instructionsOverlay.classList.add('hidden');

    if (!isRunning) {
      isRunning = true;
      lastTime = performance.now();
      loop();
    }
  } catch (err) {
    console.error('Camera access failed:', err);
    instructionsOverlay.classList.add('hidden');
    showError(getCameraErrorMessage(err));
  }
}

async function startDJExperience() {
  try {
    await startCamera();
    djInstructionsOverlay.classList.add('hidden');

    // Initialize audio engine
    audio.initAudioEngine();

    // Start playback if track is loaded
    if (djTrackLoaded && !audio.getIsPlaying()) {
      audio.play();
      transportPlay.textContent = '⏸';
    }

    if (!isRunning) {
      isRunning = true;
      lastTime = performance.now();
      loop();
    }
  } catch (err) {
    console.error('Camera access failed:', err);
    djInstructionsOverlay.classList.add('hidden');
    showError(getCameraErrorMessage(err));
  }
}

// ═══════════════════════════════════════════
// File Upload
// ═══════════════════════════════════════════

function setupFileUpload() {
  // Click to upload
  uploadZone.addEventListener('click', () => {
    audioFileInput.click();
  });

  // File input change
  audioFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleAudioFile(e.target.files[0]);
    }
  });

  // Drag and drop
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) {
      handleAudioFile(file);
    }
  });

  // Transport upload button
  transportUpload.addEventListener('click', () => {
    audioFileInput.click();
  });
}

async function handleAudioFile(file) {
  try {
    audio.initAudioEngine();

    // Show loading state
    const uploadText = uploadZone.querySelector('.upload-text');
    uploadText.innerHTML = '<strong>Loading track...</strong>';

    const info = await audio.loadAudioFile(file);

    djTrackLoaded = true;
    djTrackName.textContent = info.name;
    transportDuration.textContent = audio.formatTime(info.duration);
    if (info.bpm) djBpmEl.textContent = `${info.bpm}`;

    // Update upload zone
    uploadText.innerHTML = `<strong>✓ ${info.name}</strong>`;

    // Mixer mode: reveal the faders + apply current values + auto-play
    mixerStage.classList.add('has-track');
    if (currentMode === 'mixer') {
      mixerFaders.forEach((f) => applyMixerValue(f.param, f.value));
      if (!audio.getIsPlaying()) {
        audio.play();
        mixerPlayBtn.textContent = '⏸';
      }
    }

    // Enable start button
    djStartBtn.disabled = false;
    djStartBtn.textContent = 'Start DJ Experience';
  } catch (err) {
    console.error('Failed to load audio:', err);
    const uploadText = uploadZone.querySelector('.upload-text');
    uploadText.innerHTML = '<strong style="color:#f87171;">Failed to load. Try another file.</strong>';
  }
}

// ═══════════════════════════════════════════
// Transport Controls
// ═══════════════════════════════════════════

function setupTransportControls() {
  transportPlay.addEventListener('click', () => {
    if (!djTrackLoaded) return;
    audio.initAudioEngine();

    if (audio.getIsPlaying()) {
      audio.pause();
      transportPlay.textContent = '▶';
    } else {
      audio.play();
      transportPlay.textContent = '⏸';
    }
  });

  transportStop.addEventListener('click', () => {
    audio.stop();
    transportPlay.textContent = '▶';
    progressFill.style.width = '0%';
    transportCurrent.textContent = '0:00';
  });

  transportLoop.addEventListener('click', () => {
    const looping = audio.toggleLoop();
    transportLoop.classList.toggle('active', looping);
  });

  // Progress bar seeking
  progressBar.addEventListener('click', (e) => {
    if (!djTrackLoaded) return;
    const rect = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const time = ratio * audio.getDuration();
    audio.seek(time);
  });
}

function updateTransport() {
  if (!djTrackLoaded) return;

  const current = audio.getCurrentTime();
  const duration = audio.getDuration();

  if (duration > 0) {
    const pct = (current / duration) * 100;
    progressFill.style.width = `${pct}%`;
  }

  transportCurrent.textContent = audio.formatTime(current);

  // Auto-update play button state
  if (!audio.getIsPlaying() && transportPlay.textContent === '⏸') {
    transportPlay.textContent = '▶';
  }

  // Keep loop markers in sync if region exists
  refreshLoopMarkers();
}

// ═══════════════════════════════════════════
// Main Render Loop
// ═══════════════════════════════════════════

function loop() {
  if (!isRunning) return;

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 16.67, 3);
  lastTime = now;

  // 1. Detect hands
  const { landmarks, fps } = detectHands(video);

  // 2. Draw camera feed
  renderer.drawCamera(video);

  // 3. Clear particle canvas
  renderer.clearParticles();

  // 4. Process hands
  let activeGesture = GESTURES.NONE;
  let activeSpread = 0;

  // ── Two-hand connection (fusion) ──
  let connection = null;
  let handSpan = null;
  if (landmarks.length === 2) {
    const c = getHandConnection(landmarks[0], landmarks[1]);
    if (c.connected) {
      connection = c;
    } else {
      handSpan = getHandSpan(landmarks[0], landmarks[1]);
    }
  }

  if (landmarks.length > 0) {
    for (let h = 0; h < landmarks.length; h++) {
      const handLandmarks = landmarks[h];
      const gesture = getGesture(handLandmarks);
      const palm = getPalmCenter(handLandmarks);
      const spread = getSpread(handLandmarks);
      const forceType = getForceType(gesture);

      const palmX = renderer.mapX(palm.x);
      const palmY = renderer.mapY(palm.y);
      const intensity = spread / 100;

      // Edge-triggered finger taps (always evaluated)
      const handId = `hand_${h}`;
      const taps = getFingerTaps(handLandmarks, handId);
      for (const tap of taps) {
        const tx = renderer.mapX(tap.x);
        const ty = renderer.mapY(tap.y);
        tapBursts.push({ x: tx, y: ty, age: 0, maxAge: 28 });

        if (currentMode === 'antigravity') {
          particleSystem.applyBurst(tx, ty, 1);
        } else if (currentMode === 'dj' && djTrackLoaded) {
          // Finger taps = EQ kill toggles (middle=low, ring=mid, pinky=high)
          const eqMap = { middle: 'low', ring: 'mid', pinky: 'high' };
          if (eqMap[tap.finger]) {
            toggleEQKillBand(eqMap[tap.finger]);
            audio.duck(0.15, 60); // tactile micro-duck
          }
        }
      }

      // Skip per-hand force/effect application while hands are fused
      if (connection) {
        activeGesture = GESTURES.CONNECTION;
        activeSpread = Math.max(activeSpread, spread);
        continue;
      }

      if (currentMode === 'antigravity') {
        // ── Anti-Gravity Mode ──
        const strength = 0.5 + intensity * 0.5;

        if (forceType === 'laser') {
          const tip = getIndexTip(handLandmarks);
          const tipX = renderer.mapX(tip.x);
          const tipY = renderer.mapY(tip.y);
          particleSystem.applyHandForce(forceType, palmX, palmY, strength, { x: tipX, y: tipY });
          renderer.drawLaser(palmX, palmY, tipX, tipY);
        } else {
          particleSystem.applyHandForce(forceType, palmX, palmY, strength);
        }

        renderer.drawForceField(palmX, palmY, forceType);
      } else if (currentMode === 'dj' && djTrackLoaded && !macroPlayback) {
        // ── DJ Mode ── (suppressed while a macro is replaying)
        const normX = 1 - palm.x;
        const normY = palm.y;
        applyDJEffect(gesture, normX, normY, intensity, palmX, palmY);

        // Macro snapshot (first hand only)
        if (isMacroRecording && h === 0) {
          recordMacroSnapshot(gesture, normX, normY, intensity);
        }
      }

      activeGesture = gesture;
      activeSpread = spread;
    }

    // ── Both-fist hold → engage stutter ──
    if (currentMode === 'dj' && djTrackLoaded && landmarks.length === 2 && !connection) {
      const g1 = getGesture(landmarks[0]);
      const g2 = getGesture(landmarks[1]);
      const bothFist = g1 === GESTURES.FIST && g2 === GESTURES.FIST;
      if (bothFist) {
        bothFistFrames++;
        if (bothFistFrames === STUTTER_HOLD_FRAMES) {
          audio.setStutter(true, manualBPM ? (60000 / manualBPM / 4) : 125);
        }
      } else {
        if (bothFistFrames >= STUTTER_HOLD_FRAMES) audio.setStutter(false);
        bothFistFrames = 0;
      }
    } else if (audio.isStuttering && audio.isStuttering()) {
      audio.setStutter(false);
      bothFistFrames = 0;
    }

    // ── Apply fusion effect (visual + audio + particles) ──
    if (connection) {
      const x1 = renderer.mapX(connection.p1.x);
      const y1 = renderer.mapY(connection.p1.y);
      const x2 = renderer.mapX(connection.p2.x);
      const y2 = renderer.mapY(connection.p2.y);
      renderer.drawHandConnection(x1, y1, x2, y2, connection.strength);

      if (currentMode === 'antigravity') {
        particleSystem.applyConnectionForce(x1, y1, x2, y2, connection.strength);
      } else if (currentMode === 'dj' && djTrackLoaded) {
        audio.setHandFusionEffect(connection.strength);
      }
    } else if (wasHandsConnected && currentMode === 'dj' && djTrackLoaded) {
      // Fusion just ended — clear the reverb wash + master gain boost
      audio.resetEffects();
    }
    wasHandsConnected = !!connection;

    // ── Continuous two-hand SCENE (palm distance → playback rate) ──
    if (handSpan && currentMode === 'dj' && djTrackLoaded) {
      // Map separation to a musical rate window
      let rate = 0.65 + handSpan.t * 0.85; // 0.65× (close) → 1.50× (wide)
      if (Math.abs(rate - 1.0) < 0.04) rate = 1.0; // dead-zone snap
      audio.setPlaybackRate(rate);

      const x1 = renderer.mapX(handSpan.p1.x);
      const y1 = renderer.mapY(handSpan.p1.y);
      const x2 = renderer.mapX(handSpan.p2.x);
      const y2 = renderer.mapY(handSpan.p2.y);
      renderer.drawHandSpanScene(x1, y1, x2, y2, handSpan.t, rate);
    } else if (currentMode === 'dj' && djTrackLoaded && audio.getPlaybackRate() !== 1.0) {
      // Ease rate back to normal when fewer than 2 hands or during fusion
      audio.setPlaybackRate(1.0);
    }

    // Draw landmarks (skipped in mixer mode for a clean look)
    if (currentMode !== 'mixer') renderer.drawLandmarks(landmarks);
  } else {
    wasHandsConnected = false;
    bothFistFrames = 0;
    if (currentMode === 'dj') {
      audio.resetEffects();
      if (audio.isStuttering && audio.isStuttering()) audio.setStutter(false);
    }
  }

  // Check fingertip hits on floating sound pads (DJ mode)
  checkSoundPadHits(landmarks);

  // Mixer mode: fingertips driving the faders
  if (currentMode === 'mixer') processMixer(landmarks);

  // ── Render & expire tap bursts ──
  for (let i = tapBursts.length - 1; i >= 0; i--) {
    const b = tapBursts[i];
    renderer.drawTapBurst(b.x, b.y, b.age, b.maxAge);
    b.age += dt;
    if (b.age >= b.maxAge) tapBursts.splice(i, 1);
  }

  // 5. Mode-specific rendering
  if (currentMode === 'antigravity') {
    particleSystem.update(dt);
    renderer.drawParticles(particleSystem.getParticles());
  } else if (currentMode === 'dj' && djTrackLoaded) {
    // Macro replay (independent of live gestures, suppressed above)
    if (macroPlayback) advanceMacroPlayback();

    // DJ visualizations
    const waveform = audio.getWaveformData();
    const frequency = audio.getFrequencyData();
    const effectState = audio.getEffectState();
    const bassEnergy = audio.getBassEnergy();

    // Bass-reactive UI (smoothed)
    smoothedBass += (bassEnergy - smoothedBass) * 0.25;
    document.documentElement.style.setProperty('--bass-pulse', smoothedBass.toFixed(3));

    const palmData = landmarks.length > 0 ? {
      x: renderer.mapX(getPalmCenter(landmarks[0]).x),
      y: renderer.mapY(getPalmCenter(landmarks[0]).y),
    } : null;

    djRenderer.draw(
      waveform, frequency, effectState,
      palmData?.x, palmData?.y,
      effectState.activeEffect,
      bassEnergy
    );

    // Waveform timeline
    renderWaveform();

    // Update transport
    updateTransport();
  } else if (smoothedBass > 0.01) {
    smoothedBass *= 0.85;
    document.documentElement.style.setProperty('--bass-pulse', smoothedBass.toFixed(3));
  }

  // 6. Update HUD
  updateHUD(landmarks.length, fps, activeGesture, activeSpread);

  animFrameId = requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════
// Mixer Mode
// ═══════════════════════════════════════════

function setupMixer() {
  // Build fader state list
  mixerFaderEls.forEach((el) => {
    const param = el.dataset.param;
    const value = MIXER_DEFAULTS[param] ?? 0.5;
    el.style.setProperty('--fill', value.toFixed(3));
    mixerFaders.push({ el, param, value, touched: false });
    updateMixerLabel({ el, param, value });
  });

  mixerLayoutBtn.addEventListener('click', toggleMixerLayout);
  mixerUploadBtn.addEventListener('click', () => audioFileInput.click());
  mixerPlayBtn.addEventListener('click', () => {
    if (!djTrackLoaded) { audioFileInput.click(); return; }
    audio.initAudioEngine();
    if (audio.getIsPlaying()) {
      audio.pause();
      mixerPlayBtn.textContent = '▶';
    } else {
      audio.play();
      mixerPlayBtn.textContent = '⏸';
    }
  });

  mixerStartBtn.addEventListener('click', async () => {
    try {
      await startCamera();
      mixerInstructionsOverlay.classList.add('hidden');
      audio.initAudioEngine();
      mixerFaders.forEach((f) => applyMixerValue(f.param, f.value));
      if (!isRunning) { isRunning = true; lastTime = performance.now(); loop(); }
    } catch (err) {
      console.error('Camera access failed:', err);
      mixerInstructionsOverlay.classList.add('hidden');
      showError(getCameraErrorMessage(err));
    }
  });
}

function toggleMixerLayout() {
  mixerLayout = mixerLayout === 'vertical' ? 'horizontal' : 'vertical';
  mixerFadersEl.classList.toggle('vertical', mixerLayout === 'vertical');
  mixerFadersEl.classList.toggle('horizontal', mixerLayout === 'horizontal');
  mixerLayoutIcon.textContent = mixerLayout === 'vertical' ? '⇅' : '⇆';
}

/**
 * Per-frame: check fingertip(s) against each fader and update values.
 */
function processMixer(landmarks) {
  if (!djTrackLoaded) return;
  const tips = landmarks
    .filter((lm) => lm && lm.length >= 21)
    .map((lm) => ({ x: renderer.mapX(lm[8].x), y: renderer.mapY(lm[8].y) }));

  for (const f of mixerFaders) {
    const rect = f.el.getBoundingClientRect();
    if (rect.width === 0) continue;

    let target = null;
    for (const t of tips) {
      if (t.x < rect.left || t.x > rect.right || t.y < rect.top || t.y > rect.bottom) continue;
      if (mixerLayout === 'vertical') {
        target = 1 - (t.y - rect.top) / rect.height;
      } else {
        target = (t.x - rect.left) / rect.width;
      }
      target = Math.max(0, Math.min(1, target));
      break;
    }

    const wasTouched = f.touched;
    if (target !== null) {
      f.value += (target - f.value) * 0.35;
      f.touched = true;
    } else {
      f.touched = false;
    }

    f.el.style.setProperty('--fill', f.value.toFixed(3));
    if (wasTouched !== f.touched) f.el.classList.toggle('touched', f.touched);

    applyMixerValue(f.param, f.value);
    updateMixerLabel(f);
  }
}

function applyMixerValue(param, v) {
  switch (param) {
    case 'volume':
      audio.setVolume(v * 1.5, 1);
      break;
    case 'low':
    case 'mid':
    case 'high':
      audio.setEQGain(param, (v - 0.5) * 24); // -12..+12 dB
      break;
    case 'filter': {
      const hz = 200 * Math.pow(100, v); // 200 Hz ↔ 20 kHz exponential
      audio.setFilter(hz, 1, 1);
      break;
    }
    case 'reverb':
      audio.setReverb(v, 1);
      break;
  }
}

function updateMixerLabel(f) {
  const valEl = f.el.querySelector('.mixer-fader-value');
  if (!valEl) return;
  switch (f.param) {
    case 'volume':
      valEl.textContent = `${Math.round(f.value * 150)}%`; break;
    case 'low':
    case 'mid':
    case 'high': {
      const dB = (f.value - 0.5) * 24;
      valEl.textContent = `${dB >= 0 ? '+' : ''}${dB.toFixed(1)}`; break;
    }
    case 'filter': {
      const hz = 200 * Math.pow(100, f.value);
      valEl.textContent = hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}`;
      break;
    }
    case 'reverb':
      valEl.textContent = `${Math.round(f.value * 100)}%`; break;
  }
}

// ═══════════════════════════════════════════
// Floating Sound Pads
// ═══════════════════════════════════════════

function triggerSoundPad(padId, kindHint) {
  if (!padId) return;
  const now = performance.now();
  if (now - (soundPadCooldowns[padId] || 0) < SOUND_PAD_COOLDOWN_MS) return;
  soundPadCooldowns[padId] = now;

  // Resolve kind from DOM if not given
  let kind = kindHint;
  const padEl = document.querySelector(`.sound-pad[data-pad="${padId}"]`);
  if (!kind && padEl) kind = padEl.dataset.kind;

  if (kind === 'synth') {
    audio.initAudioEngine();
    audio.triggerSynthPad(padId);
  } else {
    const audioEl = soundPadAudios[padId];
    if (audioEl) {
      audioEl.currentTime = 0;
      audioEl.play().catch(() => { /* autoplay/permission noise */ });
    }
  }

  // Side-chain ducking on the music
  if (djTrackLoaded) audio.duck(0.4, 160);

  // MIDI note out (one-shot)
  sendMIDINote(padId);

  if (padEl) {
    padEl.classList.remove('firing');
    void padEl.offsetWidth;
    padEl.classList.add('firing');
    setTimeout(() => padEl.classList.remove('firing'), 500);
  }
}

/**
 * Check every detected hand's index tip against the floating pads and
 * trigger any pad the tip is overlapping. Only active in DJ mode.
 */
function checkSoundPadHits(landmarks) {
  if (currentMode !== 'dj' || landmarks.length === 0) return;

  for (const padEl of soundPadElements) {
    const rect = padEl.getBoundingClientRect();
    if (rect.width === 0) continue; // hidden (not in DJ mode)

    for (const lm of landmarks) {
      if (!lm || lm.length < 21) continue;
      const tip = lm[8]; // INDEX_TIP
      const tx = renderer.mapX(tip.x);
      const ty = renderer.mapY(tip.y);
      if (tx >= rect.left && tx <= rect.right && ty >= rect.top && ty <= rect.bottom) {
        triggerSoundPad(padEl.dataset.pad);
        break; // one hand per pad per frame is enough
      }
    }
  }
}

// ═══════════════════════════════════════════
// DJ Toolbar / Keyboard / MIDI / Macro
// ═══════════════════════════════════════════

function setupDJToolbar() {
  btnTapTempo.addEventListener('click', registerTapTempo);
  btnRecord.addEventListener('click', toggleRecording);
  btnMacroRec.addEventListener('click', toggleMacroRecording);
  btnMacroPlay.addEventListener('click', toggleMacroPlayback);
  btnLoopIn.addEventListener('click', setLoopIn);
  btnLoopOut.addEventListener('click', setLoopOut);
  btnLoopClear.addEventListener('click', clearLoopRegion);
  btnDeckB.addEventListener('click', () => audioFileInputB.click());

  audioFileInputB.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleDeckBFile(e.target.files[0]);
  });

  presetSelect.addEventListener('change', () => { currentPreset = presetSelect.value; });

  midiSelect.addEventListener('change', () => {
    const id = midiSelect.value;
    midiOutput = id && midiAccess ? midiAccess.outputs.get(id) : null;
  });

  crossfaderSlider.addEventListener('input', () => {
    const v = parseInt(crossfaderSlider.value, 10) / 100;
    audio.setCrossfade(v);
    updateCrossfadeLabel(v);
    sendMIDICC(8, Math.round((v + 1) * 63.5));
  });

  // EQ kill pills clickable for fallback
  eqPills.forEach((p) => {
    p.addEventListener('click', () => toggleEQKillBand(p.dataset.band));
  });
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Don't trap when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    const k = e.key.toLowerCase();

    // Always-available
    if (k === '[') return setAdjacentTheme(-1);
    if (k === ']') return setAdjacentTheme(1);
    if (k === 'v') return toggleNaturalMode();
    if (k === 'h') return toggleMinimalUI();

    // DJ-only shortcuts
    if (currentMode !== 'dj') return;

    if (e.code === 'Space') {
      e.preventDefault();
      transportPlay.click();
      return;
    }
    if (e.code === 'ArrowLeft')  { audio.seek(Math.max(0, audio.getCurrentTime() - 5)); return; }
    if (e.code === 'ArrowRight') { audio.seek(Math.min(audio.getDuration(), audio.getCurrentTime() + 5)); return; }

    // Pad triggers 1-5
    if (k >= '1' && k <= '5') {
      const order = ['fah', 'kick', 'snare', 'hat', 'riser'];
      const idx = parseInt(k, 10) - 1;
      if (order[idx]) triggerSoundPad(order[idx]);
      return;
    }

    // EQ kills
    if (k === 'q') return toggleEQKillBand('low');
    if (k === 'w') return toggleEQKillBand('mid');
    if (k === 'e') return toggleEQKillBand('high');

    // Tap tempo / record / macro
    if (k === 't') return registerTapTempo();
    if (k === 'r') return toggleRecording();
    if (k === 'm') return toggleMacroRecording();
    if (k === 'p') return toggleMacroPlayback();

    // Loop
    if (k === 'i') return setLoopIn();
    if (k === 'o') return setLoopOut();
    if (k === 'x') return clearLoopRegion();

    // Deck B
    if (k === 'b') return audioFileInputB.click();

    // Stutter while S held (engage on first press, disengage on keyup handled below)
    if (k === 's') {
      if (!e.repeat) audio.setStutter(true, manualBPM ? 60000 / manualBPM / 4 : 120);
      return;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 's') audio.setStutter(false);
  });
}

function setAdjacentTheme(dir) {
  const names = Array.from(themeButtons).map((b) => b.dataset.theme);
  const idx = names.indexOf(currentTheme);
  const next = names[(idx + dir + names.length) % names.length];
  if (next) setTheme(next);
}

function toggleNaturalMode() {
  document.body.classList.toggle('natural-mode');
}

function toggleMinimalUI() {
  document.body.classList.toggle('minimal-ui');
}

// ── Tap Tempo ──
function registerTapTempo() {
  const now = performance.now();
  tapTempoStamps.push(now);
  while (tapTempoStamps.length > 0 && now - tapTempoStamps[0] > 3000) tapTempoStamps.shift();
  if (tapTempoStamps.length >= 2) {
    const intervals = [];
    for (let i = 1; i < tapTempoStamps.length; i++) intervals.push(tapTempoStamps[i] - tapTempoStamps[i - 1]);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    manualBPM = Math.round(60000 / avg);
  }
  btnTapTempo.classList.add('active');
  setTimeout(() => btnTapTempo.classList.remove('active'), 120);
}

// ── EQ Kills ──
function toggleEQKillBand(band) {
  audio.initAudioEngine();
  const killed = audio.toggleEQKill(band);
  const pill = document.querySelector(`.eq-pill[data-band="${band}"]`);
  if (pill) pill.classList.toggle('killed', killed);
  // MIDI: send 0/127 as a switch
  const ccMap = { low: 12, mid: 13, high: 14 };
  if (ccMap[band] != null) sendMIDICC(ccMap[band], killed ? 127 : 0);
}

// ── Loop Region ──
function setLoopIn() {
  if (!djTrackLoaded) return;
  const t = audio.getCurrentTime();
  const cur = audio.getLoopRegion();
  audio.setLoopRegion(t, cur.end !== null && cur.end > t ? cur.end : Math.min(audio.getDuration(), t + 4));
  refreshLoopMarkers();
}

function setLoopOut() {
  if (!djTrackLoaded) return;
  const t = audio.getCurrentTime();
  const cur = audio.getLoopRegion();
  const start = cur.start !== null ? cur.start : Math.max(0, t - 4);
  if (t <= start) return; // ignore invalid range
  audio.setLoopRegion(start, t);
  refreshLoopMarkers();
}

function clearLoopRegion() {
  audio.clearLoopRegion();
  refreshLoopMarkers();
}

function refreshLoopMarkers() {
  const r = audio.getLoopRegion();
  const dur = audio.getDuration();
  if (r.start === null || r.end === null || dur <= 0) {
    loopMarkerIn.hidden = true;
    loopMarkerOut.hidden = true;
    loopRegionEl.hidden = true;
    return;
  }
  const sPct = (r.start / dur) * 100;
  const ePct = (r.end / dur) * 100;
  loopMarkerIn.style.left = sPct + '%';
  loopMarkerOut.style.left = ePct + '%';
  loopRegionEl.style.left = sPct + '%';
  loopRegionEl.style.width = (ePct - sPct) + '%';
  loopMarkerIn.hidden = false;
  loopMarkerOut.hidden = false;
  loopRegionEl.hidden = false;
}

// ── Recording ──
async function toggleRecording() {
  audio.initAudioEngine();
  if (audio.getIsRecording()) {
    const blob = await audio.stopRecording();
    btnRecord.classList.remove('active');
    if (blob) downloadBlob(blob, `aris-performance-${Date.now()}.webm`);
  } else {
    if (audio.startRecording()) btnRecord.classList.add('active');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Macro Recorder ──
function toggleMacroRecording() {
  if (isMacroRecording) {
    isMacroRecording = false;
    btnMacroRec.classList.remove('active');
    btnMacroPlay.disabled = macroSnapshots.length === 0;
  } else {
    macroSnapshots = [];
    macroStartTime = performance.now();
    lastMacroSnapshotTime = 0;
    isMacroRecording = true;
    btnMacroRec.classList.add('active');
    btnMacroPlay.disabled = true;
    if (macroPlayback) toggleMacroPlayback(); // stop replay if running
  }
}

function toggleMacroPlayback() {
  if (macroPlayback) {
    macroPlayback = null;
    btnMacroPlay.classList.remove('active');
  } else if (macroSnapshots.length > 0) {
    macroPlayback = { startTime: performance.now(), index: 0 };
    btnMacroPlay.classList.add('active');
  }
}

function recordMacroSnapshot(gesture, normX, normY, intensity) {
  if (!isMacroRecording) return;
  const now = performance.now();
  if (now - lastMacroSnapshotTime < MACRO_SNAPSHOT_INTERVAL_MS) return;
  lastMacroSnapshotTime = now;
  macroSnapshots.push({
    t: now - macroStartTime,
    gesture, normX, normY, intensity,
  });
}

function advanceMacroPlayback() {
  if (!macroPlayback) return;
  const elapsed = performance.now() - macroPlayback.startTime;
  while (macroPlayback.index < macroSnapshots.length && macroSnapshots[macroPlayback.index].t <= elapsed) {
    macroPlayback.index++;
  }
  if (macroPlayback.index === 0) return;
  if (macroPlayback.index > macroSnapshots.length - 1) {
    // Loop the macro
    macroPlayback.startTime = performance.now();
    macroPlayback.index = 0;
    return;
  }
  const snap = macroSnapshots[macroPlayback.index - 1];
  applyDJEffect(snap.gesture, snap.normX, snap.normY, snap.intensity);
}

// ── MIDI ──
async function initMIDI() {
  if (!navigator.requestMIDIAccess) return;
  try {
    midiAccess = await navigator.requestMIDIAccess();
    refreshMIDIOutputs();
    midiAccess.onstatechange = refreshMIDIOutputs;
  } catch (e) {
    console.warn('MIDI access denied:', e);
  }
}

function refreshMIDIOutputs() {
  if (!midiAccess) return;
  const selected = midiSelect.value;
  midiSelect.innerHTML = '<option value="">MIDI Off</option>';
  midiAccess.outputs.forEach((out) => {
    const opt = document.createElement('option');
    opt.value = out.id;
    opt.textContent = `MIDI: ${out.name}`;
    midiSelect.appendChild(opt);
  });
  if (selected) midiSelect.value = selected;
  midiOutput = selected ? midiAccess.outputs.get(selected) : null;
}

function sendMIDICC(cc, value) {
  if (!midiOutput) return;
  const v = Math.max(0, Math.min(127, Math.round(value)));
  if (lastMidiCC[cc] === v) return;
  lastMidiCC[cc] = v;
  midiOutput.send([0xB0, cc, v]);
}

function sendMIDINote(padId) {
  if (!midiOutput) return;
  const map = { fah: 36, kick: 37, snare: 38, hat: 39, riser: 40 };
  const note = map[padId];
  if (note == null) return;
  midiOutput.send([0x90, note, 100]);
  setTimeout(() => midiOutput.send([0x80, note, 0]), 80);
}

// ── Deck B ──
async function handleDeckBFile(file) {
  try {
    audio.initAudioEngine();
    const info = await audio.loadDeckBFile(file);
    djTrackNameB.textContent = info.name;
    crossfaderPanel.hidden = false;
    btnDeckB.classList.add('active');
    audio.playDeckB();
  } catch (err) {
    console.error('Failed to load deck B:', err);
    djTrackNameB.textContent = 'Failed';
  }
}

function updateCrossfadeLabel(v) {
  if (v < -0.05) xfadeValueLabel.textContent = 'A ' + Math.round(Math.abs(v) * 100) + '%';
  else if (v > 0.05) xfadeValueLabel.textContent = 'B ' + Math.round(v * 100) + '%';
  else xfadeValueLabel.textContent = 'CENTER';
}

// ═══════════════════════════════════════════
// Waveform Timeline Render
// ═══════════════════════════════════════════

function renderWaveform() {
  const peaks = audio.getWaveformPeaks();
  const w = waveformCanvas.clientWidth;
  const h = waveformCanvas.clientHeight;
  if (waveformCanvas.width !== w * 2 || waveformCanvas.height !== h * 2) {
    waveformCanvas.width = w * 2;
    waveformCanvas.height = h * 2;
    waveformCtx.scale(2, 2);
  }
  waveformCtx.clearRect(0, 0, w, h);
  if (!peaks || peaks.length === 0) return;

  const mid = h / 2;
  const theme = themes[currentTheme];
  waveformCtx.fillStyle = theme.accent;
  waveformCtx.globalAlpha = 0.45;
  const step = w / peaks.length;
  for (let i = 0; i < peaks.length; i++) {
    const v = peaks[i];
    const barH = Math.max(1, v * (h - 2));
    waveformCtx.fillRect(i * step, mid - barH / 2, Math.max(1, step - 0.5), barH);
  }
  waveformCtx.globalAlpha = 1;
}

// ═══════════════════════════════════════════
// DJ Effect Mapping
// ═══════════════════════════════════════════

function applyDJEffect(gesture, normX, normY, intensity, palmX, palmY) {
  const P = PRESETS[currentPreset] || PRESETS.default;
  switch (gesture) {
    case GESTURES.OPEN_HAND: {
      const cutoff = 200 + normX * (P.filterMax - 200);
      const resonance = 0.5 + (1 - normY) * 14.5;
      audio.setFilter(cutoff, resonance, intensity);
      sendMIDICC(74, (cutoff / 20000) * 127);
      sendMIDICC(71, (resonance / 15) * 127);
      break;
    }

    case GESTURES.FIST: {
      const distAmount = normX * P.distMax;
      const bassGain = (1 - normY) * P.bassMax;
      audio.setDistortion(distAmount, bassGain, intensity);
      sendMIDICC(80, (distAmount / 100) * 127);
      break;
    }

    case GESTURES.PINCH: {
      const volume = (1 - normY) * P.volumeMax;
      audio.setVolume(volume, intensity);
      sendMIDICC(7, Math.min(127, (volume / 1.5) * 127));
      break;
    }

    case GESTURES.VICTORY: {
      const delayTime = 0.05 + normX * (P.delayMax - 0.05);
      const feedback = (1 - normY) * P.delayFbMax;
      audio.setDelay(delayTime, feedback, intensity);
      sendMIDICC(93, (delayTime / 1.5) * 127);
      break;
    }

    case GESTURES.POINTING: {
      const wet = normX * P.reverbMax;
      audio.setReverb(wet, intensity);
      sendMIDICC(91, wet * 127);
      break;
    }

    default:
      audio.resetEffects();
      break;
  }
}

// ═══════════════════════════════════════════
// HUD Updates
// ═══════════════════════════════════════════

function updateHUD(handsCount, fps, gesture, spread) {
  hudHandsDetected.textContent = handsCount;
  hudFPS.textContent = fps;
  hudGesture.textContent = gesture;
  hudSpread.textContent = `${spread}%`;

  const forceType = getForceType(gesture);
  if (forceType) {
    hudGesture.style.color = themes[currentTheme].accent;
  } else {
    hudGesture.style.color = '';
  }

  // DJ HUD
  if (currentMode === 'dj') {
    const state = audio.getEffectState();
    const rate = audio.getPlaybackRate();
    const rateLabel = rate !== 1 ? ` · ${rate.toFixed(2)}×` : '';
    djEffectName.textContent = (state.activeEffect || 'None') + rateLabel;
    djEffectIntensity.textContent = `${Math.round(state.effectIntensity * 100)}%`;

    // BPM (prefer manual tap-tempo if set, else auto-detected)
    const bpm = manualBPM || audio.getBPM();
    djBpmEl.textContent = bpm > 0 ? `${bpm}${manualBPM ? ' (tap)' : ''}` : '—';

    if (state.activeEffect) {
      djEffectName.style.color = themes[currentTheme].accent;
    } else {
      djEffectName.style.color = '';
    }
  }
}

// ═══════════════════════════════════════════
// Theme & Resize
// ═══════════════════════════════════════════

function setTheme(themeName) {
  currentTheme = themeName;
  const theme = themes[themeName];

  document.documentElement.setAttribute('data-theme', themeName);

  renderer.setTheme(theme);
  particleSystem.setTheme(theme);
  djRenderer.setTheme(theme);

  themeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === themeName);
  });
}

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);
  particleSystem.setDimensions(w, h);
  djRenderer.setDimensions(w, h);
}

// ═══════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════

function showError(message) {
  errorMessage.textContent = message;
  errorOverlay.classList.add('visible');
}

function getCameraErrorMessage(err) {
  if (err.name === 'NotAllowedError') {
    return 'Camera access was denied. Please allow camera access in your browser settings and refresh the page.';
  }
  if (err.name === 'NotFoundError') {
    return 'No camera found. Please connect a webcam and refresh the page.';
  }
  if (err.name === 'NotReadableError') {
    return 'Camera is in use by another application. Please close other apps using the camera and try again.';
  }
  return `Camera error: ${err.message}. Please check your camera and refresh.`;
}

// ── Start ──
init();
