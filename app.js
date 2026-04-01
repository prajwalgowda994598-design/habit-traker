/* =====================================================
   HABITFORGE — app.js  (API-connected version)
   All data now comes from the Express + SQLite backend.
   Falls back gracefully if server is offline.
   ===================================================== */

'use strict';

// ─── CONFIG ───────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3001/api';

const CAT_COLORS = {
    Health: '#22c55e',
    Study: '#3b82f6',
    Gym: '#f59e0b',
    Work: '#8b5cf6',
    Mindfulness: '#06b6d4',
    Custom: '#6c63ff',
};

const CAT_ICONS = {
    Health: '💪', Study: '📚', Gym: '🏋️',
    Work: '💼', Mindfulness: '🧘', Custom: '✨',
};

// ─── STATE ────────────────────────────────────────────────────────────
let authToken = localStorage.getItem('hf_token') || null;
let currentUser = JSON.parse(localStorage.getItem('hf_user') || 'null');
let habitsCache = [];   // in-memory cache updated after each API call
let logsCache = [];
let candleChart = null;
let trendChart = null;
let toastTimeout = null;

// ─── API HELPERS ──────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const res = await fetch(API_BASE + path, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const api = {
    // Auth
    signup: (name, email, password) =>
        apiFetch('/auth/signup', { method: 'POST', body: { name, email, password } }),
    login: (email, password) =>
        apiFetch('/auth/login', { method: 'POST', body: { email, password } }),
    me: () => apiFetch('/auth/me'),

    // Habits
    getHabits: () => apiFetch('/habits'),
    getHabit: (id) => apiFetch(`/habits/${id}`),
    createHabit: (data) => apiFetch('/habits', { method: 'POST', body: data }),
    updateHabit: (id, d) => apiFetch(`/habits/${id}`, { method: 'PUT', body: d }),
    deleteHabit: (id) => apiFetch(`/habits/${id}`, { method: 'DELETE' }),

    // Logs
    getToday: () => apiFetch('/logs/today'),
    getLogs: (params) => apiFetch('/logs?' + new URLSearchParams(params).toString()),
    upsertLog: (data) => apiFetch('/logs', { method: 'POST', body: data }),
    toggleLog: (habitId) => apiFetch('/logs/toggle', { method: 'POST', body: { habit_id: habitId } }),
    getStreak: (habitId) => apiFetch(`/logs/${habitId}/streak`),
    getHeatmap: (habitId, from, to) => apiFetch(`/logs/${habitId}/heatmap?from=${from}&to=${to}`),

    // Analytics
    getAnalytics: (habitId) => apiFetch(`/analytics/${habitId}`),
};

// ─── TOKEN / SESSION ──────────────────────────────────────────────────
function saveSession(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem('hf_token', token);
    localStorage.setItem('hf_user', JSON.stringify(user));
}

function clearSession() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('hf_token');
    localStorage.removeItem('hf_user');
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0];

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split('T')[0];
}

function dateRange(startDate, days) {
    const dates = [];
    for (let i = 0; i < days; i++) {
        const d = new Date(startDate + 'T00:00:00');
        d.setDate(d.getDate() + i);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

// ─── TOAST ────────────────────────────────────────────────────────────
function showToast(msg, icon = '✅') {
    const el = document.getElementById('toast');
    document.getElementById('toast-msg').textContent = msg;
    document.getElementById('toast-icon').textContent = icon;
    el.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.add('hidden'), 3000);
}

function showError(msg) {
    showToast(msg, '❌');
    console.error(msg);
}

// ─── LOADING SPINNER ──────────────────────────────────────────────────
function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.6' : '1';
}

// ─────────────────────────────────────────────────────────────────────
//  AUTHENTICATION
// ─────────────────────────────────────────────────────────────────────
async function handleSignup(e) {
    e.preventDefault();
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errEl = document.getElementById('signup-error');
    errEl.classList.add('hidden');
    setLoading('signup-btn', true);

    try {
        const { token, user } = await api.signup(name, email, password);
        saveSession(token, user);
        showToast(`Welcome, ${user.name}! 🎉`, '🎉');
        bootApp();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        setLoading('signup-btn', false);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    errEl.classList.add('hidden');
    setLoading('login-btn', true);

    try {
        const { token, user } = await api.login(email, password);
        saveSession(token, user);
        showToast(`Welcome back, ${user.name}! 👋`);
        bootApp();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        setLoading('login-btn', false);
    }
}

function handleLogout() {
    clearSession();
    habitsCache = [];
    logsCache = [];
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('view-auth').classList.add('active');
    if (candleChart) { candleChart.destroy(); candleChart = null; }
    if (trendChart) { trendChart.destroy(); trendChart = null; }
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    showToast('Logged out successfully', '👋');
}

document.addEventListener('DOMContentLoaded', () => {
    const signUpButton = document.getElementById('signUp');
    const signInButton = document.getElementById('signIn');
    const container = document.getElementById('flip-container');

    if (signUpButton && signInButton && container) {
        signUpButton.addEventListener('click', () => {
            container.classList.add("right-panel-active");
        });

        signInButton.addEventListener('click', () => {
            container.classList.remove("right-panel-active");
        });
    }
});

// ─────────────────────────────────────────────────────────────────────
//  APP BOOT
// ─────────────────────────────────────────────────────────────────────
async function bootApp() {
    document.getElementById('view-auth').classList.remove('active');
    document.getElementById('app-shell').classList.remove('hidden');

    const name = currentUser ? currentUser.name : 'User';
    document.getElementById('user-display-name').textContent = name;
    document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();

    document.getElementById('todays-date').textContent =
        new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Pre-load habits into cache
    try {
        const { habits } = await api.getHabits();
        habitsCache = habits || [];
    } catch (err) {
        console.error('Failed to preload habits:', err);
        habitsCache = [];
    }

    navigateTo('tracker');
    updateStreakLabel();
}

async function updateStreakLabel() {
    if (habitsCache.length === 0) {
        document.getElementById('user-streak-label').textContent = '🔥 0 day streak';
        return;
    }
    try {
        const streakResults = await Promise.all(
            habitsCache.map(h => api.getStreak(h.id).catch(() => ({ current_streak: 0 })))
        );
        const maxStreak = Math.max(0, ...streakResults.map(r => r.current_streak));
        document.getElementById('user-streak-label').textContent = `🔥 ${maxStreak} day streak`;
    } catch { /* silently skip */ }
}

// ─────────────────────────────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────────────────────────────
function navigateTo(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));

    const pageEl = document.getElementById(`page-${page}`);
    const navEl = document.getElementById(`nav-${page}`);
    if (pageEl) pageEl.classList.remove('hidden');
    if (navEl) navEl.classList.add('active');

    document.getElementById('sidebar').classList.remove('open');

    if (page === 'tracker') renderTracker();
    if (page === 'habits') renderHabitsPage();
    if (page === 'analytics') renderAnalyticsPage();
    if (page === 'history') renderHistoryPage();
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ─────────────────────────────────────────────────────────────────────
//  HABIT CRUD
// ─────────────────────────────────────────────────────────────────────
let editingHabitId = null;

function openHabitModal(habitId = null) {
    editingHabitId = habitId;
    const modal = document.getElementById('habit-modal');
    const form = document.getElementById('habit-form');
    const title = document.getElementById('modal-title');

    form.reset();
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('habit-category').value = '';
    document.getElementById('habit-edit-id').value = '';
    document.getElementById('habit-form-error').classList.add('hidden');

    if (habitId) {
        const habit = habitsCache.find(h => h.id === habitId);
        if (habit) {
            title.textContent = 'Edit Habit';
            document.getElementById('habit-name').value = habit.name;
            document.getElementById('habit-duration').value = habit.duration_days;
            document.getElementById('habit-target').value = habit.daily_target;
            document.getElementById('habit-unit').value = habit.unit;
            document.getElementById('habit-category').value = habit.category;
            document.getElementById('habit-edit-id').value = habit.id;
            document.querySelectorAll('.cat-btn').forEach(b => {
                if (b.dataset.cat === habit.category) b.classList.add('selected');
            });
        }
    } else {
        title.textContent = 'Create New Habit';
    }
    modal.classList.remove('hidden');
}

function closeHabitModal(e) {
    if (e.target === document.getElementById('habit-modal')) closeHabitModalDirect();
}
function closeHabitModalDirect() {
    document.getElementById('habit-modal').classList.add('hidden');
}

function selectCategory(btn) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('habit-category').value = btn.dataset.cat;
}

async function saveHabit(e) {
    e.preventDefault();
    const errEl = document.getElementById('habit-form-error');
    const name = document.getElementById('habit-name').value.trim();
    const category = document.getElementById('habit-category').value;
    const duration = parseInt(document.getElementById('habit-duration').value);
    const target = parseFloat(document.getElementById('habit-target').value);
    const unit = document.getElementById('habit-unit').value;
    const editId = document.getElementById('habit-edit-id').value;

    errEl.classList.add('hidden');
    if (!category) {
        errEl.textContent = 'Please select a category.';
        errEl.classList.remove('hidden');
        return;
    }

    try {
        const payload = { name, category, duration_days: duration, daily_target: target, unit };
        if (editId) {
            const { habit } = await api.updateHabit(editId, payload);
            const idx = habitsCache.findIndex(h => h.id === editId);
            if (idx !== -1) habitsCache[idx] = { ...habitsCache[idx], ...habit };
            showToast('Habit updated! ✏️', '✏️');
        } else {
            const { habit } = await api.createHabit({ ...payload, start_date: today() });
            habitsCache.push(habit);
            showToast('Habit created! 🎯', '🎯');
        }
        closeHabitModalDirect();
        renderHabitsPage();
        populateHabitSelects();
        updateStreakLabel();
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    }
}

async function deleteHabit(id) {
    if (!confirm('Delete this habit and all its logs?')) return;
    try {
        await api.deleteHabit(id);
        habitsCache = habitsCache.filter(h => h.id !== id);
        showToast('Habit deleted', '🗑️');
        renderHabitsPage();
        populateHabitSelects();
    } catch (err) {
        showError('Failed to delete habit: ' + err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────
//  RENDER: MY HABITS PAGE
// ─────────────────────────────────────────────────────────────────────
async function renderHabitsPage() {
    const grid = document.getElementById('habits-grid');
    const empty = document.getElementById('habits-empty');
    grid.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Loading…</p>';

    try {
        const { habits } = await api.getHabits();
        habitsCache = habits || [];

        if (habitsCache.length === 0) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }
        empty.classList.add('hidden');

        grid.innerHTML = habitsCache.map(h => {
            const pct = Math.min(100, Math.round((h.total_done / h.duration_days) * 100));
            const color = CAT_COLORS[h.category] || CAT_COLORS.Custom;
            const icon = CAT_ICONS[h.category] || '✨';
            const today_ = new Date().toISOString().split('T')[0];

            // Elapsed days since start
            const elapsed = Math.min(h.duration_days,
                Math.floor((new Date() - new Date(h.start_date + 'T00:00:00')) / 86400000) + 1);

            return `
      <div class="habit-card" style="--cat-color:${color}">
        <div class="habit-card-header">
          <span class="habit-icon">${icon}</span>
          <div class="habit-card-actions">
            <button class="btn btn-ghost btn-sm" onclick="openHabitModal('${h.id}')" title="Edit">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteHabit('${h.id}')" title="Delete">🗑️</button>
          </div>
        </div>
        <div class="habit-card-name">${escHtml(h.name)}</div>
        <div class="habit-card-meta">
          <span class="habit-chip">${icon} ${h.category}</span>
          <span class="habit-chip">⏱ ${h.daily_target} ${h.unit}</span>
          <span class="habit-chip">📅 Day ${elapsed}/${h.duration_days}</span>
        </div>
        <div class="habit-card-progress">
          <div class="habit-progress-label">
            <span>Overall Progress</span><span>${pct}%</span>
          </div>
          <div class="habit-progress-bar">
            <div class="habit-progress-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`;
        }).join('');
    } catch (err) {
        grid.innerHTML = `<p style="color:#ef4444;padding:1rem">⚠️ ${err.message}</p>`;
    }
}

// ─────────────────────────────────────────────────────────────────────
//  RENDER: TODAY'S TRACKER
// ─────────────────────────────────────────────────────────────────────
async function renderTracker() {
    const list = document.getElementById('tracker-list');
    const empty = document.getElementById('tracker-empty');
    list.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Loading…</p>';

    try {
        const { items } = await api.getToday();

        if (!items || items.length === 0) {
            list.innerHTML = '';
            empty.classList.remove('hidden');
            updateDailyProgress(0, 0);
            return;
        }
        empty.classList.add('hidden');

        list.innerHTML = items.map(({ habit: h, log }) => {
            const done = log ? log.completed : false;
            const progress = log ? log.progress : 0;
            const color = CAT_COLORS[h.category] || CAT_COLORS.Custom;
            const pct = Math.min(100, Math.round((progress / h.daily_target) * 100));
            const radius = 18;
            const circ = 2 * Math.PI * radius;
            const offset = circ - (pct / 100) * circ;

            return `
      <div class="tracker-item ${done ? 'completed' : ''}" style="--cat-color:${color}"
           id="tracker-item-${h.id}">
        <div class="tracker-checkbox" onclick="toggleHabitComplete('${h.id}')"></div>
        <div class="tracker-info" onclick="toggleHabitComplete('${h.id}')">
          <div class="tracker-name">${escHtml(h.name)}</div>
          <div class="tracker-meta">
            <span class="tracker-cat-badge">${CAT_ICONS[h.category] || '✨'} ${h.category}</span>
            <span>🎯 ${h.daily_target} ${h.unit}/day</span>
            ${log && log.notes ? `<span>💬 ${escHtml(log.notes)}</span>` : ''}
          </div>
        </div>
        <div class="tracker-progress-ring">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle class="ring-bg" cx="24" cy="24" r="${radius}" stroke-width="4"/>
            <circle class="ring-fill" cx="24" cy="24" r="${radius}" stroke-width="4"
              stroke="${color}"
              stroke-dasharray="${circ.toFixed(1)}"
              stroke-dashoffset="${offset.toFixed(1)}"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;color:${color}">
            ${pct}%
          </div>
        </div>
        <div class="tracker-actions">
          <button class="btn btn-ghost btn-sm" onclick="openLogModal('${h.id}')" title="Log progress">📝</button>
        </div>
      </div>`;
        }).join('');

        const doneCount = items.filter(({ log }) => log && log.completed).length;
        updateDailyProgress(doneCount, items.length);

        // Refresh the local habits cache too
        habitsCache = items.map(i => i.habit);
    } catch (err) {
        list.innerHTML = `<p style="color:#ef4444;padding:1rem">⚠️ ${err.message}<br><small>Make sure the server is running on port 3001.</small></p>`;
    }
}

function updateDailyProgress(done, total) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    document.getElementById('daily-progress-bar').style.width = pct + '%';
    document.getElementById('daily-progress-pct').textContent = pct + '%';
    document.getElementById('completion-count').textContent = `${done}/${total}`;
}

async function toggleHabitComplete(habitId) {
    try {
        await api.toggleLog(habitId);
        showToast('Updated! ✅', '✅');
        renderTracker();
        updateStreakLabel();
    } catch (err) {
        showError('Failed to update: ' + err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────
//  LOG MODAL
// ─────────────────────────────────────────────────────────────────────
function openLogModal(habitId) {
    const habit = habitsCache.find(h => h.id === habitId);
    document.getElementById('log-habit-id').value = habitId;
    document.getElementById('log-modal-title').textContent = `Log: ${habit ? habit.name : ''}`;
    document.getElementById('log-progress-label').textContent =
        `Progress (${habit ? habit.unit : 'units'})`;
    // Pre-fill from habit's today_log if cached
    const todayLog = habit ? habit.today_log : null;
    document.getElementById('log-progress').value = todayLog ? todayLog.progress : '';
    document.getElementById('log-notes').value = todayLog ? todayLog.notes : '';
    document.getElementById('log-modal').classList.remove('hidden');
}

function closeLogModal(e) {
    if (e.target === document.getElementById('log-modal')) closeLogModalDirect();
}
function closeLogModalDirect() {
    document.getElementById('log-modal').classList.add('hidden');
}

async function saveLog(e) {
    e.preventDefault();
    const habitId = document.getElementById('log-habit-id').value;
    const progress = parseFloat(document.getElementById('log-progress').value) || 0;
    const notes = document.getElementById('log-notes').value.trim();

    try {
        await api.upsertLog({ habit_id: habitId, date: today(), progress, notes });
        closeLogModalDirect();
        showToast('Progress saved! 📊', '📊');
        renderTracker();
        updateStreakLabel();
    } catch (err) {
        showError('Failed to save: ' + err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────
//  ANALYTICS PAGE
// ─────────────────────────────────────────────────────────────────────
async function renderAnalyticsPage() {
    await populateHabitSelects();
    if (habitsCache.length > 0) {
        const sel = document.getElementById('analytics-habit-select');
        if (!sel.value) sel.value = habitsCache[0].id;
        renderAnalytics();
    } else {
        document.getElementById('analytics-empty').classList.remove('hidden');
        clearStatCards();
    }
}

async function populateHabitSelects() {
    try {
        const { habits } = await api.getHabits();
        habitsCache = habits || [];
    } catch { /* use cache */ }

    const selA = document.getElementById('analytics-habit-select');
    const selH = document.getElementById('history-habit-select');
    const options = habitsCache.map(h =>
        `<option value="${h.id}">${escHtml(h.name)}</option>`
    ).join('');
    selA.innerHTML = '<option value="">— Select Habit —</option>' + options;
    selH.innerHTML = '<option value="all">All Habits</option>' + options;
}

function clearStatCards() {
    ['stat-streak', 'stat-best', 'stat-total', 'stat-rate']
        .forEach(id => { document.getElementById(id).textContent = '—'; });
}

async function renderAnalytics() {
    const habitId = document.getElementById('analytics-habit-select').value;
    if (!habitId) {
        document.getElementById('analytics-empty').classList.remove('hidden');
        clearStatCards();
        return;
    }
    document.getElementById('analytics-empty').classList.add('hidden');

    try {
        const { stats, weekly_buckets, logs, habit } = await api.getAnalytics(habitId);

        document.getElementById('stat-streak').textContent = stats.current_streak;
        document.getElementById('stat-best').textContent = stats.best_streak;
        document.getElementById('stat-total').textContent = stats.total_days_done;
        document.getElementById('stat-rate').textContent = stats.completion_rate + '%';

        renderCandlestickChart(weekly_buckets);
        renderTrendChart(habit, logs);
    } catch (err) {
        showError('Analytics error: ' + err.message);
    }
}

// ──── CANDLESTICK CHART ───────────────────────────────────────────────
function renderCandlestickChart(weeks) {
    const canvas = document.getElementById('candlestick-chart');
    const ctx = canvas.getContext('2d');
    if (candleChart) { candleChart.destroy(); candleChart = null; }
    if (!weeks || weeks.length === 0) return;

    const labels = weeks.map(w => w.label);
    const upColor = '#00f076';
    const downColor = '#ff3b60';
    const barData = weeks.map(w => w.close);
    const colors = weeks.map(w => w.close >= w.open ? upColor : downColor);

    candleChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Completion %',
                    data: barData,
                    backgroundColor: colors.map(c => c + 'aa'),
                    borderColor: colors,
                    borderWidth: 2,
                    borderRadius: 4,
                },
                {
                    label: 'High',
                    data: weeks.map(w => w.high),
                    type: 'line',
                    borderColor: '#6c63ff55',
                    backgroundColor: 'transparent',
                    borderDash: [4, 4],
                    pointRadius: 0,
                    borderWidth: 1,
                },
                {
                    label: 'Low',
                    data: weeks.map(w => w.low),
                    type: 'line',
                    borderColor: '#f59e0b44',
                    backgroundColor: 'transparent',
                    borderDash: [4, 4],
                    pointRadius: 0,
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Outfit, sans-serif' } } },
                tooltip: {
                    titleFont: { family: 'Outfit, sans-serif' },
                    bodyFont: { family: 'Outfit, sans-serif' },
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.datasetIndex === 0) {
                                const w = weeks[ctx.dataIndex];
                                return [`Close: ${w.close}%`, `Open: ${w.open}%`, `High: ${w.high}%`, `Low: ${w.low}%`];
                            }
                            return `${ctx.dataset.label}: ${ctx.parsed.y}%`;
                        },
                    },
                },
            },
            scales: {
                x: { ticks: { color: '#94a3b8', font: { family: 'Outfit, sans-serif' } }, grid: { color: '#ffffff0a' } },
                y: {
                    ticks: { color: '#94a3b8', font: { family: 'Outfit, sans-serif' }, callback: v => v + '%' },
                    grid: { color: '#ffffff0a' }, min: 0, max: 100,
                },
            },
        },
    });
}

// ──── TREND CHART ─────────────────────────────────────────────────────
function renderTrendChart(habit, logs) {
    const canvas = document.getElementById('trend-chart');
    const ctx = canvas.getContext('2d');
    if (trendChart) { trendChart.destroy(); trendChart = null; }

    const last30 = dateRange(daysAgo(29), 30);
    const logMap = {};
    (logs || []).forEach(l => { logMap[l.date] = l; });

    const labels = last30.map(d =>
        new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    );
    const data = last30.map(d => {
        const log = logMap[d];
        return log ? Math.min(100, Math.round((log.progress / habit.daily_target) * 100)) : null;
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(108,99,255,0.35)');
    gradient.addColorStop(1, 'rgba(108,99,255,0)');

    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Daily Completion %',
                data,
                borderColor: '#6c63ff',
                backgroundColor: gradient,
                pointBackgroundColor: data.map(v =>
                    v === null ? 'transparent' : v >= 100 ? '#00f076' : '#6c63ff'
                ),
                pointRadius: 5,
                pointHoverRadius: 8,
                tension: 0.4,
                fill: true,
                spanGaps: true,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { family: 'Outfit, sans-serif' } } },
                tooltip: {
                    titleFont: { family: 'Outfit, sans-serif' },
                    bodyFont: { family: 'Outfit, sans-serif' },
                    callbacks: { label: (ctx) => `${ctx.parsed.y ?? 0}%` }
                },
            },
            scales: {
                x: {
                    ticks: { color: '#94a3b8', font: { family: 'Outfit, sans-serif' }, maxRotation: 45, maxTicksLimit: 10 },
                    grid: { color: '#ffffff0a' },
                },
                y: {
                    ticks: { color: '#94a3b8', font: { family: 'Outfit, sans-serif' }, callback: v => v + '%' },
                    grid: { color: '#ffffff0a' }, min: 0, max: 100,
                },
            },
        },
    });
}

// ─────────────────────────────────────────────────────────────────────
//  HISTORY / HEATMAP PAGE
// ─────────────────────────────────────────────────────────────────────
async function renderHistoryPage() {
    await populateHabitSelects();
    renderHeatmap();
    renderActivityLog();
}

async function renderHeatmap() {
    const habitFilter = document.getElementById('history-habit-select').value;
    const toDate = today();
    const fromDate = daysAgo(364);

    try {
        let allLogEntries = [];

        if (habitFilter === 'all') {
            const { logs } = await api.getLogs({ from: fromDate, to: toDate });
            allLogEntries = logs;
        } else {
            const { logs } = await api.getLogs({ habit_id: habitFilter, from: fromDate, to: toDate });
            allLogEntries = logs;
        }

        // Build date → intensity map
        const dateMap = {};
        allLogEntries.forEach(l => {
            if (!dateMap[l.date]) dateMap[l.date] = { done: 0, total: 0 };
            dateMap[l.date].total++;
            if (l.completed) dateMap[l.date].done++;
        });

        const levelMap = {};
        Object.entries(dateMap).forEach(([date, { done, total }]) => {
            const pct = (done / total) * 100;
            if (pct === 0) levelMap[date] = 0;
            else if (pct < 30) levelMap[date] = 1;
            else if (pct < 60) levelMap[date] = 2;
            else if (pct < 90) levelMap[date] = 3;
            else levelMap[date] = 4;
        });

        buildHeatmapGrid(levelMap);
    } catch (err) {
        console.error('Heatmap error:', err);
        buildHeatmapGrid({});
    }
}

function buildHeatmapGrid(levelMap) {
    const grid = document.getElementById('heatmap-grid');
    const monthsEl = document.getElementById('heatmap-months');
    grid.innerHTML = '';
    monthsEl.innerHTML = '';

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 364);
    const dayOfWeek = startDate.getDay();
    const mondayOff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDate.setDate(startDate.getDate() + mondayOff);

    const monthLabels = {};
    const totalWeeks = 53;

    for (let week = 0; week < totalWeeks; week++) {
        const col = document.createElement('div');
        col.className = 'heatmap-col';

        for (let day = 0; day < 7; day++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + week * 7 + day);
            if (d > endDate) continue;

            const dateStr = d.toISOString().split('T')[0];
            const level = levelMap[dateStr] ?? 0;
            const cell = document.createElement('div');
            cell.className = 'heatmap-cell';
            cell.dataset.level = level;
            cell.dataset.date = dateStr;
            cell.title = `${formatDate(dateStr)}: Level ${level}`;
            col.appendChild(cell);

            const key = `${d.getFullYear()}-${d.getMonth()}`;
            if (!monthLabels[key]) monthLabels[key] = week;
        }
        grid.appendChild(col);
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sortedMonths = Object.entries(monthLabels).sort((a, b) => a[1] - b[1]);
    sortedMonths.forEach(([key]) => {
        const [, month] = key.split('-').map(Number);
        const span = document.createElement('span');
        span.className = 'heatmap-month-label';
        span.textContent = monthNames[month];
        span.style.minWidth = '16px';
        monthsEl.appendChild(span);
    });
}

async function renderActivityLog() {
    const logEl = document.getElementById('activity-log');
    logEl.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Loading…</p>';

    try {
        const toDate = today();
        const fromDate = daysAgo(29);
        const { logs } = await api.getLogs({ from: fromDate, to: toDate });
        const sortedLogs = [...logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

        if (sortedLogs.length === 0) {
            logEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem">No activity yet.</p>';
            return;
        }

        // Build habit name map from cache
        const habitMap = {};
        habitsCache.forEach(h => { habitMap[h.id] = h; });

        logEl.innerHTML = sortedLogs.map(l => {
            const h = habitMap[l.habit_id];
            if (!h) return '';
            return `
      <div class="activity-item">
        <span class="activity-date">${l.date}</span>
        <span class="activity-habit">${CAT_ICONS[h.category] || '✨'} ${escHtml(h.name)}</span>
        <span class="activity-status ${l.completed ? 'activity-completed' : 'activity-missed'}">
          ${l.completed ? '✓ Done' : '✗ Missed'}
        </span>
        ${l.notes ? `<span style="color:var(--text-muted);font-size:0.75rem;">${escHtml(l.notes)}</span>` : ''}
      </div>`;
        }).join('');
    } catch (err) {
        logEl.innerHTML = `<p style="color:#ef4444;padding:1rem">⚠️ ${err.message}</p>`;
    }
}

// ─────────────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────────────
(async function init() {
    const introView = document.getElementById('view-intro');
    introView.classList.add('active');

    let nextViewId = 'view-auth';

    if (authToken && currentUser) {
        // Verify token is still valid in the background
        try {
            await api.me();
            nextViewId = 'app-shell';
        } catch {
            clearSession();
        }
    }

    // Wait 4.5 seconds for the cinematic intro animation to play completely
    await new Promise(r => setTimeout(r, 4500));

    // Hide intro
    introView.classList.remove('active');

    // Navigate to target
    if (nextViewId === 'app-shell') {
        bootApp();
    } else {
        document.getElementById('view-auth').classList.add('active');
    }
})();
