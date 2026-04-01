// auth.js — Authentication routes: POST /api/auth/signup & /api/auth/login
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb, dbGet, dbAll, dbRun } = require('./database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'habitforge-super-secret-change-in-prod';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

function makeToken(user) {
    return jwt.sign(
        { userId: user.id, name: user.name, email: user.email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
    );
}

function safeUser(user) {
    const { password, ...rest } = user;
    return rest;
}

// ─── POST /api/auth/signup ────────────────────────────────────────────
router.post('/signup', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password)
            return res.status(400).json({ error: 'name, email and password are required.' });
        if (password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters.' });

        const db = await getDb();
        const normalEmail = email.toLowerCase().trim();

        const existing = dbGet(db, 'SELECT id FROM users WHERE email = ?', [normalEmail]);
        if (existing)
            return res.status(409).json({ error: 'An account with this email already exists.' });

        const hash = await bcrypt.hash(password, 10);
        const id = uuidv4();
        const now = new Date().toISOString();

        dbRun(db,
            'INSERT INTO users (id, name, email, password, created_at) VALUES (?,?,?,?,?)',
            [id, name.trim(), normalEmail, hash, now]
        );

        const user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [id]);
        const token = makeToken(user);
        res.status(201).json({ token, user: safeUser(user) });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ error: 'Server error during signup.' });
    }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'email and password are required.' });

        const db = await getDb();
        const normalEmail = email.toLowerCase().trim();

        // Demo shortcut
        if (normalEmail === 'demo@test.com' && password === '123456') {
            let demo = dbGet(db, 'SELECT * FROM users WHERE email = ?', ['demo@test.com']);
            if (!demo) {
                const hash = await bcrypt.hash('123456', 10);
                const now = new Date().toISOString();
                dbRun(db,
                    'INSERT INTO users (id, name, email, password, created_at) VALUES (?,?,?,?,?)',
                    ['demo-user-id', 'Demo User', 'demo@test.com', hash, now]
                );
                demo = dbGet(db, 'SELECT * FROM users WHERE id = ?', ['demo-user-id']);
                await seedDemoData(db, 'demo-user-id');
            }
            return res.json({ token: makeToken(demo), user: safeUser(demo) });
        }

        const user = dbGet(db, 'SELECT * FROM users WHERE email = ?', [normalEmail]);
        if (!user)
            return res.status(401).json({ error: 'No account found with this email.' });

        const match = await bcrypt.compare(password, user.password);
        if (!match)
            return res.status(401).json({ error: 'Incorrect password.' });

        res.json({ token: makeToken(user), user: safeUser(user) });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login.' });
    }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────
router.get('/me', require('./middleware').authenticate, async (req, res) => {
    try {
        const db = await getDb();
        const user = dbGet(db, 'SELECT * FROM users WHERE id = ?', [req.userId]);
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ user: safeUser(user) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch user.' });
    }
});

// ─── Demo Data Seeder ─────────────────────────────────────────────────
async function seedDemoData(db, userId) {
    const demoHabits = [
        { name: 'Morning Run', category: 'Health', target: 30, unit: 'minutes', days: 30 },
        { name: 'Read a Book', category: 'Study', target: 20, unit: 'pages', days: 30 },
        { name: 'Gym Workout', category: 'Gym', target: 60, unit: 'minutes', days: 30 },
        { name: 'Meditation', category: 'Mindfulness', target: 10, unit: 'minutes', days: 21 },
    ];

    const startDate = (() => {
        const d = new Date(); d.setDate(d.getDate() - 20);
        return d.toISOString().split('T')[0];
    })();

    for (const h of demoHabits) {
        const habitId = uuidv4();
        const now = new Date().toISOString();
        dbRun(db,
            'INSERT OR IGNORE INTO habits (id, user_id, name, category, duration_days, daily_target, unit, start_date, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [habitId, userId, h.name, h.category, h.days, h.target, h.unit, startDate, now]
        );
        for (let i = 0; i < 20; i++) {
            if (Math.random() > 0.35) {
                const d = new Date(); d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                dbRun(db,
                    'INSERT OR IGNORE INTO logs (id, habit_id, user_id, date, completed, progress, notes, completed_at) VALUES (?,?,?,?,1,?,?,?)',
                    [uuidv4(), habitId, userId, dateStr, h.target, '', now]
                );
            }
        }
    }
}

module.exports = router;
