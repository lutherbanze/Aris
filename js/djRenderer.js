/**
 * DJ Mode Renderer.
 * Draws audio visualizations: waveform, frequency spectrum,
 * effect indicators, and beat pulse.
 */

export class DJRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx - The particle canvas context
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.width = 0;
    this.height = 0;
    this.theme = null;

    // Beat pulse state
    this.pulseAlpha = 0;
    this.pulseDecay = 0.92;
  }

  setTheme(theme) {
    this.theme = theme;
  }

  setDimensions(w, h) {
    this.width = w;
    this.height = h;
  }

  /**
   * Draw the full DJ visualization frame.
   * @param {Uint8Array} waveformData
   * @param {Uint8Array} frequencyData
   * @param {object} effectState - current effect state
   * @param {number} palmX - palm X in canvas coords
   * @param {number} palmY - palm Y in canvas coords
   * @param {string|null} activeEffect - name of active effect
   * @param {number} bassEnergy - 0–1 bass energy for beat pulse
   */
  draw(waveformData, frequencyData, effectState, palmX, palmY, activeEffect, bassEnergy) {
    if (!this.theme) return;

    this.drawFrequencySpectrum(frequencyData);
    this.drawWaveform(waveformData);
    this.drawBeatPulse(bassEnergy);

    if (activeEffect && palmX != null) {
      this.drawEffectRing(palmX, palmY, activeEffect, effectState);
    }
  }

  /**
   * Draw frequency spectrum bars at the bottom.
   */
  drawFrequencySpectrum(data) {
    if (!data || data.length === 0) return;
    const ctx = this.ctx;
    const barCount = 64;
    const step = Math.floor(data.length / barCount);
    const barWidth = this.width / barCount;
    const maxBarHeight = this.height * 0.35;

    for (let i = 0; i < barCount; i++) {
      // Average a range of frequency bins
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += data[i * step + j];
      }
      const value = sum / step / 255;
      const barHeight = value * maxBarHeight;

      // Gradient color from theme
      const hue = (i / barCount) * 60; // range within theme
      const colors = this.theme.particleColors;
      const color = colors[i % colors.length];

      ctx.globalAlpha = 0.25 + value * 0.35;
      ctx.fillStyle = color;

      const x = i * barWidth;
      const y = this.height - barHeight;

      // Rounded top bar
      const radius = Math.min(barWidth * 0.3, 4);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + barWidth - 1 - radius, y);
      ctx.quadraticCurveTo(x + barWidth - 1, y, x + barWidth - 1, y + radius);
      ctx.lineTo(x + barWidth - 1, this.height);
      ctx.lineTo(x, this.height);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw oscilloscope-style waveform.
   */
  drawWaveform(data) {
    if (!data || data.length === 0) return;
    const ctx = this.ctx;
    const sliceWidth = this.width / data.length;
    const centerY = this.height * 0.7;
    const amplitude = this.height * 0.12;

    // Glow
    ctx.shadowBlur = 12;
    ctx.shadowColor = this.theme.accent;

    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.7;

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] / 128.0) - 1;
      const y = centerY + v * amplitude;
      const x = i * sliceWidth;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Thicker dim background line
    ctx.shadowBlur = 0;
    ctx.strokeStyle = this.theme.primary;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.12;

    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] / 128.0) - 1;
      const y = centerY + v * amplitude;
      const x = i * sliceWidth;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /**
   * Draw beat-reactive border pulse.
   * @param {number} bassEnergy - 0–1
   */
  drawBeatPulse(bassEnergy) {
    // Update pulse alpha
    this.pulseAlpha = Math.max(this.pulseAlpha * this.pulseDecay, bassEnergy * 0.5);

    if (this.pulseAlpha < 0.02) return;

    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, this.height, 0, this.height - 80);
    gradient.addColorStop(0, this.theme.primary.replace(')', `, ${this.pulseAlpha})`).replace('rgb', 'rgba'));
    gradient.addColorStop(1, 'transparent');

    // Bottom glow
    ctx.fillStyle = this.theme.primary;
    ctx.globalAlpha = this.pulseAlpha * 0.4;
    ctx.fillRect(0, this.height - 40, this.width, 40);

    // Top glow (subtle)
    ctx.globalAlpha = this.pulseAlpha * 0.15;
    ctx.fillRect(0, 0, this.width, 20);

    // Side glows
    ctx.globalAlpha = this.pulseAlpha * 0.2;
    ctx.fillRect(0, 0, 10, this.height);
    ctx.fillRect(this.width - 10, 0, 10, this.height);

    ctx.globalAlpha = 1;
  }

  /**
   * Draw effect ring around the palm.
   * @param {number} palmX
   * @param {number} palmY
   * @param {string} effectName
   * @param {object} effectState
   */
  drawEffectRing(palmX, palmY, effectName, effectState) {
    const ctx = this.ctx;
    const intensity = effectState.effectIntensity || 0;
    if (intensity < 0.02) return;

    const radius = 60 + intensity * 30;

    // Outer ring
    ctx.strokeStyle = this.theme.accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4 * intensity;
    ctx.shadowBlur = 20;
    ctx.shadowColor = this.theme.accent;

    ctx.beginPath();
    ctx.arc(palmX, palmY, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Arc indicator showing intensity
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.8 * intensity;
    ctx.beginPath();
    ctx.arc(palmX, palmY, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * intensity);
    ctx.stroke();

    // Effect label
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    ctx.font = '600 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.theme.accent;
    ctx.fillText(effectName.toUpperCase(), palmX, palmY - radius - 12);

    // Parameter display
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = this.theme.landmarkColor;

    let paramText = '';
    switch (effectName) {
      case 'Filter':
        paramText = `${Math.round(effectState.filterCutoff)}Hz  Q:${effectState.filterResonance.toFixed(1)}`;
        break;
      case 'Distortion':
        paramText = `Drive: ${Math.round(effectState.distortionAmount)}%`;
        break;
      case 'Delay':
        paramText = `${(effectState.delayTime * 1000).toFixed(0)}ms  FB:${Math.round(effectState.delayFeedback * 100)}%`;
        break;
      case 'Reverb':
        paramText = `Wet: ${Math.round(effectState.reverbWet * 100)}%`;
        break;
      case 'Volume':
        paramText = `Vol: ${Math.round(effectState.volume * 100)}%`;
        break;
    }
    ctx.fillText(paramText, palmX, palmY + radius + 18);

    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }
}
