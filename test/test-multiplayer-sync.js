import './setup-test-env.js';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { setupWebSocketServer } from '../server/ws-handler.js';
import { gameManager, DEFAULT_MISMATCH_TIMEOUT_MS } from '../server/game-engine.js';
import { persistence } from '../server/persistence.js';

async function testMultiplayer() {
  console.log('🧪 Starting Multiplayer Realtime Sync Test...');

  // Reset room and persistence for clean test run
  persistence.clearRoomState('multi_room');
  gameManager.rooms.delete('multi_room');

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  setupWebSocketServer(wss);

  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const wsUrl = `ws://localhost:${port}`;

  try {
    // 1. Connect Client 1
    const ws1 = new WebSocket(wsUrl);
    await new Promise(r => ws1.on('open', r));

    ws1.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Шеф 1', avatar: '👨‍🍳', roomId: 'multi_room' }
    }));

    const init1 = await new Promise(r => ws1.once('message', d => r(JSON.parse(d.toString()))));
    console.log('✅ Client 1 connected, playerId:', init1.payload.player.playerId);

    // 2. Connect Client 2
    const ws2 = new WebSocket(wsUrl);
    await new Promise(r => ws2.on('open', r));

    ws2.send(JSON.stringify({
      type: 'JOIN_ROOM',
      payload: { playerName: 'Шеф 2', avatar: '👩‍🍳', roomId: 'multi_room' }
    }));

    const init2 = await new Promise(r => ws2.once('message', d => r(JSON.parse(d.toString()))));
    console.log('✅ Client 2 connected, playerId:', init2.payload.player.playerId);

    if (init1.payload.player.playerId === init2.payload.player.playerId) {
      throw new Error('Client 1 and Client 2 got the same playerId! They must be distinct players.');
    }

    // 3. Test Profile Update with OK button (UPDATE_PROFILE)
    console.log('Testing UPDATE_PROFILE from Client 1...');
    const client2MsgPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PLAYER_UPDATED') {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    ws1.send(JSON.stringify({
      type: 'UPDATE_PROFILE',
      payload: { playerName: 'Супер-Шеф', avatar: '/avatars/pizza.svg' }
    }));

    const playerUpdated = await client2MsgPromise;
    console.log('✅ Client 2 received PLAYER_UPDATED:', playerUpdated.payload.player.name, playerUpdated.payload.player.avatar);
    if (playerUpdated.payload.player.name !== 'Супер-Шеф' || playerUpdated.payload.player.avatar !== '/avatars/pizza.svg') {
      throw new Error('Profile update failed to propagate!');
    }

    // 4. Test Card Flip Synchronization
    console.log('Testing Card Flip Synchronization...');
    const client2FlipPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CARD_FLIPPED') {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    ws1.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: 0 }
    }));

    const flipMsg = await client2FlipPromise;
    console.log(`✅ Client 2 received CARD_FLIPPED for card #${flipMsg.payload.cardIndex}: ${flipMsg.payload.card.emoji} ${flipMsg.payload.card.name}`);
    if (!flipMsg.payload.card.isFlipped) {
      throw new Error('Card should be flipped!');
    }

    // 5. Test Card Mismatch and CARDS_UNFLIPPED
    console.log('Testing Mismatch and CARDS_UNFLIPPED synchronization...');
    // Find a card that is NOT the match for card 0
    const room = gameManager.getRoom('multi_room');
    room.mismatchTimeoutMs = 500; // Fast timeout for test
    const card0 = room.cards[0];
    let nonMatchingIndex = 1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId !== card0.pairId) {
        nonMatchingIndex = i;
        break;
      }
    }

    const unflipPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CARDS_UNFLIPPED') {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    ws1.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: nonMatchingIndex }
    }));

    const unflipMsg = await unflipPromise;
    console.log('✅ Client 2 received CARDS_UNFLIPPED for indices:', unflipMsg.payload.cardIndices);
    if (!unflipMsg.payload.cardIndices.includes(0) || !unflipMsg.payload.cardIndices.includes(nonMatchingIndex)) {
      throw new Error('CARDS_UNFLIPPED missing expected indices!');
    }
    room.mismatchTimeoutMs = DEFAULT_MISMATCH_TIMEOUT_MS; // Restore default

    // 5b. Test Single Card Auto-Unflip on Timeout (Anti-Deadlock Mechanism)
    console.log('Testing Single Card Auto-Unflip on Timeout (Deadlock Prevention)...');
    room.singleCardTimeoutMs = 500; // Fast timeout for test

    const singleFlipPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CARD_FLIPPED' && msg.payload.cardIndex === nonMatchingIndex) {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    const singleUnflipPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'CARDS_UNFLIPPED') {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    // Client 1 flips card, then waits without clicking a second card
    ws1.send(JSON.stringify({
      type: 'FLIP_CARD',
      payload: { cardIndex: nonMatchingIndex }
    }));

    await singleFlipPromise;
    console.log(`✅ Client 1 opened single card #${nonMatchingIndex}, waiting for auto-unflip timeout...`);

    const autoUnflipMsg = await singleUnflipPromise;
    console.log('✅ Client 2 received CARDS_UNFLIPPED on timeout for single card:', autoUnflipMsg.payload.cardIndices);
    if (!autoUnflipMsg.payload.cardIndices.includes(nonMatchingIndex)) {
      throw new Error('Auto-unflip on timeout missing target card index!');
    }
    if (room.cards[nonMatchingIndex].isFlipped) {
      throw new Error('Card should be face-down after timeout!');
    }
    room.singleCardTimeoutMs = 4000; // Restore default

    // 6. Test Pair Match & Discovered Recipe
    console.log('Testing Pair Match & Discovered Recipe...');
    let matchingIndex = -1;
    for (let i = 1; i < room.cards.length; i++) {
      if (room.cards[i].pairId === card0.pairId) {
        matchingIndex = i;
        break;
      }
    }

    const matchPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'PAIR_MATCHED') {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    // Flip card 0 again
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: 0 } }));
    await new Promise(r => setTimeout(r, 100));
    // Flip matching card
    ws1.send(JSON.stringify({ type: 'FLIP_CARD', payload: { cardIndex: matchingIndex } }));

    const matchMsg = await matchPromise;
    console.log('✅ Client 2 received PAIR_MATCHED:', matchMsg.payload.matchedFood.pairTitle);
    if (!matchMsg.payload.matchedPair) {
      throw new Error('Expected matchedPair in PAIR_MATCHED payload!');
    }
    console.log('✅ Discovered pair recipe generated:', matchMsg.payload.matchedPair.pairTitle);

    // 7. Test Disconnect & Progress Preservation on Reconnect
    console.log('Testing Progress Preservation on Disconnection & Reconnection...');
    const originalScore = matchMsg.payload.player.score;
    const client1Token = init1.payload.sessionToken;

    // Disconnect client 1
    ws1.close();
    await new Promise(r => setTimeout(r, 200));

    // Reconnect client 1 with same sessionToken
    const ws1Reconnected = new WebSocket(wsUrl);
    await new Promise(r => ws1Reconnected.on('open', r));

    ws1Reconnected.send(JSON.stringify({
      type: 'RESUME_SESSION',
      payload: {
        token: client1Token,
        playerName: 'Супер-Шеф',
        roomId: 'multi_room'
      }
    }));

    const resumedMsg = await new Promise(r => ws1Reconnected.once('message', d => r(JSON.parse(d.toString()))));
    console.log('✅ Client 1 reconnected. Player score:', resumedMsg.payload.player.score, 'Discovered recipes:', resumedMsg.payload.player.roundDiscoveredRecipes?.length);
    if (resumedMsg.payload.player.score !== originalScore) {
      throw new Error(`Player score was lost upon reconnect! Expected ${originalScore}, got ${resumedMsg.payload.player.score}`);
    }
    if (!resumedMsg.payload.player.roundDiscoveredRecipes || resumedMsg.payload.player.roundDiscoveredRecipes.length === 0) {
      throw new Error('Discovered recipes were lost upon reconnect!');
    }
    console.log('✅ Progress preservation verified: score and recipes retained!');

    // 8. Test Consensus Restart (Only starts when ALL players click restart)
    console.log('Testing Consensus Restart (both players must click)...');
    const voteUpdatedPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'RESTART_VOTE_UPDATED') {
          ws2.off('message', handler);
          resolve(msg);
        }
      };
      ws2.on('message', handler);
    });

    // Client 1 votes to restart
    ws1Reconnected.send(JSON.stringify({ type: 'RESTART_ROUND' }));

    const voteMsg = await voteUpdatedPromise;
    console.log(`✅ Client 2 received RESTART_VOTE_UPDATED: ${voteMsg.payload.readyCount} / ${voteMsg.payload.totalNeeded} players ready`);
    if (voteMsg.payload.readyCount !== 1 || voteMsg.payload.totalNeeded !== 2) {
      throw new Error('Expected 1 of 2 players ready!');
    }

    // Now Client 2 votes to restart -> round should start!
    const roundStartedPromise = new Promise(resolve => {
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ROUND_STARTED') {
          ws1Reconnected.off('message', handler);
          resolve(msg);
        }
      };
      ws1Reconnected.on('message', handler);
    });

    ws2.send(JSON.stringify({ type: 'RESTART_ROUND' }));

    const roundStartedMsg = await roundStartedPromise;
    console.log('✅ Both players confirmed: ROUND_STARTED received! New round:', roundStartedMsg.payload.room.roundNumber);
    if (roundStartedMsg.payload.room.roundState !== 'ACTIVE') {
      throw new Error('Round state should be ACTIVE!');
    }

    ws1Reconnected.close();
    ws2.close();

    console.log('\n🎉 ALL MULTIPLAYER REALTIME SYNC TESTS PASSED! 🎉\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Multiplayer sync test failed:', err);
    process.exit(1);
  } finally {
    try { persistence.deleteUser('Шеф 1'); } catch (e) {}
    try { persistence.deleteUser('Шеф 2'); } catch (e) {}
    try { persistence.deleteUser('Супер-Шеф'); } catch (e) {}
    try { persistence.clearRoomState('multi_room'); } catch (e) {}
    try { persistence.flushSync(); } catch (e) {}
    try { server.close(); } catch (e) {}
  }
}

testMultiplayer();
