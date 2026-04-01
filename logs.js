// logs.js — Routes for habit logs: /api/logs
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, dbGet, dbAll, dbRun } = require('./database');
const { authenticate } = require('./middleware');

const router = express.Router();
router.use(authenticate);

function boolLog(l) {
    return l ? { ...l, completed: Boolean(l.completed) } : null;
}

// ─── GET /api/logs ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const { habit_id, date, from, to } = req.query;
        const db = await getDb();

        let sql = 'SELECT l.* FROM logs l WHERE l.user_id = ?';
        const args = [req.userId];

        if (habit_id) { sql += ' AND l.habit_id = ?'; args.push(habit_id); }
        if (date) { sql += ' AND l.date = ?'; args.push(date); }
        if (from) { sql += ' AND l.date >= ?'; args.push(from); }
        if (to) { sql += ' AND l.date <= ?'; args.push(to); }
        sql += ' ORDER BY l.date DESC';

        const logs = dbAll(db, sql, args).map(l => ({ ...l, completed: Boolean(l.completed) }));
        res.json({ logs });
    } catch (err) {
        console.error('GET /logs error:', err);
        res.status(500).json({ error: 'Failed to fetch logs.' });
    }
});

// ─── GET /api/logs/today ───────────────────────────────────────────────
router.get('/today', async (req, res) => {
    try {
        const db = await getDb();
        const today = new Date().toISOString().split('T')[0];
        const habits = dbAll(db, 'SELECT * FROM habits WHERE user_id = ? AND is_active = 1', [req.userId]);

        const result = habits.map(h => {
            const log = dbGet(db, 'SELECT * FROM logs WHERE habit_id = ? AND date = ?', [h.id, today]);
            return {
                habit: { ...h, is_active: Boolean(h.is_active) },
                log: boolLog(log),
            };
        });

        res.json({ date: today, items: result });
    } catch (err) {
        console.error('GET /logs/today error:', err);
        res.status(500).json({ error: "Failed to fetch today's logs." });
    }
});

// ─── GET /api/logs/:habitId/streak ────────────────────────────────────
router.get('/:habitId/streak', async (req, res) => {
    try {
        const db = await getDb();
        const habit = dbGet(db, 'SELECT id FROM habits WHERE id = ? AND user_id = ?', [req.params.habitId, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const dates = dbAll(db,
            'SELECT date FROM logs WHERE habit_id = ? AND completed = 1 ORDER BY date DESC',
            [habit.id]
        ).map(r => r.date);

        const today = new Date().toISOString().split('T')[0];
        let streak = 0, check = today;
        for (const d of dates) {
            if (d === check) {
                streak++;
                const prev = new Date(check + 'T00:00:00');
                prev.setDate(prev.getDate() - 1);
                check = prev.toISOString().split('T')[0];
            } else if (d < check) break;
        }

        // Best streak
        const asc = [...dates].sort();
        let best = 0, cur = 0, prevD = null;
        for (const d of asc) {
            cur = prevD && (new Date(d) - new Date(prevD)) / 86400000 === 1 ? cur + 1 : 1;
            if (cur > best) best = cur;
            prevD = d;
        }

        res.json({ habit_id: habit.id, current_streak: streak, best_streak: best });
    } catch (err) {
        console.error('GET /logs/:habitId/streak error:', err);
        res.status(500).json({ error: 'Failed to compute streak.' });
    }
});

// ─── GET /api/logs/:habitId/heatmap ───────────────────────────────────
router.get('/:habitId/heatmap', async (req, res) => {
    try {
        const db = await getDb();
        const habit = dbGet(db, 'SELECT id FROM habits WHERE id = ? AND user_id = ?', [req.params.habitId, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const to = req.query.to || new Date().toISOString().split('T')[0];
        const from = req.query.from || (() => { const d = new Date(to); d.setFullYear(d.getFullYear() - 1); return d.toISOString().split('T')[0]; })();

        const logs = dbAll(db,
            'SELECT date, completed, progress FROM logs WHERE habit_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
            [habit.id, from, to]
        ).map(l => ({ ...l, completed: Boolean(l.completed) }));

        res.json({ habit_id: habit.id, from, to, logs });
    } catch (err) {
        console.error('GET /logs/:habitId/heatmap error:', err);
        res.status(500).json({ error: 'Failed to fetch heatmap data.' });
    }
});

// ─── POST /api/logs — upsert ──────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { habit_id, date, progress, notes, completed } = req.body;
        if (!habit_id) return res.status(400).json({ error: 'habit_id is required.' });

        const db = await getDb();
        const habit = dbGet(db, 'SELECT * FROM habits WHERE id = ? AND user_id = ?', [habit_id, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const logDate = date || new Date().toISOString().split('T')[0];
        const logProgress = parseFloat(progress) || 0;
        const logNotes = (notes || '').trim();
        const isDone = completed !== undefined ? Boolean(completed) : logProgress >= habit.daily_target;
        const now = new Date().toISOString();

        const existing = dbGet(db, 'SELECT id FROM logs WHERE habit_id = ? AND date = ?', [habit_id, logDate]);

        if (existing) {
            dbRun(db,
                'UPDATE logs SET completed=?, progress=?, notes=?, completed_at=? WHERE id=?',
                [isDone ? 1 : 0, logProgress, logNotes, isDone ? now : null, existing.id]
            );
        } else {
            const id = uuidv4();
            dbRun(db,
                'INSERT INTO logs (id, habit_id, user_id, date, completed, progress, notes, completed_at) VALUES (?,?,?,?,?,?,?,?)',
                [id, habit_id, req.userId, logDate, isDone ? 1 : 0, logProgress, logNotes, isDone ? now : null]
            );
        }

        const logId = existing ? existing.id : dbAll(db, 'SELECT id FROM logs WHERE habit_id=? AND date=?', [habit_id, logDate])[0].id;
        const saved = dbGet(db, 'SELECT * FROM logs WHERE id = ?', [logId]);
        res.status(existing ? 200 : 201).json({ log: boolLog(saved) });
    } catch (err) {
        console.error('POST /logs error:', err);
        res.status(500).json({ error: 'Failed to save log.' });
    }
});

// ─── POST /api/logs/toggle ────────────────────────────────────────────
router.post('/toggle', async (req, res) => {
    try {
        const { habit_id } = req.body;
        if (!habit_id) return res.status(400).json({ error: 'habit_id is required.' });

        const db = await getDb();
        const habit = dbGet(db, 'SELECT * FROM habits WHERE id = ? AND user_id = ?', [habit_id, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();
        const existing = dbGet(db, 'SELECT * FROM logs WHERE habit_id = ? AND date = ?', [habit_id, today]);

        let logId;
        if (!existing) {
            logId = uuidv4();
            dbRun(db,
                'INSERT INTO logs (id, habit_id, user_id, date, completed, progress, notes, completed_at) VALUES (?,?,?,?,1,?,?,?)',
                [logId, habit_id, req.userId, today, habit.daily_target, '', now]
            );
        } else {
            const newDone = !Boolean(existing.completed);
            dbRun(db,
                'UPDATE logs SET completed=?, progress=?, completed_at=? WHERE id=?',
                [newDone ? 1 : 0, newDone ? habit.daily_target : 0, newDone ? now : null, existing.id]
            );
            logId = existing.id;
        }

        const log = dbGet(db, 'SELECT * FROM logs WHERE id = ?', [logId]);
        res.json({ log: boolLog(log) });
    } catch (err) {
        console.error('POST /logs/toggle error:', err);
        res.status(500).json({ error: 'Failed to toggle habit.' });
    }
});

// ─── DELETE /api/logs/:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const db = await getDb();
        const log = dbGet(db, 'SELECT id FROM logs WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!log) return res.status(404).json({ error: 'Log not found.' });
        dbRun(db, 'DELETE FROM logs WHERE id = ?', [log.id]);
        res.json({ message: 'Log deleted.' });
    } catch (err) {
        console.error('DELETE /logs/:id error:', err);
        res.status(500).json({ error: 'Failed to delete log.' });
    }
});

module.exports = router;
