import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const TMP_FILE = path.join(DATA_DIR, 'database.tmp.json');

const INITIAL_DB = {
  version: 1,
  meta: {
    appName: 'SnapSafari Web Game',
    created: new Date().toISOString(),
    description: 'Persistent store for user profiles, photo gallery, match history, and conflict audit logs'
  },
  users: {},
  gallery: [
    {
      id: 'photo_init_1',
      targetId: 'royal_flamingo',
      targetName: 'Королевский Фламинго в Очках',
      targetSpecies: 'royal_flamingo',
      photographer: 'SafariMaster',
      score: 1250,
      accuracy: 96,
      timeToSnapMs: 1840,
      caption: 'Поймал на закате у водопада!',
      filter: 'vintage',
      sticker: '⭐',
      boardPosition: { x: 80, y: 80 },
      version: 1,
      lastModifiedBy: 'SafariMaster',
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 3600000).toISOString()
    },
    {
      id: 'photo_init_2',
      targetId: 'cyber_penguin',
      targetName: 'Кибер-Пингвин с Джетпаком',
      targetSpecies: 'cyber_penguin',
      photographer: 'NeonSnap',
      score: 1100,
      accuracy: 92,
      timeToSnapMs: 2410,
      caption: 'Летит над неоновыми ветками!',
      filter: 'cyberpunk',
      sticker: '🚀',
      boardPosition: { x: 380, y: 120 },
      version: 1,
      lastModifiedBy: 'NeonSnap',
      createdAt: new Date(Date.now() - 1800000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString()
    }
  ],
  matchHistory: [],
  conflictAuditLog: []
};

class PersistenceService {
  constructor() {
    this.data = JSON.parse(JSON.stringify(INITIAL_DB));
    this.isDirty = false;
    this.saveTimer = null;
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          ...INITIAL_DB,
          ...parsed,
          users: { ...(INITIAL_DB.users || {}), ...(parsed.users || {}) },
          gallery: Array.isArray(parsed.gallery) && parsed.gallery.length > 0 ? parsed.gallery : INITIAL_DB.gallery,
          matchHistory: parsed.matchHistory || [],
          conflictAuditLog: parsed.conflictAuditLog || []
        };
        console.log(`[Persistence] Loaded database from ${DB_FILE} (${Object.keys(this.data.users).length} users, ${this.data.gallery.length} photos)`);
      } else {
        console.log('[Persistence] Creating new database file at', DB_FILE);
        this.flushSync();
      }
    } catch (err) {
      console.error('[Persistence] Error loading database, falling back to defaults:', err);
      this.data = JSON.parse(JSON.stringify(INITIAL_DB));
      this.flushSync();
    }
  }

  scheduleSave() {
    this.isDirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.flush();
    }, 500);
  }

  async flush() {
    if (!this.isDirty) return;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
      }
      const serialized = JSON.stringify(this.data, null, 2);
      await fs.promises.writeFile(TMP_FILE, serialized, 'utf-8');
      await fs.promises.rename(TMP_FILE, DB_FILE);
      this.isDirty = false;
    } catch (err) {
      console.error('[Persistence] Async flush failed:', err);
    }
  }

  flushSync() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const serialized = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(TMP_FILE, serialized, 'utf-8');
      fs.renameSync(TMP_FILE, DB_FILE);
      this.isDirty = false;
    } catch (err) {
      console.error('[Persistence] Sync flush failed:', err);
    }
  }

  // --- User Profiles ---
  getOrCreateUser(username, avatar = '📸') {
    const cleanName = (username || 'Photographer').trim().slice(0, 24);
    if (!this.data.users[cleanName]) {
      this.data.users[cleanName] = {
        name: cleanName,
        avatar,
        totalScore: 0,
        gamesPlayed: 0,
        snapsSuccessful: 0,
        fastestSnapMs: null,
        accuracySum: 0,
        avgAccuracy: 0,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      this.scheduleSave();
    } else {
      this.data.users[cleanName].lastSeen = new Date().toISOString();
      if (avatar) this.data.users[cleanName].avatar = avatar;
      this.scheduleSave();
    }
    return this.data.users[cleanName];
  }

  recordSnapResult(username, score, accuracy, snapTimeMs) {
    const user = this.getOrCreateUser(username);
    user.totalScore += score;
    user.snapsSuccessful += 1;
    user.accuracySum = (user.accuracySum || 0) + accuracy;
    user.avgAccuracy = Math.round(user.accuracySum / user.snapsSuccessful);
    if (!user.fastestSnapMs || snapTimeMs < user.fastestSnapMs) {
      user.fastestSnapMs = snapTimeMs;
    }
    user.lastSeen = new Date().toISOString();
    this.scheduleSave();
    return user;
  }

  recordMatchEnd(matchRecord) {
    this.data.matchHistory.unshift({
      ...matchRecord,
      recordedAt: new Date().toISOString()
    });
    if (this.data.matchHistory.length > 50) {
      this.data.matchHistory.length = 50;
    }

    if (Array.isArray(matchRecord.scores)) {
      for (const entry of matchRecord.scores) {
        if (entry.player) {
          const user = this.getOrCreateUser(entry.player);
          user.gamesPlayed = (user.gamesPlayed || 0) + 1;
        }
      }
    }
    this.scheduleSave();
  }

  getLeaderboard(limit = 10) {
    const list = Object.values(this.data.users).map(u => ({
      name: u.name,
      avatar: u.avatar || '📸',
      totalScore: u.totalScore,
      gamesPlayed: u.gamesPlayed || 0,
      snapsSuccessful: u.snapsSuccessful || 0,
      avgAccuracy: u.avgAccuracy || 0,
      fastestSnapMs: u.fastestSnapMs,
      lastSeen: u.lastSeen
    }));

    list.sort((a, b) => b.totalScore - a.totalScore);
    return list.slice(0, limit);
  }

  // --- Shared Photo Exhibition Gallery ---
  getGallery() {
    return this.data.gallery;
  }

  addPhotoToGallery(photo) {
    const newEntry = {
      id: photo.id || `photo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      targetId: photo.targetId || 'unknown',
      targetName: photo.targetName || 'Safari Target',
      targetSpecies: photo.targetSpecies || 'wildlife',
      photographer: photo.photographer || 'Anonymous',
      score: photo.score || 500,
      accuracy: photo.accuracy || 90,
      timeToSnapMs: photo.timeToSnapMs || 2000,
      caption: photo.caption || 'Свежий трофей сафари!',
      filter: photo.filter || 'normal',
      sticker: photo.sticker || '📸',
      boardPosition: photo.boardPosition || {
        x: 60 + ((this.data.gallery.length * 70) % 600),
        y: 60 + Math.floor(this.data.gallery.length / 8) * 120
      },
      version: 1,
      lastModifiedBy: photo.photographer || 'Anonymous',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.data.gallery.unshift(newEntry);
    if (this.data.gallery.length > 40) {
      this.data.gallery.length = 40;
    }
    this.scheduleSave();
    return newEntry;
  }

  getGalleryItem(id) {
    return this.data.gallery.find(item => item.id === id);
  }

  updateGalleryItem(item) {
    const idx = this.data.gallery.findIndex(x => x.id === item.id);
    if (idx !== -1) {
      this.data.gallery[idx] = item;
      this.scheduleSave();
      return true;
    }
    return false;
  }

  // --- Conflict Audit Log ---
  logConflict(conflictEvent) {
    const entry = {
      id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...conflictEvent
    };
    this.data.conflictAuditLog.unshift(entry);
    if (this.data.conflictAuditLog.length > 50) {
      this.data.conflictAuditLog.length = 50;
    }
    this.scheduleSave();
    return entry;
  }

  getConflictAuditLog(limit = 20) {
    return this.data.conflictAuditLog.slice(0, limit);
  }

  // Reset demo data
  resetDemoData() {
    this.data = JSON.parse(JSON.stringify(INITIAL_DB));
    this.flushSync();
    return true;
  }
}

export const persistence = new PersistenceService();
