import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

export function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), String(salt), 100000, 64, 'sha512').toString('hex');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'database.json');
const TMP_FILE = path.join(path.dirname(DB_FILE), path.basename(DB_FILE, '.json') + '.tmp.json');
const TEST_DB_FILE = process.env.TEST_DB_FILE ? path.resolve(process.env.TEST_DB_FILE) : path.join(DATA_DIR, 'test_database.json');
const TEST_TMP_FILE = path.join(path.dirname(TEST_DB_FILE), path.basename(TEST_DB_FILE, '.json') + '.tmp.json');

export const DEFAULT_AVATAR = '/avatars/chef_male.svg';

export function normalizeAvatarPath(avatar) {
  if (!avatar) return DEFAULT_AVATAR;
  if (typeof avatar === 'string') {
    if (avatar.startsWith('/') || avatar.startsWith('http') || avatar.startsWith('data:')) {
      return avatar;
    }
  }
  const map = {
    '👨‍🍳': '/avatars/chef_male.svg',
    '👩‍🍳': '/avatars/chef_female.svg',
    '🦊': '/avatars/fox.svg',
    '🐼': '/avatars/panda.svg',
    '🦁': '/avatars/lion.svg',
    '🐱': '/avatars/cat.svg',
    '🍕': '/avatars/pizza.svg',
    '🍔': '/avatars/burger.svg',
    '⭐': '/avatars/chef_male.svg',
    '🍩': '/avatars/pizza.svg'
  };
  return map[avatar] || DEFAULT_AVATAR;
}

export function saveAvatarFile(dataUrl, usernameOrId = 'user') {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return normalizeAvatarPath(dataUrl);
  }
  try {
    const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
    if (!matches) return normalizeAvatarPath(dataUrl);
    let ext = matches[1].toLowerCase();
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'svg+xml') ext = 'svg';
    const buffer = Buffer.from(matches[2], 'base64');
    const safeName = String(usernameOrId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 16) || 'chef';
    const filename = `avatar_${safeName}_${Date.now()}.${ext}`;
    const avatarsDir = path.join(PUBLIC_DIR, 'avatars');
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }
    const filePath = path.join(avatarsDir, filename);
    fs.writeFileSync(filePath, buffer);
    return `/avatars/${filename}`;
  } catch (err) {
    console.error('[Persistence] Error saving avatar file:', err);
    return DEFAULT_AVATAR;
  }
}

export function isTestPlayerName(name) {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  if (/^(тест|test)/i.test(n)) return true;
  if (/^(шеф|chef)/i.test(n)) return true;
  if (/^шеф-повар/i.test(n)) return true;
  if (/^(супер-шеф|super-chef)/i.test(n)) return true;
  if (/^(alice|bob)$/i.test(n)) return true;
  if (/^(гость|guest|игрок|player)/i.test(n)) return true;
  if (/^(гурман|су-шеф)/i.test(n)) return true;
  return false;
}

export function isTestRoom(roomId) {
  if (!roomId) return false;
  const r = String(roomId).trim().toLowerCase();
  return r.startsWith('test_') || r.startsWith('multi_') || r.startsWith('rm_') || r === 'bistro_test';
}

// Complementary Food Pairs (every card is 100% unique - 16 cards form 8 distinct pairs)
export const DEFAULT_FOOD_PAIRS = [
  {
    pairId: 'pair_burger_fries',
    title: 'Бургер + Картошка Фри',
    cardA: { foodId: 'burger', name: 'Бургер', emoji: '🍔', partnerName: 'Картофель Фри', color: '#ff7043' },
    cardB: { foodId: 'fries', name: 'Картофель Фри', emoji: '🍟', partnerName: 'Бургер', color: '#ffb300' }
  },
  {
    pairId: 'pair_pizza_soda',
    title: 'Пицца + Газировка',
    cardA: { foodId: 'pizza', name: 'Пицца', emoji: '🍕', partnerName: 'Газировка', color: '#e53935' },
    cardB: { foodId: 'soda', name: 'Газировка', emoji: '🥤', partnerName: 'Пицца', color: '#d81b60' }
  },
  {
    pairId: 'pair_coffee_donut',
    title: 'Кофе + Пончик',
    cardA: { foodId: 'coffee', name: 'Кофе', emoji: '☕', partnerName: 'Пончик', color: '#6d4c41' },
    cardB: { foodId: 'donut', name: 'Пончик', emoji: '🍩', partnerName: 'Кофе', color: '#ec407a' }
  },
  {
    pairId: 'pair_pancakes_honey',
    title: 'Блины + Мед',
    cardA: { foodId: 'pancakes', name: 'Блинчики', emoji: '🥞', partnerName: 'Мед', color: '#fbc02d' },
    cardB: { foodId: 'honey', name: 'Мед', emoji: '🍯', partnerName: 'Блинчики', color: '#ffa000' }
  },
  {
    pairId: 'pair_sushi_chopsticks',
    title: 'Суши + Палочки',
    cardA: { foodId: 'sushi', name: 'Суши', emoji: '🍣', partnerName: 'Палочки и соус', color: '#fb8c00' },
    cardB: { foodId: 'chopsticks', name: 'Палочки и соус', emoji: '🥢', partnerName: 'Суши', color: '#8e24aa' }
  },
  {
    pairId: 'pair_pasta_cheese',
    title: 'Спагетти + Сыр',
    cardA: { foodId: 'pasta', name: 'Спагетти', emoji: '🍝', partnerName: 'Сыр Пармезан', color: '#e64a19' },
    cardB: { foodId: 'cheese', name: 'Сыр Пармезан', emoji: '🧀', partnerName: 'Спагетти', color: '#fbc02d' }
  },
  {
    pairId: 'pair_sandwich_juice',
    title: 'Сэндвич + Сок',
    cardA: { foodId: 'sandwich', name: 'Сэндвич', emoji: '🥪', partnerName: 'Свежий сок', color: '#7cb342' },
    cardB: { foodId: 'juice', name: 'Свежий сок', emoji: '🧃', partnerName: 'Сэндвич', color: '#00acc1' }
  },
  {
    pairId: 'pair_icecream_strawberry',
    title: 'Мороженое + Клубника',
    cardA: { foodId: 'icecream', name: 'Мороженое', emoji: '🍦', partnerName: 'Клубника', color: '#ab47bc' },
    cardB: { foodId: 'strawberry', name: 'Клубника', emoji: '🍓', partnerName: 'Мороженое', color: '#e91e63' }
  },
  {
    pairId: 'pair_dumplings_sourcream',
    title: 'Пельмени + Сметана',
    cardA: { foodId: 'dumplings', name: 'Пельмени', emoji: '🥟', partnerName: 'Сметана', color: '#78909c' },
    cardB: { foodId: 'sourcream', name: 'Сметана', emoji: '🍶', partnerName: 'Пельмени', color: '#90a4ae' }
  },
  {
    // Fix: Taco is paired with Burrito (Mexican duo!)
    pairId: 'pair_taco_burrito',
    title: 'Тако + Буррито',
    cardA: { foodId: 'taco', name: 'Тако', emoji: '🌮', partnerName: 'Буррито', color: '#f57c00' },
    cardB: { foodId: 'burrito', name: 'Буррито', emoji: '🌯', partnerName: 'Тако', color: '#e65100' }
  },
  {
    pairId: 'pair_croissant_chocolate',
    title: 'Круассан + Шоколад',
    cardA: { foodId: 'croissant', name: 'Круассан', emoji: '🥐', partnerName: 'Шоколад', color: '#ffb74d' },
    cardB: { foodId: 'chocolate', name: 'Шоколад', emoji: '🍫', partnerName: 'Круассан', color: '#5d4037' }
  },
  {
    pairId: 'pair_ramen_egg',
    title: 'Рамен + Яйцо',
    cardA: { foodId: 'ramen', name: 'Рамен', emoji: '🍜', partnerName: 'Яйцо', color: '#bcaaa4' },
    cardB: { foodId: 'egg', name: 'Яйцо', emoji: '🥚', partnerName: 'Рамен', color: '#ffe082' }
  },
  {
    pairId: 'pair_tea_cookie',
    title: 'Чай + Печенье',
    cardA: { foodId: 'tea', name: 'Зеленый Чай', emoji: '🍵', partnerName: 'Печенье', color: '#26a69a' },
    cardB: { foodId: 'cookie', name: 'Печенье', emoji: '🍪', partnerName: 'Зеленый Чай', color: '#8d6e63' }
  },
  {
    pairId: 'pair_popcorn_cocktail',
    title: 'Попкорн + Коктейль',
    cardA: { foodId: 'popcorn', name: 'Попкорн', emoji: '🍿', partnerName: 'Коктейль', color: '#ffd54f' },
    cardB: { foodId: 'cocktail', name: 'Коктейль', emoji: '🍹', partnerName: 'Попкорн', color: '#29b6f6' }
  }
];

export const INITIAL_UNLOCKED_RECIPES = [
  {
    id: 'recipe_pair_burger_fries',
    foodId: 'pair_burger_fries',
    pairId: 'pair_burger_fries',
    name: 'Бургер + Картошка Фри',
    emoji: '🍔 🍟',
    category: 'Американская классика',
    calories: 'Идеальное комбо',
    secretIngredient: 'Трюфельный соус и чеддер',
    spiceLevel: 1,
    sticker: '🔥',
    chefNotes: 'Сочный бифштекс и золотистая хрустящая соломка!',
    discoveredBy: 'Шеф-Повар',
    version: 1,
    lastModifiedBy: 'Шеф-Повар',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 'recipe_pair_pizza_soda',
    foodId: 'pair_pizza_soda',
    pairId: 'pair_pizza_soda',
    name: 'Пицца + Газировка',
    emoji: '🍕 🥤',
    category: 'Итальянская классика',
    calories: 'Идеальное комбо',
    secretIngredient: 'Моцарелла и ледяная кола',
    spiceLevel: 2,
    sticker: '⭐',
    chefNotes: 'Хрустящий бортик и освежающий газированный напиток!',
    discoveredBy: 'Шеф-Повар',
    version: 1,
    lastModifiedBy: 'Шеф-Повар',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString()
  },
  {
    id: 'recipe_pair_taco_burrito',
    foodId: 'pair_taco_burrito',
    pairId: 'pair_taco_burrito',
    name: 'Тако + Буррито',
    emoji: '🌮 🌯',
    category: 'Мексиканский дуэт',
    calories: 'Идеальное комбо',
    secretIngredient: 'Острая сальса и специи тако',
    spiceLevel: 4,
    sticker: '🔥',
    chefNotes: 'Хрустящая кукурузная лепешка и нежный сытный буррито!',
    discoveredBy: 'Шеф-Повар',
    version: 1,
    lastModifiedBy: 'Шеф-Повар',
    createdAt: new Date(Date.now() - 900000).toISOString(),
    updatedAt: new Date(Date.now() - 900000).toISOString()
  }
];

export const INITIAL_RECIPE_BOOK = INITIAL_UNLOCKED_RECIPES;

const INITIAL_DB = {
  version: 3,
  meta: {
    appName: 'Food Duo — Найди Пару: Еда (СПП ЛР4)',
    created: new Date().toISOString(),
    description: 'Персистентное хранилище: каталог пар еды, открытые рецепты (достижения), игроки и журнал аудита конфликтов'
  },
  foodPairs: DEFAULT_FOOD_PAIRS,
  users: {},
  activeRooms: {},
  sessions: {},
  authTokens: {},
  unlockedRecipes: INITIAL_UNLOCKED_RECIPES,
  conflictAuditLog: []
};

class PersistenceService {
  constructor(customDbFile = null) {
    this.dbFile = customDbFile ? path.resolve(customDbFile) : DB_FILE;
    this.tmpFile = path.join(path.dirname(this.dbFile), path.basename(this.dbFile, '.json') + '.tmp.json');
    this.testDbFile = this.dbFile.includes('.test.') ? this.dbFile : TEST_DB_FILE;
    this.testTmpFile = path.join(path.dirname(this.testDbFile), path.basename(this.testDbFile, '.json') + '.tmp.json');

    this.data = JSON.parse(JSON.stringify(INITIAL_DB));
    this.testData = {
      users: {},
      activeRooms: {},
      sessions: {},
      authTokens: {}
    };
    this.isDirty = false;
    this.isTestDirty = false;
    this.saveTimer = null;
    this.testSaveTimer = null;
    this.init();
  }

  setDatabaseFile(customPath) {
    if (!customPath) return;
    this.dbFile = path.resolve(customPath);
    this.tmpFile = path.join(path.dirname(this.dbFile), path.basename(this.dbFile, '.json') + '.tmp.json');
    this.testDbFile = this.dbFile.includes('.test.') ? this.dbFile : TEST_DB_FILE;
    this.testTmpFile = path.join(path.dirname(this.testDbFile), path.basename(this.testDbFile, '.json') + '.tmp.json');
    this.init();
  }

  init() {
    try {
      const dataDir = path.dirname(this.dbFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf-8');
        const parsed = JSON.parse(raw);

        // Normalize food pairs (migrate or load from file)
        const loadedFoodPairs = Array.isArray(parsed.foodPairs) && parsed.foodPairs.length >= 8
          ? parsed.foodPairs
          : DEFAULT_FOOD_PAIRS;

        // Ensure Taco pair is Burrito in loadedFoodPairs
        const tacoPair = loadedFoodPairs.find(p => p.pairId === 'pair_taco_avocado' || p.pairId === 'pair_taco_burrito');
        if (tacoPair) {
          tacoPair.pairId = 'pair_taco_burrito';
          tacoPair.title = 'Тако + Буррито';
          tacoPair.cardA = { foodId: 'taco', name: 'Тако', emoji: '🌮', partnerName: 'Буррито', color: '#f57c00' };
          tacoPair.cardB = { foodId: 'burrito', name: 'Буррито', emoji: '🌯', partnerName: 'Тако', color: '#e65100' };
        }

        // Unlocked recipes
        let loadedRecipes = parsed.unlockedRecipes || parsed.recipeBook;
        if (!Array.isArray(loadedRecipes) || loadedRecipes.length === 0) {
          loadedRecipes = INITIAL_UNLOCKED_RECIPES;
        }

        this.data = {
          ...INITIAL_DB,
          ...parsed,
          foodPairs: loadedFoodPairs,
          users: { ...(parsed.users || {}) },
          activeRooms: parsed.activeRooms || {},
          sessions: parsed.sessions || {},
          authTokens: parsed.authTokens || {},
          unlockedRecipes: loadedRecipes,
          recipeBook: loadedRecipes, // compatibility alias
          conflictAuditLog: parsed.conflictAuditLog || []
        };
        delete this.data.matchHistory;

        // Complete root purge: remove mock/demo bots and test users from production db
        if (this.data.users) {
          delete this.data.users['Шеф Гордон'];
          delete this.data.users['Гурман'];
          delete this.data.users['Су-Шеф'];
          delete this.data.users['Шеф-Повар'];
          delete this.data.users['Lexyak'];
          for (const key of Object.keys(this.data.users)) {
            if (isTestPlayerName(key) || key.toLowerCase() === 'lexyak') {
              this.testData.users[key] = this.data.users[key];
              delete this.data.users[key];
              this.isDirty = true;
            }
          }
        }

        // Migration / Normalization: ensure user avatars are valid image paths and gamesPlayed is accurate
        if (this.data.users) {
          for (const u of Object.values(this.data.users)) {
            if (u && typeof u === 'object') {
              if (u.avatar) u.avatar = normalizeAvatarPath(u.avatar);
              if (u.pairsMatched > 0 && (!u.gamesPlayed || u.gamesPlayed === 0)) {
                u.gamesPlayed = Math.max(1, Math.ceil(u.pairsMatched / 8));
              } else if (u.totalScore > 0 && (!u.gamesPlayed || u.gamesPlayed === 0)) {
                u.gamesPlayed = 1;
              }
            }
          }
        }
        if (this.data.sessions) {
          for (const [token, s] of Object.entries(this.data.sessions)) {
            if (s && typeof s === 'object') {
              if (s.playerName && (isTestPlayerName(s.playerName) || s.playerName.toLowerCase() === 'lexyak')) {
                delete this.data.sessions[token];
                this.isDirty = true;
              } else if (s.avatar) {
                s.avatar = normalizeAvatarPath(s.avatar);
              }
            }
          }
        }

        // Clean up stale abandoned active room timer and table players if no cards were ever matched
        if (this.data.activeRooms && this.data.activeRooms.bistro_main) {
          const bistro = this.data.activeRooms.bistro_main;
          if (Array.isArray(bistro.players)) {
            bistro.players = bistro.players.filter(p => p && p.name && !isTestPlayerName(p.name) && p.name.toLowerCase() !== 'lexyak');
          }
          const matchedCards = (bistro.cards || []).filter(c => c && c.isMatched).length;
          if (matchedCards === 0) {
            bistro.players = [];
            bistro.roundState = 'IDLE';
            bistro.elapsedSeconds = 0;
            bistro.roundStartedAt = null;
            bistro.isPaused = false;
            bistro.pauseReason = null;
            bistro.pausedAt = null;
            if (Array.isArray(bistro.cards)) {
              bistro.cards.forEach(c => {
                c.isFlipped = false;
                c.isMatched = false;
                c.flippedBy = null;
                c.matchedBy = null;
                c.matchedByName = null;
                c.matchedByColor = null;
              });
            }
          }
        }
        if (this.isDirty) {
          this.flushSync();
        }
        console.log(`[Persistence] Loaded database from ${this.dbFile} (${this.data.foodPairs.length} pairs, ${Object.keys(this.data.users).length} users, ${this.data.unlockedRecipes.length} achievements, ${Object.keys(this.data.activeRooms).length} active rooms, ${Object.keys(this.data.sessions).length} sessions)`);
      } else {
        console.log('[Persistence] Creating new database file at', this.dbFile);
        this.flushSync();
      }

      // Load separate test storage if configured
      if (this.testDbFile !== this.dbFile && fs.existsSync(this.testDbFile)) {
        try {
          const testRaw = fs.readFileSync(this.testDbFile, 'utf-8');
          const testParsed = JSON.parse(testRaw);
          this.testData = {
            users: testParsed.users || {},
            activeRooms: testParsed.activeRooms || {},
            sessions: testParsed.sessions || {},
            authTokens: testParsed.authTokens || {}
          };
          console.log(`[Persistence] Loaded test database from ${this.testDbFile} (${Object.keys(this.testData.users).length} test users)`);
        } catch (e) {
          this.testData = { users: {}, activeRooms: {}, sessions: {}, authTokens: {} };
        }
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
    }, 300);
  }

  scheduleTestSave() {
    this.isTestDirty = true;
    if (this.testSaveTimer) return;
    this.testSaveTimer = setTimeout(async () => {
      this.testSaveTimer = null;
      await this.flushTest();
    }, 300);
  }

  async flush() {
    if (!this.isDirty) return;
    try {
      const dataDir = path.dirname(this.dbFile);
      if (!fs.existsSync(dataDir)) {
        await fs.promises.mkdir(dataDir, { recursive: true });
      }
      const serialized = JSON.stringify(this.data, null, 2);
      await fs.promises.writeFile(this.tmpFile, serialized, 'utf-8');
      await fs.promises.rename(this.tmpFile, this.dbFile);
      this.isDirty = false;
    } catch (err) {
      console.error('[Persistence] Async flush failed:', err);
    }
  }

  flushSync() {
    try {
      const dataDir = path.dirname(this.dbFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const serialized = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(this.tmpFile, serialized, 'utf-8');
      fs.renameSync(this.tmpFile, this.dbFile);
      this.isDirty = false;
    } catch (err) {
      console.error('[Persistence] Sync flush failed:', err);
    }
  }

  async flushTest() {
    if (!this.isTestDirty) return;
    try {
      const dataDir = path.dirname(this.testDbFile);
      if (!fs.existsSync(dataDir)) {
        await fs.promises.mkdir(dataDir, { recursive: true });
      }
      const serialized = JSON.stringify(this.testData, null, 2);
      await fs.promises.writeFile(this.testTmpFile, serialized, 'utf-8');
      await fs.promises.rename(this.testTmpFile, this.testDbFile);
      this.isTestDirty = false;
    } catch (err) {
      console.error('[Persistence] Test async flush failed:', err);
    }
  }

  flushTestSync() {
    try {
      const dataDir = path.dirname(this.testDbFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const serialized = JSON.stringify(this.testData, null, 2);
      fs.writeFileSync(this.testTmpFile, serialized, 'utf-8');
      fs.renameSync(this.testTmpFile, this.testDbFile);
      this.isTestDirty = false;
    } catch (err) {
      console.error('[Persistence] Test sync flush failed:', err);
    }
  }

  _getUserStore(username) {
    return isTestPlayerName(username) ? this.testData.users : this.data.users;
  }

  _saveUserStore(username) {
    if (isTestPlayerName(username)) {
      this.scheduleTestSave();
    } else {
      this.scheduleSave();
    }
  }

  // --- Food Pairs Database Catalog ---
  getFoodPairs() {
    if (!this.data.foodPairs || this.data.foodPairs.length === 0) {
      this.data.foodPairs = [...DEFAULT_FOOD_PAIRS];
      this.scheduleSave();
    }
    return this.data.foodPairs;
  }

  addFoodPair(pair) {
    if (!pair || !pair.pairId) return false;
    const exists = this.data.foodPairs.some(p => p.pairId === pair.pairId);
    if (!exists) {
      this.data.foodPairs.push(pair);
      this.scheduleSave();
      return true;
    }
    return false;
  }

  // --- User Profiles & Authentication ---
  getUser(username) {
    if (!username) return null;
    const cleanName = username.trim().slice(0, 24);
    const store = this._getUserStore(cleanName);
    if (!store) return null;
    if (store[cleanName]) return store[cleanName];
    // Case-insensitive fallback
    const lower = cleanName.toLowerCase();
    for (const [k, u] of Object.entries(store)) {
      if (k.toLowerCase() === lower || (u.name && u.name.toLowerCase() === lower)) {
        return u;
      }
    }
    return null;
  }

  processAvatar(avatar, username = 'user') {
    if (!avatar) return DEFAULT_AVATAR;
    if (typeof avatar === 'string' && avatar.startsWith('data:image/')) {
      return saveAvatarFile(avatar, username);
    }
    return normalizeAvatarPath(avatar);
  }

  sanitizeUser(user) {
    if (!user) return null;
    return {
      id: user.id || `usr_${Buffer.from(user.name || 'player').toString('hex').slice(0, 8)}`,
      name: user.name,
      avatar: normalizeAvatarPath(user.avatar),
      totalScore: user.totalScore || 0,
      gamesPlayed: user.gamesPlayed || 0,
      pairsMatched: user.pairsMatched || 0,
      fastestMatchMs: user.fastestMatchMs || null,
      isRegistered: !!user.passwordHash
    };
  }

  registerUser(username, password, avatar = DEFAULT_AVATAR) {
    const cleanName = (username || '').trim().slice(0, 24);
    if (cleanName.length < 2) {
      return { success: false, message: 'Имя пользователя должно содержать не менее 2 символов' };
    }
    if (cleanName.length > 20) {
      return { success: false, message: 'Имя пользователя не должно превышать 20 символов' };
    }
    if (!password || password.length < 4) {
      return { success: false, message: 'Пароль должен содержать не менее 4 символов' };
    }

    const cleanAvatar = this.processAvatar(avatar, cleanName);
    const isTest = isTestPlayerName(cleanName);
    const store = this._getUserStore(cleanName);
    const existing = this.getUser(cleanName);
    if (existing) {
      // If user exists and already has password set, reject
      if (existing.passwordHash) {
        return { success: false, message: 'Пользователь с таким логином уже зарегистрирован' };
      }
      // If legacy profile without password, set password for it
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      existing.passwordHash = passwordHash;
      existing.salt = salt;
      if (cleanAvatar && cleanAvatar !== DEFAULT_AVATAR) {
        existing.avatar = cleanAvatar;
      } else if (!existing.avatar) {
        existing.avatar = cleanAvatar || DEFAULT_AVATAR;
      }
      existing.avatar = normalizeAvatarPath(existing.avatar);
      existing.lastSeen = new Date().toISOString();
      this._saveUserStore(cleanName);
      this.flushSync();
      this.flushTestSync();
      return { success: true, user: this.sanitizeUser(existing) };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;

    const newUser = {
      id: userId,
      name: cleanName,
      username: cleanName.toLowerCase(),
      avatar: cleanAvatar,
      passwordHash,
      salt,
      totalScore: 0,
      gamesPlayed: 0,
      pairsMatched: 0,
      fastestMatchMs: null,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };

    store[cleanName] = newUser;
    this._saveUserStore(cleanName);
    this.flushSync();
    this.flushTestSync();
    return { success: true, user: this.sanitizeUser(newUser) };
  }

  authenticateUser(username, password) {
    const cleanName = (username || '').trim().slice(0, 24);
    if (!cleanName) {
      return { success: false, message: 'Введите логин' };
    }
    if (!password) {
      return { success: false, message: 'Введите пароль' };
    }

    const user = this.getUser(cleanName);
    if (!user) {
      return { success: false, message: 'Пользователь не найден. Зарегистрируйтесь, если у вас еще нет аккаунта' };
    }

    // If profile exists without password (e.g. guest or legacy), assign password now
    if (!user.passwordHash || !user.salt) {
      const salt = crypto.randomBytes(16).toString('hex');
      user.salt = salt;
      user.passwordHash = hashPassword(password, salt);
      user.lastSeen = new Date().toISOString();
      this._saveUserStore(cleanName);
      return { success: true, user: this.sanitizeUser(user) };
    }

    // Verify password hash
    const testHash = hashPassword(password, user.salt);
    if (testHash !== user.passwordHash) {
      return { success: false, message: 'Неверный пароль' };
    }

    user.lastSeen = new Date().toISOString();
    this._saveUserStore(cleanName);
    return { success: true, user: this.sanitizeUser(user) };
  }

  createAuthToken(username) {
    const token = `auth_${crypto.randomBytes(24).toString('hex')}`;
    const isTest = isTestPlayerName(username);
    const store = isTest ? this.testData.authTokens : this.data.authTokens;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 дней без повторного логина
    store[token] = {
      username,
      createdAt: new Date().toISOString(),
      expiresAt
    };
    if (isTest) this.scheduleTestSave(); else this.scheduleSave();
    return token;
  }

  getUserByAuthToken(token) {
    if (!token) return null;
    let entry = (this.data.authTokens && this.data.authTokens[token]) ||
                (this.testData.authTokens && this.testData.authTokens[token]);
    if (!entry || !entry.username) return null;
    // Check 30-day token expiration
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now()) {
      if (this.data.authTokens) delete this.data.authTokens[token];
      if (this.testData.authTokens) delete this.testData.authTokens[token];
      this.scheduleSave();
      this.scheduleTestSave();
      return null;
    }
    const user = this.getUser(entry.username);
    return user ? this.sanitizeUser(user) : null;
  }

  revokeAuthToken(token) {
    if (this.data.authTokens && this.data.authTokens[token]) {
      delete this.data.authTokens[token];
      this.scheduleSave();
    }
    if (this.testData.authTokens && this.testData.authTokens[token]) {
      delete this.testData.authTokens[token];
      this.scheduleTestSave();
    }
  }

  deleteUser(username) {
    if (!username) return { success: false, message: 'Имя пользователя не указано' };
    const cleanName = username.trim().slice(0, 24);
    let found = false;
    let targetKey = null;

    // Check production users
    if (this.data.users) {
      for (const [k, u] of Object.entries(this.data.users)) {
        if (k.toLowerCase() === cleanName.toLowerCase() || (u.name && u.name.toLowerCase() === cleanName.toLowerCase())) {
          targetKey = k;
          delete this.data.users[k];
          found = true;
          this.scheduleSave();
          break;
        }
      }
    }

    // Check test users
    if (this.testData.users) {
      for (const [k, u] of Object.entries(this.testData.users)) {
        if (k.toLowerCase() === cleanName.toLowerCase() || (u.name && u.name.toLowerCase() === cleanName.toLowerCase())) {
          targetKey = targetKey || k;
          delete this.testData.users[k];
          found = true;
          this.scheduleTestSave();
          break;
        }
      }
    }

    if (!found) {
      return { success: false, message: 'Пользователь не найден' };
    }

    const keyName = targetKey || cleanName;
    for (const authStore of [this.data.authTokens, this.testData.authTokens]) {
      if (authStore) {
        for (const [token, entry] of Object.entries(authStore)) {
          if (entry.username && entry.username.toLowerCase() === keyName.toLowerCase()) {
            delete authStore[token];
          }
        }
      }
    }

    for (const sessStore of [this.data.sessions, this.testData.sessions]) {
      if (sessStore) {
        for (const [token, sess] of Object.entries(sessStore)) {
          if (sess.playerName && sess.playerName.toLowerCase() === keyName.toLowerCase()) {
            delete sessStore[token];
          }
        }
      }
    }

    this.flushSync();
    this.flushTestSync();
    console.log(`[Persistence] User account "${keyName}" deleted.`);
    return { success: true, message: `Аккаунт «${keyName}» успешно удален` };
  }

  getOrCreateUser(username, avatar = null) {
    const cleanName = (username || 'Игрок').trim().slice(0, 24);
    const resolvedAvatar = avatar ? this.processAvatar(avatar, cleanName) : null;
    const store = this._getUserStore(cleanName);
    let key = cleanName;
    if (!store[key]) {
      const lower = cleanName.toLowerCase();
      for (const k of Object.keys(store)) {
        if (k.toLowerCase() === lower || (store[k].name && store[k].name.toLowerCase() === lower)) {
          key = k;
          break;
        }
      }
    }
    if (!store[key]) {
      store[cleanName] = {
        name: cleanName,
        avatar: resolvedAvatar || DEFAULT_AVATAR,
        totalScore: 0,
        gamesPlayed: 0,
        pairsMatched: 0,
        fastestMatchMs: null,
        accuracySum: 0,
        avgAccuracy: 0,
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString()
      };
      this._saveUserStore(cleanName);
      return store[cleanName];
    } else {
      store[key].lastSeen = new Date().toISOString();
      if (!store[key].avatar) {
        store[key].avatar = resolvedAvatar || DEFAULT_AVATAR;
      } else {
        store[key].avatar = normalizeAvatarPath(store[key].avatar);
      }
      this._saveUserStore(cleanName);
      return store[key];
    }
  }

  updateUserAvatar(username, avatar) {
    if (!username || !avatar) return null;
    const cleanName = username.trim().slice(0, 24);
    const resolvedAvatar = this.processAvatar(avatar, cleanName);
    const lower = cleanName.toLowerCase();

    for (const store of [this.data.users, this.testData.users]) {
      if (!store) continue;
      let user = store[cleanName];
      let userKey = cleanName;
      if (!user) {
        for (const [k, u] of Object.entries(store)) {
          if (k.toLowerCase() === lower || (u.name && u.name.toLowerCase() === lower) || u.id === username) {
            user = u;
            userKey = k;
            break;
          }
        }
      }
      if (user) {
        user.avatar = resolvedAvatar;
        user.lastSeen = new Date().toISOString();
        this._saveUserStore(userKey);
        this.flushSync();
        this.flushTestSync();
        return user;
      }
    }
    return null;
  }

  recordPairMatch(username, scoreDelta, matchTimeMs) {
    const user = this.getOrCreateUser(username);
    user.totalScore += scoreDelta;
    user.pairsMatched += 1;
    if (!user.gamesPlayed || user.gamesPlayed < 1) {
      user.gamesPlayed = 1;
    }
    if (!user.fastestMatchMs || (matchTimeMs > 0 && matchTimeMs < user.fastestMatchMs)) {
      user.fastestMatchMs = matchTimeMs;
    }
    user.lastSeen = new Date().toISOString();
    this._saveUserStore(username);
    return user;
  }

  recordRoundEnd(roundSummary) {
    if (Array.isArray(roundSummary.scores)) {
      for (const p of roundSummary.scores) {
        if (p.player) {
          // Only increment gamesPlayed if player actually participated in this round and wasn't already counted
          const playedInRound = (p.roundScore > 0) || (p.roundPairs > 0) || (p.participated === true);
          if (playedInRound) {
            const user = this.getOrCreateUser(p.player);
            if (!p.alreadyCounted) {
              user.gamesPlayed = (user.gamesPlayed || 0) + 1;
            }
            if (isTestPlayerName(p.player)) {
              this.scheduleTestSave();
            } else {
              this.scheduleSave();
            }
          }
        }
      }
    }
  }

  getMatchHistory(limit = 20) {
    return [];
  }

  getLatestMatch(roomId = null) {
    return null;
  }

  // --- Active Rooms State Persistence (Requirement 3) ---
  getRoomState(roomId) {
    return (this.data.activeRooms && this.data.activeRooms[roomId]) ||
           (this.testData.activeRooms && this.testData.activeRooms[roomId]) || null;
  }

  saveRoomState(roomId, state) {
    const isTest = isTestRoom(roomId);
    const store = isTest ? this.testData.activeRooms : this.data.activeRooms;
    store[roomId] = {
      ...state,
      savedAt: new Date().toISOString()
    };
    if (isTest) this.scheduleTestSave(); else this.scheduleSave();
  }

  clearRoomState(roomId) {
    if (this.data.activeRooms && this.data.activeRooms[roomId]) {
      delete this.data.activeRooms[roomId];
      this.scheduleSave();
    }
    if (this.testData.activeRooms && this.testData.activeRooms[roomId]) {
      delete this.testData.activeRooms[roomId];
      this.scheduleTestSave();
    }
  }

  getAllRoomStates() {
    return { ...(this.data.activeRooms || {}), ...(this.testData.activeRooms || {}) };
  }

  // --- Sessions Persistence (Requirement 3 & 5) ---
  getSessions() {
    return { ...(this.data.sessions || {}), ...(this.testData.sessions || {}) };
  }

  getSession(token) {
    return (this.data.sessions && this.data.sessions[token]) ||
           (this.testData.sessions && this.testData.sessions[token]) || null;
  }

  saveSession(token, session) {
    if (!token || !session) return;
    const isTest = isTestPlayerName(session.playerName) || isTestRoom(session.roomId);
    const store = isTest ? this.testData.sessions : this.data.sessions;
    store[token] = {
      token: session.token,
      playerId: session.playerId,
      playerName: session.playerName,
      avatar: normalizeAvatarPath(session.avatar),
      roomId: session.roomId,
      score: session.score || 0,
      roundScore: session.roundScore || 0,
      roundPairs: session.roundPairs || 0,
      comboStreak: session.comboStreak || 0,
      roundDiscoveredRecipes: session.roundDiscoveredRecipes ? [...session.roundDiscoveredRecipes] : [],
      isOnline: !!session.isOnline,
      lastActive: session.lastActive || Date.now(),
      disconnectedAt: session.disconnectedAt || null
    };
    if (isTest) this.scheduleTestSave(); else this.scheduleSave();
  }

  removeSession(token) {
    if (this.data.sessions && this.data.sessions[token]) {
      delete this.data.sessions[token];
      this.scheduleSave();
    }
    if (this.testData.sessions && this.testData.sessions[token]) {
      delete this.testData.sessions[token];
      this.scheduleTestSave();
    }
  }

  getLeaderboard(limit = 10, includeTest = false) {
    let users = includeTest
      ? Object.values(this.data.users).concat(Object.values(this.testData.users))
      : Object.values(this.data.users);

    const list = users
      .filter(u => u && u.name && (includeTest || !isTestPlayerName(u.name)))
      .map(u => ({
        name: u.name,
        avatar: normalizeAvatarPath(u.avatar),
        totalScore: u.totalScore || 0,
        gamesPlayed: u.gamesPlayed || 0,
        pairsMatched: u.pairsMatched || 0,
        avgAccuracy: u.avgAccuracy || 90,
        fastestMatchMs: u.fastestMatchMs,
        lastSeen: u.lastSeen
      }));

    list.sort((a, b) => b.totalScore - a.totalScore);
    return list.slice(0, limit);
  }

  // --- Unlocked Recipes / Achievements ---
  getUnlockedRecipes() {
    if (!this.data.unlockedRecipes) {
      this.data.unlockedRecipes = this.data.recipeBook || INITIAL_UNLOCKED_RECIPES;
    }
    return this.data.unlockedRecipes;
  }

  // Backward compatibility alias for tests and handlers
  getRecipeBook() {
    return this.getUnlockedRecipes();
  }

  getGallery() {
    return this.getUnlockedRecipes();
  }

  unlockRecipeAchievement(dish) {
    const recipes = this.getUnlockedRecipes();
    const existing = recipes.find(d => d.pairId === dish.pairId || d.foodId === dish.foodId || d.id === dish.id);
    if (existing) {
      return existing;
    }

    const newAchievement = {
      id: dish.id || `recipe_${dish.pairId || dish.foodId}_${Date.now()}`,
      foodId: dish.foodId || dish.pairId,
      pairId: dish.pairId || dish.foodId,
      name: dish.name || 'Гастрономическая пара',
      emoji: dish.emoji || '🍴',
      category: dish.category || 'Кулинарное достижение',
      calories: dish.calories || 'Идеальное сочетание',
      secretIngredient: dish.secretIngredient || 'Секрет вкуса',
      spiceLevel: dish.spiceLevel || 1,
      sticker: dish.sticker || '⭐',
      chefNotes: dish.chefNotes || `Пара успешно открыта игроком ${dish.discoveredBy || 'Шеф-Повар'}!`,
      discoveredBy: dish.discoveredBy || 'Шеф-Повар',
      version: 1,
      lastModifiedBy: dish.discoveredBy || 'Шеф-Повар',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    recipes.unshift(newAchievement);
    if (recipes.length > 50) {
      recipes.length = 50;
    }
    this.data.unlockedRecipes = recipes;
    this.data.recipeBook = recipes;
    this.scheduleSave();
    return newAchievement;
  }

  unlockOrAddDish(dish) {
    return this.unlockRecipeAchievement(dish);
  }

  getRecipeItem(id) {
    const list = this.getUnlockedRecipes();
    return list.find(item => item.id === id);
  }

  getGalleryItem(id) {
    return this.getRecipeItem(id);
  }

  // --- Conflict Audit Log ---
  logConflict(conflictEvent) {
    const entry = {
      id: `conf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      ...conflictEvent
    };
    this.data.conflictAuditLog.unshift(entry);
    if (this.data.conflictAuditLog.length > 60) {
      this.data.conflictAuditLog.length = 60;
    }
    this.scheduleSave();
    return entry;
  }

  getConflictAuditLog(limit = 25) {
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
