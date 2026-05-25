/**
 * Canvas Renderer.
 * Draws the webcam feed, hand landmarks, particles, and visual effects.
 */

// Hand landmark connections (MediaPipe hand model)
const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // Index
  [0, 9], [9, 10], [10, 11], [11, 12],  // Middle
  [0, 13], [13, 14], [14, 15], [15, 16],// Ring
  [0, 17], [17, 18], [18, 19], [19, 20],// Pinky
  [5, 9], [9, 13], [13, 17],            // Palm connections
];

export class Renderer {
  /**
   * @param {HTMLCanvasElement} cameraCanvas
   * @param {HTMLCanvasElement} particleCanvas
   */
  constructor(cameraCanvas, particleCanvas) {
    this.camCanvas = cameraCanvas;
    this.camCtx = cameraCanvas.getContext('2d');
    this.partCanvas = particleCanvas;
    this.partCtx = particleCanvas.getContext('2d');
    this.theme = null;
  }

  setTheme(theme) {
    this.theme = theme;
  }

  /**
   * Resize canvases to match container.
   */
  resize(width, height) {
    // Set actual pixel dimensions (for crisp rendering)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.camCanvas.width = width * dpr;
    this.camCanvas.height = height * dpr;
    this.partCanvas.width = width * dpr;
    this.partCanvas.height = height * dpr;

    // Scale context to account for DPR
    this.camCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.partCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width = width;
    this.height = height;
  }

  /**
   * Draw the mirrored webcam feed.
   * @param {HTMLVideoElement} video
   */
  drawCamera(video) {
    const ctx = this.camCtx;
    ctx.save();

    // Mirror horizontally
    ctx.translate(this.width, 0);
    ctx.scale(-1, 1);

    ctx.drawImage(video, 0, 0, this.width, this.height);
    ctx.restore();
  }

  /**
   * Draw hand landmarks and connections.
   * @param {Array} allLandmarks - array of hands, each with 21 landmarks
   */
  drawLandmarks(allLandmarks) {
    if (!this.theme) return;
    const ctx = this.camCtx;

    for (const landmarks of allLandmarks) {
      // Draw connections
      ctx.strokeStyle = this.theme.connectionColor;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';

      for (const [i, j] of CONNECTIONS) {
        const a = landmarks[i];
        const b = landmarks[j];
        // Mirror X coordinates
        const ax = (1 - a.x) * this.width;
        const ay = a.y * this.height;
        const bx = (1 - b.x) * this.width;
        const by = b.y * this.height;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }

      // Draw landmark points
      for (let i = 0; i < landmarks.length; i++) {
        const lm = landmarks[i];
        const x = (1 - lm.x) * this.width;
        const y = lm.y * this.height;

        // Fingertips get larger dots
        const isTip = [4, 8, 12, 16, 20].includes(i);
        const radius = isTip ? 5 : 3;

        // Glow
        ctx.shadowBlur = isTip ? 12 : 6;
        ctx.shadowColor = this.theme.glowColor;

        ctx.fillStyle = isTip ? this.theme.accent : this.theme.landmarkColor;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 0;
      }
    }
  }

  /**
   * Draw force field visualization around palm.
   * @param {number} palmX - canvas X
   * @param {number} palmY - canvas Y
   * @param {string} forceType
   */
  drawForceField(palmX, palmY, forceType) {
    if (!forceType || !this.theme) return;
    const ctx = this.partCtx;

    const radius = 120;
    const gradient = ctx.createRadialGradient(palmX, palmY, 0, palmX, palmY, radius);

    let color = this.theme.forceFieldColor;
    // Make attract/grab more visible
    if (forceType === 'attract' || forceType === 'grab') {
      color = this.theme.forceFieldColor.replace('0.15', '0.25');
    }

    gradient.addColorStop(0, color);
    gradient.addColorStop(0.5, color.replace(/[\d.]+\)$/, '0.05)'));
    gradient.addColorStop(1, 'transparent');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(palmX, palmY, radius, 0, Math.PI * 2);
    ctx.fill();

    // Force type ring
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.2;

    if (forceType === 'swirl') {
      // Animated spiral
      const time = performance.now() * 0.002;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.1) {
        const r = 20 + a * 12;
        const x = palmX + Math.cos(a + time) * r;
        const y = palmY + Math.sin(a + time) * r;
        if (a === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw the laser beam for pointing gesture.
   */
  drawLaser(palmX, palmY, tipX, tipY) {
    if (!this.theme) return;
    const ctx = this.partCtx;

    // Extend the line beyond the tip
    const dx = tipX - palmX;
    const dy = tipY - palmY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const extendedX = tipX + (dx / len) * 2000;
    const extendedY = tipY + (dy / len) * 2000;

    // Glow
    ctx.shadowBlur = 15;
    ctx.shadowColor = this.theme.accent;

    // Core beam
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(extendedX, extendedY);
    ctx.stroke();

    // Outer glow
    ctx.strokeStyle = this.theme.primary;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(extendedX, extendedY);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /**
   * Draw all particles with trails and glow.
   * @param {Array} particles
   */
  drawParticles(particles) {
    if (!this.theme) return;
    const ctx = this.partCtx;
    const glowIntensity = this.theme.glowIntensity;

    for (const p of particles) {
      const alpha = p.opacity * p.life;
      if (alpha < 0.01) continue;

      // Draw trail
      if (p.trail.length > 1) {
        ctx.beginPath();
        ctx.moveTo(p.trail[0].x, p.trail[0].y);
        for (let i = 1; i < p.trail.length; i++) {
          ctx.lineTo(p.trail[i].x, p.trail[i].y);
        }
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.6;
        ctx.globalAlpha = alpha * 0.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Draw particle with glow
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = glowIntensity;
      ctx.shadowColor = p.color;

      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      // Bright core
      ctx.shadowBlur = 0;
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /**
   * Clear the particle canvas for the next frame.
   */
  clearParticles() {
    this.partCtx.clearRect(0, 0, this.width, this.height);
  }
}
