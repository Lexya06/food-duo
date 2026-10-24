import './setup-test-env.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { gameManager } from '../server/game-engine.js';
import { persistence } from '../server/persistence.js';
import { sessionStore } from '../server/session-store.js';

async function testMultiplayerReconnectPause() {
  console.log('🧪 ============================================================');
  console.log('🧪  Test: Multiplayer State Restoration, Time, Points & Pause');
  console.log('🧪 ============================================================\n');

  const roomId = 'test_multi_pause';
  persistence.clearRoomState(roomId);
  gameManager.rooms.delete(roomId);
  if (persistence.data?.users) {
    delete persistence.data.users['Шеф А'];
    delete persistence.data.users['Шеф Б'];
  }

  // --- Step 1: Start Server 1 ---
  const server1 = http.createServer();
  const wss1 = new WebSocketServer({ server: server1 });
  setupWebSocketServer(wss1);

  await new Promise(r => server1.listen(0, r));
  const port1 = server1.address().port;
  const wsUrl1 = `ws://localhost:${port1}`;
  console.log(`[Test Server 1] Started on port ${port1}`);

  try {
    // 1. Connect Player A
    const wsA = new WebSocket(wsUrl1);
    await new Promise(r => wsA.on('open', r));
    wsA.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Шеф А', avatar: '👨‍🍳', roomId }
    }));
    const initA = await new Promise(r => wsA.once('message', d => r(JSON.parse(d.toString()))));
    const tokenA = initA.payload.sessionToken;
    console.log(`✅ Player A connected. Token: ${tokenA}, Score: ${initA.payload.player.score}`);

    // 2. Connect Player B
    const wsB = new WebSocket(wsUrl1);
    await new Promise(r => wsB.on('open', r));
    wsB.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Шеф Б', avatar: '👩‍🍳', roomId }
    }));
    const initB = await new Promise(r => wsB.once('message', d => r(JSON.parse(d.toString()))));
    const tokenB = initB.payload.sessionToken;
    console.log(`✅ Player B connected. Token: ${tokenB}, Score: ${initB.payload.player.score}`);

    const room = gameManager.getRoom(roomId);
    if (!room) throw new Error('Room not found on server 1');

    // 3. Match a pair for Player A and a pair for Player B
    // Find pair 1 for Player A
    const card0 = room.cards[0];
    let matchAIdx = -1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === card0.pairId) {
        matchAIdx = i;
        break;
      }
    }

    const matchAPromise = new Promise(resolve => {
      const handler = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'PAIR_MATCHED') {
          wsA.off('message', handler);
          resolve(msg);
        }
      };
      wsA.on('message', handler);
    });

    wsA.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: 0 } }));
    await new Promise(r => setTimeout(r, 60));
    wsA.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: matchAIdx } }));

    const matchAEvent = await matchAPromise;
    const expectedScoreA = matchAEvent.payload.player.score;
    const expectedRoundScoreA = matchAEvent.payload.player.roundScore;
    console.log(`✅ Player A matched pair (${matchAEvent.payload.matchedFood.pairTitle}), score: ${matchAEvent.payload.player.score}, roundScore: ${expectedRoundScoreA}`);

    // Find pair 2 for Player B
    let cardB1Idx = -1;
    let cardB2Idx = -1;
    for (let i = 0; i < room.cards.length; i++) {
      if (!room.cards[i].isMatched) {
        cardB1Idx = i;
        break;
      }
    }
    for (let i = cardB1Idx + 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === room.cards[cardB1Idx].pairId) {
        cardB2Idx = i;
        break;
      }
    }

    const matchBPromise = new Promise(resolve => {
      const handler = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'PAIR_MATCHED') {
          wsB.off('message', handler);
          resolve(msg);
        }
      };
      wsB.on('message', handler);
    });

    wsB.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: cardB1Idx } }));
    await new Promise(r => setTimeout(r, 60));
    wsB.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: cardB2Idx } }));

    const matchBEvent = await matchBPromise;
    const expectedScoreB = matchBEvent.payload.player.score;
    const expectedRoundScoreB = matchBEvent.payload.player.roundScore;
    console.log(`✅ Player B matched pair (${matchBEvent.payload.matchedFood.pairTitle}), score: ${matchBEvent.payload.player.score}, roundScore: ${expectedRoundScoreB}`);

    // Let active round play for 2 seconds so elapsedSeconds > 0
    await new Promise(r => setTimeout(r, 2100));

    const elapsedBeforeDisconnect = room.getElapsedSeconds();
    console.log(`⏱️ Elapsed gameplay time before disconnect: ${elapsedBeforeDisconnect}s`);
    if (elapsedBeforeDisconnect < 2) {
      throw new Error(`Expected elapsed time >= 2s, got ${elapsedBeforeDisconnect}s`);
    }

    // 4. Disconnect Player B: Room MUST pause waiting for Player B!
    console.log('\n--- Step 4: Player B Disconnects (Room must pause waiting for Player B) ---');
    const pausePromiseA = new Promise(resolve => {
      const handler = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'GAME_PAUSED') {
          wsA.off('message', handler);
          resolve(msg);
        }
      };
      wsA.on('message', handler);
    });

    wsB.close();
    await new Promise(r => setTimeout(r, 150));

    const pauseMsgA = await pausePromiseA;
    console.log(`✅ Player A received GAME_PAUSED: "${pauseMsgA.payload.reason}"`);
    if (!room.isPaused) {
      throw new Error('Room must be paused after Player B disconnected!');
    }
    if (!pauseMsgA.payload.reason.includes('Шеф Б')) {
      throw new Error(`Pause reason should name Player B (Шеф Б)! Got: ${pauseMsgA.payload.reason}`);
    }

    // Wait 1.5 seconds while paused: timer must NOT advance!
    const frozenTime = room.getElapsedSeconds();
    await new Promise(r => setTimeout(r, 1500));
    const timeAfterPauseWait = room.getElapsedSeconds();
    console.log(`⏱️ Time frozen during pause: ${frozenTime}s -> after wait: ${timeAfterPauseWait}s`);
    if (timeAfterPauseWait !== frozenTime) {
      throw new Error(`Timer must be FROZEN while paused! Before: ${frozenTime}s, After: ${timeAfterPauseWait}s`);
    }

    // 5. Player A ALSO disconnects: 0 players remain online! Room MUST REMAIN PAUSED!
    console.log('\n--- Step 5: Player A Disconnects (0 players online; Room must STAY paused) ---');
    wsA.close();
    await new Promise(r => setTimeout(r, 150));

    if (!room.isPaused) {
      throw new Error('Room must NOT unpause when 0 players are online in an active round!');
    }
    console.log('✅ Confirmed: Room remains paused with 0 players online.');

    // Save and shutdown Server 1
    room.saveStateToPersistence();
    persistence.flushSync();
    await new Promise(r => server1.close(r));
    console.log('[Test Server 1] Stopped.');

    // 6. Start Server 2 (Simulating server restart / reboot)
    console.log('\n--- Step 6: Server Restart & State Verification ---');
    const server2 = http.createServer();
    const wss2 = new WebSocketServer({ server: server2 });
    setupWebSocketServer(wss2);

    await new Promise(r => server2.listen(0, r));
    const port2 = server2.address().port;
    const wsUrl2 = `ws://localhost:${port2}`;
    console.log(`[Test Server 2] Started on port ${port2}`);

    const restoredRoom = gameManager.getOrCreateRoom(roomId);
    if (!restoredRoom.isPaused) {
      throw new Error('Restored active room must be PAUSED on server start waiting for players!');
    }
    const restoredElapsed = restoredRoom.getElapsedSeconds();
    console.log(`✅ Restored room is paused: "${restoredRoom.pauseReason}"`);
    console.log(`✅ Restored elapsed time: ${restoredElapsed}s (expected ~${frozenTime}s)`);
    if (restoredElapsed !== frozenTime) {
      throw new Error(`Restored elapsed time (${restoredElapsed}s) must match frozen time (${frozenTime}s)!`);
    }

    // 7. Player A reconnects first: Player B is STILL offline!
    // The game MUST REMAIN PAUSED waiting for Player B!
    console.log('\n--- Step 7: Player A Reconnects First (Player B still offline -> MUST STAY PAUSED) ---');
    const wsA2 = new WebSocket(wsUrl2);
    await new Promise(r => wsA2.on('open', r));

    wsA2.send(JSON.stringify({
      type: 'RESUME_SESSION',
      payload: { token: tokenA, playerName: 'Шеф А', roomId }
    }));

    const resumeMsgA = await new Promise(r => wsA2.once('message', d => r(JSON.parse(d.toString()))));
    console.log(`✅ Player A reconnected. Score: ${resumeMsgA.payload.player.score}, RoundScore: ${resumeMsgA.payload.player.roundScore}`);

    if (resumeMsgA.payload.player.score !== expectedScoreA || resumeMsgA.payload.player.roundScore !== expectedRoundScoreA) {
      throw new Error(`Player A points not restored! Expected ${expectedScoreA}/${expectedRoundScoreA}, got score=${resumeMsgA.payload.player.score}, roundScore=${resumeMsgA.payload.player.roundScore}`);
    }

    if (!restoredRoom.isPaused) {
      throw new Error('CRITICAL BUG: Room unpaused when only Player A returned, even though Player B is still offline!');
    }
    if (!restoredRoom.pauseReason.includes('Шеф Б')) {
      throw new Error(`Pause reason must indicate waiting for Player B (Шеф Б)! Got: ${restoredRoom.pauseReason}`);
    }
    console.log(`✅ Verified: Room STAYS PAUSED waiting for Player B! Reason: "${restoredRoom.pauseReason}"`);

    // 8. Player B reconnects: NOW ALL PLAYERS ARE BACK!
    // The game MUST UNPAUSE!
    console.log('\n--- Step 8: Player B Reconnects (All players back -> MUST UNPAUSE) ---');
    const resumePromiseA = new Promise(resolve => {
      const handler = (d) => {
        const msg = JSON.parse(d.toString());
        if (msg.type === 'GAME_RESUMED') {
          wsA2.off('message', handler);
          resolve(msg);
        }
      };
      wsA2.on('message', handler);
    });

    const wsB2 = new WebSocket(wsUrl2);
    await new Promise(r => wsB2.on('open', r));

    wsB2.send(JSON.stringify({
      type: 'RESUME_SESSION',
      payload: { token: tokenB, playerName: 'Шеф Б', roomId }
    }));

    const resumeMsgB = await new Promise(r => wsB2.once('message', d => r(JSON.parse(d.toString()))));
    console.log(`✅ Player B reconnected. Score: ${resumeMsgB.payload.player.score}, RoundScore: ${resumeMsgB.payload.player.roundScore}`);

    if (resumeMsgB.payload.player.score !== expectedScoreB || resumeMsgB.payload.player.roundScore !== expectedRoundScoreB) {
      throw new Error(`Player B points not restored! Expected ${expectedScoreB}/${expectedRoundScoreB}, got score=${resumeMsgB.payload.player.score}, roundScore=${resumeMsgB.payload.player.roundScore}`);
    }

    const resumedNotice = await resumePromiseA;
    console.log('✅ Player A received GAME_RESUMED!');

    if (restoredRoom.isPaused) {
      throw new Error('Room should be UNPAUSED now that all players are back!');
    }
    console.log('✅ Confirmed: Room unpaused successfully!');

    // Let 1.5 seconds elapse unpaused: timer must resume ticking!
    await new Promise(r => setTimeout(r, 1600));
    const finalTime = restoredRoom.getElapsedSeconds();
    console.log(`⏱️ Resumed gameplay timer: ${finalTime}s (was ${frozenTime}s)`);
    if (finalTime <= frozenTime) {
      throw new Error(`Timer did not resume ticking after unpause! Expected > ${frozenTime}s, got ${finalTime}s`);
    }

    // Clean up
    wsA2.close();
    wsB2.close();

    console.log('\n🎉 ============================================================');
    console.log('🎉  ALL MULTIPLAYER RECONNECT, PAUSE, TIME & SCORE TESTS PASSED!');
    console.log('🎉 ============================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    try { persistence.deleteUser('Шеф А'); } catch (e) {}
    try { persistence.deleteUser('Шеф Б'); } catch (e) {}
    try { persistence.clearRoomState(roomId); } catch (e) {}
    try { persistence.flushSync(); } catch (e) {}
    try { server1?.close(); } catch (e) {}
    try { server2?.close(); } catch (e) {}
  }
}

testMultiplayerReconnectPause();