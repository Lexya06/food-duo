import { persistence } from './persistence.js';

export class ConflictResolver {
  constructor() {
    // Active contention windows by room: contentionKey -> windowData
    this.cardContentionWindows = new Map();
  }

  /**
   * Resolves simultaneous attempts to flip the same card on the game table.
   * If two or more players click a card within contention window (250ms),
   * this arbiter uses microsecond server timestamps (process.hrtime.bigint()) to determine the winner.
   */
  evaluateCardFlipContention({ roomId, cardIndex, candidateFlip }) {
    const nowHr = process.hrtime.bigint();
    const CONTENTION_WINDOW_NS = 250_000_000n; // 250ms in nanoseconds
    const contentionKey = `${roomId}_card_${cardIndex}`;

    let windowData = this.cardContentionWindows.get(contentionKey);

    if (!windowData || (nowHr - windowData.openedAtHr > CONTENTION_WINDOW_NS * 2n)) {
      // First click in this window
      windowData = {
        roomId,
        cardIndex,
        openedAtHr: nowHr,
        candidates: [candidateFlip],
        isResolved: false
      };
      this.cardContentionWindows.set(contentionKey, windowData);

      return {
        isContention: false,
        winner: candidateFlip,
        assistList: [],
        message: 'Карточка успешно выбрана первым!'
      };
    }

    // Contention detected! Another player clicked the exact same card in the window
    windowData.candidates.push(candidateFlip);

    // Sort candidates by arrival timestamp (hrtime)
    const sorted = [...windowData.candidates].sort((a, b) => {
      const diff = Number(a.arrivedAtHr - b.arrivedAtHr);
      return diff;
    });

    const winner = sorted[0];
    const competitors = sorted.slice(1);
    const timeDeltaMs = Number(candidateFlip.arrivedAtHr - windowData.openedAtHr) / 1_000_000;

    const conflictMessage = `⚡ Конкурентный клик! ${winner.playerName} нажал на карточку #${cardIndex + 1} на ${timeDeltaMs.toFixed(1)} мс быстрее!`;

    const auditRecord = persistence.logConflict({
      targetType: 'CARD_FLIP_RACE',
      targetId: `card_${cardIndex + 1}`,
      targetTitle: `Карточка #${cardIndex + 1}`,
      roomId,
      cardIndex,
      timeDeltaMs: Number(timeDeltaMs.toFixed(2)),
      winner: winner.playerName,
      competitors: windowData.candidates.map(c => c.playerName),
      resolutionType: 'MICROSECOND_TIME_ARBITRATION',
      resolutionMessage: conflictMessage
    });

    return {
      isContention: true,
      winner,
      assistList: competitors,
      timeDeltaMs,
      message: conflictMessage,
      auditRecord
    };
  }

  clearRoomContention(roomId) {
    for (const [key] of this.cardContentionWindows.entries()) {
      if (key.startsWith(`${roomId}_`)) {
        this.cardContentionWindows.delete(key);
      }
    }
  }
}

export const conflictResolver = new ConflictResolver();
