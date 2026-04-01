// habits.js — CRUD routes for habits: /api/habits
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb, dbGet, dbAll, dbRun } = require('./database');
const { authenticate } = require('./middleware');

const router = express.Router();
router.use(authenticate);

const VALID_CATS = ['Health', 'Study', 'Gym', 'Work', 'Mindfulness', 'Custom'];

// ─── GET /api/habits ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const db = await getDb();
        const today = new Date().toISOString().split('T')[0];
        const habits = dbAll(db, 'SELECT * FROM habits WHERE user_id = ? ORDER BY created_at ASC', [req.userId]);

        const enriched = habits.map(h => {
            const todayLog = dbGet(db,
                'SELECT * FROM logs WHERE habit_id = ? AND date = ?', [h.id, today]);
            const totalDone = dbAll(db,
                'SELECT id FROM logs WHERE habit_id = ? AND completed = 1', [h.id]).length;
            return {
                ...h,
                is_active: Boolean(h.is_active),
                today_done: todayLog ? Boolean(todayLog.completed) : false,
                today_log: todayLog ? { ...todayLog, completed: Boolean(todayLog.completed) } : null,
                total_done: totalDone,
            };
        });

        res.json({ habits: enriched });
    } catch (err) {
        console.error('GET /habits error:', err);
        res.status(500).json({ error: 'Failed to fetch habits.' });
    }
});

// ─── GET /api/habits/:id ──────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const db = await getDb();
        const habit = dbGet(db, 'SELECT * FROM habits WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const logs = dbAll(db, 'SELECT * FROM logs WHERE habit_id = ? ORDER BY date ASC', [habit.id])
            .map(l => ({ ...l, completed: Boolean(l.completed) }));

        res.json({ habit: { ...habit, is_active: Boolean(habit.is_active) }, logs });
    } catch (err) {
        console.error('GET /habits/:id error:', err);
        res.status(500).json({ error: 'Failed to fetch habit.' });
    }
});

// ─── POST /api/habits ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { name, category, duration_days, daily_target, unit, start_date } = req.body;
        if (!name || !category)
            return res.status(400).json({ error: 'name and category are required.' });
        if (!VALID_CATS.includes(category))
            return res.status(400).json({ error: `category must be one of: ${VALID_CATS.join(', ')}` });

        const db = await getDb();
        const id = uuidv4();
        const startDate = start_date || new Date().toISOString().split('T')[0];
        const now = new Date().toISOString();

        dbRun(db,
            'INSERT INTO habits (id, user_id, name, category, duration_days, daily_target, unit, start_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [id, req.userId, name.trim(), category, parseInt(duration_days) || 30, parseFloat(daily_target) || 1, unit || 'count', startDate, now]
        );

        const habit = dbGet(db, 'SELECT * FROM habits WHERE id = ?', [id]);
        res.status(201).json({ habit: { ...habit, is_active: Boolean(habit.is_active) } });
    } catch (err) {
        console.error('POST /habits error:', err);
        res.status(500).json({ error: 'Failed to create habit.' });
    }
});

// ─── PUT /api/habits/:id ──────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    try {
        const db = await getDb();
        const habit = dbGet(db, 'SELECT * FROM habits WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const { name, category, duration_days, daily_target, unit, is_active } = req.body;
        const newName = name !== undefined ? name.trim() : habit.name;
        const newCat = category !== undefined ? category : habit.category;
        const newDuration = duration_days !== undefined ? parseInt(duration_days) : habit.duration_days;
        const newTarget = daily_target !== undefined ? parseFloat(daily_target) : habit.daily_target;
        const newUnit = unit !== undefined ? unit : habit.unit;
        const newActive = is_active !== undefined ? (is_active ? 1 : 0) : habit.is_active;

        dbRun(db,
            'UPDATE habits SET name=?, category=?, duration_days=?, daily_target=?, unit=?, is_active=? WHERE id=?',
            [newName, newCat, newDuration, newTarget, newUnit, newActive, habit.id]
        );

        const updated = dbGet(db, 'SELECT * FROM habits WHERE id = ?', [habit.id]);
        res.json({ habit: { ...updated, is_active: Boolean(updated.is_active) } });
    } catch (err) {
        console.error('PUT /habits/:id error:', err);
        res.status(500).json({ error: 'Failed to update habit.' });
    }
});

// ─── DELETE /api/habits/:id ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    try {
        const db = await getDb();
        const habit = dbGet(db, 'SELECT id FROM habits WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        dbRun(db, 'DELETE FROM logs   WHERE habit_id = ?', [habit.id]);
        dbRun(db, 'DELETE FROM habits WHERE id = ?', [habit.id]);
        res.json({ message: 'Habit deleted successfully.' });
    } catch (err) {
        console.error('DELETE /habits/:id error:', err);
        res.status(500).json({ error: 'Failed to delete habit.' });
    }
});

module.exports = router;
