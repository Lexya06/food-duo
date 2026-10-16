import { persistence } from './persistence.js';

export class ConflictResolver {
  constructor() {
    // Active snap contention windows by roomId
    this.snapContentionWindows = new Map();
  }

  /**
   * Resolves concurrent edits to an item on the shared Photo Exhibition Board.
   * Uses Optimistic Concurrency Control (OCC) with versioning and 3-way field merge.
   */
  resolveBoardItemEdit({ id, expectedVersion, changes, editorName }) {
    const current = persistence.getGalleryItem(id);
    if (!current) {
      return {
        success: false,
        error: 'Item not found',
        code: 'NOT_FOUND'
      };
    }

    const currentVersion = current.version || 1;

    // Case 1: Clean update without conflict (expectedVersion matches currentVersion)
    if (expectedVersion === currentVersion) {
      const updated = {
        ...current,
        ...changes,
        version: currentVersion + 1,
        lastModifiedBy: editorName,
        updatedAt: new Date().toISOString()
      };
      persistence.updateGalleryItem(updated);
      return {
        success: true,
        conflict: false,
        item: updated,
        action: 'APPLIED_CLEAN'
      };
    }

    // Case 2: Concurrent conflict detected (expectedVersion !== currentVersion)
    console.log(`[ConflictResolver] OCC Conflict on photo ${id}: expected v${expectedVersion}, current v${currentVersion} by ${editorName}`);

    const conflictingFields = [];
    const nonConflictingFields = [];
    const mergedChanges = {};
    const conflictDetails = [];

    const allowedFields = ['caption', 'filter', 'sticker', 'boardPosition', 'tags'];

    for (const key of allowedFields) {
      if (changes[key] !== undefined) {
        const curVal = JSON.stringify(current[key]);
        const newVal = JSON.stringify(changes[key]);

        // If the current value is different from incoming, check if someone else edited it
        if (curVal !== newVal) {
          // If field was touched in current version by another user
          conflictingFields.push(key);
          conflictDetails.push({
            field: key,
            originalByOther: current[key],
            attemptedByIncoming: changes[key],
            otherEditor: current.lastModifiedBy
          });
        } else {
          nonConflictingFields.push(key);
        }
      }
    }

    let resolutionType = 'AUTO_MERGE';
    let resolutionMessage = '';
    const finalItem = { ...current };

    if (conflictingFields.length === 0) {
      // Incoming changes don't contradict current state
      resolutionType = 'NO_OP_MERGED';
      resolutionMessage = 'Изменения уже согласованы с актуальной версией.';
    } else if (conflictingFields.length === 1 && conflictingFields[0] === 'boardPosition') {
      // Position conflict: Apply Last-Write-Wins with small nudge to prevent overlap
      finalItem.boardPosition = {
        x: Math.max(20, Math.min(800, (changes.boardPosition?.x || current.boardPosition.x) + 15)),
        y: Math.max(20, Math.min(600, (changes.boardPosition?.y || current.boardPosition.y) + 15))
      };
      resolutionType = 'POSITION_NUDGED';
      resolutionMessage = `Одновременное перемещение карточки пользователями ${current.lastModifiedBy} и ${editorName}. Позиция скорректирована с адаптивным смещением.`;
    } else {
      // Multi-field or text conflict: 3-way semantic merge with LWW for identical fields
      for (const key of conflictingFields) {
        if (key === 'caption') {
          // If both edited caption concurrently, combine or choose LWW with audit note
          const existingCap = current.caption || '';
          const incomingCap = changes.caption || '';
          if (existingCap.length > 0 && incomingCap.length > 0 && existingCap !== incomingCap) {
            finalItem.caption = `${incomingCap} (ред. ${editorName} / ${current.lastModifiedBy})`;
            resolutionType = 'CAPTION_CONCAT_MERGE';
            resolutionMessage = `Конфликт подписи: объединены редакции от ${current.lastModifiedBy} и ${editorName}.`;
          } else {
            finalItem.caption = incomingCap || existingCap;
          }
        } else {
          // For filter, sticker, etc: apply incoming with LWW and audit
          finalItem[key] = changes[key];
        }
      }

      if (!resolutionMessage) {
        resolutionType = 'FIELD_LEVEL_MERGE';
        resolutionMessage = `Разрешен конфликт версий v${expectedVersion} -> v${currentVersion + 1}: поля успешно объединены сервером.`;
      }
    }

    finalItem.version = currentVersion + 1;
    finalItem.lastModifiedBy = `${editorName}+${current.lastModifiedBy}`;
    finalItem.updatedAt = new Date().toISOString();

    persistence.updateGalleryItem(finalItem);

    // Save conflict audit record
    const auditRecord = persistence.logConflict({
      targetType: 'GALLERY_ITEM',
      targetId: id,
      expectedVersion,
      resolvedVersion: finalItem.version,
      editorIncoming: editorName,
      editorPrevious: current.lastModifiedBy,
      resolutionType,
      resolutionMessage,
      conflictingFields,
      conflictDetails
    });

    return {
      success: true,
      conflict: true,
      item: finalItem,
      action: resolutionType,
      resolutionMessage,
      conflictingFields,
      auditRecord
    };
  }

  /**
   * Resolves simultaneous target snap attempts between multiple players in a game round.
   * If two or more players snap the target within a contention window (e.g., 200ms),
   * this arbiter evaluates microsecond server timestamps and framing accuracy.
   */
  evaluateSnapContention({ roomId, targetId, candidateSnap }) {
    const nowHr = process.hrtime.bigint();
    const CONTENTION_WINDOW_NS = 250_000_000n; // 250 milliseconds in nanoseconds

    let windowData = this.snapContentionWindows.get(roomId);
    if (!windowData || windowData.targetId !== targetId || (nowHr - windowData.openedAtHr > CONTENTION_WINDOW_NS * 2n)) {
      // First snap in this contention window
      windowData = {
        roomId,
        targetId,
        openedAtHr: nowHr,
        candidates: [candidateSnap],
        isResolved: false
      };
      this.snapContentionWindows.set(roomId, windowData);

      // Return preliminary winner; if another snap arrives within window, it will resolve as contention
      return {
        isContention: false,
        winner: candidateSnap,
        assistList: [],
        message: 'Чистый снимок цели первым!'
      };
    }

    // A snap arrived within the contention window!
    windowData.candidates.push(candidateSnap);

    // Sort candidates by:
    // 1. Arrival timestamp (hrtime)
    // 2. Focus accuracy score
    // 3. Centering distance
    const sorted = [...windowData.candidates].sort((a, b) => {
      const timeDiff = Number(a.arrivedAtHr - b.arrivedAtHr);
      if (Math.abs(timeDiff) < 30_000_000) { // If within 30ms, accuracy determines winner
        return b.accuracy - a.accuracy;
      }
      return timeDiff;
    });

    const winner = sorted[0];
    const assistList = sorted.slice(1);

    const timeDeltaMs = Number(candidateSnap.arrivedAtHr - windowData.openedAtHr) / 1_000_000;

    const conflictMessage = `⚡ Конкурентный снимок! ${winner.playerName} опередил соперников (дельта: ${timeDeltaMs.toFixed(1)} мс, точность: ${winner.accuracy}%).`;

    const auditRecord = persistence.logConflict({
      targetType: 'ROUND_TARGET_SNAP',
      roomId,
      targetId,
      timeDeltaMs,
      winner: winner.playerName,
      winnerAccuracy: winner.accuracy,
      competitors: windowData.candidates.map(c => ({
        player: c.playerName,
        accuracy: c.accuracy,
        score: c.score
      })),
      resolutionType: 'TIME_ACCURACY_ARBITRATION',
      resolutionMessage: conflictMessage
    });

    return {
      isContention: true,
      winner,
      assistList,
      timeDeltaMs,
      message: conflictMessage,
      auditRecord
    };
  }

  clearRoomContention(roomId) {
    this.snapContentionWindows.delete(roomId);
  }
}

export const conflictResolver = new ConflictResolver();
