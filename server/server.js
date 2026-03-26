const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const { initializeDatabase, dbRun, dbGet, dbAll } = require('./database.js');

const app  = express();
const PORT = process.env.PORT || 3000;

const PHOTOS_DIR = path.join(__dirname, '..', 'public', 'photos');
if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });

// ── In-memory token store ─────────────────────────────────────────────────────
const tokens = new Map();   // token  →  user object

function createToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { ...user });
  return token;
}

function getUser(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return tokens.get(token) || null;
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, PHOTOS_DIR),
  filename:    (_, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname) || '.jpg'}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Guards ────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  req.user = getUser(req);
  if (req.user) return next();
  res.status(401).json({ error: 'Please log in' });
}
function requireAdmin(req, res, next) {
  req.user = getUser(req);
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function workingDaysInMonth(monthStr) {
  const [year, month] = monthStr
    ? monthStr.split('-').map(Number)
    : [new Date().getFullYear(), new Date().getMonth() + 1];

  return new Date(year, month, 0).getDate();
}

// ══════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    // Check admin
    const admin = await dbGet('SELECT * FROM admins WHERE username = ?', [username]);
    if (admin && bcrypt.compareSync(password, admin.password)) {
      const user  = { id: admin.id, name: admin.name, username: admin.username, role: 'admin' };
      const token = createToken(user);
      return res.json({ success: true, token, user });
    }

    // Check member
    const member = await dbGet('SELECT * FROM members WHERE username = ?', [username]);
    if (member && bcrypt.compareSync(password, member.password)) {
      const user  = { id: member.id, name: member.name, username: member.username, role: 'member' };
      const token = createToken(user);
      return res.json({ success: true, token, user });
    }

    res.status(401).json({ error: 'Invalid username or password' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  tokens.delete(token);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Both fields required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const table = req.user.role === 'admin' ? 'admins' : 'members';
    const row   = await dbGet(`SELECT * FROM ${table} WHERE id = ?`, [req.user.id]);
    if (!row || !bcrypt.compareSync(currentPassword, row.password))
      return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = bcrypt.hashSync(newPassword, 10);
    await dbRun(`UPDATE ${table} SET password = ? WHERE id = ?`, [hash, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════
// MEMBERS
// ══════════════════════════════════════════════════

app.get('/api/members', requireAuth, async (req, res) => {
  try {
    const members = await dbAll(
      'SELECT id, name, username, created_at FROM members ORDER BY name'
    );
    res.json({ members });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/members', requireAdmin, async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password)
      return res.status(400).json({ error: 'Name, username and password required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await dbGet('SELECT id FROM members WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    const hash = bcrypt.hashSync(password, 10);
    const { lastID } = await dbRun(
      'INSERT INTO members (name, username, password) VALUES (?, ?, ?)',
      [name.trim(), username.trim(), hash]
    );
    res.json({ success: true, member: { id: lastID, name, username } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/members/:id', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM members WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════════════════

app.post('/api/attendance', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'member')
      return res.status(403).json({ error: 'Only members can mark attendance' });

    const today   = todayStr();
    const now     = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    const isLate  = now.getHours() >= 10 ? 1 : 0;

    const existing = await dbGet(
      'SELECT id FROM attendance WHERE member_id = ? AND date = ?', [user.id, today]
    );
    if (existing)
      return res.status(400).json({ error: 'Attendance already marked for today' });

    const location = req.body.location || null;
    let photoPath  = req.file ? `/photos/${req.file.filename}` : null;

    if (!photoPath && req.body.photo_base64) {
      try {
        const b64   = req.body.photo_base64.replace(/^data:image\/\w+;base64,/, '');
        const fname = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
        fs.writeFileSync(path.join(PHOTOS_DIR, fname), Buffer.from(b64, 'base64'));
        photoPath = `/photos/${fname}`;
      } catch (e) { console.error('Photo save error:', e.message); }
    }

    const { lastID } = await dbRun(
      `INSERT INTO attendance (member_id, date, time, location, photo_path, status, is_late)
       VALUES (?, ?, ?, ?, ?, 'Present', ?)`,
      [user.id, today, timeStr, location, photoPath, isLate]
    );
    res.json({ success: true,
      attendance: { id: lastID, date: today, time: timeStr, is_late: isLate, photo_path: photoPath }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/attendance/today', requireAuth, async (req, res) => {
  try {
    const user = req.user, today = todayStr();
    const rows = user.role === 'admin'
      ? await dbAll(
          `SELECT a.*, m.name AS member_name, m.username
           FROM attendance a JOIN members m ON m.id = a.member_id
           WHERE a.date = ? ORDER BY a.time DESC`, [today])
      : await dbAll(
          `SELECT a.*, m.name AS member_name
           FROM attendance a JOIN members m ON m.id = a.member_id
           WHERE a.date = ? AND a.member_id = ?`, [today, user.id]);
    res.json({ attendance: rows, date: today });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/attendance', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const { from, to, member_id, month } = req.query;
    let sql    = `SELECT a.*, m.name AS member_name, m.username
                  FROM attendance a JOIN members m ON m.id = a.member_id WHERE 1=1`;
    const params = [];
    if (user.role !== 'admin') { sql += ' AND a.member_id = ?'; params.push(user.id); }
    else if (member_id)        { sql += ' AND a.member_id = ?'; params.push(member_id); }
    if (from)  { sql += ' AND a.date >= ?';                   params.push(from);  }
    if (to)    { sql += ' AND a.date <= ?';                   params.push(to);    }
    if (month) { sql += " AND strftime('%Y-%m', a.date) = ?"; params.push(month); }
    sql += ' ORDER BY a.date DESC, a.time DESC';
    res.json({ attendance: await dbAll(sql, params) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/attendance/stats', requireAuth, async (req, res) => {
  try {
    const user    = req.user;
    const month   = req.query.month || todayStr().slice(0, 7);
    const working = workingDaysInMonth(month);

    const members = user.role === 'admin'
      ? await dbAll('SELECT id, name, username FROM members ORDER BY name')
      : await dbAll('SELECT id, name, username FROM members WHERE id = ?', [user.id]);

    const stats = await Promise.all(members.map(async m => {
      const p = await dbGet(
        `SELECT COUNT(*) AS c FROM attendance
         WHERE member_id=? AND strftime('%Y-%m',date)=? AND status='Present'`, [m.id, month]);
      const l = await dbGet(
        `SELECT COUNT(*) AS c FROM attendance
         WHERE member_id=? AND strftime('%Y-%m',date)=? AND is_late=1`, [m.id, month]);
      const present = p?.c || 0;
      return { ...m, present_days: present, late_days: l?.c || 0, working_days: working,
               percentage: working > 0 ? Math.round((present / working) * 100) : 0 };
    }));

    res.json({ stats, working_days: working, month });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// TASKS
// ══════════════════════════════════════════════════

app.get('/api/tasks', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    let sql    = `SELECT t.*, m.name AS assignee_name
                  FROM tasks t LEFT JOIN members m ON m.id = t.assigned_to WHERE 1=1`;
    const params = [];
    if (user.role !== 'admin') { sql += ' AND t.assigned_to = ?'; params.push(user.id); }
    sql += ' ORDER BY t.created_at DESC';
    res.json({ tasks: await dbAll(sql, params) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', requireAdmin, async (req, res) => {
  try {
    const { title, description, assigned_to, due_date, priority } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const { lastID } = await dbRun(
      `INSERT INTO tasks (title, description, assigned_to, due_date, priority, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [title, description || null, assigned_to || null,
       due_date || null, priority || 'medium', req.user.id]
    );
    res.json({ success: true, task: { id: lastID, title, priority } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/tasks/:id', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const task = await dbGet('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const { title, description, assigned_to, due_date, priority, status } = req.body;

    if (user.role !== 'admin') {
      if (task.assigned_to !== user.id)
        return res.status(403).json({ error: 'Not authorised' });
      await dbRun(
        `UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=?`,
        [status || task.status, req.params.id]
      );
      return res.json({ success: true });
    }
    await dbRun(
      `UPDATE tasks SET title=?,description=?,assigned_to=?,due_date=?,priority=?,status=?,
       updated_at=datetime('now') WHERE id=?`,
      [title ?? task.title, description ?? task.description,
       assigned_to ?? task.assigned_to, due_date ?? task.due_date,
       priority ?? task.priority, status ?? task.status, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/tasks/:id', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM tasks WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════

app.get('/api/export/attendance', requireAdmin, async (req, res) => {
  try {
    const { month } = req.query;
    let sql    = `SELECT m.name, m.username, a.date, a.time, a.status,
                  CASE WHEN a.is_late=1 THEN 'Yes' ELSE 'No' END AS late, a.location
                  FROM attendance a JOIN members m ON m.id = a.member_id WHERE 1=1`;
    const params = [];
    if (month) { sql += " AND strftime('%Y-%m', a.date) = ?"; params.push(month); }
    sql += ' ORDER BY m.name, a.date';
    const rows = await dbAll(sql, params);
    const csv  = [
      ['Name','Username','Date','Time','Status','Late','Location'].join(','),
      ...rows.map(r =>
        [`"${r.name}"`, r.username, r.date, r.time, r.status, r.late, `"${r.location || ''}"`].join(',')
      )
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${month || 'all'}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/tasks', requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT t.title, t.description, m.name AS assignee, t.due_date,
              t.priority, t.status, t.created_at
       FROM tasks t LEFT JOIN members m ON m.id = t.assigned_to
       ORDER BY t.created_at DESC`
    );
    const csv = [
      ['Title','Description','Assignee','Due Date','Priority','Status','Created'].join(','),
      ...rows.map(r =>
        [`"${r.title}"`, `"${r.description||''}"`, `"${r.assignee||'Unassigned'}"`,
         r.due_date||'', r.priority, r.status, r.created_at].join(',')
      )
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/export/backup', requireAdmin, (req, res) => {
  const dbPath = path.join(__dirname, 'attendx.db');
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Database not found' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="attendx-backup-${todayStr()}.db"`);
  fs.createReadStream(dbPath).pipe(res);
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🟢  AttendX → http://localhost:${PORT}`);
    console.log(`    Admin   →  admin / admin123`);
    console.log(`    Members →  alice,bob,carol,david,eva / pass123\n`);
  });
}).catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});

module.exports = app;
