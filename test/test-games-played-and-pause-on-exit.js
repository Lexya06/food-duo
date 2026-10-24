import './setup-test-env.js';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { gameManager } from '../server/game-engine.js';
import { persistence } from '../server/persistence.js';

function waitForMessage(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeoutMs);

    function handler(raw) {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch (err) {
        // ignore parse error
      }
    }
    ws.on('message', handler);
  });
}

async function runTest() {
  console.log('🧪 ============================================================');
  console.log('🧪  Test: gamesPlayed Count and Game Time Pausing on User Exit');
  console.log('🧪 ============================================================');

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  setupWebSocketServer(wss);

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const wsUrl = `ws://localhost:${port}`;
  console.log(`[Test Server] Started on port ${port}`);

  const testUser = `Тест_${Math.floor(Math.random() * 90000 + 10000)}`;
  const testPass = 'password123';
  const testRoomId = `rm_${Math.floor(Math.random() * 90000 + 10000)}`;

  try {
    // --- STEP 1: Registration and initial stats check ---
    console.log('\n--- Step 1: Register New User and Verify Initial gamesPlayed = 0 ---');
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.on('open', r));

    const authPromise = waitForMessage(ws, 'AUTH_SUCCESS');
    ws.send(JSON.stringify({
      type: 'REGISTER',
      payload: { username: testUser, password: testPass, avatar: '👨‍🍳' }
    }));

    const authRes = await authPromise;
    const authToken = authRes.payload.authToken;
    console.log(`✅ User registered: ${testUser}, Token: ${authToken}`);

    const profilePromise1 = waitForMessage(ws, 'USER_PROFILE_RESULT');
    ws.send(JSON.stringify({
      type: 'GET_USER_PROFILE',
      payload: { authToken }
    }));
    const prof1 = await profilePromise1;
    console.log(`✅ Initial profile: gamesPlayed = ${prof1.payload.user.gamesPlayed}`);
    if (prof1.payload.user.gamesPlayed !== 0) {
      throw new Error(`Expected new user gamesPlayed to be 0, got ${prof1.payload.user.gamesPlayed}`);
    }

    // --- STEP 2: Join room and make a move -> gamesPlayed must become 1 ---
    console.log('\n--- Step 2: Join Game Room and Make a Move (gamesPlayed must become 1) ---');
    const initPromise = waitForMessage(ws, 'INIT_STATE');
    ws.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { roomId: testRoomId, authToken, playerName: testUser }
    }));
    await initPromise;

    const room = gameManager.getOrCreateRoom(testRoomId);
    room.startNewRound(true);

    // Flip first card
    const flipPromise = waitForMessage(ws, 'CARD_FLIPPED');
    ws.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: 0 }
    }));
    await flipPromise;

    // Verify gamesPlayed incremented
    const profilePromise2 = waitForMessage(ws, 'USER_PROFILE_RESULT');
    ws.send(JSON.stringify({
      type: 'GET_USER_PROFILE',
      payload: { authToken }
    }));
    const prof2 = await profilePromise2;
    console.log(`✅ Profile after playing: gamesPlayed = ${prof2.payload.user.gamesPlayed}`);
    if (prof2.payload.user.gamesPlayed !== 1) {
      throw new Error(`Expected gamesPlayed to be 1 after making a move, got ${prof2.payload.user.gamesPlayed}`);
    }

    // Verify leaderboard reflects gamesPlayed = 1
    const allLeaderboard = persistence.getLeaderboard(20, true);
    const userInLeaderboard = allLeaderboard.find(u => u.name === testUser);
    console.log(`✅ Leaderboard entry for ${testUser}: gamesPlayed = ${userInLeaderboard?.gamesPlayed}`);
    if (!userInLeaderboard || userInLeaderboard.gamesPlayed !== 1) {
      throw new Error(`Expected leaderboard entry for ${testUser} to have gamesPlayed = 1`);
    }

    // --- STEP 3: Multiple moves in same round must NOT increment gamesPlayed again ---
    console.log('\n--- Step 3: Additional Moves in Same Round (gamesPlayed must REMAIN 1) ---');
    // Match the pair
    const card0 = room.cards[0];
    let matchIdx = -1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === card0.pairId) {
        matchIdx = i;
        break;
      }
    }

    const matchPromise = waitForMessage(ws, 'PAIR_MATCHED');
    ws.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: matchIdx }
    }));
    await matchPromise;

    const profilePromise3 = waitForMessage(ws, 'USER_PROFILE_RESULT');
    ws.send(JSON.stringify({
      type: 'GET_USER_PROFILE',
      payload: { authToken }
    }));
    const prof3 = await profilePromise3;
    console.log(`✅ Profile after pair match: gamesPlayed = ${prof3.payload.user.gamesPlayed}`);
    if (prof3.payload.user.gamesPlayed !== 1) {
      throw new Error(`Expected gamesPlayed to remain 1 within same round, got ${prof3.payload.user.gamesPlayed}`);
    }

    // --- STEP 4: Start New Round (Restart) and play -> gamesPlayed must become 2 ---
    console.log('\n--- Step 4: Restart Round and Play (gamesPlayed must become 2) ---');
    const restartPromise = waitForMessage(ws, 'ROUND_STARTED');
    ws.send(JSON.stringify({ type: 'RESTART_ROUND' }));
    await restartPromise;

    const flipPromise2 = waitForMessage(ws, 'CARD_FLIPPED');
    ws.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: 0 }
    }));
    await flipPromise2;

    const profilePromise4 = waitForMessage(ws, 'USER_PROFILE_RESULT');
    ws.send(JSON.stringify({
      type: 'GET_USER_PROFILE',
      payload: { authToken }
    }));
    const prof4 = await profilePromise4;
    console.log(`✅ Profile in 2nd round: gamesPlayed = ${prof4.payload.user.gamesPlayed}`);
    if (prof4.payload.user.gamesPlayed !== 2) {
      throw new Error(`Expected gamesPlayed to be 2 in second round, got ${prof4.payload.user.gamesPlayed}`);
    }

    // --- STEP 5: Test Game Pause when User Switches Away / Minimizes Window (PLAYER_AWAY) ---
    console.log('\n--- Step 5: Test Pause on Tab Switch / Minimize (PLAYER_AWAY) ---');
    // Let 1.2s pass so timer advances
    await new Promise(r => setTimeout(r, 1200));
    const timeBeforeAway = room.getElapsedSeconds();
    console.log(`⏱️ Elapsed time before PLAYER_AWAY: ${timeBeforeAway}s`);

    const pausedPromise = waitForMessage(ws, 'GAME_PAUSED');
    ws.send(JSON.stringify({
      type: 'PLAYER_AWAY',
      payload: { reason: 'Шеф-повар свернул окно' }
    }));
    const pauseMsg = await pausedPromise;
    console.log(`✅ Received GAME_PAUSED: "${pauseMsg.payload.reason}"`);
    if (!room.isPaused) {
      throw new Error('Room must be paused after PLAYER_AWAY!');
    }

    // Wait 1.5s while away: timer MUST BE FROZEN
    const frozenTimeAway = room.getElapsedSeconds();
    await new Promise(r => setTimeout(r, 1500));
    const timeAfterAwayWait = room.getElapsedSeconds();
    console.log(`⏱️ Time frozen during PLAYER_AWAY: ${frozenTimeAway}s -> after wait: ${timeAfterAwayWait}s`);
    if (timeAfterAwayWait !== frozenTimeAway) {
      throw new Error(`Timer must be FROZEN while player is away! Expected ${frozenTimeAway}s, got ${timeAfterAwayWait}s`);
    }

    // User returns: PLAYER_BACK
    console.log('\n--- Step 6: Test Resume when User Returns (PLAYER_BACK) ---');
    const resumePromise = waitForMessage(ws, 'GAME_RESUMED');
    ws.send(JSON.stringify({ type: 'PLAYER_BACK' }));
    await resumePromise;
    console.log('✅ Received GAME_RESUMED! Room unpaused successfully.');
    if (room.isPaused) {
      throw new Error('Room must NOT be paused after PLAYER_BACK!');
    }

    // Wait 1.2s: timer must resume advancing
    await new Promise(r => setTimeout(r, 1200));
    const timeAfterResume = room.getElapsedSeconds();
    console.log(`⏱️ Resumed timer after PLAYER_BACK: ${timeAfterResume}s (was ${frozenTimeAway}s)`);
    if (timeAfterResume <= frozenTimeAway) {
      throw new Error(`Timer did not resume! Expected > ${frozenTimeAway}s, got ${timeAfterResume}s`);
    }

    // --- STEP 7: Test Game Pause when User Exits via LOGOUT ---
    console.log('\n--- Step 7: Test Game Pause on User Exit (LOGOUT) ---');
    const timeBeforeLogout = room.getElapsedSeconds();
    const logoutPromise = waitForMessage(ws, 'LOGOUT_SUCCESS');
    ws.send(JSON.stringify({
      type: 'LOGOUT',
      payload: { authToken }
    }));
    await logoutPromise;
    console.log('✅ Received LOGOUT_SUCCESS');

    if (!room.isPaused) {
      throw new Error('Room MUST BE PAUSED when user logs out/exits the game!');
    }
    console.log(`✅ Confirmed: Room is paused after logout. Reason: "${room.pauseReason}"`);

    // Wait 1.5s while logged out: timer must remain completely FROZEN
    const frozenTimeLogout = room.getElapsedSeconds();
    await new Promise(r => setTimeout(r, 1500));
    const timeAfterLogoutWait = room.getElapsedSeconds();
    console.log(`⏱️ Time frozen after LOGOUT: ${frozenTimeLogout}s -> after wait: ${timeAfterLogoutWait}s`);
    if (timeAfterLogoutWait !== frozenTimeLogout) {
      throw new Error(`Timer must be FROZEN while user is logged out! Expected ${frozenTimeLogout}s, got ${timeAfterLogoutWait}s`);
    }

    // --- STEP 8: User Logs Back In -> Game Resumes Cleanly ---
    console.log('\n--- Step 8: User Logs Back In -> Game Resumes from Paused Time ---');
    const loginPromise = waitForMessage(ws, 'AUTH_SUCCESS');
    ws.send(JSON.stringify({
      type: 'LOGIN',
      payload: { username: testUser, password: testPass }
    }));
    const loginRes = await loginPromise;
    console.log(`✅ Logged back in: ${loginRes.payload.user.name}, gamesPlayed: ${loginRes.payload.user.gamesPlayed}`);

    // Room unpauses
    if (room.isPaused) {
      throw new Error('Room should unpause after user logs back in!');
    }
    console.log('✅ Room unpaused after user returned!');

    ws.close();
    console.log('\n🎉 ============================================================');
    console.log('🎉  ALL gamesPlayed & PAUSE-ON-EXIT TESTS PASSED SUCCESSFULLY!');
    console.log('🎉 ============================================================');
  } finally {
    persistence.deleteUser(testUser);
    persistence.clearRoomState(testRoomId);
    gameManager.rooms.delete(testRoomId);
    persistence.flushSync();
    await new Promise(r => server.close(r));
  }
}

  runTest().then(() => {
    process.exit(0);
  }).catch(err => {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  });
