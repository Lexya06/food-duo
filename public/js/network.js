/**
 * Network Manager: WebSocket connection, heartbeat, offline detection,
 * state persistence in localStorage, action queuing, and auto-reconnection.
 */
export class NetworkClient {
  constructor() {
    this.ws = null;
    this.sessionToken = localStorage.getItem('snapsafari_session_token') || null;
    this.offlineQueue = JSON.parse(localStorage.getItem('snapsafari_offline_queue') || '[]');
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

      // If we have an existing session token, resume it!
      if (this.sessionToken) {
        console.log('[Network] Resuming session with token:', this.sessionToken);
        this.send('RESUME_SESSION', {
          token: this.sessionToken,
          queuedActions: this.offlineQueue
        });
      } else if (roomData) {
        this.send('JOIN_ROOM', roomData);
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
    const { type, payload } = msg;

    if (type === 'INIT_STATE') {
      if (payload.sessionToken) {
        this.setSessionToken(payload.sessionToken);
      }
    } else if (type === 'SESSION_RESUMED') {
      if (payload.success) {
        console.log('[Network] Session resumed successfully! Clearing offline queue.');
        this.offlineQueue = [];
        this.persistQueue();
        this.emit('status_change', { status: 'CONNECTED', resumed: true });
      } else {
        console.warn('[Network] Session expired on server. Requesting new join.');
        this.sessionToken = null;
        localStorage.removeItem('snapsafari_session_token');
        this.emit('session_expired');
      }
    }

    // Pass message to registered handlers
    this.emit(type, payload);
    this.emit('*', msg);
  }

  send(type, payload = {}) {
    const msg = { type, payload, timestamp: Date.now() };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    } else {
      // Offline fallback: Queue modifications locally if relevant
      if (['UPDATE_BOARD_CARD'].includes(type)) {
        console.log('[Network] Queuing action while offline:', type);
        const actionItem = {
          id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type,
          payload,
          timestamp: Date.now()
        };
        this.offlineQueue.push(actionItem);
        this.persistQueue();
        this.emit('status_change', { status: this.status, queueLength: this.offlineQueue.length });
        return false;
      }
      return false;
    }
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Network] Max reconnect attempts reached.');
      return;
    }

    this.reconnectAttempts += 1;
    // Exponential backoff with jitter: 1s, 2s, 3s, max 6s
    const delay = Math.min(6000, 1000 * Math.pow(1.4, this.reconnectAttempts) + Math.random() * 500);

    console.log(`[Network] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);
    this.status = 'RECONNECTING';
    this.emit('status_change', {
      status: this.status,
      nextAttemptSec: Math.round(delay / 1000),
      attempt: this.reconnectAttempts,
      queueLength: this.offlineQueue.length
    });

    this.reconnectTimer = setTimeout(() => {
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

  // Testing helper for Lab 4 bonus evaluation
  simulateDropConnection() {
    console.warn('[Network] SIMULATING CONNECTION DROP FOR LAB EVALUATION');
    this.isManualDisconnect = true;
    if (this.ws) {
      this.ws.close(1000, 'Simulated drop');
      this.ws = null;
    }
    this.handleConnectionLoss('Имитация обрыва соединения');
  }

  setSessionToken(token) {
    this.sessionToken = token;
    localStorage.setItem('snapsafari_session_token', token);
  }

  persistQueue() {
    localStorage.setItem('snapsafari_offline_queue', JSON.stringify(this.offlineQueue));
  }
}

export const network = new NetworkClient();
