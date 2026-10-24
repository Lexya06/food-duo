import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

if (!process.env.DB_FILE) {
  process.env.DB_FILE = path.join(DATA_DIR, 'database.test.json');
}

// Clean up test database file if it exists before tests run
try {
  if (fs.existsSync(process.env.DB_FILE)) {
    fs.unlinkSync(process.env.DB_FILE);
  }
  const tmp = path.join(path.dirname(process.env.DB_FILE), path.basename(process.env.DB_FILE, '.json') + '.tmp.json');
  if (fs.existsSync(tmp)) {
    fs.unlinkSync(tmp);
  }
} catch (e) {}

// Clean up test database file on exit
process.on('exit', () => {
  try {
    const testDb = process.env.DB_FILE;
    if (testDb && testDb.includes('.test.') && fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }
    const tmp = path.join(path.dirname(testDb), path.basename(testDb, '.json') + '.tmp.json');
    if (tmp && tmp.includes('.test.') && fs.existsSync(tmp)) {
      fs.unlinkSync(tmp);
    }
  } catch (e) {}
});
