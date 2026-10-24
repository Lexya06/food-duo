import './setup-test-env.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { gameManager } from '../server/game-engine.js';
import { persistence } from '../server/persistence.js';
import { sessionStore } from '../server/session-store.js';

function waitForMessage(ws, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timed out waiting for message of type ${type}`));
    }, 5000);

    const handler = (d) => {
      try {
        const msg = JSON.parse(d.toString());
        if (msg.type === type) {
          clearTimeout(timeout);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (e) {}
    };
    ws.on('message', handler);
  });
}

async function testNewFeatures() {
  console.log('🧪 ============================================================');
  console.log('🧪  Test: Current Game Scores, Profile Stats, Delete Account & Leaderboards');
  console.log('🧪 ============================================================\n');

  const roomId = 'test_scores_room';
  persistence.clearRoomState(roomId);
  gameManager.rooms.delete(roomId);

  // Clean up test users
  persistence.deleteUser('ТестШеф1');
  persistence.deleteUser('ТестШеф2');
  sessionStore.removeSessionsByPlayerName('ТестШеф1');
  sessionStore.removeSessionsByPlayerName('ТестШеф2');

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  setupWebSocketServer(wss);

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const wsUrl = `ws://localhost:${port}`;
  console.log(`[Test Server] Started on port ${port}`);

  try {
    // --- Step 1: Register User 1 ---
    console.log('\n--- Step 1: Register and Authenticate User 1 ---');
    const ws1 = new WebSocket(wsUrl);
    await new Promise(r => ws1.on('open', r));

    const reg1Promise = waitForMessage(ws1, 'AUTH_SUCCESS');
    ws1.send(JSON.stringify({
      type: 'REGISTER',
      payload: { username: 'ТестШеф1', password: 'password123', avatar: '/avatars/pizza.svg' }
    }));

    const regMsg = await reg1Promise;
    const authToken1 = regMsg.payload.authToken;
    console.log(`✅ User 1 registered: ${regMsg.payload.user.name}, Token: ${authToken1}`);

    // Join room with token
    const join1Promise = waitForMessage(ws1, 'INIT_STATE');
    ws1.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { authToken: authToken1, roomId }
    }));

    const init1 = await join1Promise;
    console.log(`✅ Joined room: ${roomId}, initial roundScore: ${init1.payload.player.roundScore}`);
    if (init1.payload.player.roundScore !== 0) throw new Error('Expected initial roundScore to be 0');

    // --- Step 2: Register User 2 ---
    console.log('\n--- Step 2: Register and Connect User 2 ---');
    const ws2 = new WebSocket(wsUrl);
    await new Promise(r => ws2.on('open', r));

    const reg2Promise = waitForMessage(ws2, 'AUTH_SUCCESS');
    ws2.send(JSON.stringify({
      type: 'REGISTER',
      payload: { username: 'ТестШеф2', password: 'password123', avatar: '/avatars/burger.svg' }
    }));

    const regMsg2 = await reg2Promise;
    const authToken2 = regMsg2.payload.authToken;

    const join2Promise = waitForMessage(ws2, 'INIT_STATE');
    ws2.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { authToken: authToken2, roomId }
    }));

    const init2 = await join2Promise;
    console.log(`✅ User 2 connected: ${init2.payload.player.name}`);

    // --- Step 3: Match a pair and verify Current Game score vs Total Score ---
    console.log('\n--- Step 3: Verify Current Game Score vs Total Score ---');
    const room = gameManager.getRoom(roomId);
    const card0 = room.cards[0];
    let matchIdx = -1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === card0.pairId) {
        matchIdx = i;
        break;
      }
    }

    const matchPromise = waitForMessage(ws1, 'PAIR_MATCHED');

    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: 0 } }));
    await new Promise(r => setTimeout(r, 60));
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: matchIdx } }));

    const matchEvent = await matchPromise;
    console.log(`✅ Pair matched! Player current game score: ${matchEvent.payload.player.roundScore}, total score: ${matchEvent.payload.player.score}`);
    if (matchEvent.payload.player.roundScore !== 100) {
      throw new Error(`Expected roundScore 100, got ${matchEvent.payload.player.roundScore}`);
    }

    // --- Step 4: Verify Profile Stats via GET_USER_PROFILE ---
    console.log('\n--- Step 4: Test GET_USER_PROFILE ---');
    const profilePromise = waitForMessage(ws1, 'USER_PROFILE_RESULT');

    ws1.send(JSON.stringify({
      type: 'GET_USER_PROFILE',
      payload: { authToken: authToken1 }
    }));

    const profileRes = await profilePromise;
    console.log(`✅ Received profile: TotalScore = ${profileRes.payload.user.totalScore}, GamesPlayed = ${profileRes.payload.user.gamesPlayed}, CurrentGameScore = ${profileRes.payload.currentGameScore}`);
    if (profileRes.payload.currentGameScore !== 100) {
      throw new Error(`Expected profile currentGameScore to be 100, got ${profileRes.payload.currentGameScore}`);
    }
    if (profileRes.payload.user.totalScore !== 100) {
      throw new Error(`Expected profile totalScore to be 100, got ${profileRes.payload.user.totalScore}`);
    }

    // --- Step 5: Verify Leaderboards (Current Game & All Games) ---
    console.log('\n--- Step 5: Test Leaderboard for Current Game & All Games ---');
    const roomSnap = room.getSnapshot();
    const roomLeaderboard = roomSnap.roomLeaderboard;
    console.log(`✅ Room Leaderboard entries: ${roomLeaderboard.length}`);
    console.log(`   Top room player: ${roomLeaderboard[0].name} (RoundScore: ${roomLeaderboard[0].roundScore})`);
    if (roomLeaderboard[0].name !== 'ТестШеф1' || roomLeaderboard[0].roundScore !== 100) {
      throw new Error('Expected ТестШеф1 to be leader of current game with 100 points!');
    }

    const allLeaderboard = persistence.getLeaderboard(10, true);
    const inAll = allLeaderboard.find(u => u.name === 'ТестШеф1');
    console.log(`✅ All-Games Leaderboard includes ТестШеф1 with TotalScore: ${inAll?.totalScore}`);
    if (!inAll || inAll.totalScore !== 100) {
      throw new Error('Expected ТестШеф1 in all-time leaderboard with 100 points!');
    }

    // --- Step 6: Test Account Deletion ---
    console.log('\n--- Step 6: Test Account Deletion (DELETE_ACCOUNT) ---');
    const deletePromise = waitForMessage(ws1, 'ACCOUNT_DELETED');

    ws1.send(JSON.stringify({
      type: 'DELETE_ACCOUNT',
      payload: { authToken: authToken1 }
    }));

    const deleteRes = await deletePromise;
    console.log(`✅ Account deleted successfully: ${deleteRes.payload.message}`);

    // Verify user no longer exists in persistence
    const userAfterDelete = persistence.getUser('ТестШеф1');
    if (userAfterDelete) {
      throw new Error('User still exists in persistence after DELETE_ACCOUNT!');
    }
    console.log('✅ Confirmed: User purged from data/database.json');

    // Verify user cannot log in
    const authCheck = persistence.authenticateUser('ТестШеф1', 'password123');
    if (authCheck.success) {
      throw new Error('Deleted user was able to authenticate!');
    }
    console.log('✅ Confirmed: Deleted user cannot authenticate.');

    // Verify user removed from all-time leaderboard
    const allLeaderboardAfter = persistence.getLeaderboard(10, true);
    if (allLeaderboardAfter.some(u => u.name === 'ТестШеф1')) {
      throw new Error('Deleted user still present in all-time leaderboard!');
    }
    console.log('✅ Confirmed: Deleted user removed from all-time leaderboard.');

    console.log('\n🎉 ============================================================');
    console.log('🎉  ALL CURRENT GAME, PROFILE STATS, DELETE & LEADERBOARD TESTS PASSED!');
    console.log('🎉 ============================================================');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  } finally {
    try { ws1?.close(); } catch (e) {}
    try { ws2?.close(); } catch (e) {}
    try { persistence.deleteUser('ТестШеф1'); } catch (e) {}
    try { persistence.deleteUser('ТестШеф2'); } catch (e) {}
    try { sessionStore.removeSessionsByPlayerName('ТестШеф1'); } catch (e) {}
    try { sessionStore.removeSessionsByPlayerName('ТестШеф2'); } catch (e) {}
    try { persistence.clearRoomState('test_scores_room'); } catch (e) {}
    try { gameManager.rooms.delete('test_scores_room'); } catch (e) {}
    try { persistence.flushSync(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

testNewFeatures();
