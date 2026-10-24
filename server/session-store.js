import crypto from 'node:crypto';
import { persistence, DEFAULT_AVATAR, normalizeAvatarPath, isTestPlayerName } from './persistence.js';

export class SessionStore {
  constructor(gracePeriodMs = 86400000) { // 24 hours default grace period
    this.gracePeriodMs = gracePeriodMs;
    // Map of sessionToken -> Session
    this.sessions = new Map();
    this.initFromPersistence();
  }

  initFromPersistence() {
    try {
      const saved = persistence.getSessions();
      if (saved && typeof saved === 'object') {
        for (const [token, data] of Object.entries(saved)) {
          this.sessions.set(token, {
            token: data.token || token,
            playerId: data.playerId || ('plr_' + crypto.randomBytes(4).toString('hex')),
            playerName: data.playerName || 'Шеф-Повар',
            avatar: normalizeAvatarPath(data.avatar),
            roomId: data.roomId || 'bistro_main',
            socketId: null,
            score: data.score || 0,
            roundScore: data.roundScore || 0,
            roundPairs: data.roundPairs || 0,
            comboStreak: data.comboStreak || 0,
            roundDiscoveredRecipes: Array.isArray(data.roundDiscoveredRecipes) ? [...data.roundDiscoveredRecipes] : [],
            isOnline: false, // offline until client socket reconnects
            lastActive: data.lastActive || Date.now(),
            disconnectedAt: data.disconnectedAt || Date.now(),
            expiryTimer: null
          });
        }
      }
      console.log(`[SessionStore] Initialized: restored ${this.sessions.size} persistent sessions from database.`);
    } catch (err) {
      console.error('[SessionStore] Failed to restore sessions from persistence:', err);
    }
  }

  generateToken() {
    return 'ses_' + crypto.randomUUID().replace(/-/g, '');
  }

  findSessionByPlayerName(playerName, roomId = null) {
    if (!playerName) return null;
    const lower = playerName.trim().toLowerCase();
    if (lower === 'шеф-повар' || isTestPlayerName(playerName)) return null;
    for (const s of this.sessions.values()) {
      if ((!roomId || s.roomId === roomId) && s.playerName && s.playerName.trim().toLowerCase() === lower && s.isOnline === false) {
        return s;
      }
    }
    const saved = persistence.getSessions();
    for (const [token, s] of Object.entries(saved)) {
      if ((!roomId || s.roomId === roomId) && s.playerName && s.playerName.trim().toLowerCase() === lower && s.isOnline === false) {
        if (!this.sessions.has(token)) {
          this.sessions.set(token, { ...s, isOnline: false, expiryTimer: null });
        }
        return this.sessions.get(token);
      }
    }
    return null;
  }

  createSession({ token, playerName, avatar, roomId, socketId, score = 0, roundScore = 0, roundPairs = 0, comboStreak = 0, roundDiscoveredRecipes = [] }) {
    const finalToken = token || this.generateToken();
    const dbUser = persistence.getUser(playerName);
    const resolvedScore = (score !== undefined && score !== null && score > 0)
      ? score
      : (dbUser ? (dbUser.totalScore || 0) : (score || 0));

    const resolvedAvatar = (dbUser && normalizeAvatarPath(dbUser.avatar)) || normalizeAvatarPath(avatar);

    const session = {
      token: finalToken,
      playerId: 'plr_' + crypto.randomBytes(4).toString('hex'),
      playerName: playerName || 'Шеф-Повар',
      avatar: resolvedAvatar,
      roomId: roomId || 'bistro_main',
      socketId,
      score: resolvedScore,
      roundScore: roundScore || 0,
      roundPairs: roundPairs || 0,
      comboStreak: comboStreak || 0,
      roundDiscoveredRecipes: [...roundDiscoveredRecipes],
      isOnline: true,
      lastActive: Date.now(),
      disconnectedAt: null,
      expiryTimer: null
    };

    this.sessions.set(finalToken, session);
    persistence.saveSession(finalToken, session);
    return session;
  }

  getSession(token) {
    if (!token) return null;
    let session = this.sessions.get(token);
    if (!session) {
      const saved = persistence.getSession(token);
      if (saved) {
        session = { ...saved, isOnline: false, expiryTimer: null };
        this.sessions.set(token, session);
      }
    }
    return session;
  }

  touch(token, updates = {}) {
    const session = this.getSession(token);
    if (!session) return null;

    Object.assign(session, updates, {
      lastActive: Date.now()
    });
    persistence.saveSession(token, session);
    return session;
  }

  markDisconnected(token) {
    const session = this.getSession(token);
    if (!session) return;

    session.isOnline = false;
    session.disconnectedAt = Date.now();
    persistence.saveSession(token, session);

    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer);
    }

    session.expiryTimer = setTimeout(() => {
      console.log(`[SessionStore] Grace period expired for session ${token} (${session.playerName})`);
      this.sessions.delete(token);
      persistence.removeSession(token);
    }, this.gracePeriodMs);

    console.log(`[SessionStore] Player ${session.playerName} marked offline. Grace timer active (${this.gracePeriodMs / 1000}s)`);
  }

  resumeSession(token, newSocketId) {
    let session = this.getSession(token);
    if (!session) {
      return null;
    }

    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer);
      session.expiryTimer = null;
    }

    session.isOnline = true;
    session.disconnectedAt = null;
    session.socketId = newSocketId;
    session.lastActive = Date.now();
    persistence.saveSession(token, session);

    console.log(`[SessionStore] Successfully resumed session for ${session.playerName} in room ${session.roomId}`);
    return session;
  }

  removeSession(token) {
    const session = this.sessions.get(token);
    if (session?.expiryTimer) {
      clearTimeout(session.expiryTimer);
    }
    this.sessions.delete(token);
    persistence.removeSession(token);
  }

  removeSessionsByPlayerName(playerName) {
    if (!playerName) return;
    const lower = playerName.trim().toLowerCase();
    for (const [token, s] of this.sessions.entries()) {
      if (s.playerName && s.playerName.trim().toLowerCase() === lower) {
        if (s.expiryTimer) clearTimeout(s.expiryTimer);
        this.sessions.delete(token);
        persistence.removeSession(token);
      }
    }
  }

  resetRoundForRoom(roomId) {
    if (!roomId) return;
    for (const [token, s] of this.sessions.entries()) {
      if (s.roomId === roomId) {
        s.roundScore = 0;
        s.roundPairs = 0;
        s.comboStreak = 0;
        s.roundDiscoveredRecipes = [];
        persistence.saveSession(token, s);
      }
    }
    const saved = persistence.getSessions();
    if (saved && typeof saved === 'object') {
      for (const [token, s] of Object.entries(saved)) {
        if (s.roomId === roomId) {
          s.roundScore = 0;
          s.roundPairs = 0;
          s.comboStreak = 0;
          s.roundDiscoveredRecipes = [];
          persistence.saveSession(token, s);
        }
      }
    }
  }
}

export const sessionStore = new SessionStore();
