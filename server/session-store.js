import crypto from 'node:crypto';

export class SessionStore {
  constructor(gracePeriodMs = 120000) {
    this.gracePeriodMs = gracePeriodMs;
    // Map of sessionToken -> Session
    this.sessions = new Map();
  }

  generateToken() {
    return 'ses_' + crypto.randomUUID().replace(/-/g, '');
  }

  createSession({ token, playerName, avatar, roomId, socketId }) {
    const finalToken = token || this.generateToken();
    const session = {
      token: finalToken,
      playerId: 'plr_' + crypto.randomBytes(4).toString('hex'),
      playerName: playerName || 'Фотограф',
      avatar: avatar || '📸',
      roomId: roomId || 'safari_main',
      socketId,
      score: 0,
      roundSnaps: 0,
      camera: { x: 1200, y: 800, zoom: 1 },
      isOnline: true,
      lastActive: Date.now(),
      disconnectedAt: null,
      expiryTimer: null
    };

    this.sessions.set(finalToken, session);
    return session;
  }

  getSession(token) {
    return this.sessions.get(token);
  }

  touch(token, updates = {}) {
    const session = this.sessions.get(token);
    if (!session) return null;

    Object.assign(session, updates, {
      lastActive: Date.now()
    });
    return session;
  }

  markDisconnected(token) {
    const session = this.sessions.get(token);
    if (!session) return;

    session.isOnline = false;
    session.disconnectedAt = Date.now();

    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer);
    }

    // Give 2 minutes grace period for reconnection
    session.expiryTimer = setTimeout(() => {
      console.log(`[SessionStore] Grace period expired for session ${token} (${session.playerName})`);
      this.sessions.delete(token);
    }, this.gracePeriodMs);

    console.log(`[SessionStore] Player ${session.playerName} marked offline. Grace timer active (${this.gracePeriodMs / 1000}s)`);
  }

  resumeSession(token, newSocketId) {
    const session = this.sessions.get(token);
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

    console.log(`[SessionStore] Successfully resumed session for ${session.playerName} in room ${session.roomId}`);
    return session;
  }

  removeSession(token) {
    const session = this.sessions.get(token);
    if (session?.expiryTimer) {
      clearTimeout(session.expiryTimer);
    }
    this.sessions.delete(token);
  }
}

export const sessionStore = new SessionStore();
