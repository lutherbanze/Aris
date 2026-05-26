/**
 * Gesture detection from 21 hand landmarks.
 *
 * Landmark indices (MediaPipe):
 *   0  = Wrist
 *   1-4  = Thumb (CMC, MCP, IP, TIP)
 *   5-8  = Index (MCP, PIP, DIP, TIP)
 *   9-12 = Middle (MCP, PIP, DIP, TIP)
 *   13-16 = Ring (MCP, PIP, DIP, TIP)
 *   17-20 = Pinky (MCP, PIP, DIP, TIP)
 */

// Gesture types
export const GESTURES = {
  NONE: 'No Hand',
  OPEN_HAND: 'Open Hand',
  FIST: 'Fist',
  PINCH: 'Pinch',
  VICTORY: 'Victory',
  POINTING: 'Pointing',
  CONNECTION: 'Hand Fusion',
};

// Gesture → force mapping
export const GESTURE_FORCES = {
  [GESTURES.NONE]: null,
  [GESTURES.OPEN_HAND]: 'repel',
  [GESTURES.FIST]: 'attract',
  [GESTURES.PINCH]: 'grab',
  [GESTURES.VICTORY]: 'swirl',
  [GESTURES.POINTING]: 'laser',
  [GESTURES.CONNECTION]: null, // handled separately
};

// Thresholds for new gestures
export const HAND_CONNECTION_THRESHOLD = 0.22; // normalized distance index-to-index
const FINGER_TAP_THRESHOLD = 0.05; // thumb tip to other finger tip

// Landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_TIP = 8;
const INDEX_PIP = 6;
const INDEX_MCP = 5;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const MIDDLE_MCP = 9;
const RING_TIP = 16;
const RING_PIP = 14;
const RING_MCP = 13;
const PINKY_TIP = 20;
const PINKY_PIP = 18;
const PINKY_MCP = 17;

// Smoothing state
let smoothedGesture = GESTURES.NONE;
let gestureConfidence = 0;
const GESTURE_THRESHOLD = 3; // frames to confirm gesture change

let smoothedPalm = { x: 0.5, y: 0.5 };
const PALM_SMOOTH = 0.35; // lower = smoother

/**
 * Calculate distance between two landmarks.
 */
function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Check if a finger is extended.
 * A finger is extended if the tip is farther from the wrist than the PIP joint.
 */
function isFingerExtended(landmarks, tipIdx, pipIdx, mcpIdx) {
  const wrist = landmarks[WRIST];
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];

  // Compare tip-to-wrist distance vs pip-to-wrist distance
  const tipDist = dist(tip, wrist);
  const pipDist = dist(pip, wrist);

  return tipDist > pipDist * 1.05;
}

/**
 * Check if thumb is extended (uses different logic — lateral movement).
 */
function isThumbExtended(landmarks) {
  const thumbTip = landmarks[THUMB_TIP];
  const thumbIp = landmarks[THUMB_IP];
  const indexMcp = landmarks[INDEX_MCP];

  // Thumb is extended if tip is farther from index MCP than IP joint
  return dist(thumbTip, indexMcp) > dist(thumbIp, indexMcp) * 1.15;
}

/**
 * Detect gesture from landmarks.
 * @param {Array} landmarks - 21 normalized landmarks
 * @returns {string} gesture name
 */
function detectRawGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return GESTURES.NONE;

  const thumb = isThumbExtended(landmarks);
  const index = isFingerExtended(landmarks, INDEX_TIP, INDEX_PIP, INDEX_MCP);
  const middle = isFingerExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP);
  const ring = isFingerExtended(landmarks, RING_TIP, RING_PIP, RING_MCP);
  const pinky = isFingerExtended(landmarks, PINKY_TIP, PINKY_PIP, PINKY_MCP);

  const extendedCount = [thumb, index, middle, ring, pinky].filter(Boolean).length;

  // Check pinch first — thumb and index tips close together
  const pinchDist = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  if (pinchDist < 0.06 && !middle && !ring && !pinky) {
    return GESTURES.PINCH;
  }

  // Fist — no fingers extended (or just thumb)
  if (extendedCount <= 1 && !index && !middle) {
    return GESTURES.FIST;
  }

  // Pointing — only index extended
  if (index && !middle && !ring && !pinky) {
    return GESTURES.POINTING;
  }

  // Victory — index and middle extended, others closed
  if (index && middle && !ring && !pinky) {
    return GESTURES.VICTORY;
  }

  // Open hand — 4 or 5 fingers extended
  if (extendedCount >= 4) {
    return GESTURES.OPEN_HAND;
  }

  // Default to open hand if 3 fingers
  if (extendedCount >= 3) {
    return GESTURES.OPEN_HAND;
  }

  return GESTURES.FIST;
}

/**
 * Get stabilized gesture with temporal smoothing.
 * @param {Array} landmarks
 * @returns {string}
 */
export function getGesture(landmarks) {
  const raw = detectRawGesture(landmarks);

  if (raw === smoothedGesture) {
    gestureConfidence = GESTURE_THRESHOLD;
    return smoothedGesture;
  }

  gestureConfidence--;
  if (gestureConfidence <= 0) {
    smoothedGesture = raw;
    gestureConfidence = GESTURE_THRESHOLD;
  }

  return smoothedGesture;
}

/**
 * Get the palm center (smoothed).
 * Average of wrist and finger MCP joints.
 * @param {Array} landmarks
 * @returns {{ x: number, y: number }}
 */
export function getPalmCenter(landmarks) {
  if (!landmarks || landmarks.length < 21) return smoothedPalm;

  const points = [landmarks[WRIST], landmarks[INDEX_MCP], landmarks[MIDDLE_MCP], landmarks[RING_MCP], landmarks[PINKY_MCP]];

  let x = 0, y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  x /= points.length;
  y /= points.length;

  // Exponential moving average
  smoothedPalm.x += (x - smoothedPalm.x) * PALM_SMOOTH;
  smoothedPalm.y += (y - smoothedPalm.y) * PALM_SMOOTH;

  return { x: smoothedPalm.x, y: smoothedPalm.y };
}

/**
 * Get the finger spread ratio (0-100%).
 * Normalized distance between fingertips.
 * @param {Array} landmarks
 * @returns {number}
 */
export function getSpread(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;

  const tips = [landmarks[THUMB_TIP], landmarks[INDEX_TIP], landmarks[MIDDLE_TIP], landmarks[RING_TIP], landmarks[PINKY_TIP]];

  // Average distance between adjacent fingertips
  let totalDist = 0;
  for (let i = 0; i < tips.length - 1; i++) {
    totalDist += dist(tips[i], tips[i + 1]);
  }
  const avgDist = totalDist / (tips.length - 1);

  // Normalize: typical spread range is 0.03 to 0.15
  const normalized = Math.min(1, Math.max(0, (avgDist - 0.03) / 0.12));
  return Math.round(normalized * 100);
}

/**
 * Get the force type for the current gesture.
 * @param {string} gesture
 * @returns {string|null}
 */
export function getForceType(gesture) {
  return GESTURE_FORCES[gesture] || null;
}

/**
 * Get index finger tip position (for pointing/laser).
 * @param {Array} landmarks
 * @returns {{ x: number, y: number }}
 */
export function getIndexTip(landmarks) {
  if (!landmarks || landmarks.length < 21) return { x: 0.5, y: 0.5 };
  return { x: landmarks[INDEX_TIP].x, y: landmarks[INDEX_TIP].y };
}

/**
 * Detect connection between two hands via index fingertips.
 * @param {Array} lm1 - first hand landmarks
 * @param {Array} lm2 - second hand landmarks
 * @returns {{ connected: boolean, strength: number, p1: {x,y}, p2: {x,y}, dist: number }}
 */
export function getHandConnection(lm1, lm2) {
  if (!lm1 || !lm2 || lm1.length < 21 || lm2.length < 21) {
    return { connected: false, strength: 0, p1: null, p2: null, dist: 1 };
  }
  const t1 = lm1[INDEX_TIP];
  const t2 = lm2[INDEX_TIP];
  const d = dist(t1, t2);
  const connected = d < HAND_CONNECTION_THRESHOLD;
  // 1.0 at touching, 0 at threshold
  const strength = connected ? Math.max(0, 1 - d / HAND_CONNECTION_THRESHOLD) : 0;
  return {
    connected,
    strength,
    p1: { x: t1.x, y: t1.y },
    p2: { x: t2.x, y: t2.y },
    dist: d,
  };
}

/**
 * Stable per-hand anchor point (wrist + middle MCP midpoint).
 * Use this for two-hand operations to avoid the global smoothing bug
 * inside getPalmCenter.
 */
function handAnchor(lm) {
  return {
    x: (lm[WRIST].x + lm[MIDDLE_MCP].x) / 2,
    y: (lm[WRIST].y + lm[MIDDLE_MCP].y) / 2,
  };
}

/**
 * Continuous two-hand span — distance between palm anchors.
 * Returns null if both hands aren't fully tracked.
 * @returns {{ p1:{x,y}, p2:{x,y}, dist:number, t:number } | null}
 *   t is the normalized 0–1 separation (0 ≈ hands touching, 1 ≈ wide apart).
 */
export function getHandSpan(lm1, lm2) {
  if (!lm1 || !lm2 || lm1.length < 21 || lm2.length < 21) return null;
  const a = handAnchor(lm1);
  const b = handAnchor(lm2);
  const d = dist(a, b);
  // Typical span range: ~0.15 (touching) to ~0.75 (arms wide on screen)
  const t = Math.min(1, Math.max(0, (d - 0.15) / 0.55));
  return { p1: a, p2: b, dist: d, t };
}

// Edge-trigger state for finger taps (per hand id)
const tapStateMap = new Map();

/**
 * Detect edge-triggered finger taps (thumb tip touching middle / ring / pinky).
 * Returns an event only on the frame the tap is initiated.
 * @param {Array} landmarks
 * @param {string} handId - stable identifier for the hand (e.g. 'Left'/'Right' or index)
 * @returns {Array<{ finger: string, x: number, y: number }>}
 */
export function getFingerTaps(landmarks, handId) {
  if (!landmarks || landmarks.length < 21) return [];

  let prev = tapStateMap.get(handId);
  if (!prev) {
    prev = { middle: false, ring: false, pinky: false };
    tapStateMap.set(handId, prev);
  }

  const thumb = landmarks[THUMB_TIP];
  const events = [];
  const targets = [
    { name: 'middle', tip: landmarks[MIDDLE_TIP] },
    { name: 'ring', tip: landmarks[RING_TIP] },
    { name: 'pinky', tip: landmarks[PINKY_TIP] },
  ];

  for (const { name, tip } of targets) {
    const touching = dist(thumb, tip) < FINGER_TAP_THRESHOLD;
    if (touching && !prev[name]) {
      events.push({
        finger: name,
        x: (thumb.x + tip.x) / 2,
        y: (thumb.y + tip.y) / 2,
      });
    }
    prev[name] = touching;
  }

  return events;
}
