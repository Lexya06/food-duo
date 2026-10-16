/**
 * CanvasRenderer: 60fps dynamic world rendering with parallax layers,
 * procedural creature graphics, opponents' viewfinders, and camera transform.
 */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mapWidth = 2400;
    this.mapHeight = 1600;

    // Camera transform
    this.camera = { x: 1200, y: 800, zoom: 1.0, targetX: 1200, targetY: 800 };
    this.creatures = [];
    this.otherPlayers = [];
    this.currentTargetUid = null;
    this.animTime = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width || 1200;
    this.canvas.height = rect.height || 650;
  }

  setCameraTarget(x, y, zoom) {
    this.camera.targetX = Math.max(0, Math.min(this.mapWidth, x));
    this.camera.targetY = Math.max(0, Math.min(this.mapHeight, y));
    if (zoom !== undefined) this.camera.zoom = zoom;
  }

  updateData(snapshot, myPlayerId) {
    if (!snapshot) return;
    this.creatures = snapshot.creatures || [];
    this.currentTargetUid = snapshot.currentTarget?.uid;
    this.otherPlayers = (snapshot.players || []).filter(p => p.playerId !== myPlayerId);
  }

  render() {
    this.animTime += 0.016;

    // Smooth camera lerp
    this.camera.x += (this.camera.targetX - this.camera.x) * 0.15;
    this.camera.y += (this.camera.targetY - this.camera.y) * 0.15;

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    // Center camera on screen
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 1. Draw Map Background & Zones
    this.drawTerrain(ctx);

    // 2. Draw Environmental Props (Trees, Rocks, Rivers, Cyberflora)
    this.drawDecorations(ctx);

    // 3. Draw Creatures
    for (const c of this.creatures) {
      this.drawCreature(ctx, c);
    }

    // 4. Draw Other Players' Laser Crosshairs / Viewfinders
    for (const p of this.otherPlayers) {
      this.drawOpponentViewfinder(ctx, p);
    }

    ctx.restore();
  }

  drawTerrain(ctx) {
    // Savannah base
    const grad = ctx.createLinearGradient(0, 0, this.mapWidth, this.mapHeight);
    grad.addColorStop(0, '#2b3a1a');   // Jungle green
    grad.addColorStop(0.4, '#4a411e'); // Savannah golden
    grad.addColorStop(0.7, '#1b3240'); // River azure
    grad.addColorStop(1, '#1b1b36');   // Cyber neon zone

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.mapWidth, this.mapHeight);

    // Map boundary border
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, this.mapWidth, this.mapHeight);

    // River curve
    ctx.beginPath();
    ctx.moveTo(900, 0);
    ctx.bezierCurveTo(1100, 400, 800, 1000, 1200, 1600);
    ctx.lineWidth = 140;
    ctx.strokeStyle = 'rgba(0, 180, 216, 0.4)';
    ctx.stroke();

    // River ripples
    ctx.beginPath();
    ctx.moveTo(910, 0);
    ctx.bezierCurveTo(1110, 400, 810, 1000, 1210, 1600);
    ctx.lineWidth = 80;
    ctx.strokeStyle = 'rgba(72, 202, 228, 0.5)';
    ctx.stroke();
  }

  drawDecorations(ctx) {
    // Acacia Trees in savannah
    const trees = [
      { x: 450, y: 300, r: 60, col: '#556b2f' },
      { x: 350, y: 800, r: 80, col: '#4c6328' },
      { x: 700, y: 1200, r: 70, col: '#556b2f' },
      { x: 250, y: 1300, r: 90, col: '#3e5220' },
      { x: 1400, y: 250, r: 65, col: '#235347' },
      { x: 1700, y: 500, r: 75, col: '#0f4c5c' },
      { x: 1950, y: 900, r: 85, col: '#5c0f4f' },
      { x: 2150, y: 1350, r: 70, col: '#4a0e4e' }
    ];

    for (const t of trees) {
      // Trunk shadow
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(t.x + 10, t.y + 15, t.r * 0.9, t.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tree canopy
      ctx.fillStyle = t.col;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();

      // Canopy highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCreature(ctx, c) {
    const isTarget = c.uid === this.currentTargetUid;

    ctx.save();
    ctx.translate(c.x, c.y);

    // If stealth chameleon is hiding, set low opacity
    if (c.isHiding) {
      ctx.globalAlpha = 0.25;
    }

    // Target highlight ring if in sight
    if (isTarget) {
      ctx.strokeStyle = 'rgba(255, 214, 0, 0.7)';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, c.size + 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Creature body shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(0, c.size * 0.7, c.size * 0.9, c.size * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Rotate according to heading
    ctx.rotate(c.heading);

    // Body
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(0, 0, c.size, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(c.size * 0.5, -c.size * 0.3, c.size * 0.22, 0, Math.PI * 2);
    ctx.arc(c.size * 0.5, c.size * 0.3, c.size * 0.22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(c.size * 0.6, -c.size * 0.3, c.size * 0.1, 0, Math.PI * 2);
    ctx.arc(c.size * 0.6, c.size * 0.3, c.size * 0.1, 0, Math.PI * 2);
    ctx.fill();

    // Draw unique accessories
    this.drawAccessory(ctx, c.accessory, c.size);

    ctx.restore();

    // Name label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 4;
    ctx.fillText(c.species.replace(/_/g, ' '), c.x, c.y - c.size - 8);
    ctx.shadowBlur = 0;
  }

  drawAccessory(ctx, accessory, size) {
    if (accessory === 'sunglasses') {
      ctx.fillStyle = '#111';
      ctx.fillRect(size * 0.35, -size * 0.5, size * 0.35, size * 0.35);
      ctx.fillRect(size * 0.35, size * 0.15, size * 0.35, size * 0.35);
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.strokeRect(size * 0.35, -size * 0.5, size * 0.35, size * 0.35);
      ctx.strokeRect(size * 0.35, size * 0.15, size * 0.35, size * 0.35);
    } else if (accessory === 'jetpack') {
      ctx.fillStyle = '#78909c';
      ctx.fillRect(-size * 1.1, -size * 0.5, size * 0.5, size * 1.0);
      // Jetpack flame particles
      ctx.fillStyle = '#ff3d00';
      ctx.beginPath();
      ctx.arc(-size * 1.3, 0, size * 0.3 + Math.sin(this.animTime * 15) * 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (accessory === 'top_hat') {
      ctx.fillStyle = '#212121';
      ctx.fillRect(-size * 0.2, -size * 1.2, size * 0.6, size * 0.7);
      ctx.fillRect(-size * 0.4, -size * 0.6, size * 1.0, size * 0.2);
    } else if (accessory === 'crown') {
      ctx.fillStyle = '#ffd600';
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, -size * 0.7);
      ctx.lineTo(-size * 0.4, -size * 1.3);
      ctx.lineTo(-size * 0.1, -size * 0.9);
      ctx.lineTo(size * 0.2, -size * 1.4);
      ctx.lineTo(size * 0.5, -size * 0.9);
      ctx.lineTo(size * 0.8, -size * 1.3);
      ctx.lineTo(size * 0.8, -size * 0.7);
      ctx.closePath();
      ctx.fill();
    } else if (accessory === 'orange') {
      ctx.fillStyle = '#ff6d00';
      ctx.beginPath();
      ctx.arc(0, -size * 0.9, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2e7d32'; // leaf
      ctx.beginPath();
      ctx.ellipse(size * 0.1, -size * 1.2, size * 0.15, size * 0.08, 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (accessory === 'party_hat') {
      ctx.fillStyle = '#ff1744';
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.5);
      ctx.lineTo(-size * 0.4, -size * 0.7);
      ctx.lineTo(size * 0.4, -size * 0.7);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawOpponentViewfinder(ctx, player) {
    if (!player.camera) return;

    const px = player.camera.x;
    const py = player.camera.y;
    const pColor = player.color || '#ff3d00';

    ctx.save();
    ctx.translate(px, py);

    // Crosshair ring
    ctx.strokeStyle = pColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 50, 0, Math.PI * 2);
    ctx.stroke();

    // Laser lines
    ctx.beginPath();
    ctx.moveTo(-70, 0); ctx.lineTo(-30, 0);
    ctx.moveTo(30, 0); ctx.lineTo(70, 0);
    ctx.moveTo(0, -70); ctx.lineTo(0, -30);
    ctx.moveTo(0, 30); ctx.lineTo(0, 70);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = pColor;
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Opponent Name Tag
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(-45, -75, 90, 20);
    ctx.strokeStyle = pColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(-45, -75, 90, 20);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${player.avatar || '📸'} ${player.name}`, 0, -61);

    ctx.restore();
  }
}
