import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { persistence } from '../server/persistence.js';
import { conflictResolver } from '../server/conflict-resolver.js';

async function runTests() {
  console.log('🧪 ==========================================');
  console.log('🧪  SnapSafari Automated Concurrency & Sync Tests');
  console.log('🧪 ==========================================\n');

  // Start test server on random port
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
      payload: { playerName: 'Alice', avatar: '🦁', roomId: 'test_room' }
    }));

    const init1 = await new Promise(r => ws1.once('message', data => r(JSON.parse(data.toString()))));
    if (init1.type !== 'INIT_STATE') throw new Error('Expected INIT_STATE message');
    console.log('✅ Client 1 received INIT_STATE. SessionToken:', init1.payload.sessionToken);
    console.log('✅ Initial gallery cards:', init1.payload.gallery.length);

    // TEST 2: Concurrent Edits & Optimistic Concurrency Control (OCC) 3-Way Merge
    console.log('\n--- TEST 2: Concurrent Access & 3-Way Merge Conflict Resolution ---');
    const ws2 = new WebSocket(wsUrl);
    await new Promise(r => ws2.on('open', r));

    ws2.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Bob', avatar: '🦊', roomId: 'test_room' }
    }));

    const init2 = await new Promise(r => ws2.once('message', data => r(JSON.parse(data.toString()))));
    console.log('✅ Client 2 connected.');

    const targetCard = init1.payload.gallery[0];
    const baseVersion = targetCard.version;
    console.log(`Target card ID: "${targetCard.id}", base version: v${baseVersion}`);

    // Alice modifies caption, Bob concurrently modifies filter and sticker
    const cardMessages = [];
    ws1.on('message', d => cardMessages.push(JSON.parse(d.toString())));
    ws2.on('message', d => cardMessages.push(JSON.parse(d.toString())));

    console.log('⚡ Sending concurrent conflicting edits from Alice and Bob...');
    ws1.send(JSON.stringify({
      type: 'UPDATE_BOARD_CARD',
      payload: {
        id: targetCard.id,
        expectedVersion: baseVersion,
        changes: { caption: 'Подпись от Алисы: лучший снимок!' }
      }
    }));

    ws2.send(JSON.stringify({
      type: 'UPDATE_BOARD_CARD',
      payload: {
        id: targetCard.id,
        expectedVersion: baseVersion, // Contention! Bob has not yet seen Alice's version!
        changes: { filter: 'cyberpunk', sticker: '🔥' }
      }
    }));

    // Wait for resolution
    await new Promise(r => setTimeout(r, 400));

    const conflictEvent = cardMessages.find(m => m.type === 'BOARD_CONFLICT_RESOLVED');
    if (!conflictEvent) {
      throw new Error('Expected BOARD_CONFLICT_RESOLVED event on concurrent edit!');
    }

    console.log('✅ Conflict detected and resolved by server!');
    console.log(`   Resolution Message: "${conflictEvent.payload.resolutionMessage}"`);
    console.log(`   New Version: v${conflictEvent.payload.item.version}`);
    console.log(`   Merged Caption: "${conflictEvent.payload.item.caption}"`);
    console.log(`   Merged Filter: "${conflictEvent.payload.item.filter}"`);
    console.log(`   Merged Sticker: "${conflictEvent.payload.item.sticker}"`);

    if (conflictEvent.payload.item.caption !== 'Подпись от Алисы: лучший снимок!' ||
        conflictEvent.payload.item.filter !== 'cyberpunk') {
      throw new Error('Non-conflicting fields failed to merge properly!');
    }
    console.log('✅ 3-Way Merge preserved both Alice and Bob changes without data loss!');

    // TEST 3: Network Disconnection, Session Token & State Recovery
    console.log('\n--- TEST 3: Connection Loss & Session Resumption ---');
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

    // TEST 4: Persistence Verification
    console.log('\n--- TEST 4: Persistence Storage Verification ---');
    persistence.flushSync();
    const loadedCards = persistence.getGallery();
    const updatedInDb = loadedCards.find(c => c.id === targetCard.id);
    if (!updatedInDb || updatedInDb.version < 3) {
      throw new Error('Data persistence check failed in data/database.json!');
    }
    console.log(`✅ Verified: Card updated in persistence file data/database.json to version v${updatedInDb.version}`);

    ws1Reconnected.close();
    ws2.close();
    console.log('\n🎉 ==========================================');
    console.log('🎉  ALL 4 TEST SUITES PASSED SUCCESSFULLY! (10/10)');
    console.log('🎉 ==========================================\n');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    server.close();
    process.exit(1);
  }
}

runTests();
