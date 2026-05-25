/**
 * Main Application Orchestrator.
 * Supports two modes: Anti-Gravity (particles) and DJ (audio effects).
 */

import { initHandTracker, detectHands } from './handTracker.js';
import { getGesture, getPalmCenter, getSpread, getForceType, getIndexTip, GESTURES } from './gestures.js';
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

// ── State ──
let currentTheme = defaultTheme;
let currentMode = 'antigravity'; // 'antigravity' | 'dj'
let isRunning = false;
let cameraStarted = false;
let animFrameId = null;
let lastTime = 0;
let djTrackLoaded = false;

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

  // Toggle body class
  document.body.classList.toggle('dj-mode', mode === 'dj');

  // Update title badge
  const titleMain = document.querySelector('.title-main');
  const titleSub = document.querySelector('.title-sub');
  if (mode === 'dj') {
    titleMain.textContent = 'DJ Controller';
    titleSub.textContent = 'Hand Tracking • Audio FX';
  } else {
    titleMain.textContent = 'Anti-Gravity Controller';
    titleSub.textContent = 'Hand Tracking • MediaPipe AI';
  }

  // If switching to DJ and camera hasn't started, show DJ instructions
  if (mode === 'dj' && !cameraStarted) {
    instructionsOverlay.classList.add('hidden');
    djInstructionsOverlay.classList.remove('hidden');
  } else if (mode === 'antigravity' && !cameraStarted) {
    djInstructionsOverlay.classList.add('hidden');
    instructionsOverlay.classList.remove('hidden');
  }

  // If switching to DJ and camera is running, show DJ instructions if no track loaded
  if (mode === 'dj' && cameraStarted && !djTrackLoaded) {
    djInstructionsOverlay.classList.remove('hidden');
  }

  // Reset effects when leaving DJ mode
  if (mode === 'antigravity') {
    audio.resetEffects();
    djInstructionsOverlay.classList.add('hidden');
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

    // Update upload zone
    uploadText.innerHTML = `<strong>✓ ${info.name}</strong>`;

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

  if (landmarks.length > 0) {
    for (const handLandmarks of landmarks) {
      const gesture = getGesture(handLandmarks);
      const palm = getPalmCenter(handLandmarks);
      const spread = getSpread(handLandmarks);
      const forceType = getForceType(gesture);

      const palmX = (1 - palm.x) * renderer.width;
      const palmY = palm.y * renderer.height;
      const intensity = spread / 100;

      if (currentMode === 'antigravity') {
        // ── Anti-Gravity Mode ──
        const strength = 0.5 + intensity * 0.5;

        if (forceType === 'laser') {
          const tip = getIndexTip(handLandmarks);
          const tipX = (1 - tip.x) * renderer.width;
          const tipY = tip.y * renderer.height;
          particleSystem.applyHandForce(forceType, palmX, palmY, strength, { x: tipX, y: tipY });
          renderer.drawLaser(palmX, palmY, tipX, tipY);
        } else {
          particleSystem.applyHandForce(forceType, palmX, palmY, strength);
        }

        renderer.drawForceField(palmX, palmY, forceType);
      } else if (currentMode === 'dj' && djTrackLoaded) {
        // ── DJ Mode ──
        // Map hand position to effect parameters
        // X: 0 (left) to 1 (right) — normalized, mirrored
        const normX = 1 - palm.x;
        // Y: 0 (top) to 1 (bottom)
        const normY = palm.y;

        applyDJEffect(gesture, normX, normY, intensity, palmX, palmY);
      }

      activeGesture = gesture;
      activeSpread = spread;
    }

    // Draw landmarks on camera canvas
    renderer.drawLandmarks(landmarks);
  } else if (currentMode === 'dj') {
    // No hand detected — smoothly reset effects
    audio.resetEffects();
  }

  // 5. Mode-specific rendering
  if (currentMode === 'antigravity') {
    particleSystem.update(dt);
    renderer.drawParticles(particleSystem.getParticles());
  } else if (currentMode === 'dj' && djTrackLoaded) {
    // DJ visualizations
    const waveform = audio.getWaveformData();
    const frequency = audio.getFrequencyData();
    const effectState = audio.getEffectState();
    const bassEnergy = audio.getBassEnergy();

    const palmData = landmarks.length > 0 ? {
      x: (1 - getPalmCenter(landmarks[0]).x) * renderer.width,
      y: getPalmCenter(landmarks[0]).y * renderer.height,
    } : null;

    djRenderer.draw(
      waveform, frequency, effectState,
      palmData?.x, palmData?.y,
      effectState.activeEffect,
      bassEnergy
    );

    // Update transport
    updateTransport();
  }

  // 6. Update HUD
  updateHUD(landmarks.length, fps, activeGesture, activeSpread);

  animFrameId = requestAnimationFrame(loop);
}

// ═══════════════════════════════════════════
// DJ Effect Mapping
// ═══════════════════════════════════════════

function applyDJEffect(gesture, normX, normY, intensity, palmX, palmY) {
  switch (gesture) {
    case GESTURES.OPEN_HAND: {
      // Filter sweep: X = cutoff (200–8000 Hz), Y = resonance (0.5–15)
      const cutoff = 200 + normX * 7800;
      const resonance = 0.5 + (1 - normY) * 14.5;
      audio.setFilter(cutoff, resonance, intensity);
      break;
    }

    case GESTURES.FIST: {
      // Distortion + bass: X = distortion amount (0–80), Y = bass gain
      const distAmount = normX * 80;
      const bassGain = (1 - normY) * 24;
      audio.setDistortion(distAmount, bassGain, intensity);
      break;
    }

    case GESTURES.PINCH: {
      // Volume: Y = volume (0–1.5)
      const volume = (1 - normY) * 1.5;
      audio.setVolume(volume, intensity);
      break;
    }

    case GESTURES.VICTORY: {
      // Delay: X = delay time (0.05–0.8s), Y = feedback (0–0.85)
      const delayTime = 0.05 + normX * 0.75;
      const feedback = (1 - normY) * 0.85;
      audio.setDelay(delayTime, feedback, intensity);
      break;
    }

    case GESTURES.POINTING: {
      // Reverb: X = wet/dry (0–1)
      const wet = normX;
      audio.setReverb(wet, intensity);
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
    djEffectName.textContent = state.activeEffect || 'None';
    djEffectIntensity.textContent = `${Math.round(state.effectIntensity * 100)}%`;

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
