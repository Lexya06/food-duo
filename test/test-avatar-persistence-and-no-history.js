import './setup-test-env.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

async function runAvatarAndNoHistoryTest() {
  console.log('🧪 ============================================================');
  console.log('🧪  Test: Avatar Permanent Persistence & Game History Removal');
  console.log('🧪 ============================================================\n');

  const roomId = 'test_avatar_room';
  persistence.clearRoomState(roomId);
  gameManager.rooms.delete(roomId);

  const testUsername = 'Тест_Аватар';
  persistence.deleteUser(testUsername);
  sessionStore.removeSessionsByPlayerName(testUsername);

  // --- Step 1: Start Server 1 ---
  const server1 = http.createServer();
  const wss1 = new WebSocketServer({ server: server1 });
  setupWebSocketServer(wss1);

  await new Promise(r => server1.listen(0, r));
  const port1 = server1.address().port;
  const wsUrl1 = `ws://localhost:${port1}`;
  console.log(`[Test Server 1] Started on port ${port1}`);

  let uploadedAvatarPath = null;

  try {
    // --- Step 2: Register user with custom avatar image (/avatars/fox.svg) ---
    console.log('\n--- Step 2: Register user with custom avatar image (/avatars/fox.svg) ---');
    const ws1 = new WebSocket(wsUrl1);
    await new Promise(r => ws1.on('open', r));

    const regPromise = waitForMessage(ws1, 'AUTH_SUCCESS');
    ws1.send(JSON.stringify({
      type: 'REGISTER',
      payload: { username: testUsername, password: 'password123', avatar: '/avatars/fox.svg' }
    }));

    const regMsg = await regPromise;
    console.log(`✅ Registered user: ${regMsg.payload.user.name}, avatar path: ${regMsg.payload.user.avatar}`);
    if (regMsg.payload.user.avatar !== '/avatars/fox.svg') {
      throw new Error(`Expected registered avatar path to be '/avatars/fox.svg', got: '${regMsg.payload.user.avatar}'`);
    }

    const authToken = regMsg.payload.authToken;

    // --- Step 3: Join Room and verify avatar in player state ---
    console.log('\n--- Step 3: Join room and verify avatar in player state ---');
    const initPromise = waitForMessage(ws1, 'INIT_STATE');
    ws1.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { authToken, roomId }
    }));

    const initMsg = await initPromise;
    console.log(`✅ Player joined room. Avatar path: ${initMsg.payload.player.avatar}`);
    if (initMsg.payload.player.avatar !== '/avatars/fox.svg') {
      throw new Error(`Expected room player avatar to be '/avatars/fox.svg', got: '${initMsg.payload.player.avatar}'`);
    }

    const sessionToken = initMsg.payload.sessionToken;
    const room = gameManager.getOrCreateRoom(roomId);

    // --- Step 4: Card matching must NOT overwrite avatar with default ---
    console.log('\n--- Step 4: Card matching must preserve custom avatar ---');
    const card0 = room.cards[0];
    let matchIdx = -1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === card0.pairId) {
        matchIdx = i;
      }
    }

    const matchPromise = waitForMessage(ws1, 'PAIR_MATCHED');
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: 0 } }));
    await new Promise(r => setTimeout(r, 80));
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: matchIdx } }));

    const matchMsg = await matchPromise;
    console.log(`✅ Pair matched. Player score: ${matchMsg.payload.player.score}`);

    // Check DB user avatar after match
    const dbUserAfterMatch = persistence.getUser(testUsername);
    console.log(`✅ User avatar in DB after pair match: ${dbUserAfterMatch.avatar}`);
    if (dbUserAfterMatch.avatar !== '/avatars/fox.svg') {
      throw new Error(`Avatar in DB was overwritten after card match! Got: '${dbUserAfterMatch.avatar}', expected '/avatars/fox.svg'`);
    }

    // --- Step 5: Update avatar permanently in profile to image file (/avatars/panda.svg) ---
    console.log('\n--- Step 5: Update avatar in profile to (/avatars/panda.svg) ---');
    const profilePromise = waitForMessage(ws1, 'PROFILE_UPDATED');
    ws1.send(JSON.stringify({
      type: 'UPDATE_PROFILE',
      payload: { playerName: testUsername, avatar: '/avatars/panda.svg' }
    }));

    const profileMsg = await profilePromise;
    console.log(`✅ Profile updated. New avatar: ${profileMsg.payload.player.avatar}`);
    if (profileMsg.payload.player.avatar !== '/avatars/panda.svg') {
      throw new Error(`Expected updated player avatar to be '/avatars/panda.svg', got: '${profileMsg.payload.player.avatar}'`);
    }

    const dbUserAfterProfile = persistence.getUser(testUsername);
    console.log(`✅ User avatar in DB after profile update: ${dbUserAfterProfile.avatar}`);
    if (dbUserAfterProfile.avatar !== '/avatars/panda.svg') {
      throw new Error(`Expected user avatar in DB to be '/avatars/panda.svg', got: '${dbUserAfterProfile.avatar}'`);
    }

    // --- Step 5b: Upload custom base64 image avatar and verify file saved on disk ---
    console.log('\n--- Step 5b: Upload custom base64 image avatar and verify file saved on disk ---');
    const sampleBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const uploadPromise = waitForMessage(ws1, 'PROFILE_UPDATED');
    ws1.send(JSON.stringify({
      type: 'UPDATE_PROFILE',
      payload: { playerName: testUsername, avatar: sampleBase64 }
    }));

    const uploadMsg = await uploadPromise;
    uploadedAvatarPath = uploadMsg.payload.player.avatar;
    console.log(`✅ Custom image avatar saved: ${uploadedAvatarPath}`);
    if (!uploadedAvatarPath.startsWith('/avatars/') || !uploadedAvatarPath.endsWith('.png')) {
      throw new Error(`Expected avatar to be saved as PNG file path, got: '${uploadedAvatarPath}'`);
    }

    const fullFilePath = path.join(process.cwd(), 'public', uploadedAvatarPath.replace(/^\//, ''));
    if (!fs.existsSync(fullFilePath)) {
      throw new Error(`Avatar image file does not exist on disk at: ${fullFilePath}`);
    }
    console.log(`✅ Confirmed file exists on disk: ${fullFilePath}`);

    const dbUserAfterUpload = persistence.getUser(testUsername);
    console.log(`✅ User avatar in DB after upload: ${dbUserAfterUpload.avatar}`);
    if (dbUserAfterUpload.avatar !== uploadedAvatarPath) {
      throw new Error(`Expected user avatar in DB to be '${uploadedAvatarPath}', got: '${dbUserAfterUpload.avatar}'`);
    }

    // --- Step 6: End round and verify avatar remains intact ---
    console.log('\n--- Step 6: End round and verify avatar remains intact ---');
    persistence.recordRoundEnd({
      roomId,
      roundNumber: 1,
      winner: testUsername,
      scores: [{ player: testUsername, score: 200, roundScore: 200, roundPairs: 1 }]
    });

    const dbUserAfterRound = persistence.getUser(testUsername);
    console.log(`✅ User avatar in DB after round completion: ${dbUserAfterRound.avatar}`);
    if (dbUserAfterRound.avatar !== uploadedAvatarPath) {
      throw new Error(`Avatar was overwritten during round end! Got: '${dbUserAfterRound.avatar}', expected '${uploadedAvatarPath}'`);
    }

    // Flush to disk
    room.saveStateToPersistence();
    persistence.flushSync();

    // --- Step 7: Server Restart & Avatar Persistence ---
    console.log('\n--- Step 7: Server Shutdown and Restart ---');
    ws1.close();
    await new Promise(r => setTimeout(r, 150));
    await new Promise(r => server1.close(r));
    console.log('[Test Server 1] Stopped.');

    // Start Server 2 from same persisted storage
    const server2 = http.createServer();
    const wss2 = new WebSocketServer({ server: server2 });
    setupWebSocketServer(wss2);

    await new Promise(r => server2.listen(0, r));
    const port2 = server2.address().port;
    const wsUrl2 = `ws://localhost:${port2}`;
    console.log(`[Test Server 2] Started on port ${port2}`);

    // Reconnect client using authToken and sessionToken
    const ws2 = new WebSocket(wsUrl2);
    await new Promise(r => ws2.on('open', r));

    const resumePromise = waitForMessage(ws2, 'SESSION_RESUMED');
    ws2.send(JSON.stringify({
      type: 'RESUME_SESSION',
      payload: { token: sessionToken, authToken, roomId }
    }));

    const resumeMsg = await resumePromise;
    console.log(`✅ Reconnected to Server 2. Resumed player avatar: ${resumeMsg.payload.player.avatar}`);
    if (resumeMsg.payload.player.avatar !== uploadedAvatarPath) {
      throw new Error(`Player avatar was lost across server restart! Expected '${uploadedAvatarPath}', got: '${resumeMsg.payload.player.avatar}'`);
    }
    if (resumeMsg.payload.authUser?.avatar !== uploadedAvatarPath) {
      throw new Error(`AuthUser avatar was lost across server restart! Expected '${uploadedAvatarPath}', got: '${resumeMsg.payload.authUser?.avatar}'`);
    }

    // Verify GET_USER_PROFILE returns uploadedAvatarPath
    const getProfilePromise = waitForMessage(ws2, 'USER_PROFILE_RESULT');
    ws2.send(JSON.stringify({
      type: 'GET_USER_PROFILE',
      payload: { authToken, playerName: testUsername }
    }));
    const profileResult = await getProfilePromise;
    console.log(`✅ GET_USER_PROFILE returned avatar: ${profileResult.payload.user?.avatar}`);
    if (profileResult.payload.user?.avatar !== uploadedAvatarPath) {
      throw new Error(`GET_USER_PROFILE returned wrong avatar! Expected '${uploadedAvatarPath}', got: '${profileResult.payload.user?.avatar}'`);
    }

    // --- Step 8: Log Out and Log Back In ---
    console.log('\n--- Step 8: Log Out and Log Back In ---');
    const logoutPromise = waitForMessage(ws2, 'LOGOUT_SUCCESS');
    ws2.send(JSON.stringify({
      type: 'LOGOUT',
      payload: { authToken }
    }));
    await logoutPromise;
    console.log('✅ Logged out successfully.');

    // Log back in
    const loginPromise = waitForMessage(ws2, 'AUTH_SUCCESS');
    ws2.send(JSON.stringify({
      type: 'LOGIN',
      payload: { username: testUsername, password: 'password123' }
    }));
    const loginMsg = await loginPromise;
    console.log(`✅ Logged back in. User avatar: ${loginMsg.payload.user.avatar}`);
    if (loginMsg.payload.user.avatar !== uploadedAvatarPath) {
      throw new Error(`Avatar lost after log in! Expected '${uploadedAvatarPath}', got: '${loginMsg.payload.user.avatar}'`);
    }

    // --- Step 9: Verify Game History is Completely Removed ---
    console.log('\n--- Step 9: Verify Game History is Completely Removed ---');
    const matchHistory = persistence.getMatchHistory();
    console.log(`✅ persistence.getMatchHistory() returns: ${JSON.stringify(matchHistory)}`);
    if (matchHistory.length !== 0) {
      throw new Error(`Game history must be empty, but got ${matchHistory.length} items`);
    }

    if (resumeMsg.payload.matchHistory && resumeMsg.payload.matchHistory.length > 0) {
      throw new Error(`SESSION_RESUMED payload contains matchHistory!`);
    }

    console.log('\n🎉 ============================================================');
    console.log('🎉  ALL AVATAR PERSISTENCE & NO-HISTORY TESTS PASSED (100%)');
    console.log('🎉 ============================================================\n');

    ws2.close();
    await new Promise(r => server2.close(r));
    if (uploadedAvatarPath) {
      try {
        const p = path.join(process.cwd(), 'public', uploadedAvatarPath.replace(/^\//, ''));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (e) {}
    }
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    try { persistence.deleteUser(testUsername); } catch (e) {}
    try { persistence.clearRoomState(roomId); } catch (e) {}
    try { persistence.flushSync(); } catch (e) {}
    try { server1?.close(); } catch (e) {}
    if (uploadedAvatarPath) {
      try {
        const p = path.join(process.cwd(), 'public', uploadedAvatarPath.replace(/^\//, ''));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch (e) {}
    }
  }
}

runAvatarAndNoHistoryTest();
