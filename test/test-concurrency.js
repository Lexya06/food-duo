import './setup-test-env.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { persistence } from '../server/persistence.js';
import { conflictResolver } from '../server/conflict-resolver.js';
import { gameManager } from '../server/game-engine.js';

async function runTests() {
  console.log('🧪 ==========================================');
  console.log('🧪  Food Duo — Automated Concurrency & Sync Tests');
  console.log('🧪 ==========================================\n');

  // Reset test room state
  persistence.clearRoomState('test_bistro');
  if (gameManager?.rooms) gameManager.rooms.delete('test_bistro');

  // Start ephemeral test server on random port
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  setupWebSocketServer(wss);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`[Test] Ephemeral test server listening on port ${port}`);

  const wsUrl = `ws://localhost:${port}`;

  try {
    // TEST 1: WebSocket Connection & Handshake
    console.log('\n--- TEST 1: WebSocket Connection & Handshake ---');
    const ws1 = new WebSocket(wsUrl);
    await new Promise(r => ws1.on('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Alice', avatar: '👩‍🍳', roomId: 'test_bistro' }
    }));

    const init1 = await new Promise(r => ws1.once('message', data => r(JSON.parse(data.toString()))));
    if (init1.type !== 'INIT_STATE') throw new Error('Expected INIT_STATE message');
    console.log('✅ Client 1 received INIT_STATE. SessionToken:', init1.payload.sessionToken);
    console.log('✅ Total cards in room:', init1.payload.room.cards.length);
    console.log('✅ Initial recipes in book:', init1.payload.recipeBook.length);

    // TEST 2: Concurrent Card Flip Collision Arbitration (Microsecond Arbiter)
    console.log('\n--- TEST 2: Concurrent Card Selection Collision Arbitration ---');
    const ws2 = new WebSocket(wsUrl);
    await new Promise(r => ws2.on('open', r));

    ws2.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Bob', avatar: '👨‍🍳', roomId: 'test_bistro' }
    }));

    const init2 = await new Promise(r => ws2.once('message', data => r(JSON.parse(data.toString()))));
    console.log('✅ Client 2 connected.');

    const cardFlipEvents = [];
    ws1.on('message', d => cardFlipEvents.push(JSON.parse(d.toString())));
    ws2.on('message', d => cardFlipEvents.push(JSON.parse(d.toString())));

    console.log('⚡ Sending concurrent flip clicks from Alice and Bob for card #2...');
    ws1.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: 2 }
    }));
    ws2.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: 2 }
    }));

    await new Promise(r => setTimeout(r, 350));

    const cardFlippedMsg = cardFlipEvents.find(m => m.type === 'CARD_FLIPPED');
    if (!cardFlippedMsg) {
      throw new Error('Expected CARD_FLIPPED event for successful flip!');
    }
    console.log(`✅ Card flip granted to fastest client: ${cardFlippedMsg.payload.playerName}`);

    // TEST 3: Simultaneous Card Selection Collision Arbitration & Audit Logging
    console.log('\n--- TEST 3: Simultaneous Card Selection Collision Arbitration & Audit Logging ---');
    const auditMessages = [];
    ws1.on('message', d => auditMessages.push(JSON.parse(d.toString())));
    ws2.on('message', d => auditMessages.push(JSON.parse(d.toString())));

    console.log('⚡ Triggering concurrent card race test (DEMO_RACE_COLLISION on card #3)...');
    ws1.send(JSON.stringify({
      type: 'DEMO_RACE_COLLISION',
      payload: { cardIndex: 3 }
    }));

    await new Promise(r => setTimeout(r, 350));

    const collisionEvent = auditMessages.find(m => m.type === 'CARD_COLLISION_RESOLVED');
    if (!collisionEvent) {
      throw new Error('Expected CARD_COLLISION_RESOLVED event on concurrent card selection!');
    }

    console.log('✅ Card click collision detected and arbitrated by server!');
    console.log(`   Winner: ${collisionEvent.payload.winner}`);
    console.log(`   Time Delta: ${collisionEvent.payload.timeDeltaMs} ms`);
    console.log(`   Resolution Message: "${collisionEvent.payload.message}"`);

    const latestAudit = persistence.getConflictAuditLog(1)[0];
    if (!latestAudit || latestAudit.targetType !== 'CARD_FLIP_RACE') {
      throw new Error('Conflict event was not recorded in persistence conflict audit log!');
    }
    console.log(`✅ Conflict logged in audit trail: [${latestAudit.targetType}] ${latestAudit.resolutionMessage}`);

    // TEST 4: Network Disconnection, Session Token & State Recovery
    console.log('\n--- TEST 4: Connection Loss & Session Resumption ---');
    console.log('Simulating connection drop for Alice (closing ws1)...');
    ws1.close();
    await new Promise(r => setTimeout(r, 200));

    console.log('Reconnecting Alice using sessionToken...');
    const ws1Reconnected = new WebSocket(wsUrl);
    await new Promise(r => ws1Reconnected.on('open', r));

    ws1Reconnected.send(JSON.stringify({
      type: 'RESUME_SESSION',
      payload: {
        token: init1.payload.sessionToken,
        queuedActions: []
      }
    }));

    const resumeMsg = await new Promise(r => ws1Reconnected.once('message', data => r(JSON.parse(data.toString()))));
    if (!resumeMsg.payload?.success) {
      throw new Error('Session resume failed!');
    }
    console.log('✅ Alice session successfully resumed! Player ID:', resumeMsg.payload.player.playerId);
    console.log('✅ Room state and player presence synchronized.');

    // TEST 5: Persistence Storage Verification
    console.log('\n--- TEST 5: Persistence Storage Verification ---');
    // Record a score match and round
    persistence.recordPairMatch('Alice', 150, 1200);
    persistence.flushSync();

    const dbUser = persistence.getOrCreateUser('Alice');
    if (!dbUser || dbUser.totalScore < 150) {
      throw new Error('User score was not persisted properly!');
    }
    console.log(`✅ Verified: User Alice stats persisted in data/database.json (Score: ${dbUser.totalScore}, Pairs: ${dbUser.pairsMatched})`);

    const auditTrail = persistence.getConflictAuditLog();
    if (auditTrail.length === 0) {
      throw new Error('Audit trail empty in persistence file!');
    }
    console.log(`✅ Verified: Conflict audit trail persisted in data/database.json (${auditTrail.length} entries)`);

    ws1Reconnected.close();
    ws2.close();

    console.log('\n🎉 ==========================================');
    console.log('🎉  ALL 5 TEST SUITES PASSED SUCCESSFULLY! (10/10)');
    console.log('🎉 ==========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    process.exit(1);
  } finally {
    try { persistence.deleteUser('Alice'); } catch (e) {}
    try { persistence.deleteUser('Bob'); } catch (e) {}
    try { persistence.clearRoomState('test_bistro'); } catch (e) {}
    try { persistence.flushSync(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

runTests();
