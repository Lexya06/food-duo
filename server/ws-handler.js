import { gameManager } from './game-engine.js';
import { sessionStore } from './session-store.js';
import { conflictResolver } from './conflict-resolver.js';
import { persistence } from './persistence.js';

export function setupWebSocketServer(wss) {
  // Map: socket -> meta { socketId, sessionToken, roomId, isAlive }
  const socketMeta = new Map();
  let socketCounter = 1;

  // Broadcast helper
  function broadcastToRoom(roomId, message, excludeSocket = null) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === 1 && client !== excludeSocket) {
        const meta = socketMeta.get(client);
        if (meta && meta.roomId === roomId) {
          client.send(raw);
        }
      }
    });
  }

  function broadcastToAll(message) {
    const raw = typeof message === 'string' ? message : JSON.stringify(message);
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(raw);
      }
    });
  }

  // Periodic room state sync loop (20Hz)
  setInterval(() => {
    for (const [roomId, room] of gameManager.rooms.entries()) {
      if (room.players.size > 0) {
        const snapshot = room.getSnapshot();
        broadcastToRoom(roomId, {
          type: 'SYNC_TICK',
          snapshot
        });
      }
    }
  }, 50);

  // Heartbeat ping-pong to detect abrupt connection loss
  setInterval(() => {
    wss.clients.forEach(ws => {
      const meta = socketMeta.get(ws);
      if (!meta) return;
      if (meta.isAlive === false) {
        console.log(`[WS] Terminating dead socket ${meta.socketId} (${meta.playerName})`);
        sessionStore.markDisconnected(meta.sessionToken);
        const room = gameManager.getRoom(meta.roomId);
        if (room) room.removePlayer(meta.socketId);
        socketMeta.delete(ws);
        return ws.terminate();
      }
      meta.isAlive = false;
      ws.ping();
    });
  }, 15000);

  wss.on('connection', (ws) => {
    const socketId = `sock_${socketCounter++}`;
    const meta = {
      socketId,
      sessionToken: null,
      roomId: 'safari_main',
      playerName: 'Гость',
      isAlive: true
    };
    socketMeta.set(ws, meta);

    ws.on('pong', () => {
      meta.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, meta, msg);
      } catch (err) {
        console.error('[WS] Parse message error:', err);
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Connection closed: ${meta.socketId} (${meta.playerName})`);
      if (meta.sessionToken) {
        sessionStore.markDisconnected(meta.sessionToken);
      }
      const room = gameManager.getRoom(meta.roomId);
      if (room) {
        room.removePlayer(meta.socketId);
        broadcastToRoom(meta.roomId, {
          type: 'PLAYER_LEFT',
          socketId: meta.socketId,
          playerName: meta.playerName
        });
      }
      socketMeta.delete(ws);
    });

    ws.on('error', (err) => {
      console.error(`[WS Error on ${meta.socketId}]:`, err);
    });
  });

  function handleMessage(ws, meta, msg) {
    const { type, payload = {} } = msg;

    switch (type) {
      case 'JOIN_ROOM': {
        const { token, playerName, avatar, roomId = 'safari_main' } = payload;
        meta.roomId = roomId;
        meta.playerName = playerName || 'Фотограф';

        let session;
        if (token) {
          session = sessionStore.resumeSession(token, meta.socketId);
        }

        if (!session) {
          session = sessionStore.createSession({
            token,
            playerName: meta.playerName,
            avatar,
            roomId,
            socketId: meta.socketId
          });
        } else {
          session.playerName = meta.playerName;
          session.roomId = roomId;
          if (avatar) session.avatar = avatar;
        }

        meta.sessionToken = session.token;
        persistence.getOrCreateUser(meta.playerName, avatar);

        const room = gameManager.getOrCreateRoom(roomId);
        const player = room.addPlayer(meta.socketId, session);

        // Send full init state to newly connected client
        ws.send(JSON.stringify({
          type: 'INIT_STATE',
          payload: {
            sessionToken: session.token,
            player,
            room: room.getSnapshot(),
            gallery: persistence.getGallery(),
            leaderboard: persistence.getLeaderboard(10),
            conflictAuditLog: persistence.getConflictAuditLog(10)
          }
        }));

        broadcastToRoom(roomId, {
          type: 'PLAYER_JOINED',
          payload: { player }
        }, ws);
        break;
      }

      case 'RESUME_SESSION': {
        const { token, queuedActions = [] } = payload;
        const session = sessionStore.resumeSession(token, meta.socketId);

        if (session) {
          meta.sessionToken = session.token;
          meta.playerName = session.playerName;
          meta.roomId = session.roomId;

          const room = gameManager.getOrCreateRoom(session.roomId);
          const player = room.addPlayer(meta.socketId, session);

          // Replay any queued offline actions!
          const replayedResults = [];
          for (const action of queuedActions) {
            console.log(`[WS] Replaying offline action for ${session.playerName}:`, action.type);
            if (action.type === 'UPDATE_BOARD_CARD') {
              const res = conflictResolver.resolveBoardItemEdit({
                ...action.payload,
                editorName: session.playerName
              });
              replayedResults.push({ actionId: action.id, result: res });
              if (res.success) {
                broadcastToAll({
                  type: 'BOARD_CARD_UPDATED',
                  payload: {
                    item: res.item,
                    conflict: res.conflict,
                    message: res.resolutionMessage
                  }
                });
              }
            }
          }

          ws.send(JSON.stringify({
            type: 'SESSION_RESUMED',
            payload: {
              success: true,
              sessionToken: session.token,
              player,
              room: room.getSnapshot(),
              replayedResults,
              gallery: persistence.getGallery()
            }
          }));

          broadcastToRoom(session.roomId, {
            type: 'PLAYER_RECONNECTED',
            payload: { playerName: session.playerName }
          }, ws);
        } else {
          ws.send(JSON.stringify({
            type: 'SESSION_RESUMED',
            payload: { success: false, error: 'SESSION_EXPIRED' }
          }));
        }
        break;
      }

      case 'MOVE_VIEWFINDER': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          room.updatePlayerViewfinder(meta.socketId, payload);
          sessionStore.touch(meta.sessionToken, { camera: payload });
        }
        break;
      }

      case 'SNAP_PHOTO': {
        const room = gameManager.getRoom(meta.roomId);
        if (!room) return;

        const result = room.handlePlayerSnap(meta.socketId, payload);

        if (result.success) {
          // Broadcast camera flash event to entire room
          broadcastToRoom(meta.roomId, {
            type: 'FLASH_EFFECT',
            payload: {
              x: payload.x,
              y: payload.y,
              photographer: meta.playerName,
              targetName: room.currentTarget?.name
            }
          });

          if (result.isContention) {
            broadcastToRoom(meta.roomId, {
              type: 'SNAP_CONTENTION_RESOLVED',
              payload: {
                winner: result.winner,
                assistList: result.assistList,
                message: result.message
              }
            });
          } else {
            broadcastToRoom(meta.roomId, {
              type: 'SNAP_SUCCESS',
              payload: {
                winner: result.winner,
                message: result.message
              }
            });
          }

          // Broadcast updated gallery
          broadcastToAll({
            type: 'GALLERY_UPDATED',
            payload: { gallery: persistence.getGallery() }
          });

          // Broadcast updated leaderboard
          broadcastToAll({
            type: 'LEADERBOARD_UPDATED',
            payload: { leaderboard: persistence.getLeaderboard() }
          });
        } else {
          ws.send(JSON.stringify({
            type: 'SNAP_FAILED',
            payload: result
          }));
        }
        break;
      }

      case 'UPDATE_BOARD_CARD': {
        const { id, expectedVersion, changes } = payload;
        const outcome = conflictResolver.resolveBoardItemEdit({
          id,
          expectedVersion,
          changes,
          editorName: meta.playerName
        });

        if (outcome.success) {
          broadcastToAll({
            type: outcome.conflict ? 'BOARD_CONFLICT_RESOLVED' : 'BOARD_CARD_UPDATED',
            payload: {
              item: outcome.item,
              conflict: outcome.conflict,
              resolutionMessage: outcome.resolutionMessage,
              conflictingFields: outcome.conflictingFields,
              auditRecord: outcome.auditRecord
            }
          });
        } else {
          ws.send(JSON.stringify({
            type: 'BOARD_UPDATE_FAILED',
            payload: outcome
          }));
        }
        break;
      }

      case 'DEMO_TRIGGER_CONFLICT': {
        // Lab demonstration helper: fires two conflicting concurrent edits against a target card
        const cardId = payload.cardId || 'photo_init_1';
        const card = persistence.getGalleryItem(cardId);
        if (!card) return;

        const baseVersion = card.version;

        // Edit 1: Bot Alice updates caption and sticker
        const editAlice = conflictResolver.resolveBoardItemEdit({
          id: cardId,
          expectedVersion: baseVersion,
          changes: { caption: 'Версия от Алисы: лучший ракурс!', sticker: '🔥' },
          editorName: 'Алиса (Бот)'
        });

        // Edit 2: Simultaneous incoming edit from player with SAME baseVersion
        const editUser = conflictResolver.resolveBoardItemEdit({
          id: cardId,
          expectedVersion: baseVersion, // Intentionally outdated version!
          changes: { caption: 'Версия от игрока: супер фокус!', filter: 'cyberpunk' },
          editorName: meta.playerName
        });

        broadcastToAll({
          type: 'BOARD_CONFLICT_RESOLVED',
          payload: {
            item: editUser.item,
            conflict: true,
            resolutionMessage: editUser.resolutionMessage,
            conflictingFields: editUser.conflictingFields,
            auditRecord: editUser.auditRecord,
            demoNotice: '🧪 ДЕМОНСТРАЦИЯ КОНФЛИКТА: смоделировано одновременное редактирование карточки двумя пользователями!'
          }
        });
        break;
      }

      case 'RESET_DATA': {
        persistence.resetDemoData();
        broadcastToAll({
          type: 'DATA_RESET',
          payload: {
            gallery: persistence.getGallery(),
            leaderboard: persistence.getLeaderboard(),
            conflictAuditLog: persistence.getConflictAuditLog()
          }
        });
        break;
      }

      case 'GET_AUDIT_LOG': {
        ws.send(JSON.stringify({
          type: 'AUDIT_LOG_RESULT',
          payload: {
            auditLog: persistence.getConflictAuditLog(30)
          }
        }));
        break;
      }

      default:
        console.warn(`[WS] Unknown message type: ${type}`);
    }
  }
}
