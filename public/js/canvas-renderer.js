/**
 * Particle and Celebration Effects Overlay using HTML5 Canvas 2D.
 * Handles celebration confetti and sparkles upon card matches and round victories.
 */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.particles = [];
    this.hasDrawn = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    if (!this.canvas) return;
    const w = window.innerWidth || document.documentElement.clientWidth || 1000;
    const h = window.innerHeight || document.documentElement.clientHeight || 700;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // Stubs for backwards compatibility
  updateRemoteCursor() {}
  removeRemoteCursor() {}
  syncRemoteCursors() {}

  clear() {
    this.particles = [];
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.hasDrawn = false;
  }

  spawnConfetti(originX, originY, count = 30) {
    if (!this.ctx) return;
    const colors = ['#ff4757', '#2ed573', '#ffa502', '#1e90ff', '#9b59b6', '#ffd32a', '#ff6b81', '#00d2d3'];
    const emojis = ['🍕', '🍔', '🍣', '🍩', '🌮', '⭐', '✨', '🎉'];

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      const isEmoji = Math.random() < 0.25;

      this.particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        gravity: 0.16,
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 12,
        size: 7 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
        emoji: isEmoji ? emojis[Math.floor(Math.random() * emojis.length)] : null,
        life: 1.0,
        decay: 0.014 + Math.random() * 0.018
      });
    }
  }

  spawnVictoryCelebration() {
    if (!this.canvas) return;
    const w = this.canvas.width || window.innerWidth;
    const h = this.canvas.height || window.innerHeight;

    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const x = w * (0.15 + Math.random() * 0.7);
        const y = h * (0.15 + Math.random() * 0.45);
        this.spawnConfetti(x, y, 35);
      }, i * 180);
    }
  }

  render() {
    if (!this.ctx || !this.canvas) return;

    if (this.particles.length === 0) {
      if (this.hasDrawn) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.hasDrawn = false;
      }
      return;
    }

    this.hasDrawn = true;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Limit maximum particles to prevent any performance hit
    if (this.particles.length > 250) {
      this.particles.splice(0, this.particles.length - 250);
    }

    try {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.rotation += p.vRot;
        p.life -= p.decay;

        if (p.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        this.ctx.save();
        this.ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate((p.rotation * Math.PI) / 180);

        if (p.emoji) {
          this.ctx.font = `${Math.round(p.size * 1.5)}px sans-serif`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText(p.emoji, 0, 0);
        } else {
          this.ctx.fillStyle = p.color;
          this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        }
        this.ctx.restore();
      }
    } catch (err) {
      console.error('[CanvasRenderer] Render error:', err);
    }
  }
}
