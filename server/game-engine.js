import { conflictResolver } from './conflict-resolver.js';
import { persistence } from './persistence.js';

export const MAP_WIDTH = 2400;
export const MAP_HEIGHT = 1600;

export const CREATURE_SPECIES = [
  {
    id: 'royal_flamingo',
    name: 'Королевский Фламинго в Очках',
    species: 'royal_flamingo',
    color: '#ff6b9d',
    accessory: 'sunglasses',
    speed: 1.8,
    size: 42,
    rarity: 'rare',
    habitat: 'river',
    hint: 'Обитает у реки и водопада, носит стильные темные очки!'
  },
  {
    id: 'cyber_penguin',
    name: 'Кибер-Пингвин с Джетпаком',
    species: 'cyber_penguin',
    color: '#00e5ff',
    accessory: 'jetpack',
    speed: 3.2,
    size: 38,
    rarity: 'epic',
    habitat: 'cyber',
    hint: 'Быстро скользит с неоновыми искрами, несет джетпак за спиной!'
  },
  {
    id: 'neon_fox',
    name: 'Неоновый Лис в Шарфе',
    species: 'neon_fox',
    color: '#ff9100',
    accessory: 'scarf',
    speed: 2.8,
    size: 40,
    rarity: 'common',
    habitat: 'savannah',
    hint: 'Ловко петляет по саванне в уютном вязаном шарфе!'
  },
  {
    id: 'stealth_chameleon',
    name: 'Хамелеон в Цилиндре',
    species: 'stealth_chameleon',
    color: '#00e676',
    accessory: 'top_hat',
    speed: 1.2,
    size: 36,
    rarity: 'epic',
    habitat: 'jungle',
    hint: 'Маскируется среди тропических листьев, но выдает себя крошечный цилиндр!'
  },
  {
    id: 'space_capybara',
    name: 'Космическая Капибара с Мандарином',
    species: 'space_capybara',
    color: '#8d6e63',
    accessory: 'orange',
    speed: 0.9,
    size: 46,
    rarity: 'rare',
    habitat: 'river',
    hint: 'Самое спокойное создание у воды, на голове балансирует спелый мандарин!'
  },
  {
    id: 'golden_falcon',
    name: 'Золотой Сокол в Короне',
    species: 'golden_falcon',
    color: '#ffd600',
    accessory: 'crown',
    speed: 3.6,
    size: 34,
    rarity: 'legendary',
    habitat: 'sky',
    hint: 'Парит широкими кругами высоко над деревьями, сверкая золотой короной!'
  },
  {
    id: 'sleepy_sloth',
    name: 'Ленивец с Кружкой Чая',
    species: 'sleepy_sloth',
    color: '#a1887f',
    accessory: 'teacup',
    speed: 0.6,
    size: 44,
    rarity: 'common',
    habitat: 'jungle',
    hint: 'Медленно передвигается по ветвям, бережно держа кружку горячего чая!'
  },
  {
    id: 'robo_rabbit',
    name: 'Робо-Кролик с Антенной',
    species: 'robo_rabbit',
    color: '#e0e0e0',
    accessory: 'antenna',
    speed: 3.0,
    size: 32,
    rarity: 'common',
    habitat: 'savannah',
    hint: 'Прыгает резкими зигзагами, на ушке мигает сигнальная антенна!'
  },
  {
    id: 'party_panda',
    name: 'Панда в Колпаке',
    species: 'party_panda',
    color: '#f5f5f5',
    accessory: 'party_hat',
    speed: 1.4,
    size: 48,
    rarity: 'rare',
    habitat: 'jungle',
    hint: 'Сидит в бамбуке в ярком праздничном колпаке!'
  },
  {
    id: 'disco_zebra',
    name: 'Диско-Зебра в Неоне',
    species: 'disco_zebra',
    color: '#d500f9',
    accessory: 'glow_stripes',
    speed: 2.5,
    size: 44,
    rarity: 'rare',
    habitat: 'savannah',
    hint: 'Светящиеся полосы переливаются всеми цветами неона!'
  },
  {
    id: 'detective_owl',
    name: 'Сова-Детектив с Лупой',
    species: 'detective_owl',
    color: '#795548',
    accessory: 'monocle',
    speed: 2.2,
    size: 36,
    rarity: 'common',
    habitat: 'jungle',
    hint: 'Внимательно всматривается сквозь свой золотой монокль!'
  },
  {
    id: 'mystic_deer',
    name: 'Мистический Олень с Рунами',
    species: 'mystic_deer',
    color: '#2979ff',
    accessory: 'glowing_horns',
    speed: 2.4,
    size: 48,
    rarity: 'legendary',
    habitat: 'cyber',
    hint: 'Благородный олень со светящимися бирюзовыми рогами!'
  }
];

export class GameRoom {
  constructor(roomId = 'safari_main', roomName = 'Сафари Заповедник') {
    this.roomId = roomId;
    this.roomName = roomName;
    // Map: socketId -> Player
    this.players = new Map();
    this.creatures = [];
    this.currentTarget = null;
    this.roundNumber = 0;
    this.roundState = 'LOBBY'; // 'LOBBY', 'ROUND_ACTIVE', 'ROUND_SHOWCASE'
    this.roundTimeRemaining = 35;
    this.roundTimer = null;
    this.tickTimer = null;
    this.lastWinnerInfo = null;

    this.initCreatures();
    this.startTickLoop();
  }

  initCreatures() {
    this.creatures = [];
    let idCounter = 1;

    for (const spec of CREATURE_SPECIES) {
      // Spawn 1-2 instances of each creature
      const count = spec.rarity === 'common' ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = spec.speed * (0.8 + Math.random() * 0.4);

        let initialX, initialY;
        if (spec.habitat === 'river') {
          initialX = 900 + Math.random() * 600;
          initialY = 400 + Math.random() * 800;
        } else if (spec.habitat === 'jungle') {
          initialX = 200 + Math.random() * 700;
          initialY = 200 + Math.random() * 1200;
        } else if (spec.habitat === 'cyber') {
          initialX = 1600 + Math.random() * 600;
          initialY = 200 + Math.random() * 1200;
        } else {
          initialX = 300 + Math.random() * 1800;
          initialY = 300 + Math.random() * 1000;
        }

        this.creatures.push({
          uid: `${spec.species}_${idCounter++}`,
          speciesId: spec.id,
          name: spec.name,
          species: spec.species,
          color: spec.color,
          accessory: spec.accessory,
          size: spec.size,
          speed,
          habitat: spec.habitat,
          rarity: spec.rarity,
          hint: spec.hint,
          x: Math.round(initialX),
          y: Math.round(initialY),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          heading: angle,
          isHiding: false,
          camouflageTimer: 0,
          stateTime: Math.random() * 10
        });
      }
    }
  }

  startTickLoop() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    // 20Hz authoritative tick
    this.tickTimer = setInterval(() => {
      this.updatePhysics();
    }, 50);
  }

  updatePhysics() {
    for (const c of this.creatures) {
      c.stateTime += 0.05;

      // Random direction wandering
      if (Math.random() < 0.02) {
        const deltaAngle = (Math.random() - 0.5) * 1.2;
        c.heading += deltaAngle;
        c.vx = Math.cos(c.heading) * c.speed;
        c.vy = Math.sin(c.heading) * c.speed;
      }

      // Stealth chameleon behavior (blending in)
      if (c.species === 'stealth_chameleon') {
        c.camouflageTimer += 0.05;
        if (c.camouflageTimer > 6) {
          c.isHiding = !c.isHiding;
          c.camouflageTimer = 0;
        }
      }

      // Move
      c.x += c.vx;
      c.y += c.vy;

      // Boundaries bounce
      const margin = 100;
      if (c.x < margin) {
        c.x = margin;
        c.vx = Math.abs(c.vx);
        c.heading = Math.atan2(c.vy, c.vx);
      } else if (c.x > MAP_WIDTH - margin) {
        c.x = MAP_WIDTH - margin;
        c.vx = -Math.abs(c.vx);
        c.heading = Math.atan2(c.vy, c.vx);
      }

      if (c.y < margin) {
        c.y = margin;
        c.vy = Math.abs(c.vy);
        c.heading = Math.atan2(c.vy, c.vx);
      } else if (c.y > MAP_HEIGHT - margin) {
        c.y = MAP_HEIGHT - margin;
        c.vy = -Math.abs(c.vy);
        c.heading = Math.atan2(c.vy, c.vx);
      }
    }
  }

  addPlayer(socketId, session) {
    const playerColors = ['#00e5ff', '#ff3d00', '#ffd600', '#76ff03', '#d500f9', '#ff9100'];
    const color = playerColors[this.players.size % playerColors.length];

    const player = {
      socketId,
      sessionToken: session.token,
      playerId: session.playerId,
      name: session.playerName,
      avatar: session.avatar,
      color,
      score: session.score || 0,
      roundScore: 0,
      isOnline: true,
      camera: session.camera || { x: 1200, y: 800, zoom: 1 },
      lastSnapTime: 0
    };

    this.players.set(socketId, player);
    console.log(`[GameRoom ${this.roomId}] Player ${player.name} joined. Total: ${this.players.size}`);

    // If game not yet running, auto-start round
    if (this.roundState === 'LOBBY' && this.players.size >= 1) {
      this.startNewRound();
    }

    return player;
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      player.isOnline = false;
      this.players.delete(socketId);
      console.log(`[GameRoom ${this.roomId}] Player ${player.name} left. Remaining: ${this.players.size}`);
    }
  }

  getPlayerBySocket(socketId) {
    return this.players.get(socketId);
  }

  updatePlayerViewfinder(socketId, { x, y, zoom, isFocusing }) {
    const player = this.players.get(socketId);
    if (!player) return;
    player.camera.x = Math.max(0, Math.min(MAP_WIDTH, x));
    player.camera.y = Math.max(0, Math.min(MAP_HEIGHT, y));
    if (zoom !== undefined) player.camera.zoom = Math.max(0.6, Math.min(2.5, zoom));
    player.isFocusing = !!isFocusing;
  }

  startNewRound() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    conflictResolver.clearRoomContention(this.roomId);

    this.roundNumber += 1;
    this.roundState = 'ROUND_ACTIVE';
    this.roundTimeRemaining = 35;
    this.lastWinnerInfo = null;

    // Pick target creature from available pool
    const pickIndex = Math.floor(Math.random() * this.creatures.length);
    const chosenCreature = this.creatures[pickIndex];
    this.currentTarget = {
      uid: chosenCreature.uid,
      speciesId: chosenCreature.speciesId,
      name: chosenCreature.name,
      species: chosenCreature.species,
      color: chosenCreature.color,
      accessory: chosenCreature.accessory,
      hint: chosenCreature.hint,
      rarity: chosenCreature.rarity,
      snapped: false
    };

    console.log(`[GameRoom ${this.roomId}] Round ${this.roundNumber} started! Target: ${this.currentTarget.name}`);

    this.roundTimer = setInterval(() => {
      this.roundTimeRemaining -= 1;
      if (this.roundTimeRemaining <= 0) {
        this.endRoundNoWinner();
      }
    }, 1000);
  }

  handlePlayerSnap(socketId, { x, y, zoom, clientTimestamp, focusRingValue }) {
    const player = this.players.get(socketId);
    if (!player || this.roundState !== 'ROUND_ACTIVE' || !this.currentTarget) {
      return { success: false, reason: 'ROUND_NOT_ACTIVE' };
    }

    // Cooldown check (500ms)
    const now = Date.now();
    if (now - (player.lastSnapTime || 0) < 500) {
      return { success: false, reason: 'COOLDOWN' };
    }
    player.lastSnapTime = now;

    const targetCreature = this.creatures.find(c => c.uid === this.currentTarget.uid);
    if (!targetCreature) {
      return { success: false, reason: 'TARGET_NOT_FOUND' };
    }

    // Viewfinder radius on canvas (approx 140px / zoom)
    const viewfinderRadius = 140 / (zoom || 1);
    const dx = x - targetCreature.x;
    const dy = y - targetCreature.y;
    const distance = Math.hypot(dx, dy);

    // Is the target creature inside the viewfinder?
    if (distance > (viewfinderRadius + targetCreature.size)) {
      return {
        success: false,
        reason: 'MISSED_TARGET',
        distance: Math.round(distance),
        requiredDistance: Math.round(viewfinderRadius)
      };
    }

    // Centering score (0 to 100)
    const centerFactor = Math.max(0, 1 - distance / (viewfinderRadius + targetCreature.size));
    // Zoom factor (prefer 1.0 - 2.0x zoom)
    const zoomFactor = Math.min(1.2, Math.max(0.7, (zoom || 1) * 0.8));
    // Focus ring factor (0 to 100)
    const focusFactor = focusRingValue ? (1 - Math.abs(focusRingValue - 50) / 100) : 0.9;

    const accuracy = Math.round(Math.min(100, Math.max(65, centerFactor * 80 + zoomFactor * 15 + focusFactor * 10)));

    // Calculate score
    const speedBonus = Math.round(this.roundTimeRemaining * 15);
    const score = 1000 + speedBonus + Math.round((accuracy - 60) * 8);

    const arrivedAtHr = process.hrtime.bigint();

    const candidateSnap = {
      playerId: player.playerId,
      socketId,
      playerName: player.name,
      avatar: player.avatar,
      accuracy,
      score,
      arrivedAtHr,
      clientTimestamp,
      timeToSnapMs: (35 - this.roundTimeRemaining) * 1000 + (1000 - (now % 1000))
    };

    // Send through conflict resolver
    const contentionOutcome = conflictResolver.evaluateSnapContention({
      roomId: this.roomId,
      targetId: this.currentTarget.uid,
      candidateSnap
    });

    if (contentionOutcome.isContention) {
      // Multiple players snapped almost at once!
      const winner = contentionOutcome.winner;
      const winnerPlayer = [...this.players.values()].find(p => p.playerId === winner.playerId);
      if (winnerPlayer) {
        winnerPlayer.score += winner.score;
        persistence.recordSnapResult(winnerPlayer.name, winner.score, winner.accuracy, winner.timeToSnapMs);
      }

      // Assist awards
      for (const assist of contentionOutcome.assistList) {
        const assistPlayer = [...this.players.values()].find(p => p.playerId === assist.playerId);
        if (assistPlayer) {
          const assistScore = 500;
          assistPlayer.score += assistScore;
          persistence.recordSnapResult(assistPlayer.name, assistScore, assist.accuracy, assist.timeToSnapMs);
        }
      }

      this.currentTarget.snapped = true;
      this.finishRoundWithWinner(winner, true, contentionOutcome);
      return {
        success: true,
        isContention: true,
        winner,
        assistList: contentionOutcome.assistList,
        message: contentionOutcome.message
      };
    } else {
      // First clean snap
      player.score += score;
      persistence.recordSnapResult(player.name, score, accuracy, candidateSnap.timeToSnapMs);
      this.currentTarget.snapped = true;
      this.finishRoundWithWinner(candidateSnap, false, null);
      return {
        success: true,
        isContention: false,
        winner: candidateSnap,
        message: 'Идеальный снимок цели!'
      };
    }
  }

  finishRoundWithWinner(winnerSnap, wasContention, contentionDetails) {
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundState = 'ROUND_SHOWCASE';

    // Add winning photo to persistent exhibition gallery
    const savedPhoto = persistence.addPhotoToGallery({
      targetId: this.currentTarget.uid,
      targetName: this.currentTarget.name,
      targetSpecies: this.currentTarget.species,
      photographer: winnerSnap.playerName,
      score: winnerSnap.score,
      accuracy: winnerSnap.accuracy,
      timeToSnapMs: winnerSnap.timeToSnapMs,
      caption: `Пойман в раунде №${this.roundNumber}!`,
      filter: 'normal',
      sticker: '🏆'
    });

    this.lastWinnerInfo = {
      winnerName: winnerSnap.playerName,
      targetName: this.currentTarget.name,
      score: winnerSnap.score,
      accuracy: winnerSnap.accuracy,
      timeToSnapMs: winnerSnap.timeToSnapMs,
      photoId: savedPhoto.id,
      wasContention,
      contentionDetails: contentionDetails ? {
        timeDeltaMs: contentionDetails.timeDeltaMs,
        message: contentionDetails.message
      } : null
    };

    // Save match round to history
    persistence.recordMatchEnd({
      roomId: this.roomId,
      roundNumber: this.roundNumber,
      targetName: this.currentTarget.name,
      winner: winnerSnap.playerName,
      scores: [...this.players.values()].map(p => ({ player: p.name, score: p.score })),
      conflictsCount: wasContention ? 1 : 0
    });

    // 5-second showcase before next round
    setTimeout(() => {
      this.startNewRound();
    }, 5500);
  }

  endRoundNoWinner() {
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.roundState = 'ROUND_SHOWCASE';
    this.lastWinnerInfo = {
      winnerName: null,
      targetName: this.currentTarget?.name || 'Никто',
      message: 'Время вышло! Объект ускользнул от фотографов.'
    };

    setTimeout(() => {
      this.startNewRound();
    }, 4000);
  }

  getSnapshot() {
    return {
      roomId: this.roomId,
      roundNumber: this.roundNumber,
      roundState: this.roundState,
      roundTimeRemaining: this.roundTimeRemaining,
      currentTarget: this.currentTarget,
      lastWinnerInfo: this.lastWinnerInfo,
      players: [...this.players.values()].map(p => ({
        playerId: p.playerId,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        score: p.score,
        isOnline: p.isOnline,
        camera: p.camera,
        isFocusing: p.isFocusing
      })),
      creatures: this.creatures.map(c => ({
        uid: c.uid,
        speciesId: c.speciesId,
        species: c.species,
        color: c.color,
        accessory: c.accessory,
        size: c.size,
        x: Math.round(c.x),
        y: Math.round(c.y),
        vx: Number(c.vx.toFixed(2)),
        vy: Number(c.vy.toFixed(2)),
        heading: Number(c.heading.toFixed(2)),
        isHiding: c.isHiding
      }))
    };
  }

  destroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.roundTimer) clearInterval(this.roundTimer);
    this.players.clear();
  }
}

export class GameManager {
  constructor() {
    this.rooms = new Map();
    // Default room
    this.getOrCreateRoom('safari_main', 'Сафари Заповедник');
  }

  getOrCreateRoom(roomId = 'safari_main', roomName) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new GameRoom(roomId, roomName || `Заповедник ${roomId}`));
    }
    return this.rooms.get(roomId);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getRoomList() {
    return [...this.rooms.values()].map(r => ({
      roomId: r.roomId,
      roomName: r.roomName,
      playersCount: r.players.size,
      roundNumber: r.roundNumber,
      roundState: r.roundState
    }));
  }
}

export const gameManager = new GameManager();
