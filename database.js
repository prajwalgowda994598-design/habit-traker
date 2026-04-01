// database.js — SQLite via sql.js (pure JS, no C++ compiler needed)
'use strict';

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'habitforge.db.bin');

// ─── Singleton promise ─────────────────────────────────────────────────
let _db = null;
let _SQL = null;

async function getDb() {
    if (_db) return _db;

    _SQL = await initSqlJs();

    // Load existing database file, or create a fresh one
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        _db = new _SQL.Database(fileBuffer);
        console.log('✅ Loaded existing database from', DB_PATH);
    } else {
        _db = new _SQL.Database();
        console.log('✅ Created new database at', DB_PATH);
    }

    createSchema(_db);
    return _db;
}

function createSchema(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            email      TEXT NOT NULL UNIQUE,
            password   TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS habits (
            id            TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL,
            name          TEXT NOT NULL,
            category      TEXT NOT NULL DEFAULT 'Custom',
            duration_days INTEGER NOT NULL DEFAULT 30,
            daily_target  REAL NOT NULL DEFAULT 1,
            unit          TEXT NOT NULL DEFAULT 'count',
            start_date    TEXT NOT NULL,
            is_active     INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS logs (
            id           TEXT PRIMARY KEY,
            habit_id     TEXT NOT NULL,
            user_id      TEXT NOT NULL,
            date         TEXT NOT NULL,
            completed    INTEGER NOT NULL DEFAULT 0,
            progress     REAL NOT NULL DEFAULT 0,
            notes        TEXT DEFAULT '',
            completed_at TEXT DEFAULT NULL,
            UNIQUE(habit_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id);
        CREATE INDEX IF NOT EXISTS idx_logs_habit  ON logs(habit_id);
        CREATE INDEX IF NOT EXISTS idx_logs_user   ON logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_logs_date   ON logs(date);
    `);
}

// ─── Persist DB to disk after every write ────────────────────────────
function persist(db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ─── Helper: run a query that returns rows ───────────────────────────
function dbAll(db, sql, params = []) {
    const stmt = db.prepare(sql);
    const results = [];
    stmt.bind(params);
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

// ─── Helper: run a query that returns one row ────────────────────────
function dbGet(db, sql, params = []) {
    const rows = dbAll(db, sql, params);
    return rows[0] || null;
}

// ─── Helper: run an INSERT/UPDATE/DELETE ────────────────────────────
function dbRun(db, sql, params = []) {
    db.run(sql, params);
    persist(db);
}

module.exports = { getDb, dbAll, dbGet, dbRun, persist };
