import { conflictResolver } from './conflict-resolver.js';
import { persistence, DEFAULT_AVATAR, normalizeAvatarPath, isTestPlayerName, isTestRoom } from './persistence.js';
import { sessionStore } from './session-store.js';

// Load Complementary Food Pairs dynamically from database (data/database.json)
export const getFoodPairs = () => persistence.getFoodPairs();
export const FOOD_PAIRS = persistence.getFoodPairs();
export const DEFAULT_SINGLE_CARD_TIMEOUT_MS = 4000;
export const DEFAULT_MISMATCH_TIMEOUT_MS = 2500;
export const MAX_ROOM_PLAYERS = 8;


const PLAYER_COLORS = [
  '#ff4757', '#2ed573', '#1e90ff', '#ffa502',
  '#9b59b6', '#00d2d3', '#ff6b81', '#70a1ff'
];

export class GameRoom {
  constructor(roomId = 'bistro_main', roomName = 'Главный Зал Ресторана') {
    this.roomId = roomId;
    this.roomName = roomName;
    this.players = new Map();
    this.cards = [];
    this.roundNumber = 0;
    this.roundState = 'IDLE'; // 'IDLE' | 'ACTIVE' | 'SHOWCASE'
    this.elapsedSeconds = 0;
    this.lastActiveTime = null;
    this.roundStartedAt = null;
    this.lastWinnerInfo = null;
    this.previousRoundWinner = null;

    // Pause state (pauses game for all participants when someone disconnects)
    this.isPaused = false;
    this.pauseReason = null;
    this.pausedAt = null;
    this.accumulatedPauseMs = 0;

    // Active unconfirmed card flips by socketId: socketId -> [cardIndex, ...]
    this.playerPendingFlips = new Map();
    this.flipTimers = new Map();
    this.singleFlipTimers = new Map(); // socketId -> NodeJS.Timeout
    this.singleCardTimeoutMs = DEFAULT_SINGLE_CARD_TIMEOUT_MS;
    this.mismatchTimeoutMs = DEFAULT_MISMATCH_TIMEOUT_MS;

    // Restart consensus tracking (all players must click restart to start next round)
    this.restartVotes = new Set();
    this.onRoundCompleted = null;
    this.onRoundStarted = null;
    this.onCardsUnflipped = null;

    const savedState = persistence.getRoomState(this.roomId);
    if (savedState && Array.isArray(savedState.cards) && savedState.cards.length === 16) {
      this.restoreFromState(savedState);
    } else {
      this.startNewRound(false);
    }
  }

  restoreFromState(state) {
    this.roundNumber = state.roundNumber || 1;
    this.roundState = state.roundState || 'IDLE';
    this.elapsedSeconds = state.elapsedSeconds || 0;
    this.roundStartedAt = state.roundStartedAt || null;
    this.lastActiveTime = null;
    this.lastWinnerInfo = state.lastWinnerInfo || null;
    this.previousRoundWinner = state.previousRoundWinner || null;
    this.accumulatedPauseMs = state.accumulatedPauseMs || 0;
    this.cards = (state.cards || []).map((item, index) => ({
      index: item.index !== undefined ? item.index : index,
      cardId: item.cardId || `card_${this.roundNumber}_${index}`,
      pairId: item.pairId,
      pairTitle: item.pairTitle || '',
      foodId: item.foodId,
      name: item.name,
      emoji: item.emoji,
      partnerName: item.partnerName || '',
      color: item.color || '#475569',
      isFlipped: !!item.isMatched,
      isMatched: !!item.isMatched,
      flippedBy: null,
      matchedBy: item.matchedBy || null,
      matchedByName: item.matchedByName || null,
      matchedByColor: item.matchedByColor || null
    }));

    // Restore players from state.players (authoritative) and supplement from sessions
    this.players.clear();
    const restoredPlayers = new Map();

    if (Array.isArray(state.players)) {
      for (const p of state.players) {
        // Exclude test runners/players from table restoration
        if (p.name && /^(тест|test)/i.test(p.name.trim())) {
          continue;
        }
        const playerObj = {
          socketId: null,
          sessionToken: p.sessionToken || null,
          playerId: p.playerId || ('plr_' + Math.random().toString(36).slice(2, 8)),
          name: p.name || 'Шеф-Повар',
          avatar: normalizeAvatarPath(p.avatar),
          color: p.color || PLAYER_COLORS[restoredPlayers.size % PLAYER_COLORS.length],
          score: p.score || 0,
          roundScore: p.roundScore || 0,
          roundPairs: p.roundPairs || 0,
          comboStreak: p.comboStreak || 0,
          roundDiscoveredRecipes: Array.isArray(p.roundDiscoveredRecipes) ? [...p.roundDiscoveredRecipes] : [],
          cursor: p.cursor || { x: 50, y: 50 },
          isOnline: false,
          isAway: false,
          lastCountedRound: p.lastCountedRound || null,
          disconnectedAt: p.disconnectedAt || Date.now(),
          joinedAt: p.joinedAt || Date.now()
        };
        const key = p.sessionToken ? `offline_${p.sessionToken}` : `offline_${playerObj.playerId}`;
        restoredPlayers.set(key, playerObj);
      }
    }

    // Supplement from savedSessions in case any were not in state.players
    const savedSessions = persistence.getSessions();
    for (const [token, sess] of Object.entries(savedSessions)) {
      if (sess.roomId === this.roomId) {
        if (sess.playerName && /^(тест|test)/i.test(sess.playerName.trim())) {
          continue;
        }
        const exists = [...restoredPlayers.values()].some(p => p.sessionToken === token || (sess.playerName && p.name.toLowerCase() === sess.playerName.toLowerCase()));
        if (!exists) {
          const playerObj = {
            socketId: null,
            sessionToken: sess.token || token,
            playerId: sess.playerId || ('plr_' + Math.random().toString(36).slice(2, 8)),
            name: sess.playerName || 'Шеф-Повар',
            avatar: normalizeAvatarPath(sess.avatar),
            color: PLAYER_COLORS[restoredPlayers.size % PLAYER_COLORS.length],
            score: sess.score || 0,
            roundScore: sess.roundScore || 0,
            roundPairs: sess.roundPairs || 0,
            comboStreak: sess.comboStreak || 0,
            roundDiscoveredRecipes: Array.isArray(sess.roundDiscoveredRecipes) ? [...sess.roundDiscoveredRecipes] : [],
            cursor: { x: 50, y: 50 },
            isOnline: false,
            joinedAt: sess.lastActive || Date.now()
          };
          restoredPlayers.set(`offline_${token}`, playerObj);
        }
      }
    }

    this.players = restoredPlayers;

    const matchedCardsCount = this.cards.filter(c => c.isMatched).length;
    if (this.roomId === 'bistro_main' && matchedCardsCount === 0) {
      // Main public room starts fresh and clean when no active cards were matched
      this.players.clear();
      this.roundState = 'IDLE';
      this.isPaused = false;
      this.pauseReason = null;
      this.pausedAt = null;
      this.elapsedSeconds = 0;
      this.roundStartedAt = null;
      for (const card of this.cards) {
        card.isFlipped = false;
        card.isMatched = false;
        card.flippedBy = null;
        card.matchedBy = null;
        card.matchedByName = null;
        card.matchedByColor = null;
      }
      try {
        sessionStore.resetRoundForRoom(this.roomId);
      } catch (e) {}
    } else if (matchedCardsCount === 0 || this.roundState === 'IDLE') {
      for (const p of this.players.values()) {
        p.roundScore = 0;
        p.roundPairs = 0;
        p.comboStreak = 0;
        p.roundDiscoveredRecipes = [];
      }
      try {
        sessionStore.resetRoundForRoom(this.roomId);
      } catch (e) {}
    } else if (this.roundState === 'ACTIVE') {
      this.isPaused = true;
      const offlineNames = [...this.players.values()].map(p => p.name).join(', ');
      this.pauseReason = state.pauseReason || (offlineNames ? `Связь с игроком «${offlineNames}» прервана. Игра приостановлена. Ожидание переподключения...` : 'Сервер перезапущен. Ожидание переподключения участников...');
      this.pausedAt = Date.now();
    } else {
      this.isPaused = !!state.isPaused;
      this.pauseReason = state.pauseReason || null;
      this.pausedAt = state.pausedAt || null;
    }

    console.log(`[GameRoom ${this.roomId}] Restored state from database: Round ${this.roundNumber} (${this.roundState}, Paused: ${this.isPaused}), ${this.cards.length} cards, ${this.players.size} players, ${this.getRemainingPairsCount()} pairs left.`);
  }

  saveStateToPersistence() {
    const playersData = [...this.players.values()].map(p => ({
      playerId: p.playerId,
      sessionToken: p.sessionToken,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      score: p.score || 0,
      roundScore: p.roundScore || 0,
      roundPairs: p.roundPairs || 0,
      comboStreak: p.comboStreak || 0,
      roundDiscoveredRecipes: Array.isArray(p.roundDiscoveredRecipes) ? [...p.roundDiscoveredRecipes] : [],
      cursor: p.cursor || { x: 50, y: 50 },
      isOnline: !!p.isOnline,
      isAway: !!p.isAway,
      lastCountedRound: p.lastCountedRound || null,
      disconnectedAt: p.disconnectedAt || null,
      joinedAt: p.joinedAt || Date.now()
    }));

    persistence.saveRoomState(this.roomId, {
      roomId: this.roomId,
      roomName: this.roomName,
      roundNumber: this.roundNumber,
      roundState: this.roundState,
      elapsedSeconds: this.getElapsedSeconds(),
      roundStartedAt: this.roundStartedAt,
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
      pausedAt: this.pausedAt,
      lastWinnerInfo: this.lastWinnerInfo,
      previousRoundWinner: this.previousRoundWinner,
      players: playersData,
      cards: this.cards.map(c => ({
        index: c.index,
        cardId: c.cardId,
        pairId: c.pairId,
        pairTitle: c.pairTitle,
        foodId: c.foodId,
        name: c.name,
        emoji: c.emoji,
        partnerName: c.partnerName,
        color: c.color,
        isFlipped: !!c.isFlipped,
        isMatched: !!c.isMatched,
        flippedBy: c.flippedBy,
        matchedBy: c.matchedBy,
        matchedByName: c.matchedByName,
        matchedByColor: c.matchedByColor
      }))
    });

    // Also sync each player into sessions and user records
    for (const p of this.players.values()) {
      if (p.sessionToken) {
        persistence.saveSession(p.sessionToken, {
          token: p.sessionToken,
          playerId: p.playerId,
          playerName: p.name,
          avatar: p.avatar,
          roomId: this.roomId,
          score: p.score || 0,
          roundScore: p.roundScore || 0,
          roundPairs: p.roundPairs || 0,
          comboStreak: p.comboStreak || 0,
          roundDiscoveredRecipes: p.roundDiscoveredRecipes || [],
          isOnline: p.isOnline,
          disconnectedAt: p.disconnectedAt || null
        });
      }
      if (p.name) {
        const u = persistence.getUser(p.name);
        if (u) {
          let modified = false;
          if (p.score > (u.totalScore || 0)) {
            u.totalScore = p.score;
            modified = true;
          }
          if (p.avatar && p.avatar !== DEFAULT_AVATAR && u.avatar !== p.avatar) {
            u.avatar = normalizeAvatarPath(p.avatar);
            modified = true;
          }
          if (modified) {
            persistence.scheduleSave();
          }
        }
      }
    }
  }

  setPaused(paused, reason = null, pauseType = null) {
    if (this.isPaused === paused) {
      if (paused && reason && this.pauseReason !== reason) {
        this.pauseReason = reason;
        if (pauseType) this.pauseType = pauseType;
        this.saveStateToPersistence();
      }
      return;
    }
    if (paused) {
      this.elapsedSeconds = this.getElapsedSeconds();
      this.isPaused = true;
      this.pauseReason = reason;
      this.pauseType = pauseType || ([...this.players.values()].some(p => p.isOnline === false || p.isAway) ? 'PLAYER_DISCONNECTED' : 'USER_MANUAL');
      this.lastActiveTime = null;
      this.pausedAt = Date.now();
    } else {
      this.isPaused = false;
      this.pauseReason = null;
      this.pauseType = null;
      this.pausedAt = null;
      this.lastActiveTime = Date.now();
    }
    this.saveStateToPersistence();
    console.log(`[GameRoom ${this.roomId}] Pause state changed to: ${paused} (${reason || 'Active'}, elapsed: ${this.elapsedSeconds}s)`);
  }

  setPlayerAway(socketId, isAway, reason = null) {
    const p = this.players.get(socketId);
    if (!p) return;
    p.isAway = !!isAway;
    if (this.roundState === 'ACTIVE') {
      const offlineOrAway = [...this.players.values()].filter(x => x.isOnline === false || x.isAway);
      if (offlineOrAway.length > 0) {
        const names = offlineOrAway.map(x => x.name).join(', ');
        const pauseMsg = reason || (isAway ? `Игрок «${names}» отошел или свернул окно. Время игры приостановлено.` : `Связь с игроком «${names}» прервана. Игра приостановлена.`);
        this.setPaused(true, pauseMsg);
      } else {
        this.setPaused(false);
      }
    }
    this.saveStateToPersistence();
  }

  ensurePlayerGameCounted(player) {
    if (!player || !player.name) return;
    if (player.lastCountedRound === this.roundNumber) return;
    if (!isTestRoom(this.roomId) && isTestPlayerName(player.name)) return;

    player.lastCountedRound = this.roundNumber;
    const user = persistence.getOrCreateUser(player.name, player.avatar);
    if (user) {
      user.gamesPlayed = (user.gamesPlayed || 0) + 1;
      persistence.scheduleSave();
    }
  }

  getElapsedSeconds() {
    if (this.roundState === 'SHOWCASE') {
      return this.elapsedSeconds || 0;
    }
    if (this.roundState === 'ACTIVE') {
      if (this.isPaused || !this.lastActiveTime) {
        return this.elapsedSeconds || 0;
      }
      const deltaSec = Math.floor((Date.now() - this.lastActiveTime) / 1000);
      return (this.elapsedSeconds || 0) + Math.max(0, deltaSec);
    }
    return 0;
  }

  startNewRound(autoStart = true) {
    if (this.lastWinnerInfo) {
      this.previousRoundWinner = this.lastWinnerInfo;
    }
    this.roundNumber += 1;
    this.elapsedSeconds = 0;
    this.lastActiveTime = null;
    this.lastWinnerInfo = null;
    this.isPaused = false;
    this.pauseReason = null;
    this.pausedAt = null;
    this.accumulatedPauseMs = 0;
    this.playerPendingFlips.clear();
    this.restartVotes.clear();

    for (const timer of this.flipTimers.values()) {
      clearTimeout(timer);
    }
    this.flipTimers.clear();

    for (const timer of this.singleFlipTimers.values()) {
      clearTimeout(timer);
    }
    this.singleFlipTimers.clear();
    conflictResolver.clearRoomContention(this.roomId);

    // Pick 8 unique pairs from the pool (16 cards total, NO repeating cards!)
    const shuffledPairs = [...persistence.getFoodPairs()].sort(() => Math.random() - 0.5);
    const selectedPairs = shuffledPairs.slice(0, 8);

    const deck = [];
    selectedPairs.forEach(pair => {
      deck.push({
        pairId: pair.pairId,
        pairTitle: pair.title,
        foodId: pair.cardA.foodId,
        name: pair.cardA.name,
        emoji: pair.cardA.emoji,
        partnerName: pair.cardA.partnerName,
        color: pair.cardA.color
      });
      deck.push({
        pairId: pair.pairId,
        pairTitle: pair.title,
        foodId: pair.cardB.foodId,
        name: pair.cardB.name,
        emoji: pair.cardB.emoji,
        partnerName: pair.cardB.partnerName,
        color: pair.cardB.color
      });
    });

    // Fisher-Yates Shuffle so the complementary pairs are randomly spread
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    this.cards = deck.map((item, index) => ({
      index,
      cardId: `card_${this.roundNumber}_${index}`,
      pairId: item.pairId,
      pairTitle: item.pairTitle,
      foodId: item.foodId,
      name: item.name,
      emoji: item.emoji,
      partnerName: item.partnerName,
      color: item.color,
      isFlipped: false,
      isMatched: false,
      flippedBy: null,
      matchedBy: null,
      matchedByName: null,
      matchedByColor: null
    }));

    for (const p of this.players.values()) {
      p.roundScore = 0;
      p.roundPairs = 0;
      p.comboStreak = 0;
      p.roundDiscoveredRecipes = [];
    }

    try {
      sessionStore.resetRoundForRoom(this.roomId);
    } catch (e) {
      // ignore in isolated tests
    }

    if (autoStart && this.players.size > 0) {
      this.roundState = 'ACTIVE';
      this.roundStartedAt = Date.now();
      this.lastActiveTime = Date.now();
    } else {
      this.roundState = 'IDLE';
      this.roundStartedAt = null;
      this.lastActiveTime = null;
    }

    this.saveStateToPersistence();
    console.log(`[GameRoom ${this.roomId}] Round ${this.roundNumber} prepared (${this.roundState}).`);
  }

  requestRestart(socketId) {
    const player = this.players.get(socketId);
    if (!player) return { success: false, reason: 'PLAYER_NOT_FOUND' };

    this.restartVotes.add(socketId);

    const onlinePlayers = [...this.players.values()].filter(p => p.isOnline !== false);
    const totalNeeded = Math.max(1, onlinePlayers.length);
    const readyPlayers = onlinePlayers.filter(p => this.restartVotes.has(p.socketId));
    const readyCount = readyPlayers.length;

    const allReady = readyCount >= totalNeeded;

    if (allReady) {
      this.restartVotes.clear();
      this.startNewRound(true);
      return {
        success: true,
        allReady: true,
        readyCount,
        totalNeeded,
        readyPlayerNames: readyPlayers.map(p => p.name),
        roundStarted: true
      };
    }

    return {
      success: true,
      allReady: false,
      readyCount,
      totalNeeded,
      readyPlayerNames: readyPlayers.map(p => p.name),
      roundStarted: false
    };
  }

  addPlayer(socketId, session) {
    // 1. Check if already exists by current socketId
    let existing = this.players.get(socketId);

    // 2. Check if a reconnecting player matches by session.token, session.playerId, or playerName
    if (!existing) {
      for (const [key, p] of this.players.entries()) {
        const matchesToken = session.token && p.sessionToken && p.sessionToken === session.token;
        const matchesPlayerId = session.playerId && p.playerId && p.playerId === session.playerId;
        const isGenericChef = (session.playerName || '').trim().toLowerCase() === 'шеф-повар';
        const matchesName = session.playerName && p.name && (p.name.trim().toLowerCase() === session.playerName.trim().toLowerCase());
        // Deduplicate: same user opening a 2nd tab or refreshing inherits their existing player seat
        const isSameAccount = matchesName && (!isGenericChef || p.isOnline === false);

        if (matchesToken || matchesPlayerId || isSameAccount) {
          existing = p;
          this.players.delete(key);
          this.restartVotes.delete(key);
          break;
        }
      }
    }

    if (existing) {
      const oldSocketId = existing.socketId;
      existing.socketId = socketId;
      if (session.token) existing.sessionToken = session.token;
      existing.isOnline = true;
      existing.isAway = false;
      existing.disconnectedAt = null;
      if (session.playerName) existing.name = session.playerName;
      const dbUser = persistence.getUser(existing.name);
      if (dbUser && dbUser.avatar) {
        existing.avatar = normalizeAvatarPath(dbUser.avatar);
      } else if (session.avatar) {
        existing.avatar = normalizeAvatarPath(session.avatar);
      }

      // Re-map cards flipped/matched by old socket, token or name
      for (const card of this.cards) {
        if (card.flippedBy === oldSocketId || (existing.sessionToken && card.flippedBy === existing.sessionToken) || card.flippedBy === existing.name) {
          card.flippedBy = socketId;
        }
        if (card.matchedBy === oldSocketId || (existing.sessionToken && card.matchedBy === existing.sessionToken) || card.matchedByName === existing.name) {
          card.matchedBy = socketId;
          card.matchedByName = existing.name;
          card.matchedByColor = existing.color;
        }
      }

      this.players.set(socketId, existing);

      // If room has 0 matched cards or is in IDLE, reset lingering roundScore
      const roomMatchedCards = this.cards.filter(c => c.isMatched).length;
      if (roomMatchedCards === 0 || this.roundState === 'IDLE') {
        existing.roundScore = 0;
        existing.roundPairs = 0;
        existing.comboStreak = 0;
        existing.roundDiscoveredRecipes = [];
        if (session) {
          session.roundScore = 0;
          session.roundPairs = 0;
          session.comboStreak = 0;
          session.roundDiscoveredRecipes = [];
        }
      }

      // Check if all players in active round are back, or clear pause if no one is missing
      const offlinePlayers = [...this.players.values()].filter(x => x.isOnline === false || x.isAway);
      if (offlinePlayers.length > 0) {
        if (this.roundState === 'ACTIVE') {
          const missingNames = offlinePlayers.map(p => p.name).join(', ');
          this.setPaused(true, `Связь с игроком «${missingNames}» прервана. Игра приостановлена. Ожидание переподключения...`);
        }
      } else {
        this.setPaused(false, null);
      }

      this.saveStateToPersistence();
      console.log(`[GameRoom ${this.roomId}] Player ${existing.name} reconnected (Score: ${existing.score}, RoundScore: ${existing.roundScore}, Pairs: ${existing.roundPairs})`);
      return existing;
    }

    // 3. New player joining
    const isFirstActive = (this.players.size === 0 || this.roundState === 'IDLE') && (this.cards.length === 0 || this.roundNumber === 0);
    const colorIndex = this.players.size % PLAYER_COLORS.length;

    // Check for duplicate name among other players in this room
    let finalPlayerName = (session.playerName || 'Шеф-Повар').trim().slice(0, 16);
    const existingNames = new Set(
      [...this.players.values()].filter(p => p.socketId !== socketId).map(p => p.name.trim().toLowerCase())
    );
    if (existingNames.has(finalPlayerName.toLowerCase())) {
      let counter = 2;
      while (existingNames.has(`${finalPlayerName} (${counter})`.toLowerCase())) {
        counter++;
      }
      finalPlayerName = `${finalPlayerName} (${counter})`;
    }

    // Determine initial score:
    // If dbUser exists, preserve their score! Brand new unregistered user without plays starts at 0.
    const dbUser = persistence.getUser(finalPlayerName);
    const initialScore = (session.score !== undefined && session.score !== null && session.score > 0)
      ? session.score
      : (dbUser ? (dbUser.totalScore || 0) : (session.score || 0));

    const roomMatchedCards = this.cards.filter(c => c.isMatched).length;
    const initialRoundScore = (roomMatchedCards === 0 || this.roundState === 'IDLE') ? 0 : (session.roundScore || 0);
    const initialRoundPairs = (roomMatchedCards === 0 || this.roundState === 'IDLE') ? 0 : (session.roundPairs || 0);

    const player = {
      socketId,
      sessionToken: session.token || null,
      playerId: session.playerId || (session.token ? session.token.slice(0, 12) : `plr_${Math.random().toString(36).slice(2, 8)}`),
      name: finalPlayerName,
      avatar: (dbUser && normalizeAvatarPath(dbUser.avatar)) || normalizeAvatarPath(session.avatar),
      color: PLAYER_COLORS[colorIndex],
      score: initialScore,
      roundScore: initialRoundScore,
      roundPairs: initialRoundPairs,
      comboStreak: (roomMatchedCards === 0 || this.roundState === 'IDLE') ? 0 : (session.comboStreak || 0),
      roundDiscoveredRecipes: (roomMatchedCards === 0 || this.roundState === 'IDLE') ? [] : (session.roundDiscoveredRecipes ? [...session.roundDiscoveredRecipes] : []),
      cursor: { x: 50, y: 50 },
      isOnline: true,
      isAway: false,
      lastCountedRound: null,
      joinedAt: Date.now()
    };

    this.players.set(socketId, player);
    if (isFirstActive) {
      this.startNewRound(true);
    } else {
      const offlinePlayers = [...this.players.values()].filter(x => x.isOnline === false || x.isAway);
      if (offlinePlayers.length > 0) {
        if (this.roundState === 'ACTIVE') {
          const missingNames = offlinePlayers.map(p => p.name).join(', ');
          this.setPaused(true, `Связь с игроком «${missingNames}» прервана. Игра приостановлена. Ожидание переподключения...`);
        }
      } else {
        this.setPaused(false, null);
      }
    }

    this.saveStateToPersistence();
    console.log(`[GameRoom ${this.roomId}] Player ${player.name} joined (Score: ${player.score}). Total: ${this.players.size}`);
    return player;
  }

  updatePlayerProfile(socketId, { playerName, avatar }) {
    const p = this.players.get(socketId);
    if (p) {
      if (playerName) p.name = playerName.trim().slice(0, 16);
      if (avatar) p.avatar = normalizeAvatarPath(avatar);

      // Update winner avatar/name in lastWinnerInfo if this player is the winner:
      if (this.lastWinnerInfo) {
        if (this.lastWinnerInfo.winnerPlayerId === p.playerId || this.lastWinnerInfo.winnerName === p.name) {
          if (avatar) this.lastWinnerInfo.winnerAvatar = normalizeAvatarPath(avatar);
          if (playerName) this.lastWinnerInfo.winnerName = p.name;
        }
      }

      this.saveStateToPersistence();
      return p;
    }
    return null;
  }

  removePlayer(socketId) {
    const p = this.players.get(socketId);
    if (p) {
      const isTest = isTestRoom(this.roomId);
      const isGenericOrTest = isTestPlayerName(p.name);

      if (!isTest && isGenericOrTest) {
        this.players.delete(socketId);
        this.singleFlipTimers.delete(socketId);
        this.playerPendingFlips.delete(socketId);
        this.restartVotes.delete(socketId);

        const unFlippedIndices = [];
        for (const card of this.cards) {
          if (!card.isMatched && card.flippedBy === socketId) {
            card.isFlipped = false;
            card.flippedBy = null;
            unFlippedIndices.push(card.index);
          }
        }
        if (unFlippedIndices.length > 0 && this.onCardsUnflipped) {
          this.onCardsUnflipped(this.roomId, unFlippedIndices);
        }

        const onlinePlayers = [...this.players.values()].filter(x => x.isOnline !== false);
        if (this.roundState === 'ACTIVE') {
          const offlinePlayers = [...this.players.values()].filter(x => x.isOnline === false || x.isAway);
          if (offlinePlayers.length > 0) {
            const missingNames = offlinePlayers.map(x => x.name).join(', ');
            this.setPaused(true, `Связь с игроком «${missingNames}» прервана. Игра приостановлена. Ожидание переподключения...`);
          } else {
            this.setPaused(false, null);
          }
        }

        this.saveStateToPersistence();
        console.log(`[GameRoom ${this.roomId}] Removed guest player ${p.name}. Online remaining: ${onlinePlayers.length}`);
        return p;
      }

      p.isOnline = false;
      p.disconnectedAt = Date.now();

      const singleTimer = this.singleFlipTimers.get(socketId);
      if (singleTimer) {
        clearTimeout(singleTimer);
        this.singleFlipTimers.delete(socketId);
      }

      const unFlippedIndices = [];
      for (const card of this.cards) {
        if (!card.isMatched && card.flippedBy === socketId) {
          card.isFlipped = false;
          card.flippedBy = null;
          unFlippedIndices.push(card.index);
        }
      }
      this.playerPendingFlips.delete(socketId);
      this.restartVotes.delete(socketId);

      if (unFlippedIndices.length > 0 && this.onCardsUnflipped) {
        this.onCardsUnflipped(this.roomId, unFlippedIndices);
      }

      // Check pause state in ACTIVE round:
      // Even if onlinePlayers.length === 0, it MUST remain paused waiting for re-connection!
      const onlinePlayers = [...this.players.values()].filter(x => x.isOnline !== false);
      if (this.roundState === 'ACTIVE') {
        const offlinePlayers = [...this.players.values()].filter(x => x.isOnline === false || x.isAway);
        const missingNames = offlinePlayers.map(x => x.name).join(', ');
        this.setPaused(true, `Связь с игроком «${missingNames}» прервана. Игра приостановлена. Ожидание переподключения...`);
      }

      // If waiting for restart votes and remaining online players are ready:
      if (this.roundState === 'SHOWCASE') {
        if (onlinePlayers.length > 0) {
          const readyCount = onlinePlayers.filter(x => this.restartVotes.has(x.socketId)).length;
          if (readyCount >= onlinePlayers.length) {
            this.restartVotes.clear();
            this.startNewRound(true);
            if (this.onRoundStarted) this.onRoundStarted(this.roomId, this.getSnapshot());
          }
        }
      }

      this.saveStateToPersistence();
      console.log(`[GameRoom ${this.roomId}] Player ${p.name} marked offline. Online remaining: ${onlinePlayers.length}`);
      return p;
    }
    return null;
  }

  hasPlayer(socketId, playerName, sessionToken) {
    if (socketId && this.players.has(socketId)) return true;
    const cleanName = playerName ? playerName.trim().toLowerCase() : null;
    const isGeneric = cleanName === 'шеф-повар';
    for (const p of this.players.values()) {
      if (sessionToken && p.sessionToken && p.sessionToken === sessionToken) return true;
      if (cleanName && !isGeneric && p.name && p.name.trim().toLowerCase() === cleanName) return true;
    }
    return false;
  }

  getOnlinePlayerCount() {
    return [...this.players.values()].filter(p => p.isOnline !== false).length;
  }

  updatePlayerCursor(socketId, cursorData) {
    const p = this.players.get(socketId);
    if (p && cursorData) {
      p.cursor = {
        x: cursorData.x ?? p.cursor.x,
        y: cursorData.y ?? p.cursor.y
      };
    }
  }

  handleCardFlip(socketId, cardIndex) {
    if (this.isPaused) {
      return { success: false, reason: 'GAME_PAUSED', message: this.pauseReason || 'Игра приостановлена' };
    }

    if (this.roundState === 'IDLE') {
      this.roundState = 'ACTIVE';
      this.roundStartedAt = Date.now();
      this.lastActiveTime = Date.now();
      this.elapsedSeconds = 0;
    } else if (this.roundState !== 'ACTIVE') {
      return { success: false, reason: 'ROUND_NOT_ACTIVE' };
    }

    const player = this.players.get(socketId);
    if (!player) {
      return { success: false, reason: 'PLAYER_NOT_FOUND' };
    }
    this.ensurePlayerGameCounted(player);

    const card = this.cards[cardIndex];
    if (!card) {
      return { success: false, reason: 'INVALID_CARD_INDEX' };
    }

    if (card.isMatched) {
      return { success: false, reason: 'CARD_ALREADY_MATCHED' };
    }

    if (card.isFlipped) {
      return { success: false, reason: 'CARD_ALREADY_FLIPPED' };
    }

    // Arbitration check: simultaneous click collision on the same card within 250ms
    const arrivedAtHr = process.hrtime.bigint();
    const contentionResult = conflictResolver.evaluateCardFlipContention({
      roomId: this.roomId,
      cardIndex,
      candidateFlip: {
        socketId,
        playerName: player.name,
        arrivedAtHr
      }
    });

    if (contentionResult.isContention && contentionResult.winner.socketId !== socketId) {
      return {
        success: false,
        isContention: true,
        winner: contentionResult.winner,
        timeDeltaMs: contentionResult.timeDeltaMs,
        message: contentionResult.message,
        auditRecord: contentionResult.auditRecord
      };
    }

    let pending = this.playerPendingFlips.get(socketId) || [];
    if (pending.length >= 2) {
      return { success: false, reason: 'WAIT_FOR_MISMATCH_RESET' };
    }

    card.isFlipped = true;
    card.flippedBy = socketId;
    card.flippedAt = Date.now();
    pending.push(cardIndex);
    this.playerPendingFlips.set(socketId, pending);
    this.saveStateToPersistence();

    const flipEvent = {
      cardIndex,
      card: this.getPublicCard(card),
      playerName: player.name,
      playerColor: player.color,
      isContention: contentionResult.isContention,
      contentionDetails: contentionResult.isContention ? {
        timeDeltaMs: contentionResult.timeDeltaMs,
        message: contentionResult.message
      } : null
    };

    if (pending.length === 2) {
      // Clear single-card auto-unflip timeout since the player flipped their 2nd card
      const singleTimer = this.singleFlipTimers.get(socketId);
      if (singleTimer) {
        clearTimeout(singleTimer);
        this.singleFlipTimers.delete(socketId);
      }

      const firstIndex = pending[0];
      const secondIndex = pending[1];
      const firstCard = this.cards[firstIndex];
      const secondCard = this.cards[secondIndex];

      // Match check: do they belong to the same complementary food pair?
      const isMatch = firstCard.pairId === secondCard.pairId;

      if (isMatch) {
        firstCard.isMatched = true;
        firstCard.matchedBy = socketId;
        firstCard.matchedByName = player.name;
        firstCard.matchedByColor = player.color;

        secondCard.isMatched = true;
        secondCard.matchedBy = socketId;
        secondCard.matchedByName = player.name;
        secondCard.matchedByColor = player.color;

        player.comboStreak = (player.comboStreak || 0) + 1;
        const streakBonus = (player.comboStreak - 1) * 50;
        const scoreDelta = 100 + streakBonus;

        player.score += scoreDelta;
        player.roundScore += scoreDelta;
        player.roundPairs += 1;

        const matchTimeMs = firstCard.flippedAt ? Math.max(100, Date.now() - firstCard.flippedAt) : 1200;
        persistence.recordPairMatch(player.name, scoreDelta, matchTimeMs);

        persistence.unlockOrAddDish({
          foodId: firstCard.pairId,
          name: firstCard.pairTitle,
          emoji: `${firstCard.emoji} ${secondCard.emoji}`,
          category: 'Гастрономическая пара',
          calories: 'Идеальное сочетание',
          secretIngredient: `${firstCard.name} + ${secondCard.name}`,
          discoveredBy: player.name
        });

        const recipeEntry = {
          pairId: firstCard.pairId,
          pairTitle: firstCard.pairTitle,
          cardA: { name: firstCard.name, emoji: firstCard.emoji },
          cardB: { name: secondCard.name, emoji: secondCard.emoji },
          discoveredAt: new Date().toISOString()
        };
        if (!player.roundDiscoveredRecipes) player.roundDiscoveredRecipes = [];
        player.roundDiscoveredRecipes.push(recipeEntry);

        this.playerPendingFlips.delete(socketId);
        this.saveStateToPersistence();

        const remainingPairs = this.getRemainingPairsCount();

        const matchResult = {
          success: true,
          type: 'MATCH',
          player: {
            playerId: player.playerId,
            name: player.name,
            avatar: player.avatar,
            color: player.color,
            score: player.score,
            roundScore: player.roundScore,
            roundPairs: player.roundPairs,
            comboStreak: player.comboStreak,
            roundDiscoveredRecipes: player.roundDiscoveredRecipes
          },
          scoreDelta,
          matchedPair: recipeEntry,
          matchedFood: {
            pairTitle: firstCard.pairTitle,
            itemA: `${firstCard.emoji} ${firstCard.name}`,
            itemB: `${secondCard.emoji} ${secondCard.name}`
          },
          cards: [
            this.getPublicCard(firstCard),
            this.getPublicCard(secondCard)
          ],
          cardIndices: [firstIndex, secondIndex],
          remainingPairs,
          flipEvent
        };

        if (remainingPairs === 0) {
          setTimeout(() => {
            this.endRound();
          }, 600);
        }

        return matchResult;
      } else {
        player.comboStreak = 0;
        const mismatchResult = {
          success: true,
          type: 'MISMATCH',
          player: {
            playerId: player.playerId,
            name: player.name,
            color: player.color
          },
          cardIndices: [firstIndex, secondIndex],
          cards: [
            this.getPublicCard(firstCard),
            this.getPublicCard(secondCard)
          ],
          flipEvent
        };

        const timerKey = `${socketId}_${Date.now()}`;
        const resetTimer = setTimeout(() => {
          firstCard.isFlipped = false;
          firstCard.flippedBy = null;
          secondCard.isFlipped = false;
          secondCard.flippedBy = null;
          this.playerPendingFlips.delete(socketId);
          this.flipTimers.delete(timerKey);
          this.saveStateToPersistence();
          if (this.onCardsUnflipped) {
            this.onCardsUnflipped(this.roomId, [firstIndex, secondIndex]);
          }
        }, this.mismatchTimeoutMs);

        this.flipTimers.set(timerKey, resetTimer);
        return mismatchResult;
      }
    }

    // Auto-unflip timeout: if 2nd card is not clicked within singleCardTimeoutMs,
    // flip this 1st card back down so the board never gets deadlocked.
    const prevTimer = this.singleFlipTimers.get(socketId);
    if (prevTimer) {
      clearTimeout(prevTimer);
    }

    const singleTimer = setTimeout(() => {
      this.singleFlipTimers.delete(socketId);
      const pendingNow = this.playerPendingFlips.get(socketId);
      if (pendingNow && pendingNow.length === 1 && pendingNow[0] === cardIndex) {
        const targetCard = this.cards[cardIndex];
        if (targetCard && !targetCard.isMatched && targetCard.isFlipped) {
          targetCard.isFlipped = false;
          targetCard.flippedBy = null;
          this.playerPendingFlips.delete(socketId);
          this.saveStateToPersistence();
          console.log(`[GameRoom ${this.roomId}] Card #${cardIndex} auto-unflipped (timeout ${this.singleCardTimeoutMs}ms without 2nd card)`);
          if (this.onCardsUnflipped) {
            this.onCardsUnflipped(this.roomId, [cardIndex]);
          }
        }
      }
    }, this.singleCardTimeoutMs);

    this.singleFlipTimers.set(socketId, singleTimer);

    return {
      success: true,
      type: 'SINGLE_FLIP',
      flipEvent
    };
  }

  getRemainingPairsCount() {
    let unmatched = 0;
    for (const card of this.cards) {
      if (!card.isMatched) unmatched++;
    }
    return Math.floor(unmatched / 2);
  }

  endRound() {
    for (const timer of this.singleFlipTimers.values()) {
      clearTimeout(timer);
    }
    this.singleFlipTimers.clear();

    const finalElapsed = this.getElapsedSeconds();
    this.elapsedSeconds = finalElapsed;
    this.roundState = 'SHOWCASE';
    this.roundStartedAt = null;
    this.lastActiveTime = null;

    let topScore = -1;
    let winner = null;
    for (const p of this.players.values()) {
      if (p.roundScore > topScore) {
        topScore = p.roundScore;
        winner = p;
      }
    }

    this.lastWinnerInfo = {
      roundNumber: this.roundNumber,
      winnerName: winner ? winner.name : 'Шеф-Повар',
      winnerAvatar: winner ? normalizeAvatarPath(winner.avatar) : DEFAULT_AVATAR,
      winnerScore: topScore > 0 ? topScore : 0,
      winnerPairs: winner ? winner.roundPairs : 8,
      elapsedSeconds: this.elapsedSeconds,
      totalPairs: 8,
      scores: [...this.players.values()].map(p => ({
        player: p.name,
        avatar: normalizeAvatarPath(p.avatar),
        score: p.score,
        roundScore: p.roundScore,
        roundPairs: p.roundPairs
      })),
      message: winner
        ? `🎉 Отлично! Все пары найдены за ${this.elapsedSeconds} сек! Победитель: ${winner.name}`
        : `🎉 Все пары найдены за ${this.elapsedSeconds} сек!`
    };
    this.previousRoundWinner = this.lastWinnerInfo;

    for (const p of this.players.values()) {
      if (p.roundScore > 0 || p.roundPairs > 0 || p.lastCountedRound === this.roundNumber) {
        this.ensurePlayerGameCounted(p);
      }
    }

    persistence.recordRoundEnd({
      roomId: this.roomId,
      roundNumber: this.roundNumber,
      winner: this.lastWinnerInfo.winnerName,
      elapsedSeconds: this.elapsedSeconds,
      scores: [...this.players.values()].map(p => ({
        player: p.name,
        score: p.score,
        roundScore: p.roundScore,
        roundPairs: p.roundPairs,
        participated: (p.roundScore > 0 || p.roundPairs > 0 || p.lastCountedRound === this.roundNumber),
        alreadyCounted: (p.lastCountedRound === this.roundNumber)
      }))
    });

    this.saveStateToPersistence();
    console.log(`[GameRoom ${this.roomId}] Round ${this.roundNumber} solved in ${this.elapsedSeconds}s. Winner: ${this.lastWinnerInfo.winnerName}`);

    // Manual consensus restart: no automatic countdown timer!
    // Round will only start when all players press restart
    this.restartVotes.clear();

    if (this.onRoundCompleted) {
      this.onRoundCompleted(this.roomId, {
        winnerInfo: this.lastWinnerInfo,
        room: this.getSnapshot()
      });
    }
  }

  getPublicCard(card) {
    if (!card) return null;
    if (card.isFlipped || card.isMatched) {
      return {
        index: card.index,
        cardId: card.cardId,
        pairId: card.pairId,
        isFlipped: card.isFlipped,
        isMatched: card.isMatched,
        name: card.name,
        emoji: card.emoji,
        partnerName: card.partnerName,
        pairTitle: card.pairTitle,
        color: card.color,
        matchedByName: card.matchedByName,
        matchedByColor: card.matchedByColor
      };
    }
    return {
      index: card.index,
      cardId: card.cardId,
      isFlipped: false,
      isMatched: false,
      name: '?',
      emoji: '🍴',
      partnerName: '',
      pairTitle: '',
      color: '#475569',
      matchedByName: null,
      matchedByColor: null
    };
  }

  getRoomLeaderboard() {
    const isTest = isTestRoom(this.roomId);
    return [...this.players.values()]
      .filter(p => isTest || (p.name && !isTestPlayerName(p.name)))
      .map(p => ({
        playerId: p.playerId,
        socketId: p.socketId,
        name: p.name,
        avatar: normalizeAvatarPath(p.avatar),
        color: p.color,
        roundScore: p.roundScore || 0,
        roundPairs: p.roundPairs || 0,
        comboStreak: p.comboStreak || 0,
        isOnline: p.isOnline !== false
      }))
      .sort((a, b) => (b.roundScore - a.roundScore) || (b.roundPairs - a.roundPairs));
  }

  getSnapshot() {
    let winnerInfo = this.lastWinnerInfo;
    if (winnerInfo && winnerInfo.winnerName) {
      const winnerPlayer = [...this.players.values()].find(p => p.name === winnerInfo.winnerName || p.playerId === winnerInfo.winnerPlayerId);
      const dbUser = persistence.getUser(winnerInfo.winnerName);
      const liveAvatar = (winnerPlayer && winnerPlayer.avatar) || (dbUser && dbUser.avatar);
      if (liveAvatar) {
        winnerInfo = {
          ...winnerInfo,
          winnerAvatar: normalizeAvatarPath(liveAvatar)
        };
      }
    }

    let prevWinner = this.previousRoundWinner;
    if (!prevWinner && persistence.getLatestMatch) {
      const latest = persistence.getLatestMatch(this.roomId);
      if (latest) {
        const dbUser = persistence.getUser(latest.winner);
        prevWinner = {
          roundNumber: latest.roundNumber,
          winnerName: latest.winner,
          winnerAvatar: normalizeAvatarPath((latest.scores && latest.scores.find(s => s.player === latest.winner)?.avatar) || (dbUser && dbUser.avatar)),
          winnerScore: (latest.scores && latest.scores.find(s => s.player === latest.winner)?.roundScore) || 0,
          winnerPairs: (latest.scores && latest.scores.find(s => s.player === latest.winner)?.roundPairs) || 0,
          elapsedSeconds: latest.elapsedSeconds,
          scores: latest.scores || []
        };
      }
    }

    return {
      roomId: this.roomId,
      roomName: this.roomName,
      roundNumber: this.roundNumber,
      roundState: this.roundState,
      isPaused: this.isPaused || false,
      pauseReason: this.pauseReason || null,
      pauseType: this.pauseType || (this.isPaused ? ([...this.players.values()].some(p => p.isOnline === false || p.isAway) ? 'PLAYER_DISCONNECTED' : 'USER_MANUAL') : null),
      hasMissingPlayers: [...this.players.values()].some(p => p.isOnline === false || p.isAway),
      roundStartedAt: this.roundStartedAt,
      elapsedSeconds: this.getElapsedSeconds(),
      remainingPairs: this.getRemainingPairsCount(),
      totalPairs: 8,
      playersCount: this.players.size,
      lastWinnerInfo: winnerInfo,
      previousRoundWinner: prevWinner || null,
      roomLeaderboard: this.getRoomLeaderboard(),
      restartStatus: {
        readyCount: [...this.players.values()].filter(p => p.isOnline !== false && this.restartVotes.has(p.socketId)).length,
        totalNeeded: Math.max(1, [...this.players.values()].filter(p => p.isOnline !== false).length),
        readyPlayerNames: [...this.players.values()].filter(p => p.isOnline !== false && this.restartVotes.has(p.socketId)).map(p => p.name)
      },
      players: [...this.players.values()].map(p => ({
        playerId: p.playerId,
        socketId: p.socketId,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        score: p.score,
        roundScore: p.roundScore,
        roundPairs: p.roundPairs,
        comboStreak: p.comboStreak || 0,
        roundDiscoveredRecipes: p.roundDiscoveredRecipes || [],
        isOnline: p.isOnline,
        isAway: !!p.isAway,
        cursor: p.cursor
      })),
      cards: this.cards.map(c => this.getPublicCard(c))
    };
  }

  destroy() {
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    for (const timer of this.flipTimers.values()) clearTimeout(timer);
    this.players.clear();
  }
}

export class GameManager {
  constructor() {
    this.rooms = new Map();
    // Restore any previously active rooms from persistent storage
    const savedRoomStates = persistence.getAllRoomStates();
    if (savedRoomStates && typeof savedRoomStates === 'object') {
      for (const [roomId, state] of Object.entries(savedRoomStates)) {
        this.getOrCreateRoom(roomId, state.roomName || `Зал ${roomId}`);
      }
    }
    this.getOrCreateRoom('bistro_main', 'Главный Зал Ресторана');
  }

  getOrCreateRoom(roomId = 'bistro_main', roomName) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new GameRoom(roomId, roomName || `Зал ${roomId}`));
    }
    return this.rooms.get(roomId);
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Finds an available room with capacity < MAX_ROOM_PLAYERS (8),
   * or creates a new table (e.g. bistro_2, bistro_3...) so players can play separately.
   * If the player already has a seat in a room, reconnects them to that room.
   */
  findAvailableRoom(preferredRoomId = 'bistro_main', playerName = null, sessionToken = null) {
    // 1. Reconnection check: if player already has an existing seat in preferredRoomId
    if (preferredRoomId && this.rooms.has(preferredRoomId)) {
      const room = this.rooms.get(preferredRoomId);
      if (room.hasPlayer(null, playerName, sessionToken)) {
        return room;
      }
    }

    // 2. Reconnection check: if player already has an existing seat in ANY other active room
    for (const room of this.rooms.values()) {
      if (room.hasPlayer(null, playerName, sessionToken)) {
        return room;
      }
    }

    // 3. For any test rooms or custom rooms (e.g. test_*, multi_*, rm_*, *test*):
    if (preferredRoomId && (/test/i.test(preferredRoomId) || /^(multi_|rm_)/i.test(preferredRoomId))) {
      const customRoom = this.getOrCreateRoom(preferredRoomId);
      if (customRoom.getOnlinePlayerCount() < MAX_ROOM_PLAYERS && customRoom.players.size < MAX_ROOM_PLAYERS) {
        return customRoom;
      }
      let idx = 2;
      while (true) {
        const subId = `${preferredRoomId}_${idx}`;
        if (!this.rooms.has(subId)) {
          return this.getOrCreateRoom(subId, `${preferredRoomId} (${idx})`);
        }
        const subRoom = this.rooms.get(subId);
        if (subRoom.getOnlinePlayerCount() < MAX_ROOM_PLAYERS && subRoom.players.size < MAX_ROOM_PLAYERS) {
          return subRoom;
        }
        idx++;
      }
    }

    // 4. If an explicit custom room was passed (not bistro_main and not bistro_*):
    if (preferredRoomId && preferredRoomId !== 'bistro_main' && !/^bistro_[0-9]+$/i.test(preferredRoomId)) {
      const explicitRoom = this.getOrCreateRoom(preferredRoomId);
      if (explicitRoom.getOnlinePlayerCount() < MAX_ROOM_PLAYERS && explicitRoom.players.size < MAX_ROOM_PLAYERS) {
        return explicitRoom;
      }
    }

    // 5. Standard gameplay matchmaking (default tables: bistro_main, bistro_2, bistro_3...):
    const mainRoom = this.getOrCreateRoom('bistro_main', 'Главный Зал Ресторана');
    if (mainRoom.getOnlinePlayerCount() < MAX_ROOM_PLAYERS && mainRoom.players.size < MAX_ROOM_PLAYERS) {
      return mainRoom;
    }

    // Table 1 is full (8 players). Search for existing open tables or create Table 2, Table 3...
    let tableIndex = 2;
    while (true) {
      const roomId = `bistro_${tableIndex}`;
      const roomName = `Стол №${tableIndex}`;

      if (!this.rooms.has(roomId)) {
        const newRoom = this.getOrCreateRoom(roomId, roomName);
        console.log(`[GameManager] Table reached 8 players limit. Created new room: ${roomId} (${roomName}) for player ${playerName || 'Шеф'}`);
        return newRoom;
      }

      const existingRoom = this.rooms.get(roomId);
      if (existingRoom.getOnlinePlayerCount() < MAX_ROOM_PLAYERS && existingRoom.players.size < MAX_ROOM_PLAYERS) {
        return existingRoom;
      }

      tableIndex++;
    }
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
