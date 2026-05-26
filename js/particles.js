/**
 * Anti-Gravity Particle Physics Engine.
 * Manages a system of particles that respond to hand forces.
 */

const MAX_PARTICLES = 200;
const SPAWN_RATE = 2; // particles per frame when below max
const DAMPING = 0.985;
const BASE_ANTIGRAVITY = -0.08; // slight upward drift
const MAX_SPEED = 4;

class Particle {
  constructor(canvasW, canvasH, theme) {
    this.reset(canvasW, canvasH, theme);
  }

  reset(canvasW, canvasH, theme) {
    this.x = Math.random() * canvasW;
    this.y = Math.random() * canvasH;
    this.vx = (Math.random() - 0.5) * 0.5;
    this.vy = (Math.random() - 0.5) * 0.5;
    this.ax = 0;
    this.ay = 0;

    const sizeRange = theme.particleSize;
    this.baseSize = sizeRange.min + Math.random() * (sizeRange.max - sizeRange.min);
    this.size = this.baseSize;

    const colors = theme.particleColors;
    this.color = colors[Math.floor(Math.random() * colors.length)];

    this.opacity = 0.4 + Math.random() * 0.5;
    this.life = 1.0;
    this.decay = 0.0003 + Math.random() * 0.0004;

    this.trail = [];
    this.maxTrail = theme.trailLength;

    // Pulse animation
    this.pulsePhase = Math.random() * Math.PI * 2;
    this.pulseSpeed = 0.02 + Math.random() * 0.03;
  }

  update(canvasW, canvasH, dt) {
    // Store trail position
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > this.maxTrail) {
      this.trail.shift();
    }

    // Apply acceleration
    this.vx += this.ax;
    this.vy += this.ay + BASE_ANTIGRAVITY;

    // Damping
    this.vx *= DAMPING;
    this.vy *= DAMPING;

    // Speed limit
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > MAX_SPEED) {
      const scale = MAX_SPEED / speed;
      this.vx *= scale;
      this.vy *= scale;
    }

    // Move
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Reset acceleration
    this.ax = 0;
    this.ay = 0;

    // Boundary wrapping
    const margin = 50;
    if (this.x < -margin) this.x = canvasW + margin;
    if (this.x > canvasW + margin) this.x = -margin;
    if (this.y < -margin) this.y = canvasH + margin;
    if (this.y > canvasH + margin) this.y = -margin;

    // Decay
    this.life -= this.decay;

    // Pulse size
    this.pulsePhase += this.pulseSpeed;
    this.size = this.baseSize * (0.85 + 0.3 * Math.sin(this.pulsePhase));
  }

  applyForce(fx, fy) {
    this.ax += fx;
    this.ay += fy;
  }

  isAlive() {
    return this.life > 0;
  }
}

export class ParticleSystem {
  constructor() {
    this.particles = [];
    this.canvasW = 0;
    this.canvasH = 0;
    this.theme = null;
  }

  setDimensions(w, h) {
    this.canvasW = w;
    this.canvasH = h;
  }

  setTheme(theme) {
    this.theme = theme;
    // Update existing particle colors
    for (const p of this.particles) {
      const colors = theme.particleColors;
      p.color = colors[Math.floor(Math.random() * colors.length)];
      p.maxTrail = theme.trailLength;
    }
  }

  /**
   * Apply hand force to all particles.
   * @param {string} forceType - 'repel'|'attract'|'grab'|'swirl'|'laser'
   * @param {number} palmX - palm X in canvas coordinates
   * @param {number} palmY - palm Y in canvas coordinates
   * @param {number} strength - force multiplier (0-1, based on spread or distance)
   * @param {{ x: number, y: number }} [indexTip] - index tip for laser
   */
  applyHandForce(forceType, palmX, palmY, strength = 1, indexTip = null) {
    if (!forceType) return;

    const forceRadius = 250; // pixels
    const baseForce = 0.35 * strength;

    for (const p of this.particles) {
      const dx = p.x - palmX;
      const dy = p.y - palmY;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (dist > forceRadius && forceType !== 'laser') continue;
      if (dist < 1) continue;

      // Inverse distance factor (clamped)
      const falloff = 1 - Math.min(dist / forceRadius, 1);
      const force = baseForce * falloff * falloff;

      const nx = dx / dist; // normalized direction
      const ny = dy / dist;

      switch (forceType) {
        case 'repel':
          // Push particles away from palm
          p.applyForce(nx * force * 2, ny * force * 2);
          break;

        case 'attract':
          // Pull particles toward palm
          p.applyForce(-nx * force * 1.5, -ny * force * 1.5);
          break;

        case 'grab':
          // Strong attraction + damping (hold in place)
          p.applyForce(-nx * force * 3, -ny * force * 3);
          p.vx *= 0.92;
          p.vy *= 0.92;
          break;

        case 'swirl':
          // Perpendicular force creates rotation
          p.applyForce(-ny * force * 1.8, nx * force * 1.8);
          // Small inward pull to keep the vortex tight
          p.applyForce(-nx * force * 0.3, -ny * force * 0.3);
          break;

        case 'laser': {
          // Only affect particles near the pointing line
          if (!indexTip) break;
          const ldx = indexTip.x - palmX;
          const ldy = indexTip.y - palmY;
          const lineLen = Math.sqrt(ldx * ldx + ldy * ldy);
          if (lineLen < 1) break;

          // Project particle onto laser line
          const t = Math.max(0, Math.min(2, ((p.x - palmX) * ldx + (p.y - palmY) * ldy) / (lineLen * lineLen)));
          const projX = palmX + ldx * t;
          const projY = palmY + ldy * t;
          const perpDist = Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);

          if (perpDist < 60) {
            // Push along laser direction
            const lnx = ldx / lineLen;
            const lny = ldy / lineLen;
            const pushForce = 0.5 * (1 - perpDist / 60);
            p.applyForce(lnx * pushForce, lny * pushForce);
          }
          break;
        }
      }
    }
  }

  /**
   * Pull particles toward the line connecting two hands (fusion beam).
   */
  applyConnectionForce(x1, y1, x2, y2, strength = 1) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lineLenSq = dx * dx + dy * dy;
    if (lineLenSq < 1) return;
    const lineLen = Math.sqrt(lineLenSq);

    const beamHalfWidth = 240;
    const baseForce = 0.55 * strength;

    for (const p of this.particles) {
      const t = Math.max(0, Math.min(1, ((p.x - x1) * dx + (p.y - y1) * dy) / lineLenSq));
      const projX = x1 + dx * t;
      const projY = y1 + dy * t;
      const ox = p.x - projX;
      const oy = p.y - projY;
      const perpDist = Math.sqrt(ox * ox + oy * oy);
      if (perpDist > beamHalfWidth || perpDist < 0.5) continue;

      const falloff = 1 - perpDist / beamHalfWidth;
      const pull = baseForce * falloff;
      p.applyForce(-(ox / perpDist) * pull * 2, -(oy / perpDist) * pull * 2);

      // Drift along the beam toward the midpoint for a tight fusion look
      const midPull = (0.5 - t) * baseForce * 0.4;
      p.applyForce((dx / lineLen) * midPull, (dy / lineLen) * midPull);
    }
  }

  /**
   * Radial explosive burst at a point (used by finger taps).
   */
  applyBurst(x, y, strength = 1) {
    const radius = 220;
    const baseForce = 1.6 * strength;
    for (const p of this.particles) {
      const dx = p.x - x;
      const dy = p.y - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius || d < 1) continue;
      const falloff = 1 - d / radius;
      const f = baseForce * falloff;
      p.applyForce((dx / d) * f, (dy / d) * f);
    }
  }

  update(dt) {
    if (!this.theme) return;

    // Spawn new particles
    if (this.particles.length < MAX_PARTICLES) {
      const toSpawn = Math.min(SPAWN_RATE, MAX_PARTICLES - this.particles.length);
      for (let i = 0; i < toSpawn; i++) {
        this.particles.push(new Particle(this.canvasW, this.canvasH, this.theme));
      }
    }

    // Update all particles
    for (const p of this.particles) {
      p.update(this.canvasW, this.canvasH, dt);
    }

    // Remove dead particles
    this.particles = this.particles.filter(p => p.isAlive());
  }

  getParticles() {
    return this.particles;
  }
}
