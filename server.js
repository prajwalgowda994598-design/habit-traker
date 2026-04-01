// server.js — HabitForge Express API Server
'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const { getDb, dbGet, dbAll } = require('./database');
const { authenticate } = require('./middleware');

const authRoutes = require('./auth');
const habitRoutes = require('./habits');
const logRoutes = require('./logs');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));
app.use(express.json());
app.use(morgan('dev'));

// ─── STATIC FILES — serve the frontend ───────────────────────────────
app.use(express.static(path.join(__dirname)));

// ─── API ROUTES ───────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/habits', habitRoutes);
app.use('/api/logs', logRoutes);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── ANALYTICS ENDPOINT ───────────────────────────────────────────────
app.get('/api/analytics/:habitId', authenticate, async (req, res) => {
    try {
        const db = await getDb();
        const habit = dbGet(db, 'SELECT * FROM habits WHERE id = ? AND user_id = ?',
            [req.params.habitId, req.userId]);
        if (!habit) return res.status(404).json({ error: 'Habit not found.' });

        const logs = dbAll(db, 'SELECT * FROM logs WHERE habit_id = ? ORDER BY date ASC', [habit.id])
            .map(l => ({ ...l, completed: Boolean(l.completed) }));

        // Weekly OHLC buckets for candlestick chart
        const weekly_buckets = buildWeeklyBuckets(habit, logs);

        // Streak computation
        const doneDates = logs.filter(l => l.completed).map(l => l.date).sort().reverse();
        const today = new Date().toISOString().split('T')[0];
        let streak = 0, check = today;
        for (const d of doneDates) {
            if (d === check) {
                streak++;
                const prev = new Date(check + 'T00:00:00');
                prev.setDate(prev.getDate() - 1);
                check = prev.toISOString().split('T')[0];
            } else if (d < check) break;
        }

        const asc = [...doneDates].sort();
        let best = 0, cur = 0, prevD = null;
        for (const d of asc) {
            cur = prevD && (new Date(d) - new Date(prevD)) / 86400000 === 1 ? cur + 1 : 1;
            if (cur > best) best = cur;
            prevD = d;
        }

        const totalDone = logs.filter(l => l.completed).length;
        const rate = logs.length === 0 ? 0 : Math.round((totalDone / logs.length) * 100);

        res.json({
            habit,
            stats: { current_streak: streak, best_streak: best, total_days_done: totalDone, completion_rate: rate },
            weekly_buckets,
            logs,
        });
    } catch (err) {
        console.error('GET /analytics/:habitId error:', err);
        res.status(500).json({ error: 'Failed to fetch analytics.' });
    }
});

function buildWeeklyBuckets(habit, logs) {
    const logMap = {};
    logs.forEach(l => { logMap[l.date] = l; });

    const weeks = [];
    for (let w = 0; w < Math.ceil(habit.duration_days / 7); w++) {
        const dayPcts = [];
        for (let d = 0; d < 7 && (w * 7 + d) < habit.duration_days; d++) {
            const date = addDays(habit.start_date, w * 7 + d);
            const log = logMap[date];
            const pct = log ? Math.min(100, Math.round((log.progress / habit.daily_target) * 100)) : 0;
            dayPcts.push(pct);
        }
        if (dayPcts.length === 0) continue;
        const weekStart = addDays(habit.start_date, w * 7);
        weeks.push({
            label: `Wk${w + 1} (${weekStart})`,
            open: dayPcts[0],
            high: Math.max(...dayPcts),
            low: Math.min(...dayPcts),
            close: dayPcts[dayPcts.length - 1],
        });
    }
    return weeks;
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
}

// ─── 404 for unknown API routes ────────────────────────────────────────
app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
});

// ─── SPA fallback ─────────────────────────────────────────────────────
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

// ─── START — initialise DB first, then listen ─────────────────────────
getDb().then(() => {
    app.listen(PORT, () => {
        console.log(`\n🚀 HabitForge API  →  http://localhost:${PORT}`);
        console.log(`🌐 Open app        →  http://localhost:${PORT}/index.html`);
        console.log(`🏥 Health check    →  http://localhost:${PORT}/api/health\n`);
    });
}).catch(err => {
    console.error('❌ Failed to initialise database:', err);
    process.exit(1);
});

module.exports = app;
