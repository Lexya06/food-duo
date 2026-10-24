import './setup-test-env.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { gameManager } from '../server/game-engine.js';
import { persistence } from '../server/persistence.js';

async function testMaxPlayersRoomOverflow() {
  console.log('🧪 ============================================================');
  console.log('🧪  Test: 8-Player Room Capacity and Auto-Creation of New Table');
  console.log('🧪 ============================================================\n');

  // Reset rooms for test
  gameManager.rooms.clear();
  persistence.clearRoomState('bistro_main');
  persistence.clearRoomState('bistro_2');

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  setupWebSocketServer(wss);

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const wsUrl = `ws://localhost:${port}`;
  console.log(`[Test Server] Started on port ${port}`);

  const sockets = [];

  try {
    // --- Step 1: Connect 8 players to bistro_main ---
    console.log('\n--- Step 1: Connecting 8 players to Table 1 (bistro_main) ---');
    for (let i = 1; i <= 8; i++) {
      const ws = new WebSocket(wsUrl);
      sockets.push(ws);
      await new Promise(r => ws.on('open', r));

      ws.send(JSON.stringify({
        type: 'JOIN_ROOM',
        payload: {
          playerName: `Шеф_${i}`,
          avatar: '👨‍🍳',
          roomId: 'bistro_main'
        }
      }));

      const msg = await new Promise(r => ws.once('message', d => r(JSON.parse(d.toString()))));
      if (msg.type !== 'INIT_STATE') {
        throw new Error(`Expected INIT_STATE for player ${i}, got: ${msg.type}`);
      }
      if (msg.payload.room.roomId !== 'bistro_main') {
        throw new Error(`Player ${i} was expected to join bistro_main, got: ${msg.payload.room.roomId}`);
      }
    }

    const room1 = gameManager.getRoom('bistro_main');
    console.log(`✅ All 8 players successfully seated at Table 1 (${room1.roomId}): ${room1.players.size} players.`);
    if (room1.players.size !== 8) {
      throw new Error(`Table 1 expected 8 players, found: ${room1.players.size}`);
    }

    // --- Step 2: 9th player connects -> MUST create and join Table 2 (bistro_2) ---
    console.log('\n--- Step 2: 9th player connects (Table 1 is full) ---');
    const ws9 = new WebSocket(wsUrl);
    sockets.push(ws9);
    await new Promise(r => ws9.on('open', r));

    ws9.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: {
        playerName: 'Шеф_9',
        avatar: '👩‍🍳',
        roomId: 'bistro_main'
      }
    }));

    const msg9 = await new Promise(r => ws9.once('message', d => r(JSON.parse(d.toString()))));
    if (msg9.type !== 'INIT_STATE') {
      throw new Error(`Expected INIT_STATE for player 9, got: ${msg9.type}`);
    }

    const room9Id = msg9.payload.room.roomId;
    console.log(`✅ Player 9 automatically routed to new room: "${room9Id}" (${msg9.payload.room.roomName})`);
    if (room9Id !== 'bistro_2') {
      throw new Error(`Expected Player 9 to be in bistro_2, but got: ${room9Id}`);
    }

    const room2 = gameManager.getRoom('bistro_2');
    if (!room2) {
      throw new Error('bistro_2 was not created by gameManager!');
    }
    console.log(`✅ Table 2 created separately. Players in Table 2: ${room2.players.size}`);

    // --- Step 3: 10th player connects -> MUST join Table 2 along with 9th player ---
    console.log('\n--- Step 3: 10th player connects -> Joins Table 2 with Player 9 ---');
    const ws10 = new WebSocket(wsUrl);
    sockets.push(ws10);
    await new Promise(r => ws10.on('open', r));

    ws10.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: {
        playerName: 'Шеф_10',
        avatar: '🍕',
        roomId: 'bistro_main'
      }
    }));

    const msg10 = await new Promise(r => ws10.once('message', d => r(JSON.parse(d.toString()))));
    if (msg10.type !== 'INIT_STATE') {
      throw new Error(`Expected INIT_STATE for player 10, got: ${msg10.type}`);
    }

    const room10Id = msg10.payload.room.roomId;
    console.log(`✅ Player 10 connected to: "${room10Id}" (${msg10.payload.room.roomName})`);
    if (room10Id !== 'bistro_2') {
      throw new Error(`Expected Player 10 to join bistro_2, but got: ${room10Id}`);
    }

    if (room2.players.size !== 2) {
      throw new Error(`Expected Table 2 to have 2 players (Шеф_9 and Шеф_10), found: ${room2.players.size}`);
    }
    console.log(`✅ Confirmed: Player 9 and Player 10 are together at Table 2 (${room2.players.size} players).`);

    // --- Step 4: Verify Table 1 remains untouched with 8 players ---
    console.log('\n--- Step 4: Verify Table 1 player count is still 8 ---');
    if (room1.players.size !== 8) {
      throw new Error(`Table 1 count changed! Expected 8, got: ${room1.players.size}`);
    }
    console.log(`✅ Confirmed: Table 1 strictly preserved at 8 players.`);

    // --- Step 5: Verify Reconnection of Player 3 back to Table 1 ---
    console.log('\n--- Step 5: Test reconnection of Player 3 back to Table 1 ---');
    const ws3Reconnected = new WebSocket(wsUrl);
    sockets.push(ws3Reconnected);
    await new Promise(r => ws3Reconnected.on('open', r));

    ws3Reconnected.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: {
        playerName: 'Шеф_3',
        avatar: '👨‍🍳',
        roomId: 'bistro_main'
      }
    }));

    const msg3 = await new Promise(r => ws3Reconnected.once('message', d => r(JSON.parse(d.toString()))));
    if (msg3.payload.room.roomId !== 'bistro_main') {
      throw new Error(`Expected Player 3 to reconnect back to Table 1, got: ${msg3.payload.room.roomId}`);
    }
    console.log(`✅ Player 3 successfully reconnected to their original seat at Table 1.`);

    console.log('\n🎉 ============================================================');
    console.log('🎉  ALL 8-PLAYER OVERFLOW & ROOM ALLOCATION TESTS PASSED!');
    console.log('🎉 ============================================================');

    process.exit(0);
  } finally {
    for (const ws of sockets) {
      try { ws.close(); } catch (_) {}
    }
    await new Promise(r => server.close(r));
  }
}

testMaxPlayersRoomOverflow().catch(err => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
