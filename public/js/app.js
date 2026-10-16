import { soundEngine } from './audio.js';
import { network } from './network.js';
import { CanvasRenderer } from './canvas-renderer.js';
import { BoardEditor } from './board-editor.js';

class AppController {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.renderer = new CanvasRenderer(this.canvas);
    this.boardEditor = new BoardEditor();

    // Player State
    this.player = {
      id: null,
      name: localStorage.getItem('snapsafari_player_name') || 'Охотник',
      avatar: localStorage.getItem('snapsafari_player_avatar') || '📸',
      roomId: localStorage.getItem('snapsafari_room_id') || 'safari_main',
      score: 0
    };

    // Camera control state
    this.camPos = { x: 1200, y: 800, zoom: 1.0, isFocusing: false, focusVal: 50 };
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.keyState = {};
    this.latestSnapshot = null;

    // UI elements
    this.initDOMElements();
    this.initEvents();
    this.initNetworkListeners();

    // Start 60fps loop
    this.startLoop();

    // Check if player profile exists
    if (localStorage.getItem('snapsafari_player_name')) {
      this.loginModal.classList.add('hidden');
      this.joinGame();
    } else {
      this.loginModal.classList.remove('hidden');
    }
  }

  initDOMElements() {
    // Nav tabs
    this.tabBtns = document.querySelectorAll('.tab-btn');
    this.views = document.querySelectorAll('.game-view');

    // Modals
    this.loginModal = document.getElementById('loginModal');
    this.showcaseModal = document.getElementById('showcaseModal');
    this.playerNameInput = document.getElementById('playerNameInput');
    this.avatarPicker = document.getElementById('avatarPicker');
    this.roomSelectInput = document.getElementById('roomSelectInput');
    this.startGameBtn = document.getElementById('startGameBtn');

    // Header items
    this.netStatusPill = document.getElementById('netStatusPill');
    this.netStatusText = document.getElementById('netStatusText');
    this.soundToggleBtn = document.getElementById('soundToggleBtn');
    this.headerPlayerAvatar = document.getElementById('headerPlayerAvatar');
    this.headerPlayerName = document.getElementById('headerPlayerName');
    this.headerPlayerScore = document.getElementById('headerPlayerScore');

    // Offline banner
    this.offlineBanner = document.getElementById('offlineBanner');
    this.offlineBannerMsg = document.getElementById('offlineBannerMsg');
    this.offlineQueueBadge = document.getElementById('offlineQueueBadge');
    this.reconnectNowBtn = document.getElementById('reconnectNowBtn');

    // HUD Target elements
    this.targetSpeciesIcon = document.getElementById('targetSpeciesIcon');
    this.targetNameText = document.getElementById('targetNameText');
    this.targetRarityBadge = document.getElementById('targetRarityBadge');
    this.targetHintText = document.getElementById('targetHintText');
    this.roundTimerVal = document.getElementById('roundTimerVal');
    this.roundTimerBar = document.getElementById('roundTimerBar');
    this.roundNumberVal = document.getElementById('roundNumberVal');
    this.onlineHuntersCount = document.getElementById('onlineHuntersCount');

    // Viewfinder Readout
    this.viewfinderCoords = document.getElementById('viewfinderCoords');
    this.viewfinderZoom = document.getElementById('viewfinderZoom');
    this.viewfinderFocus = document.getElementById('viewfinderFocus');
    this.viewfinderCircle = document.querySelector('.viewfinder-circle');
    this.targetInSightAlert = document.getElementById('targetInSightAlert');
    this.flashOverlay = document.getElementById('flashOverlay');

    // Camera Controls
    this.shutterBtn = document.getElementById('shutterBtn');
    this.zoomSlider = document.getElementById('zoomSlider');
    this.zoomInBtn = document.getElementById('zoomInBtn');
    this.zoomOutBtn = document.getElementById('zoomOutBtn');
    this.zoomValDisplay = document.getElementById('zoomValDisplay');
    this.focusSlider = document.getElementById('focusSlider');
    this.focusValDisplay = document.getElementById('focusValDisplay');

    // Showcase modal
    this.showcaseCanvas = document.getElementById('showcaseCanvas');
    this.showcaseTargetTitle = document.getElementById('showcaseTargetTitle');
    this.showcaseWinnerName = document.getElementById('showcaseWinnerName');
    this.showcaseAccuracy = document.getElementById('showcaseAccuracy');
    this.showcaseScore = document.getElementById('showcaseScore');
    this.showcaseTime = document.getElementById('showcaseTime');
    this.showcaseContentionBox = document.getElementById('showcaseContentionBox');
    this.showcaseDeltaMs = document.getElementById('showcaseDeltaMs');
    this.showcaseSec = document.getElementById('showcaseSec');

    // Tables
    this.leaderboardTbody = document.getElementById('leaderboardTbody');
    this.conflictAuditTbody = document.getElementById('conflictAuditTbody');

    // Lab Demo buttons
    this.simulateDropSocketBtn = document.getElementById('simulateDropSocketBtn');
    this.resetDemoDbBtn = document.getElementById('resetDemoDbBtn');
    this.viewDbJsonBtn = document.getElementById('viewDbJsonBtn');
  }

  initEvents() {
    // 1. Navigation Tabs
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        this.views.forEach(v => {
          v.classList.toggle('active', v.id === `view-${tab}`);
        });

        if (tab === 'safari') {
          this.renderer.resize();
        }
      });
    });

    // 2. Sound Toggle
    this.soundToggleBtn.addEventListener('click', () => {
      const muted = soundEngine.toggleMute();
      this.soundToggleBtn.textContent = muted ? '🔇' : '🔊';
    });

    // 3. Login Modal
    this.avatarPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.avatar-opt');
      if (btn) {
        this.avatarPicker.querySelectorAll('.avatar-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.player.avatar = btn.dataset.avatar;
      }
    });

    this.startGameBtn.addEventListener('click', () => {
      const name = this.playerNameInput.value.trim() || 'Охотник';
      this.player.name = name;
      this.player.roomId = this.roomSelectInput.value || 'safari_main';
      localStorage.setItem('snapsafari_player_name', name);
      localStorage.setItem('snapsafari_player_avatar', this.player.avatar);
      localStorage.setItem('snapsafari_room_id', this.player.roomId);

      this.loginModal.classList.add('hidden');
      this.joinGame();
    });

    // 4. Shutter Action (Spacebar or Button or Click)
    this.shutterBtn.addEventListener('click', () => this.triggerSnap());

    window.addEventListener('keydown', (e) => {
      this.keyState[e.code] = true;

      // Space to Snap
      if (e.code === 'Space' && !e.repeat) {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          this.triggerSnap();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keyState[e.code] = false;
    });

    // Canvas Mouse Navigation
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Translate canvas screen coords to world coords
      const worldX = this.camPos.x + (mouseX - this.canvas.width / 2) / this.camPos.zoom;
      const worldY = this.camPos.y + (mouseY - this.canvas.height / 2) / this.camPos.zoom;

      // Smoothly steer camera towards cursor
      this.camPos.x += (worldX - this.camPos.x) * 0.08;
      this.camPos.y += (worldY - this.camPos.y) * 0.08;

      this.clampCamera();
      this.notifyViewfinderMoved();
    });

    // Mouse Wheel Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.setZoom(this.camPos.zoom + delta);
    }, { passive: false });

    // Zoom Controls
    this.zoomSlider.addEventListener('input', (e) => {
      this.setZoom(parseFloat(e.target.value));
    });
    this.zoomInBtn.addEventListener('click', () => this.setZoom(this.camPos.zoom + 0.15));
    this.zoomOutBtn.addEventListener('click', () => this.setZoom(this.camPos.zoom - 0.15));

    // Focus Ring Slider
    this.focusSlider.addEventListener('input', (e) => {
      this.camPos.focusVal = parseInt(e.target.value, 10);
      this.focusValDisplay.textContent = `${this.camPos.focusVal}%`;
      this.viewfinderFocus.textContent = `FOCUS ${this.camPos.focusVal}%`;
      soundEngine.playFocusBeep();
    });

    // Offline / Reconnect Buttons
    this.reconnectNowBtn.addEventListener('click', () => {
      network.reconnectNow();
    });

    this.simulateDropSocketBtn.addEventListener('click', () => {
      network.simulateDropConnection();
    });

    this.resetDemoDbBtn.addEventListener('click', () => {
      if (confirm('Сбросить базу данных к начальным демонстрационным записям?')) {
        network.send('RESET_DATA');
      }
    });

    this.viewDbJsonBtn.addEventListener('click', () => {
      alert(`База данных сохраняется в web-game/data/database.json\n\nСтруктура: users, gallery, matchHistory, conflictAuditLog.\nАтомарная запись через .tmp файл.`);
    });
  }

  setZoom(zoom) {
    this.camPos.zoom = Math.max(0.6, Math.min(2.2, parseFloat(zoom.toFixed(2))));
    this.zoomSlider.value = this.camPos.zoom;
    this.zoomValDisplay.textContent = `${this.camPos.zoom.toFixed(1)}x`;
    this.viewfinderZoom.textContent = `ZOOM ${this.camPos.zoom.toFixed(1)}x`;
    this.notifyViewfinderMoved();
  }

  clampCamera() {
    this.camPos.x = Math.max(100, Math.min(2300, this.camPos.x));
    this.camPos.y = Math.max(100, Math.min(1500, this.camPos.y));
    this.viewfinderCoords.textContent = `X: ${Math.round(this.camPos.x)} Y: ${Math.round(this.camPos.y)}`;
  }

  notifyViewfinderMoved() {
    network.send('MOVE_VIEWFINDER', {
      x: Math.round(this.camPos.x),
      y: Math.round(this.camPos.y),
      zoom: this.camPos.zoom,
      isFocusing: this.camPos.isFocusing
    });
  }

  triggerSnap() {
    // Play shutter audio & camera flash immediately
    soundEngine.playShutter();
    this.flashOverlay.classList.remove('active');
    void this.flashOverlay.offsetWidth; // Trigger reflow
    this.flashOverlay.classList.add('active');

    network.send('SNAP_PHOTO', {
      x: Math.round(this.camPos.x),
      y: Math.round(this.camPos.y),
      zoom: this.camPos.zoom,
      focusRingValue: this.camPos.focusVal,
      clientTimestamp: Date.now()
    });
  }

  joinGame() {
    this.headerPlayerName.textContent = this.player.name;
    this.headerPlayerAvatar.textContent = this.player.avatar;

    network.connect({
      token: network.sessionToken,
      playerName: this.player.name,
      avatar: this.player.avatar,
      roomId: this.player.roomId
    });
  }

  initNetworkListeners() {
    // Network status transitions
    network.on('status_change', ({ status, reason, nextAttemptSec, queueLength, resumed }) => {
      this.netStatusPill.className = `status-pill status-${status.toLowerCase()}`;
      if (status === 'CONNECTED') {
        this.netStatusText.textContent = 'В сети';
        this.offlineBanner.classList.add('hidden');
        if (resumed) {
          soundEngine.playTargetSpotted();
        }
      } else if (status === 'RECONNECTING') {
        this.netStatusText.textContent = `Связь... (${nextAttemptSec ? nextAttemptSec + 'с' : ''})`;
        this.offlineBanner.classList.remove('hidden');
        this.offlineBannerMsg.textContent = `Связь прервана! Состояние сохранено локально. Повторная попытка через ${nextAttemptSec || 2}с...`;
        this.offlineQueueBadge.textContent = `Очередь: ${queueLength || 0}`;
      } else if (status === 'DISCONNECTED') {
        this.netStatusText.textContent = 'Оффлайн';
        this.offlineBanner.classList.remove('hidden');
        this.offlineBannerMsg.textContent = reason || 'Отключено от сервера. Локальное состояние зафиксировано.';
        this.offlineQueueBadge.textContent = `Очередь: ${queueLength || 0}`;
      }
    });

    // Init state on connection
    network.on('INIT_STATE', ({ player, room, gallery, leaderboard, conflictAuditLog }) => {
      this.player.id = player.playerId;
      this.player.score = player.score;
      this.headerPlayerScore.textContent = player.score;
      this.boardEditor.setCards(gallery);
      this.renderLeaderboard(leaderboard);
      this.renderAuditLog(conflictAuditLog);
    });

    network.on('SESSION_RESUMED', ({ player, room, gallery }) => {
      if (player) {
        this.player.score = player.score;
        this.headerPlayerScore.textContent = player.score;
      }
      if (gallery) {
        this.boardEditor.setCards(gallery);
      }
    });

    // 20Hz sync ticks from server
    network.on('SYNC_TICK', ({ snapshot }) => {
      this.latestSnapshot = snapshot;
      this.renderer.updateData(snapshot, this.player.id);
      this.updateHUD(snapshot);
    });

    // Flash animation from any player in the room
    network.on('FLASH_EFFECT', ({ photographer, targetName }) => {
      soundEngine.playShutter();
      this.flashOverlay.classList.remove('active');
      void this.flashOverlay.offsetWidth;
      this.flashOverlay.classList.add('active');
    });

    // Snap success / Showcase
    network.on('SNAP_SUCCESS', ({ winner, message }) => {
      soundEngine.playWinFanfare();
      this.showVictoryShowcase(winner, false, null);
    });

    network.on('SNAP_CONTENTION_RESOLVED', ({ winner, assistList, message }) => {
      soundEngine.playConflictAlert();
      this.showVictoryShowcase(winner, true, { message });
    });

    // Photo board live sync
    network.on('BOARD_CARD_UPDATED', ({ item, message }) => {
      this.boardEditor.updateOrAddCard(item);
    });

    network.on('BOARD_CONFLICT_RESOLVED', (data) => {
      this.boardEditor.showConflictNotification(data);
      // Fetch updated audit log
      network.send('GET_AUDIT_LOG');
    });

    network.on('GALLERY_UPDATED', ({ gallery }) => {
      this.boardEditor.setCards(gallery);
    });

    network.on('LEADERBOARD_UPDATED', ({ leaderboard }) => {
      this.renderLeaderboard(leaderboard);
    });

    network.on('AUDIT_LOG_RESULT', ({ auditLog }) => {
      this.renderAuditLog(auditLog);
    });

    network.on('DATA_RESET', ({ gallery, leaderboard, conflictAuditLog }) => {
      this.boardEditor.setCards(gallery);
      this.renderLeaderboard(leaderboard);
      this.renderAuditLog(conflictAuditLog);
      alert('Демо-данные базы данных успешно сброшены к начальным!');
    });
  }

  updateHUD(snap) {
    if (!snap) return;

    this.roundNumberVal.textContent = snap.roundNumber || 1;
    this.roundTimerVal.textContent = `${snap.roundTimeRemaining}s`;
    this.roundTimerBar.style.width = `${(snap.roundTimeRemaining / 35) * 100}%`;
    this.onlineHuntersCount.textContent = snap.players?.length || 1;

    // Update current player score in header
    const me = (snap.players || []).find(p => p.playerId === this.player.id);
    if (me) {
      this.headerPlayerScore.textContent = me.score;
    }

    if (snap.currentTarget) {
      this.targetNameText.textContent = snap.currentTarget.name;
      this.targetRarityBadge.textContent = snap.currentTarget.rarity || 'Обычный';
      this.targetHintText.textContent = snap.currentTarget.hint || 'Ищите объект в саванне!';

      // Target icons mapping
      const icons = {
        royal_flamingo: '🦩', cyber_penguin: '🐧', neon_fox: '🦊', stealth_chameleon: '🦎',
        space_capybara: '🍊', golden_falcon: '🦅', sleepy_sloth: '🦥', robo_rabbit: '🐰',
        party_panda: '🐼', disco_zebra: '🦓', detective_owl: '🦉', mystic_deer: '🦌'
      };
      this.targetSpeciesIcon.textContent = icons[snap.currentTarget.species] || '🎯';

      // Check if target is inside local viewfinder
      const targetCreature = (snap.creatures || []).find(c => c.uid === snap.currentTarget.uid);
      if (targetCreature) {
        const dist = Math.hypot(this.camPos.x - targetCreature.x, this.camPos.y - targetCreature.y);
        const radius = 140 / this.camPos.zoom;
        if (dist <= radius) {
          this.viewfinderCircle.classList.add('in-focus');
          this.targetInSightAlert.classList.remove('hidden');
        } else {
          this.viewfinderCircle.classList.remove('in-focus');
          this.targetInSightAlert.classList.add('hidden');
        }
      }
    }
  }

  showVictoryShowcase(winner, wasContention, contentionDetails) {
    this.showcaseModal.classList.remove('hidden');
    this.showcaseTargetTitle.textContent = this.latestSnapshot?.currentTarget?.name || 'Трофей';
    this.showcaseWinnerName.textContent = winner.playerName;
    this.showcaseAccuracy.textContent = `${winner.accuracy}%`;
    this.showcaseScore.textContent = `+${winner.score}`;
    this.showcaseTime.textContent = `${(winner.timeToSnapMs / 1000).toFixed(2)}s`;

    if (wasContention) {
      this.showcaseContentionBox.classList.remove('hidden');
      this.showcaseDeltaMs.textContent = contentionDetails?.message || 'Разрешен конкурентный снимок';
    } else {
      this.showcaseContentionBox.classList.add('hidden');
    }

    // Render snapshot graphic onto showcase canvas
    this.drawShowcaseSnapshot(this.showcaseCanvas, winner);

    // 5-second countdown
    let count = 5;
    this.showcaseSec.textContent = count;
    const cd = setInterval(() => {
      count -= 1;
      this.showcaseSec.textContent = count;
      if (count <= 0) {
        clearInterval(cd);
        this.showcaseModal.classList.add('hidden');
      }
    }, 1000);
  }

  drawShowcaseSnapshot(canvas, winner) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // Viewfinder snapshot look
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // Glowing circle
    ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 70, 0, Math.PI * 2);
    ctx.fill();

    // Central graphic
    ctx.fillStyle = '#ff6b9d';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 45, 0, Math.PI * 2);
    ctx.fill();

    // Cute face
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(w / 2 + 10, h / 2 - 10, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(w / 2 + 12, h / 2 - 10, 5, 0, Math.PI * 2);
    ctx.fill();

    // Accuracy stamp
    ctx.strokeStyle = '#00e676';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, w - 20, h - 20);
  }

  renderLeaderboard(list) {
    if (!this.leaderboardTbody || !Array.isArray(list)) return;
    this.leaderboardTbody.innerHTML = '';

    list.forEach((u, i) => {
      const tr = document.createElement('tr');
      const medal = i === 0 ? '🥇 ' : i === 1 ? '🥈 ' : i === 2 ? '🥉 ' : `${i + 1}. `;
      tr.innerHTML = `
        <td><b>${medal}</b></td>
        <td>${u.avatar || '📸'} <b>${u.name}</b></td>
        <td><span class="player-score-badge">${u.totalScore}</span></td>
        <td>${u.snapsSuccessful || 0}</td>
        <td>${u.avgAccuracy || 0}%</td>
        <td>${u.fastestSnapMs ? (u.fastestSnapMs / 1000).toFixed(2) + 'с' : '—'}</td>
        <td style="color: #8b949e; font-size: 11px;">${new Date(u.lastSeen).toLocaleTimeString()}</td>
      `;
      this.leaderboardTbody.appendChild(tr);
    });
  }

  renderAuditLog(logs) {
    if (!this.conflictAuditTbody || !Array.isArray(logs)) return;
    this.conflictAuditTbody.innerHTML = '';

    logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: monospace; font-size: 11px;">${new Date(log.timestamp).toLocaleTimeString()}</td>
        <td><span class="badge" style="background:#ff9100; color:#000;">${log.targetType}</span></td>
        <td><b>${log.targetId || log.roomId}</b></td>
        <td>${log.editorIncoming || log.winner || 'Участники'}</td>
        <td><code>${log.resolutionType}</code></td>
        <td style="font-size: 12px; color: #00e5ff;">${log.resolutionMessage || 'Успешно разрешен'}</td>
      `;
      this.conflictAuditTbody.appendChild(tr);
    });
  }

  startLoop() {
    const loop = () => {
      // WASD / Arrow keys movement
      let dx = 0;
      let dy = 0;
      const speed = 12 / this.camPos.zoom;

      if (this.keyState['KeyW'] || this.keyState['ArrowUp']) dy -= speed;
      if (this.keyState['KeyS'] || this.keyState['ArrowDown']) dy += speed;
      if (this.keyState['KeyA'] || this.keyState['ArrowLeft']) dx -= speed;
      if (this.keyState['KeyD'] || this.keyState['ArrowRight']) dx += speed;

      if (dx !== 0 || dy !== 0) {
        this.camPos.x += dx;
        this.camPos.y += dy;
        this.clampCamera();
        this.notifyViewfinderMoved();
      }

      this.renderer.setCameraTarget(this.camPos.x, this.camPos.y, this.camPos.zoom);
      this.renderer.render();

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }
}

// Start application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
});
