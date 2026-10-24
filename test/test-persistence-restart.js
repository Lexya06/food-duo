import './setup-test-env.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { gameManager } from '../server/game-engine.js';
import { persistence } from '../server/persistence.js';
import { sessionStore } from '../server/session-store.js';

async function testPersistenceAndNewUser() {
  console.log('🧪 ============================================================');
  console.log('🧪  Test Suite: New User Points & Server Restart Persistence');
  console.log('🧪 ============================================================\n');

  // --- Step 1: Start Server Instance 1 ---
  const server1 = http.createServer();
  const wss1 = new WebSocketServer({ server: server1 });
  setupWebSocketServer(wss1);

  await new Promise(r => server1.listen(0, r));
  const port1 = server1.address().port;
  const wsUrl1 = `ws://localhost:${port1}`;
  console.log(`[Test Server 1] Started on port ${port1}`);

  // Reset test room state
  persistence.clearRoomState('bistro_test');
  gameManager.rooms.delete('bistro_test');

  try {
    // --- 1. Test New User Who Has Not Played Yet ---
    console.log('\n--- Test 1: New User Points & Initial State Verification ---');
    const ws1 = new WebSocket(wsUrl1);
    await new Promise(r => ws1.on('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Шеф-Повар', avatar: '👨‍🍳', roomId: 'bistro_test' }
    }));

    const init1 = await new Promise(r => ws1.once('message', d => r(JSON.parse(d.toString()))));
    console.log(`✅ User 1 connected. Name: "${init1.payload.player.name}", Score: ${init1.payload.player.score}`);

    if (init1.payload.player.score !== 0) {
      throw new Error(`New user who hasn't played yet must have score 0! Got: ${init1.payload.player.score}`);
    }
    if (init1.payload.player.roundScore !== 0) {
      throw new Error(`New user who hasn't played yet must have roundScore 0! Got: ${init1.payload.player.roundScore}`);
    }
    if (init1.payload.player.roundPairs !== 0) {
      throw new Error(`New user who hasn't played yet must have roundPairs 0! Got: ${init1.payload.player.roundPairs}`);
    }

    const token1 = init1.payload.sessionToken;
    const room = gameManager.getOrCreateRoom('bistro_test');

    // --- 2. Test Second User Joining with Same Default Name ---
    console.log('\n--- Test 2: Second Default User Joining Without Collisions ---');
    const ws2 = new WebSocket(wsUrl1);
    await new Promise(r => ws2.on('open', r));

    ws2.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Шеф-Повар', avatar: '👨‍🍳', roomId: 'bistro_test' }
    }));

    const init2 = await new Promise(r => ws2.once('message', d => r(JSON.parse(d.toString()))));
    console.log(`✅ User 2 connected. Name: "${init2.payload.player.name}", Score: ${init2.payload.player.score}`);

    if (init2.payload.player.score !== 0) {
      throw new Error(`Second user who hasn't played yet must have score 0! Got: ${init2.payload.player.score}`);
    }
    if (init2.payload.player.playerId === init1.payload.player.playerId) {
      throw new Error('User 2 must NOT hijack User 1 playerId!');
    }
    if (init2.payload.player.name === init1.payload.player.name) {
      throw new Error('Duplicate default usernames must be deduplicated (e.g. Шеф-Повар (2))!');
    }

    const token2 = init2.payload.sessionToken;

    // --- 3. User 1 Matches a Pair and Scores Points ---
    console.log('\n--- Test 3: Card Matching & Progress Tracking ---');
    // Find a matching pair in the deck
    const card0 = room.cards[0];
    let matchIdx = -1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === card0.pairId) {
        matchIdx = i;
        break;
      }
    }

    const matchPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PAIR_MATCHED') {
          ws1.off('message', handler);
          resolve(msg);
        }
      };
      ws1.on('message', handler);
    });

    // Flip both matching cards from User 1
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: 0 } }));
    await new Promise(r => setTimeout(r, 100));
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: matchIdx } }));

    const matchEvent = await matchPromise;
    console.log(`✅ Pair matched by User 1: ${matchEvent.payload.matchedFood.pairTitle}, +${matchEvent.payload.scoreDelta} pts`);

    if (matchEvent.payload.player.score < 100) {
      throw new Error(`Expected score >= 100, got ${matchEvent.payload.player.score}`);
    }

    // Flush persistent storage
    room.saveStateToPersistence();
    persistence.flushSync();

    // Verify User 2 has NOT received points (User 2 has not played!)
    const user2InRoom = room.players.get(init2.payload.player.socketId);
    if (user2InRoom.roundScore !== 0 || user2InRoom.roundPairs !== 0) {
      throw new Error(`User 2 must remain at 0 points! Got: ${user2InRoom.roundScore}`);
    }
    console.log(`✅ Confirmed: User 2 (who hasn't played) remains at score ${user2InRoom.score}, roundScore ${user2InRoom.roundScore}`);

    // --- 4. Server Shutdown & State Persistence Check ---
    console.log('\n--- Test 4: Simulating Server Shutdown (Ctrl+C / SIGTERM) ---');
    // Disconnect clients
    ws1.close();
    ws2.close();
    await new Promise(r => setTimeout(r, 150));

    // Close server 1
    await new Promise(r => server1.close(r));
    console.log('[Test Server 1] Stopped.');

    // Verify data/database.json on disk contains activeRooms and sessions
    const savedRoomState = persistence.getRoomState('bistro_test');
    if (!savedRoomState) {
      throw new Error('Room state was not saved to database.json!');
    }
    const savedCard0 = savedRoomState.cards[0];
    const savedCardMatch = savedRoomState.cards[matchIdx];
    if (!savedCard0.isMatched || !savedCardMatch.isMatched) {
      throw new Error('Matched cards status was not saved in persistent database!');
    }
    console.log(`✅ Persistent storage verified: cards #0 and #${matchIdx} saved as matched in database.json`);

    const savedSession1 = persistence.getSession(token1);
    if (!savedSession1 || savedSession1.score < 100) {
      throw new Error(`User 1 session score not saved in database.json! Expected >= 100, got ${savedSession1?.score}`);
    }
    console.log(`✅ Persistent storage verified: User 1 session saved with score ${savedSession1.score}`);

    // --- 5. Server Restart & Full State Recovery (Требование 3) ---
    console.log('\n--- Test 5: Server Restart & State Resumption (Requirement 3) ---');
    // Start Server Instance 2 (emulating server restart reading from same database.json)
    const server2 = http.createServer();
    const wss2 = new WebSocketServer({ server: server2 });
    setupWebSocketServer(wss2);

    await new Promise(r => server2.listen(0, r));
    const port2 = server2.address().port;
    const wsUrl2 = `ws://localhost:${port2}`;
    console.log(`[Test Server 2] Started on port ${port2} (Restored from database.json)`);

    // Client 1 reconnects after server restart using saved token1
    const ws1New = new WebSocket(wsUrl2);
    await new Promise(r => ws1New.on('open', r));

    ws1New.send(JSON.stringify({
      type: 'RESUME_SESSION',
      payload: { token: token1, roomId: 'bistro_test' }
    }));

    const resumeMsg1 = await new Promise(r => ws1New.once('message', d => r(JSON.parse(d.toString()))));
    if (!resumeMsg1.payload?.success) {
      throw new Error('Failed to resume session after server restart!');
    }

    console.log(`✅ User 1 successfully reconnected to Server 2! Score: ${resumeMsg1.payload.player.score}`);
    if (resumeMsg1.payload.player.score !== savedSession1.score) {
      throw new Error(`Player score was not preserved across server restart! Expected ${savedSession1.score}, got ${resumeMsg1.payload.player.score}`);
    }

    // Verify board cards state on restored server:
    const restoredCards = resumeMsg1.payload.room.cards;
    if (!restoredCards[0].isMatched || !restoredCards[matchIdx].isMatched) {
      throw new Error('Board cards were not restored properly across server restart!');
    }
    console.log('✅ Board state verified: Matched pair remains matched after server restart!');
    console.log(`✅ Remaining pairs count: ${resumeMsg1.payload.room.remainingPairs} / 8`);

    // Clean up
    ws1New.close();

    console.log('\n🎉 ============================================================');
    console.log('🎉  ALL NEW USER & PERSISTENCE RESTART TESTS PASSED (100%)');
    console.log('🎉 ============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    try { persistence.deleteUser('Шеф-Повар'); } catch (e) {}
    try { persistence.deleteUser('Шеф-Повар (2)'); } catch (e) {}
    try { persistence.clearRoomState('bistro_test'); } catch (e) {}
    try { persistence.flushSync(); } catch (e) {}
    try { server1?.close(); } catch (e) {}
    try { server2?.close(); } catch (e) {}
  }
}

testPersistenceAndNewUser();
