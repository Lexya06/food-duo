/**
 * Network Manager: Native WebSocket connection, heartbeat, offline detection,
 * state persistence in localStorage, offline action queuing, and auto-reconnection.
 */
export class NetworkClient {
  constructor() {
    this.ws = null;
    this.sessionToken = sessionStorage.getItem('foodmatch_session_token') || localStorage.getItem('foodmatch_session_token') || null;
    this.offlineQueue = JSON.parse(sessionStorage.getItem('foodmatch_offline_queue') || '[]');
    this.status = 'DISCONNECTED'; // 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 30;
    this.reconnectTimer = null;
    this.eventHandlers = new Map();
    this.isManualDisconnect = false;

    // Browser offline/online listeners
    window.addEventListener('online', () => {
      console.log('[Network] Browser reported online.');
      this.reconnectNow();
    });

    window.addEventListener('offline', () => {
      console.warn('[Network] Browser reported offline.');
      this.handleConnectionLoss('Сетевой интерфейс отключен');
    });
  }

  on(type, handler) {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, []);
    }
    this.eventHandlers.get(type).push(handler);
  }

  emit(type, data) {
    const list = this.eventHandlers.get(type);
    if (list) {
      list.forEach(fn => fn(data));
    }
  }

  connect(roomData = null) {
    if (roomData) {
      this.lastRoomData = roomData;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.status = 'RECONNECTING';
    this.emit('status_change', { status: this.status, queueLength: this.offlineQueue.length });

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    console.log(`[Network] Connecting to ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      console.error('[Network] WebSocket init error:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[Network] WebSocket connection established.');
      this.status = 'CONNECTED';
      this.reconnectAttempts = 0;
      this.isManualDisconnect = false;
      this.emit('status_change', { status: this.status });

      const authToken = sessionStorage.getItem('foodmatch_auth_token') || localStorage.getItem('foodmatch_auth_token') || null;

      const fallbackRoomData = this.lastRoomData || {
        playerName: sessionStorage.getItem('foodmatch_player_name') || localStorage.getItem('foodmatch_player_name') || 'Шеф-Повар',
        avatar: sessionStorage.getItem('foodmatch_player_avatar') || localStorage.getItem('foodmatch_player_avatar') || '/avatars/chef_male.svg',
        roomId: 'bistro_main'
      };

      // If we have an existing session token, resume it!
      if (this.sessionToken) {
        this.send('RESUME_SESSION', {
          token: this.sessionToken,
          authToken,
          playerName: fallbackRoomData.playerName,
          avatar: fallbackRoomData.avatar,
          roomId: fallbackRoomData.roomId,
          queuedActions: this.offlineQueue
        });
      } else {
        this.send('JOIN_ROOM', {
          ...fallbackRoomData,
          authToken
        });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleIncomingMessage(msg);
      } catch (err) {
        console.error('[Network] Message parse failed:', err);
      }
    };

    this.ws.onclose = (event) => {
      console.warn('[Network] WebSocket closed:', event.code, event.reason);
      if (!this.isManualDisconnect) {
        this.handleConnectionLoss('Соединение с сервером разорвано');
      }
    };

    this.ws.onerror = (err) => {
      console.error('[Network] WebSocket error:', err);
    };
  }

  handleIncomingMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const type = msg.type;
    const payload = msg.payload !== undefined ? msg.payload : msg;

    if (type === 'INIT_STATE') {
      if (payload.sessionToken) {
        this.setSessionToken(payload.sessionToken);
      }
      if (payload.room && payload.room.roomId) {
        if (!this.lastRoomData) this.lastRoomData = {};
        this.lastRoomData.roomId = payload.room.roomId;
      }
    } else if (type === 'SESSION_RESUMED') {
      if (payload.success) {
        console.log('[Network] Session resumed successfully! Clearing offline queue.');
        this.offlineQueue = [];
        this.saveOfflineQueue();
        if (payload.sessionToken) {
          this.setSessionToken(payload.sessionToken);
        }
        if (payload.room && payload.room.roomId) {
          if (!this.lastRoomData) this.lastRoomData = {};
          this.lastRoomData.roomId = payload.room.roomId;
        }
      } else {
        console.warn('[Network] Session resumption rejected (expired). Resetting token & joining room.');
        this.setSessionToken(null);
        const fallbackRoomData = this.lastRoomData || {
          playerName: localStorage.getItem('foodmatch_player_name') || 'Шеф-Повар',
          avatar: localStorage.getItem('foodmatch_player_avatar') || '/avatars/chef_male.svg',
          roomId: 'bistro_main'
        };
        this.send('JOIN_ROOM', fallbackRoomData);
      }
    }

    this.emit(type, payload);
    this.emit('*', msg);
  }

  send(type, payload = {}) {
    const message = JSON.stringify({ type, payload });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
      return true;
    }

    // If offline, queue appropriate editable actions (e.g., recipe updates)
    if (type === 'UPDATE_RECIPE_ITEM' || type === 'UPDATE_BOARD_CARD') {
      console.warn(`[Network] Offline: buffering action ${type} in local queue.`);
      this.offlineQueue.push({
        id: `offline_act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        payload,
        queuedAt: new Date().toISOString()
      });
      this.saveOfflineQueue();
      this.emit('offline_action_queued', {
        actionType: type,
        queueLength: this.offlineQueue.length
      });
    }

    return false;
  }

  setSessionToken(token) {
    this.sessionToken = token;
    if (token) {
      sessionStorage.setItem('foodmatch_session_token', token);
      localStorage.setItem('foodmatch_session_token', token);
    } else {
      sessionStorage.removeItem('foodmatch_session_token');
      localStorage.removeItem('foodmatch_session_token');
    }
  }

  saveOfflineQueue() {
    const serialized = JSON.stringify(this.offlineQueue);
    sessionStorage.setItem('foodmatch_offline_queue', serialized);
    this.emit('queue_updated', { length: this.offlineQueue.length });
  }

  handleConnectionLoss(reason) {
    this.status = 'DISCONNECTED';
    this.emit('status_change', {
      status: this.status,
      reason,
      queueLength: this.offlineQueue.length
    });
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.isManualDisconnect) return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > this.maxReconnectAttempts) {
      console.warn('[Network] Max reconnection attempts reached.');
      return;
    }

    // Exponential backoff: min 1s, max 8s
    const delay = Math.min(1000 * Math.pow(1.3, this.reconnectAttempts), 8000);
    console.log(`[Network] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  reconnectNow() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.isManualDisconnect = false;
    this.connect();
  }

  // Debug tool to simulate sudden network disconnection (Lab Requirement 5)
  simulateDropConnection() {
    console.warn('[Network Demo] Simulating network drop...');
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Demo network drop');
      this.ws = null;
    }
    this.status = 'DISCONNECTED';
    this.emit('status_change', {
      status: 'DISCONNECTED',
      reason: 'Имитация обрыва соединения (Лабораторный тест ЛР4)',
      queueLength: this.offlineQueue.length
    });
  }

  resumeAfterSimulatedDrop() {
    console.log('[Network Demo] Resuming from simulated network drop...');
    this.isManualDisconnect = false;
    this.reconnectNow();
  }
}

export const network = new NetworkClient();
