import { gameManager } from './game-engine.js';
import { sessionStore } from './session-store.js';
import { conflictResolver } from './conflict-resolver.js';
import { persistence, DEFAULT_AVATAR, normalizeAvatarPath, isTestPlayerName, isTestRoom } from './persistence.js';

export function setupWebSocketServer(wss) {
  // Map: socket -> meta { socketId, sessionToken, roomId, playerName, isAlive }
  const socketMeta = new Map();
  let socketCounter = 1;

  function ensureRoomHooks(room) {
    if (!room) return;
    if (!room.onCardsUnflipped) {
      room.onCardsUnflipped = (rId, cardIndices) => {
        broadcastToRoom(rId, {
          type: 'CARDS_UNFLIPPED',
          payload: { cardIndices }
        });
      };
    }
    if (!room.onRoundCompleted) {
      room.onRoundCompleted = (rId, data) => {
        broadcastToRoom(rId, {
          type: 'ROUND_COMPLETED',
          payload: {
            ...data.winnerInfo,
            room: data.room,
            roomLeaderboard: data.room ? data.room.roomLeaderboard : []
          }
        });
        broadcastToAll({
          type: 'LEADERBOARD_UPDATED',
          payload: {
            leaderboard: persistence.getLeaderboard(10)
          }
        });
      };
    }
    if (!room.onRoundStarted) {
      room.onRoundStarted = (rId, snapshot) => {
        broadcastToRoom(rId, {
          type: 'ROUND_STARTED',
          payload: { room: snapshot }
        });
      };
    }
  }

  for (const r of gameManager.rooms.values()) {
    ensureRoomHooks(r);
  }

  // Broadcast helpers
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

  // Periodic room state sync loop (1Hz)
  setInterval(() => {
    for (const [roomId, room] of gameManager.rooms.entries()) {
      if (room.players.size > 0) {
        const snapshot = room.getSnapshot();
        broadcastToRoom(roomId, {
          type: 'SYNC_TICK',
          payload: {
            snapshot
          }
        });
      }
    }
  }, 1000);

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
      roomId: 'bistro_main',
      playerName: 'Шеф-Повар',
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
      if (meta.isSuperseded) {
        socketMeta.delete(ws);
        return;
      }
      if (meta.sessionToken) {
        sessionStore.markDisconnected(meta.sessionToken);
      }
      const room = gameManager.getRoom(meta.roomId);
      if (room) {
        const removed = room.removePlayer(meta.socketId);
        if (removed) {
          broadcastToRoom(meta.roomId, {
            type: 'PLAYER_LEFT',
            payload: {
              socketId: meta.socketId,
              playerName: meta.playerName,
              players: room.getSnapshot().players,
              playersCount: room.players.size,
              isPaused: room.isPaused,
              pauseReason: room.pauseReason
            }
          });

          if (room.isPaused) {
            broadcastToRoom(meta.roomId, {
              type: 'GAME_PAUSED',
              payload: {
                reason: room.pauseReason,
                room: room.getSnapshot()
              }
            });
          }
        }
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
        const { token, authToken, playerName, avatar, roomId = 'bistro_main' } = payload;
        meta.roomId = roomId;

        let authUser = null;
        if (authToken) {
          authUser = persistence.getUserByAuthToken(authToken);
        }

        if (authUser) {
          meta.playerName = authUser.name;
          meta.avatar = normalizeAvatarPath(authUser.avatar);
          meta.userId = authUser.id;
        } else {
          meta.playerName = (playerName || 'Шеф-Повар').trim().slice(0, 16);
          const dbUser = persistence.getUser(meta.playerName);
          meta.avatar = (dbUser && normalizeAvatarPath(dbUser.avatar)) || normalizeAvatarPath(avatar);
        }

        let session;
        if (token) {
          session = sessionStore.resumeSession(token, meta.socketId);
        }

        if (!session && meta.playerName) {
          session = sessionStore.findSessionByPlayerName(meta.playerName, roomId);
          if (session) {
            session = sessionStore.resumeSession(session.token, meta.socketId);
          }
        }

        // Matchmaking: Find available room with < 8 players or create Table 2, Table 3...
        const room = gameManager.findAvailableRoom(session ? session.roomId : roomId, meta.playerName, token);
        ensureRoomHooks(room);
        const resolvedRoomId = room.roomId;
        meta.roomId = resolvedRoomId;

        if (!session) {
          const dbUser = persistence.getUser(meta.playerName);
          const initialScore = authUser ? (authUser.totalScore || 0) : (dbUser ? (dbUser.totalScore || 0) : 0);
          session = sessionStore.createSession({
            token,
            playerName: meta.playerName,
            avatar: meta.avatar,
            roomId: resolvedRoomId,
            socketId: meta.socketId,
            score: initialScore
          });
        } else {
          session.playerName = meta.playerName;
          session.roomId = resolvedRoomId;
          session.avatar = meta.avatar;
          session.socketId = meta.socketId;
          sessionStore.touch(session.token, { playerName: meta.playerName, avatar: meta.avatar, socketId: meta.socketId });
        }

        meta.sessionToken = session.token;
        const player = room.addPlayer(meta.socketId, session);

        // Prevent tab duplication: mark prior superseded socket for this same user in this room
        for (const [otherWs, otherMeta] of socketMeta.entries()) {
          if (otherWs !== ws && otherMeta.roomId === resolvedRoomId) {
            const isGeneric = (player.name || '').trim().toLowerCase() === 'шеф-повар';
            const sameUser = !isGeneric && otherMeta.playerName && (otherMeta.playerName.trim().toLowerCase() === player.name.trim().toLowerCase());
            const sameToken = session.token && otherMeta.sessionToken === session.token;
            if (sameUser || sameToken) {
              otherMeta.isSuperseded = true;
            }
          }
        }

        meta.playerName = player.name;
        session.playerName = player.name;
        sessionStore.touch(session.token, {
          playerName: player.name,
          score: player.score,
          roundScore: player.roundScore,
          roundPairs: player.roundPairs,
          comboStreak: player.comboStreak,
          roundDiscoveredRecipes: player.roundDiscoveredRecipes
        });
        if (authUser || isTestPlayerName(player.name) || isTestRoom(roomId)) {
          persistence.getOrCreateUser(player.name, player.avatar);
        }

        // Send full init state to newly connected client
        ws.send(JSON.stringify({
          type: 'INIT_STATE',
          payload: {
            sessionToken: session.token,
            player,
            authUser: authUser || null,
            room: room.getSnapshot(),
            recipeBook: persistence.getRecipeBook(),
            gallery: persistence.getRecipeBook(), // compatibility
            leaderboard: persistence.getLeaderboard(10),
            conflictAuditLog: persistence.getConflictAuditLog(15)
          }
        }));

        broadcastToRoom(roomId, {
          type: 'PLAYER_JOINED',
          payload: {
            player,
            players: room.getSnapshot().players,
            playersCount: room.players.size,
            room: room.getSnapshot()
          }
        }, ws);

        if (!room.isPaused) {
          broadcastToRoom(roomId, {
            type: 'GAME_RESUMED',
            payload: {
              room: room.getSnapshot()
            }
          });
        } else {
          broadcastToRoom(roomId, {
            type: 'GAME_PAUSED',
            payload: {
              reason: room.pauseReason,
              room: room.getSnapshot()
            }
          });
        }
        break;
      }

      case 'RESUME_SESSION': {
        const { token, authToken, queuedActions = [], playerName, avatar, roomId = 'bistro_main' } = payload;
        let session = token ? sessionStore.resumeSession(token, meta.socketId) : null;

        let authUser = null;
        if (authToken) {
          authUser = persistence.getUserByAuthToken(authToken);
        }

        const resolvedName = authUser ? authUser.name : (playerName || meta.playerName || 'Шеф-Повар').trim().slice(0, 16);
        const dbUser = persistence.getUser(resolvedName);
        const resolvedAvatar = authUser ? normalizeAvatarPath(authUser.avatar) : ((dbUser && normalizeAvatarPath(dbUser.avatar)) || normalizeAvatarPath(avatar) || normalizeAvatarPath(meta.avatar));

        if (!session) {
          session = sessionStore.findSessionByPlayerName(resolvedName, roomId);
          if (session) {
            session = sessionStore.resumeSession(session.token, meta.socketId);
          }
        }

        // Matchmaking: Find available room or reconnect to existing room
        const room = gameManager.findAvailableRoom(session ? session.roomId : roomId, resolvedName, token);
        ensureRoomHooks(room);
        const resolvedRoomId = room.roomId;

        if (!session) {
          // If server was restarted or session expired, seamlessly re-create session for player
          const dbUser = persistence.getUser(resolvedName);
          const initialScore = authUser ? (authUser.totalScore || 0) : (dbUser ? (dbUser.totalScore || 0) : 0);
          session = sessionStore.createSession({
            token,
            playerName: resolvedName,
            avatar: resolvedAvatar,
            roomId: resolvedRoomId,
            socketId: meta.socketId,
            score: initialScore
          });
        }

        if (authUser) {
          meta.userId = authUser.id;
          session.playerName = authUser.name;
          session.avatar = authUser.avatar;
        } else {
          session.playerName = resolvedName;
          session.avatar = resolvedAvatar;
        }

        meta.sessionToken = session.token;
        meta.playerName = session.playerName;
        meta.roomId = resolvedRoomId;
        session.roomId = resolvedRoomId;

        const player = room.addPlayer(meta.socketId, session);

        // Prevent tab duplication: mark prior superseded socket for this same user in this room
        for (const [otherWs, otherMeta] of socketMeta.entries()) {
          if (otherWs !== ws && otherMeta.roomId === resolvedRoomId) {
            const isGeneric = (player.name || '').trim().toLowerCase() === 'шеф-повар';
            const sameUser = !isGeneric && otherMeta.playerName && (otherMeta.playerName.trim().toLowerCase() === player.name.trim().toLowerCase());
            const sameToken = session.token && otherMeta.sessionToken === session.token;
            if (sameUser || sameToken) {
              otherMeta.isSuperseded = true;
            }
          }
        }

        meta.playerName = player.name;
        session.playerName = player.name;
        sessionStore.touch(session.token, {
          playerName: player.name,
          score: player.score,
          roundScore: player.roundScore,
          roundPairs: player.roundPairs,
          comboStreak: player.comboStreak,
          roundDiscoveredRecipes: player.roundDiscoveredRecipes
        });
        if (authUser || isTestPlayerName(player.name) || isTestRoom(roomId)) {
          persistence.getOrCreateUser(player.name, player.avatar);
        }

        // Replay any queued offline actions if applicable
        const replayedResults = [];
        for (const action of queuedActions) {
          // Process offline queue safely
        }

        ws.send(JSON.stringify({
          type: 'SESSION_RESUMED',
          payload: {
            success: true,
            sessionToken: session.token,
            player,
            authUser: authUser || null,
            room: room.getSnapshot(),
            replayedResults,
            recipeBook: persistence.getRecipeBook(),
            gallery: persistence.getRecipeBook(),
            leaderboard: persistence.getLeaderboard(10),
            conflictAuditLog: persistence.getConflictAuditLog(15)
          }
        }));

        broadcastToRoom(session.roomId, {
          type: 'PLAYER_RECONNECTED',
          payload: {
            playerName: session.playerName,
            player,
            players: room.getSnapshot().players,
            playersCount: room.players.size,
            room: room.getSnapshot()
          }
        }, ws);

        if (!room.isPaused) {
          broadcastToRoom(session.roomId, {
            type: 'GAME_RESUMED',
            payload: {
              room: room.getSnapshot()
            }
          });
        } else {
          broadcastToRoom(session.roomId, {
            type: 'GAME_PAUSED',
            payload: {
              reason: room.pauseReason,
              room: room.getSnapshot()
            }
          });
        }
        break;
      }

      case 'REGISTER': {
        const { username, password, avatar, avatarData } = payload;
        const regResult = persistence.registerUser(username, password, avatarData || avatar || meta.avatar);
        if (!regResult.success) {
          ws.send(JSON.stringify({
            type: 'AUTH_ERROR',
            payload: { message: regResult.message }
          }));
          return;
        }

        const user = regResult.user;
        const authToken = persistence.createAuthToken(user.name);
        meta.playerName = user.name;
        meta.avatar = user.avatar;
        meta.userId = user.id;

        const room = gameManager.getRoom(meta.roomId);
        let updatedPlayer = null;
        if (room && room.players.has(meta.socketId)) {
          updatedPlayer = room.updatePlayerProfile(meta.socketId, {
            playerName: user.name,
            avatar: user.avatar
          });
          broadcastToRoom(meta.roomId, {
            type: 'PLAYER_UPDATED',
            payload: {
              player: updatedPlayer,
              players: room.getSnapshot().players,
              playersCount: room.players.size,
              room: room.getSnapshot()
            }
          });
        }

        if (meta.sessionToken) {
          sessionStore.touch(meta.sessionToken, {
            playerName: user.name,
            avatar: user.avatar
          });
        }

        ws.send(JSON.stringify({
          type: 'AUTH_SUCCESS',
          payload: {
            user,
            authToken,
            player: updatedPlayer,
            message: `Добро пожаловать, ${user.name}! Вы успешно зарегистрированы.`
          }
        }));

        broadcastToAll({
          type: 'LEADERBOARD_UPDATED',
          payload: {
            leaderboard: persistence.getLeaderboard(10)
          }
        });
        break;
      }

      case 'LOGIN': {
        const { username, password } = payload;
        const authResult = persistence.authenticateUser(username, password);
        if (!authResult.success) {
          ws.send(JSON.stringify({
            type: 'AUTH_ERROR',
            payload: { message: authResult.message }
          }));
          return;
        }

        const user = authResult.user;
        const authToken = persistence.createAuthToken(user.name);
        meta.playerName = user.name;
        meta.avatar = user.avatar;
        meta.userId = user.id;

        if (meta.sessionToken) {
          sessionStore.touch(meta.sessionToken, {
            playerName: user.name,
            avatar: user.avatar
          });
        }

        const room = gameManager.getRoom(meta.roomId);
        let updatedPlayer = null;
        if (room) {
          // Check if user already had a player seat in this room
          let existing = room.players.get(meta.socketId);
          if (!existing) {
            for (const [key, p] of room.players.entries()) {
              if (p.name && p.name.trim().toLowerCase() === user.name.trim().toLowerCase()) {
                existing = p;
                room.players.delete(key);
                room.players.set(meta.socketId, existing);
                break;
              }
            }
          }

          if (existing) {
            existing.socketId = meta.socketId;
            existing.isOnline = true;
            existing.isAway = false;
            existing.disconnectedAt = null;
            existing.name = user.name;
            existing.avatar = user.avatar;
            const dbUser = persistence.getUser(user.name);
            if (dbUser) {
              existing.score = Math.max(existing.score || 0, dbUser.totalScore || 0);
            }
            updatedPlayer = existing;
          } else {
            const session = meta.sessionToken ? sessionStore.getSession(meta.sessionToken) : null;
            updatedPlayer = room.addPlayer(meta.socketId, session || {
              token: meta.sessionToken,
              playerName: user.name,
              avatar: user.avatar,
              roomId: meta.roomId,
              score: user.totalScore || 0
            });
          }

          // When this player logs back in, unpause the room if all players are online!
          const offline = [...room.players.values()].filter(x => x.isOnline === false || x.isAway);
          if (offline.length === 0) {
            room.setPaused(false, null);
          } else {
            const reason = room.pauseReason || '';
            if (reason.includes(user.name) || reason.includes('вышел из игры') || reason.includes('Шеф-повар')) {
              const otherOffline = offline.filter(x => x.name.toLowerCase() !== user.name.toLowerCase());
              if (otherOffline.length === 0) {
                room.setPaused(false, null);
              } else {
                const missingNames = otherOffline.map(x => x.name).join(', ');
                room.setPaused(true, `Связь с игроком «${missingNames}» прервана. Игра приостановлена. Ожидание переподключения...`);
              }
            }
          }
          room.saveStateToPersistence();
          broadcastToRoom(meta.roomId, {
            type: 'PLAYER_UPDATED',
            payload: {
              player: updatedPlayer,
              players: room.getSnapshot().players,
              playersCount: room.players.size,
              room: room.getSnapshot()
            }
          });
          if (!room.isPaused) {
            broadcastToRoom(meta.roomId, {
              type: 'GAME_RESUMED',
              payload: { room: room.getSnapshot() }
            });
          } else {
            broadcastToRoom(meta.roomId, {
              type: 'GAME_PAUSED',
              payload: {
                reason: room.pauseReason,
                room: room.getSnapshot()
              }
            });
          }
        }

        if (meta.sessionToken) {
          sessionStore.touch(meta.sessionToken, {
            playerName: user.name,
            avatar: user.avatar,
            score: updatedPlayer?.score
          });
        }

        ws.send(JSON.stringify({
          type: 'AUTH_SUCCESS',
          payload: {
            user,
            authToken,
            player: updatedPlayer,
            message: `С возвращением, ${user.name}!`
          }
        }));

        broadcastToAll({
          type: 'LEADERBOARD_UPDATED',
          payload: {
            leaderboard: persistence.getLeaderboard(10)
          }
        });
        break;
      }

      case 'LOGOUT': {
        const { authToken } = payload;
        const exitingName = (meta.playerName && meta.playerName !== 'Шеф-Повар')
          ? meta.playerName
          : (meta.playerName || 'Игрок');
        if (authToken) {
          persistence.revokeAuthToken(authToken);
        }
        meta.userId = null;
        meta.playerName = 'Шеф-Повар';
        meta.avatar = DEFAULT_AVATAR;

        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          room.removePlayer(meta.socketId);
          if (room.roundState === 'ACTIVE') {
            room.setPaused(true, `Игрок «${exitingName}» вышел из игры. Время игры приостановлено.`);
          }
          broadcastToRoom(meta.roomId, {
            type: 'PLAYER_LEFT',
            payload: {
              socketId: meta.socketId,
              playerName: exitingName,
              players: room.getSnapshot().players,
              playersCount: room.players.size,
              isPaused: room.isPaused,
              pauseReason: room.pauseReason
            }
          });
          broadcastToRoom(meta.roomId, {
            type: 'GAME_PAUSED',
            payload: {
              reason: room.pauseReason,
              room: room.getSnapshot()
            }
          });
        }

        ws.send(JSON.stringify({
          type: 'LOGOUT_SUCCESS',
          payload: {
            player: null
          }
        }));
        break;
      }

      case 'VALIDATE_AUTH_TOKEN': {
        const { authToken } = payload;
        const user = persistence.getUserByAuthToken(authToken);
        if (user) {
          meta.playerName = user.name;
          meta.avatar = user.avatar;
          meta.userId = user.id;

          const room = gameManager.getRoom(meta.roomId);
          let updatedPlayer = null;
          if (room) {
            updatedPlayer = room.updatePlayerProfile(meta.socketId, {
              playerName: user.name,
              avatar: user.avatar
            });
            const dbUser = persistence.getUser(user.name);
            if (dbUser && updatedPlayer) {
              updatedPlayer.score = Math.max(updatedPlayer.score || 0, dbUser.totalScore || 0);
            }
            room.saveStateToPersistence();
            broadcastToRoom(meta.roomId, {
              type: 'PLAYER_UPDATED',
              payload: {
                player: updatedPlayer,
                players: room.getSnapshot().players,
                playersCount: room.players.size,
                room: room.getSnapshot()
              }
            });
          }

          if (meta.sessionToken) {
            sessionStore.touch(meta.sessionToken, {
              playerName: user.name,
              avatar: user.avatar,
              score: updatedPlayer?.score
            });
          }

          ws.send(JSON.stringify({
            type: 'AUTH_SUCCESS',
            payload: {
              user,
              authToken,
              player: updatedPlayer
            }
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'AUTH_INVALID',
            payload: {}
          }));
        }
        break;
      }

      case 'DELETE_ACCOUNT': {
        const { authToken } = payload;
        let usernameToDelete = null;

        if (authToken) {
          const authUser = persistence.getUserByAuthToken(authToken);
          if (authUser) {
            usernameToDelete = authUser.name;
          }
        }

        if (!usernameToDelete && meta.userId) {
          usernameToDelete = meta.playerName;
        }

        if (!usernameToDelete && meta.playerName) {
          usernameToDelete = meta.playerName;
        }

        if (!usernameToDelete) {
          ws.send(JSON.stringify({
            type: 'DELETE_ACCOUNT_ERROR',
            payload: { message: 'Не удалось определить аккаунт для удаления' }
          }));
          return;
        }

        const deleteResult = persistence.deleteUser(usernameToDelete);
        if (!deleteResult.success) {
          ws.send(JSON.stringify({
            type: 'DELETE_ACCOUNT_ERROR',
            payload: { message: deleteResult.message }
          }));
          return;
        }

        if (authToken) {
          persistence.revokeAuthToken(authToken);
        }

        sessionStore.removeSessionsByPlayerName(usernameToDelete);

        if (meta.sessionToken) {
          sessionStore.removeSession(meta.sessionToken);
          meta.sessionToken = null;
        }

        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          room.removePlayer(meta.socketId);
          broadcastToRoom(meta.roomId, {
            type: 'PLAYER_LEFT',
            payload: {
              socketId: meta.socketId,
              playerName: usernameToDelete,
              players: room.getSnapshot().players,
              playersCount: room.players.size,
              isPaused: room.isPaused,
              pauseReason: room.pauseReason
            }
          });
        }

        meta.userId = null;
        meta.playerName = 'Шеф-Повар';
        meta.avatar = DEFAULT_AVATAR;

        ws.send(JSON.stringify({
          type: 'ACCOUNT_DELETED',
          payload: {
            message: `Аккаунт «${usernameToDelete}» успешно удален.`
          }
        }));

        broadcastToAll({
          type: 'LEADERBOARD_UPDATED',
          payload: {
            leaderboard: persistence.getLeaderboard(10)
          }
        });
        break;
      }

      case 'GET_USER_PROFILE': {
        const { authToken, playerName } = payload;
        let user = null;
        if (authToken) {
          user = persistence.getUserByAuthToken(authToken);
        }
        if (!user && (playerName || meta.playerName)) {
          const rawUser = persistence.getUser(playerName || meta.playerName);
          user = persistence.sanitizeUser(rawUser);
        }

        const room = gameManager.getRoom(meta.roomId);
        const playerInRoom = room ? room.players.get(meta.socketId) : null;

        ws.send(JSON.stringify({
          type: 'USER_PROFILE_RESULT',
          payload: {
            user: user || null,
            currentGameScore: playerInRoom ? (playerInRoom.roundScore || 0) : 0,
            currentGamePairs: playerInRoom ? (playerInRoom.roundPairs || 0) : 0
          }
        }));
        break;
      }

      case 'FLIP_CARD': {
        const room = gameManager.getRoom(meta.roomId);
        if (!room) return;

        const { cardIndex } = payload;
        const result = room.handleCardFlip(meta.socketId, cardIndex);

        if (!result.success) {
          if (result.isContention) {
            // Collision race event: another player flipped it first
            ws.send(JSON.stringify({
              type: 'CARD_COLLISION_RESOLVED',
              payload: {
                cardIndex,
                winner: result.winner.playerName,
                timeDeltaMs: result.timeDeltaMs,
                message: result.message
              }
            }));
            // Broadcast audit log update
            broadcastToAll({
              type: 'AUDIT_LOG_UPDATED',
              payload: { auditLog: persistence.getConflictAuditLog(15) }
            });
          } else {
            ws.send(JSON.stringify({
              type: 'FLIP_REJECTED',
              payload: { cardIndex, reason: result.reason }
            }));
          }
          return;
        }

        if (result.type === 'SINGLE_FLIP') {
          broadcastToRoom(meta.roomId, {
            type: 'CARD_FLIPPED',
            payload: {
              ...result.flipEvent,
              actorSocketId: meta.socketId
            }
          });
          broadcastToAll({
            type: 'LEADERBOARD_UPDATED',
            payload: { leaderboard: persistence.getLeaderboard(10) }
          });
        } else if (result.type === 'MATCH') {
          // Broadcast card flip of the 2nd card + match celebration!
          broadcastToRoom(meta.roomId, {
            type: 'PAIR_MATCHED',
            payload: {
              cardIndices: result.cardIndices,
              cards: result.cards,
              matchedPair: result.matchedPair,
              matchedFood: result.matchedFood,
              player: result.player,
              players: room.getSnapshot().players,
              scoreDelta: result.scoreDelta,
              remainingPairs: result.remainingPairs,
              flipEvent: result.flipEvent
            }
          });

          if (meta.sessionToken && result.player) {
            sessionStore.touch(meta.sessionToken, {
              score: result.player.score,
              roundScore: result.player.roundScore,
              roundPairs: result.player.roundPairs,
              comboStreak: result.player.comboStreak,
              roundDiscoveredRecipes: result.player.roundDiscoveredRecipes
            });
          }

          // Broadcast updated recipe book & leaderboard
          broadcastToAll({
            type: 'RECIPE_BOOK_UPDATED',
            payload: { recipeBook: persistence.getRecipeBook() }
          });
          broadcastToAll({
            type: 'LEADERBOARD_UPDATED',
            payload: { leaderboard: persistence.getLeaderboard(10) }
          });
        } else if (result.type === 'MISMATCH') {
          broadcastToRoom(meta.roomId, {
            type: 'PAIR_MISMATCH',
            payload: {
              cardIndices: result.cardIndices,
              cards: result.cards,
              player: result.player,
              players: room.getSnapshot().players,
              flipEvent: result.flipEvent
            }
          });
        }
        break;
      }

      case 'UPDATE_PROFILE': {
        const { playerName, avatar, avatarData } = payload;
        const cleanName = (playerName || meta.playerName || 'Шеф-Повар').trim().slice(0, 16);
        const inputAvatar = avatarData || avatar;
        const cleanAvatar = persistence.processAvatar(inputAvatar || meta.avatar, cleanName);

        meta.playerName = cleanName;
        meta.avatar = cleanAvatar;

        if (meta.sessionToken) {
          const session = sessionStore.getSession(meta.sessionToken);
          if (session) {
            session.playerName = cleanName;
            session.avatar = cleanAvatar;
            sessionStore.touch(meta.sessionToken, { playerName: cleanName, avatar: cleanAvatar });
          }
        }

        if (meta.userId || isTestPlayerName(cleanName) || isTestRoom(meta.roomId)) {
          persistence.getOrCreateUser(cleanName, cleanAvatar);
          persistence.updateUserAvatar(cleanName, cleanAvatar);
          if (meta.userId) {
            persistence.updateUserAvatar(meta.userId, cleanAvatar);
          }
        }

        const room = gameManager.getRoom(meta.roomId);
        let updatedPlayer = null;
        if (room) {
          updatedPlayer = room.updatePlayerProfile(meta.socketId, { playerName: cleanName, avatar: cleanAvatar });
          broadcastToRoom(meta.roomId, {
            type: 'PLAYER_UPDATED',
            payload: {
              player: updatedPlayer,
              players: room.getSnapshot().players,
              playersCount: room.players.size
            }
          });
        }

        const freshUser = persistence.getUser(cleanName);
        ws.send(JSON.stringify({
          type: 'PROFILE_UPDATED',
          payload: {
            success: true,
            player: updatedPlayer,
            user: freshUser ? persistence.sanitizeUser(freshUser) : null,
            sessionToken: meta.sessionToken
          }
        }));
        break;
      }

      case 'MOVE_CURSOR': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          room.updatePlayerCursor(meta.socketId, payload);
        }
        break;
      }

      case 'PLAYER_AWAY': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          const reason = payload?.reason || `Игрок «${meta.playerName}» свернул окно или отошел. Время игры приостановлено.`;
          room.setPlayerAway(meta.socketId, true, reason);
          if (room.isPaused) {
            broadcastToRoom(meta.roomId, {
              type: 'GAME_PAUSED',
              payload: {
                reason: room.pauseReason,
                room: room.getSnapshot()
              }
            });
          }
        }
        break;
      }

      case 'PLAYER_BACK': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          room.setPlayerAway(meta.socketId, false);
          if (!room.isPaused) {
            broadcastToRoom(meta.roomId, {
              type: 'GAME_RESUMED',
              payload: {
                room: room.getSnapshot()
              }
            });
          }
        }
        break;
      }

      case 'PAUSE_GAME': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          const reason = payload?.reason || `Игрок «${meta.playerName}» поставил игру на паузу. Время игры приостановлено.`;
          room.setPaused(true, reason);
          broadcastToRoom(meta.roomId, {
            type: 'GAME_PAUSED',
            payload: {
              reason: room.pauseReason,
              room: room.getSnapshot()
            }
          });
        }
        break;
      }

      case 'RESUME_GAME': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          room.setPlayerAway(meta.socketId, false);
          const offlineOrAway = [...room.players.values()].filter(x => x.isOnline === false || x.isAway);
          if (offlineOrAway.length === 0) {
            room.setPaused(false);
            broadcastToRoom(meta.roomId, {
              type: 'GAME_RESUMED',
              payload: {
                room: room.getSnapshot()
              }
            });
          }
        }
        break;
      }

      case 'DEMO_RACE_COLLISION': {
        // Lab 4 Demonstration: Simultaneous click race on the same card with 14.2ms delta
        const targetIndex = payload.cardIndex !== undefined ? payload.cardIndex : 2;
        const nowHr = process.hrtime.bigint();
        const deltaNs = 14_250_000n; // 14.25 ms

        const candidateAlice = {
          socketId: 'sock_bot_alice',
          playerName: 'Алиса (Шеф-Бот)',
          arrivedAtHr: nowHr
        };

        const candidatePlayer = {
          socketId: meta.socketId,
          playerName: meta.playerName,
          arrivedAtHr: nowHr + deltaNs
        };

        // Reset window to guarantee clean collision demonstration
        conflictResolver.clearRoomContention(meta.roomId);
        conflictResolver.evaluateCardFlipContention({
          roomId: meta.roomId,
          cardIndex: targetIndex,
          candidateFlip: candidateAlice
        });

        const contentionResult = conflictResolver.evaluateCardFlipContention({
          roomId: meta.roomId,
          cardIndex: targetIndex,
          candidateFlip: candidatePlayer
        });

        broadcastToAll({
          type: 'CARD_COLLISION_RESOLVED',
          payload: {
            cardIndex: targetIndex,
            winner: contentionResult.winner.playerName,
            timeDeltaMs: contentionResult.timeDeltaMs,
            message: contentionResult.message,
            auditRecord: contentionResult.auditRecord,
            demoNotice: `⚡ ДЕМОНСТРАЦИЯ АРБИТРАЖА: Алиса опередила ${meta.playerName} на ${contentionResult.timeDeltaMs.toFixed(1)} мс!`
          }
        });

        broadcastToAll({
          type: 'AUDIT_LOG_UPDATED',
          payload: { auditLog: persistence.getConflictAuditLog(20) }
        });
        break;
      }

      case 'RESTART_ROUND':
      case 'START_NEW_ROUND': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          const res = room.requestRestart(meta.socketId);
          if (res.roundStarted) {
            broadcastToRoom(meta.roomId, {
              type: 'ROUND_STARTED',
              payload: { room: room.getSnapshot() }
            });
          } else {
            broadcastToRoom(meta.roomId, {
              type: 'RESTART_VOTE_UPDATED',
              payload: {
                readyCount: res.readyCount,
                totalNeeded: res.totalNeeded,
                readyPlayerNames: res.readyPlayerNames,
                voterSocketId: meta.socketId,
                voterName: meta.playerName,
                room: room.getSnapshot()
              }
            });
          }
        }
        break;
      }

      case 'ABORT_AND_RESTART_ROUND': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          // Remove disconnected/offline/away players who left so they don't block the new game
          for (const [key, p] of room.players.entries()) {
            if (p.isOnline === false || p.isAway) {
              room.players.delete(key);
              room.restartVotes.delete(key);
            }
          }
          room.restartVotes.clear();
          room.startNewRound(true);
          room.setPaused(false, null);
          room.saveStateToPersistence();

          broadcastToRoom(meta.roomId, {
            type: 'ROUND_STARTED',
            payload: { room: room.getSnapshot() }
          });
          broadcastToRoom(meta.roomId, {
            type: 'GAME_RESUMED',
            payload: { room: room.getSnapshot() }
          });
          console.log(`[GameRoom ${meta.roomId}] Round aborted and new round started by ${meta.playerName}. Active players: ${room.players.size}`);
        }
        break;
      }

      case 'RESET_DATA': {
        persistence.resetDemoData();
        broadcastToAll({
          type: 'DATA_RESET',
          payload: {
            recipeBook: persistence.getRecipeBook(),
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

      case 'PING': {
        ws.send(JSON.stringify({
          type: 'PONG',
          payload: {
            clientTime: payload?.clientTime || Date.now(),
            serverTime: Date.now()
          }
        }));
        break;
      }

      case 'REQUEST_ROOM_SYNC': {
        const room = gameManager.getRoom(meta.roomId);
        if (room) {
          ws.send(JSON.stringify({
            type: 'ROOM_SYNC_RESULT',
            payload: {
              room: room.getSnapshot(),
              serverTime: Date.now()
            }
          }));
        }
        break;
      }

      default:
        console.warn(`[WS] Unknown message type: ${type}`);
    }
  }
}
