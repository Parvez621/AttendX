const sqlite3 = require('sqlite3').verbose();
const bcrypt  = require('bcryptjs');
const path    = require('path');

const DB_PATH = path.join(__dirname, 'attendx.db');
let db;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, err => {
      if (err) { console.error('DB error:', err.message); process.exit(1); }
    });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');
  }
  return db;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Each CREATE TABLE is run individually — sqlite3 .exec() silently skips
// all statements after the first in a multi-statement string.
async function initializeDatabase() {
  await dbRun(`CREATE TABLE IF NOT EXISTS admins (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS members (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    time       TEXT NOT NULL,
    location   TEXT,
    photo_path TEXT,
    status     TEXT DEFAULT 'Present',
    is_late    INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(member_id, date)
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    assigned_to INTEGER REFERENCES members(id) ON DELETE SET NULL,
    due_date    TEXT,
    priority    TEXT DEFAULT 'medium',
    status      TEXT DEFAULT 'pending',
    created_by  INTEGER,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  )`);

  // Seed only on first run
  const adminCount = await dbGet('SELECT COUNT(*) AS c FROM admins');
  if (adminCount.c === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    await dbRun(
      'INSERT INTO admins (name, username, password) VALUES (?, ?, ?)',
      ['Admin', 'admin', adminHash]
    );

    const employees = [
      { name: 'Alice Johnson', username: 'alice' },
      { name: 'Bob Martinez',  username: 'bob'   },
      { name: 'Carol Lee',     username: 'carol' },
      { name: 'David Kim',     username: 'david' },
      { name: 'Eva Patel',     username: 'eva'   },
    ];
    for (const e of employees) {
      const hash = bcrypt.hashSync('pass123', 10);
      await dbRun(
        'INSERT INTO members (name, username, password) VALUES (?, ?, ?)',
        [e.name, e.username, hash]
      );
    }

    console.log('\n✅  AttendX database ready');
    console.log('   Admin  →  admin    / admin123');
    console.log('   Staff  →  alice,bob,carol,david,eva  / pass123\n');
  }
}

module.exports = { initializeDatabase, dbRun, dbGet, dbAll };
