/**
 * MediaPipe HandLandmarker wrapper.
 * Initializes the hand tracking model and provides detection API.
 */

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task';

let handLandmarker = null;
let lastFrameTime = -1;

// FPS tracking
const fpsSamples = [];
const FPS_SAMPLE_COUNT = 30;

/**
 * Initialize the MediaPipe HandLandmarker.
 * @returns {Promise<void>}
 */
export async function initHandTracker() {
  const { FilesetResolver, HandLandmarker } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'
  );

  const vision = await FilesetResolver.forVisionTasks(WASM_CDN);

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.65,
    minHandPresenceConfidence: 0.65,
    minTrackingConfidence: 0.5,
  });
}

/**
 * Detect hands in the current video frame.
 * @param {HTMLVideoElement} video
 * @returns {{ landmarks: Array, handedness: Array, fps: number }}
 */
export function detectHands(video) {
  if (!handLandmarker || video.readyState < 2) {
    return { landmarks: [], handedness: [], fps: 0 };
  }

  const now = performance.now();

  // Avoid duplicate timestamps
  if (now === lastFrameTime) {
    return { landmarks: [], handedness: [], fps: getAverageFPS() };
  }

  // FPS calculation
  if (lastFrameTime > 0) {
    const delta = now - lastFrameTime;
    fpsSamples.push(1000 / delta);
    if (fpsSamples.length > FPS_SAMPLE_COUNT) {
      fpsSamples.shift();
    }
  }

  lastFrameTime = now;

  const result = handLandmarker.detectForVideo(video, now);

  return {
    landmarks: result.landmarks || [],
    handedness: result.handedness || [],
    fps: getAverageFPS(),
  };
}

/**
 * Get smoothed FPS value.
 */
function getAverageFPS() {
  if (fpsSamples.length === 0) return 0;
  const sum = fpsSamples.reduce((a, b) => a + b, 0);
  return Math.round(sum / fpsSamples.length);
}

/**
 * Check if tracker is ready.
 */
export function isTrackerReady() {
  return handLandmarker !== null;
}
