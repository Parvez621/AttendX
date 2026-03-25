'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser    = null;
let allMembers     = [];
let allTasks       = [];
let clockInterval  = null;

// Camera state
let cameraStream     = null;
let capturedPhoto    = null;
let capturedLocation = null;
let _camMetaTicker   = null;
let _gpsWatchId      = null;
let _gpsResolved     = false;
let _countdownTimer  = null;

// Detail modal state
let _detailTaskId   = null;
let _detailMemberId = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await sleep(1800);
  document.getElementById('app-loader').classList.add('fade-out');
  document.getElementById('app').classList.remove('hidden');
  try {
    const res = await api('GET', '/api/me');
    currentUser = res.user;
    routeByRole();
  } catch {
    showScreen('login');
  }
});

// ── Routing ───────────────────────────────────────────────────────────────────
function routeByRole() {
  if (!currentUser) { showScreen('login'); return; }
  if (currentUser.role === 'admin') { showScreen('admin'); initAdminDashboard(); }
  else                              { showScreen('member'); initMemberDashboard(); }
}
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`)?.classList.add('active');
}

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  if (!username || !password) { toast('Enter your credentials', 'warning'); return; }
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Signing in…';
  try {
    const res = await api('POST', '/api/login', { username, password });
    localStorage.setItem('attendx_token', res.token);
    currentUser = res.user;
    toast(`Welcome back, ${res.user.name.split(' ')[0]}!`, 'success');
    await sleep(350);
    routeByRole();
  } catch (err) {
    toast(err.message || 'Login failed', 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'Sign In';
  }
});

document.getElementById('pw-toggle').addEventListener('click', () => {
  const inp = document.getElementById('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout() {
  await api('POST', '/api/logout').catch(() => {});
  currentUser = null; allMembers = []; allTasks = [];
  localStorage.removeItem('attendx_token');
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
  showScreen('login');
  toast('Signed out');
}
document.getElementById('btn-logout-admin').addEventListener('click', logout);
document.getElementById('btn-logout-member').addEventListener('click', logout);

// ── Change Password ───────────────────────────────────────────────────────────
document.getElementById('form-change-pw').addEventListener('submit', async e => {
  e.preventDefault();
  const current = document.getElementById('cp-current').value;
  const nw      = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  if (!current || !nw || !confirm) { toast('All fields required', 'warning'); return; }
  if (nw !== confirm) { toast('Passwords do not match', 'error'); return; }
  if (nw.length < 6)  { toast('Password must be ≥ 6 characters', 'warning'); return; }
  try {
    await api('POST', '/api/change-password', { currentPassword: current, newPassword: nw });
    toast('Password updated!', 'success');
    closeModal('modal-change-pw');
    e.target.reset();
  } catch (err) { toast(err.message, 'error'); }
});

// ═══════════════════════════════════════════
// MEMBER DASHBOARD
// ═══════════════════════════════════════════

function initMemberDashboard() {
  const u = currentUser;
  setInitials('member-avatar-initials', u.name);
  setText('member-name', u.name);
  startClock();
  loadMemberStatus();
  loadMemberStats();
  loadMemberTasks();
  loadMemberHistory();
  document.getElementById('member-avatar-btn').onclick = () => {
    setText('profile-avatar-big', initials(u.name));
    setText('profile-name', u.name);
    setText('profile-username', `@${u.username}`);
    openModal('modal-profile');
  };
}

function startClock() {
  const tick = () => {
    const now = new Date();
    setText('member-clock', now.toLocaleTimeString('en-GB', { hour12: false }));
    setText('member-date',  now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' }));
    const h = now.getHours();
    setText('member-greeting', h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  };
  tick();
  clockInterval = setInterval(tick, 1000);
}

async function loadMemberStatus() {
  const indicator = document.getElementById('status-indicator');
  const label     = document.getElementById('status-label');
  const btn       = document.getElementById('checkin-btn');
  const sub       = document.getElementById('checkin-sub');
  try {
    const res = await api('GET', '/api/attendance/today');
    const rec = res.attendance[0];
    if (rec) {
      indicator.className = `status-indicator ${rec.is_late ? 'late' : 'present'}`;
      label.textContent   = rec.is_late ? '⚠ Marked Late' : '✓ Present Today';
      btn.disabled        = true;
      sub.textContent     = `Checked in at ${rec.time}`;
    } else {
      indicator.className = 'status-indicator absent';
      label.textContent   = '✗ Not Yet Marked';
      btn.disabled        = false;
      sub.textContent     = new Date().getHours() >= 10
        ? '⚠ Will be flagged as Late'
        : 'Tap to mark attendance';
    }
  } catch {
    label.textContent = 'Status unavailable';
    btn.disabled = false;
    sub.textContent = 'Tap to mark attendance';
  }
}

async function loadMemberStats() {
  try {
    const res = await api('GET', '/api/attendance/stats');
    const me  = res.stats.find(s => s.id === currentUser.id) || res.stats[0];
    if (!me) return;
    setText('member-present', me.present_days);
    setText('member-working', me.working_days);
    setText('member-pct', `${me.percentage}%`);
  } catch {}
}

async function loadMemberTasks() {
  try {
    const res   = await api('GET', '/api/tasks');
    const tasks = res.tasks || [];
    setText('tasks-badge', tasks.filter(t => t.status !== 'done' && t.status !== 'completed').length);
    renderMemberTasks(tasks);
  } catch {}
}

function renderMemberTasks(tasks) {
  const el = document.getElementById('member-tasks-list');
  if (!tasks.length) { el.innerHTML = '<div class="empty-state">No tasks assigned.</div>'; return; }
  el.innerHTML = tasks.map(t => `
    <div class="task-item ${t.status === 'done' ? 'done' : ''}" onclick="cycleTaskStatus(${t.id},'${t.status}')">
      <div class="task-pri ${t.priority}"></div>
      <div class="task-body">
        <div class="task-title-text">${esc(t.title)}</div>
        <div class="task-meta">
          ${t.due_date ? `<span>Due: ${t.due_date}</span>` : ''}
          <span>${cap(t.priority)} priority</span>
        </div>
      </div>
      <span class="task-status-badge ${t.status}">${fmtStatus(t.status)}</span>
    </div>`).join('');
}

async function cycleTaskStatus(id, current) {
  const next = { pending:'in-progress', 'in-progress':'done', done:'pending' };
  try {
    await api('PUT', `/api/tasks/${id}`, { status: next[current] || 'pending' });
    toast(`Marked as ${fmtStatus(next[current])}`, 'success');
    loadMemberTasks();
  } catch (e) { toast(e.message, 'error'); }
}

async function loadMemberHistory() {
  try {
    const res  = await api('GET', '/api/attendance');
    const recs = res.attendance || [];
    const el   = document.getElementById('member-history-list');
    if (!recs.length) { el.innerHTML = '<div class="empty-state">No attendance records yet.</div>'; return; }
    el.innerHTML = recs.map(r => {
      const thumb = r.photo_path
        ? `<img class="hist-thumb" src="${r.photo_path}" onclick="viewPhoto('${r.photo_path}','${r.date} ${r.time}')" />`
        : `<div class="hist-no-photo">◎</div>`;
      return `
        <div class="history-item">
          ${thumb}
          <div class="hist-info">
            <div class="hist-date">${fmtDate(r.date)}</div>
            <div class="hist-time">${r.time}${r.location ? ' · ' + shortLoc(r.location) : ''}</div>
          </div>
          <span class="hist-badge ${r.is_late ? 'late' : 'present'}">${r.is_late ? 'Late' : 'Present'}</span>
        </div>`;
    }).join('');
  } catch {}
}

window.memberTab = function(tab, btn) {
  document.querySelectorAll('#screen-member .nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'profile') { document.getElementById('member-avatar-btn').click(); return; }
  const map = { home:'attendance-status-card', history:'member-history-list', tasks:'member-tasks-list' };
  document.getElementById(map[tab])?.scrollIntoView({ behavior:'smooth', block:'start' });
};

// ═══════════════════════════════════════════
// CHECK-IN FLOW
// ═══════════════════════════════════════════

document.getElementById('checkin-btn').addEventListener('click', openCheckin);
document.getElementById('btn-close-checkin').addEventListener('click', () => closeModal('modal-checkin'));

window.openModal  = id => document.getElementById(id)?.classList.remove('hidden');
window.closeModal = function(id) {
  if (id === 'modal-checkin') { _stopCamera(); _stopCamMeta(); _stopGPS(); }
  document.getElementById(id)?.classList.add('hidden');
};

document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) closeModal(o.id); });
});

async function openCheckin() {
  capturedPhoto = null; capturedLocation = null; _gpsResolved = false;
  if (_countdownTimer) { clearTimeout(_countdownTimer); _countdownTimer = null; }
  _stopGPS();
  _goToStep('camera', 'Step 1 of 3', 'Position Your Face');
  openModal('modal-checkin');
  _startCamMeta();
  _startGPS();
  await _startCamera();
}

function _goToStep(step, pill, title) {
  document.querySelectorAll('.ci-step').forEach(s => s.classList.add('hidden'));
  document.getElementById(`ci-step-${step}`)?.classList.remove('hidden');
  setText('ci-step-pill', pill);
  setText('ci-title', title);
}

async function _startCamera() {
  const init  = document.getElementById('cam-init-overlay');
  const error = document.getElementById('cam-error-overlay');
  const guide = document.getElementById('face-guide');
  const video = document.getElementById('camera-preview');
  init.style.display = '';
  error.classList.add('hidden');
  guide.style.opacity = '0';
  video.classList.remove('hidden');
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('btn-capture').style.pointerEvents = '';
  _stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:'user', width:{ ideal:720 }, height:{ ideal:960 } }, audio: false
    });
    video.srcObject = cameraStream;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res; video.onerror = rej; setTimeout(rej, 8000);
    });
    init.style.display = 'none';
    guide.style.opacity = '1';
  } catch (err) {
    init.style.display = 'none';
    error.classList.remove('hidden');
    const msgs = {
      NotAllowedError:      'Camera permission denied. Allow camera access and try again.',
      NotFoundError:        'No camera found. Please connect a camera.',
      NotReadableError:     'Camera is in use by another app. Close it and try again.'
    };
    setText('cam-error-msg', msgs[err.name] || `Camera error: ${err.message}`);
    document.getElementById('btn-retry-cam').onclick = () => _startCamera();
  }
}
function _stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}

function _startCamMeta() {
  _stopCamMeta();
  const tick = () => {
    const now = new Date();
    setText('cam-time-val', now.toLocaleTimeString('en-GB', { hour12: false }));
    const h = now.getHours();
    const lateEl = document.getElementById('cam-late-val');
    const warnEl = document.getElementById('late-warning');
    if (h >= 10) {
      lateEl.textContent = 'Will be Late ⚠'; lateEl.style.color = 'var(--late)';
      warnEl.classList.remove('hidden');
    } else {
      lateEl.textContent = `On Time · ${10*60 - (h*60+now.getMinutes())}m left`;
      lateEl.style.color = 'var(--accent)';
      warnEl.classList.add('hidden');
    }
  };
  tick();
  _camMetaTicker = setInterval(tick, 1000);
}
function _stopCamMeta() { if (_camMetaTicker) { clearInterval(_camMetaTicker); _camMetaTicker = null; } }

function _startGPS() {
  const locEl   = document.getElementById('cam-loc-val');
  const gpsIcon = document.getElementById('gps-icon');
  locEl.textContent = 'Locating…';
  gpsIcon.classList.add('gps-pulse');
  gpsIcon.classList.remove('fixed');
  if (!navigator.geolocation) { locEl.textContent = 'GPS not supported'; return; }
  _gpsWatchId = navigator.geolocation.watchPosition(
    async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      locEl.textContent = 'Getting address…';
      gpsIcon.classList.remove('gps-pulse');
      gpsIcon.classList.add('fixed');
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await resp.json();
        const a    = data.address || {};
        const parts = [
          a.neighbourhood || a.suburb || a.village || a.town || a.hamlet,
          a.city || a.county || a.district, a.state
        ].filter(Boolean);
        capturedLocation = parts.length ? parts.join(', ') : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      } catch { capturedLocation = `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
      _gpsResolved = true;
      locEl.textContent = capturedLocation;
    },
    err => {
      if (_gpsResolved) return;
      const msgs = { 1:'Permission denied', 2:'Position unavailable', 3:'Timeout' };
      locEl.textContent = msgs[err.code] || 'Location error';
      gpsIcon.classList.remove('gps-pulse');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}
function _stopGPS() {
  if (_gpsWatchId !== null) { navigator.geolocation.clearWatch(_gpsWatchId); _gpsWatchId = null; }
}

window.capturePhoto = function() {
  if (_countdownTimer) return;
  const overlay = document.getElementById('countdown-overlay');
  const numEl   = document.getElementById('countdown-num');
  document.getElementById('btn-capture').style.pointerEvents = 'none';
  let count = 3;
  overlay.classList.remove('hidden');
  const tick = () => {
    numEl.textContent = count;
    numEl.style.animation = 'none'; void numEl.offsetWidth; numEl.style.animation = '';
    if (count === 0) {
      overlay.classList.add('hidden');
      document.getElementById('btn-capture').style.pointerEvents = '';
      _countdownTimer = null;
      _doCapture();
      return;
    }
    count--;
    _countdownTimer = setTimeout(tick, 900);
  };
  tick();
};

function _doCapture() {
  const video  = document.getElementById('camera-preview');
  const canvas = document.getElementById('camera-canvas');
  const flash  = document.getElementById('flash-overlay');
  flash.classList.remove('hidden');
  setTimeout(() => flash.classList.add('hidden'), 350);
  const w = video.videoWidth || 720, h = video.videoHeight || 960;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.translate(w, 0); ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  capturedPhoto = canvas.toDataURL('image/jpeg', 0.88);
  _stopCamera(); _stopCamMeta();

  const now    = new Date();
  const isLate = now.getHours() >= 10;
  document.getElementById('review-photo').src = capturedPhoto;
  setText('review-datetime', `${now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} at ${now.toLocaleTimeString('en-GB',{hour12:false})}`);
  setText('review-location', capturedLocation || 'Location not captured');
  setText('review-status', isLate ? '⚠ Late check-in (after 10:00 AM)' : '✓ On Time');
  const badge = document.getElementById('review-badge');
  badge.className = `review-badge ${isLate ? 'late' : 'present'}`;
  setText('review-badge-icon', isLate ? '⚠' : '✓');
  setText('review-badge-text', isLate ? 'Late Check-in' : 'On Time');
  _goToStep('review', 'Step 2 of 3', 'Review Your Photo');
}

window.retakePhoto = function() {
  capturedPhoto = null;
  _goToStep('camera', 'Step 1 of 3', 'Position Your Face');
  _startCamMeta(); _startCamera();
};

window.submitCheckin = async function() {
  const btn = document.getElementById('btn-submit-checkin');
  btn.disabled = true; btn.textContent = 'Submitting…';
  try {
    const body = {};
    if (capturedLocation) body.location     = capturedLocation;
    if (capturedPhoto)    body.photo_base64 = capturedPhoto;
    await api('POST', '/api/attendance', body);
    _stopGPS();
    const now    = new Date();
    const isLate = now.getHours() >= 10;
    setText('sc-time', now.toLocaleTimeString('en-GB', { hour12: false }));
    setText('sc-status', isLate ? '⚠ Late' : '✓ On Time');
    setText('success-title', isLate ? 'Marked as Late' : 'Attendance Marked!');
    setText('success-sub', isLate ? 'Check-in recorded as Late.' : "You're all set for today.");
    _goToStep('success', 'Step 3 of 3', 'All Done');
    loadMemberStatus(); loadMemberStats(); loadMemberHistory();
  } catch (err) {
    toast(err.message || 'Failed to submit', 'error');
    btn.disabled = false; btn.textContent = 'Submit Attendance →';
  }
};

// ═══════════════════════════════════════════
// ADMIN DASHBOARD
// ═══════════════════════════════════════════

function initAdminDashboard() {
  const u = currentUser;
  setInitials('admin-avatar-initials', u.name);
  setInitials('apc-avatar', u.name);
  setText('apc-name', u.name);

  const today = new Date().toISOString().split('T')[0];
  setText('admin-today-date', fmtDate(today));
  const ym = today.slice(0, 7);
  document.getElementById('filter-month').value = ym;
  document.getElementById('stats-month').value  = ym;

  document.getElementById('btn-add-member').onclick      = () => openModal('modal-add-member');
  document.getElementById('btn-add-task').onclick        = () => openAddTaskModal();
  document.getElementById('btn-apply-filter').onclick    = loadAdminLog;
  document.getElementById('btn-export-att').onclick      = exportAttendance;
  document.getElementById('btn-export-tasks').onclick    = exportTasks;
  document.getElementById('btn-export-att-s').onclick    = exportAttendance;
  document.getElementById('btn-export-tasks-s').onclick  = exportTasks;
  document.getElementById('btn-backup').onclick          = downloadBackup;
  document.getElementById('btn-change-pw-admin').onclick = () => openModal('modal-change-pw');
  document.getElementById('admin-avatar-btn').onclick    = () => openModal('modal-change-pw');
  document.getElementById('stats-month').addEventListener('change', loadAdminStats);

  document.getElementById('td-btn-edit').onclick   = () => { const id = _detailTaskId; closeModal('modal-task-detail'); openEditTask(id); };
  document.getElementById('td-btn-delete').onclick = () => confirmAction('Delete this task?', 'This cannot be undone.', '🗑', async () => { await deleteTask(_detailTaskId); closeModal('modal-task-detail'); });
  document.getElementById('mdd-btn-remove').onclick = () => {
    const id   = _detailMemberId;
    const name = document.getElementById('mdd-name').textContent;
    confirmAction(`Remove ${name}?`, 'All their attendance records will be deleted.', '⚠', async () => {
      await api('DELETE', `/api/members/${id}`);
      toast(`${name} removed`);
      closeModal('modal-member-detail');
      loadAdminMembers(); loadOverview();
    });
  };

  loadOverview(); loadAdminToday(); loadAdminMembers(); loadAdminStats(); loadAdminTasks();
}

async function loadOverview() {
  try {
    const [todayRes, membersRes, tasksRes] = await Promise.all([
      api('GET', '/api/attendance/today'),
      api('GET', '/api/members'),
      api('GET', '/api/tasks')
    ]);
    setText('ov-present', todayRes.attendance.length);
    setText('ov-members', membersRes.members.length);
    setText('ov-tasks',   tasksRes.tasks.filter(t => t.status !== 'done' && t.status !== 'completed').length);
    setText('ov-late',    todayRes.attendance.filter(r => r.is_late).length);
  } catch {}
}

async function loadAdminToday() {
  try {
    const [todayRes, membersRes] = await Promise.all([
      api('GET', '/api/attendance/today'),
      api('GET', '/api/members')
    ]);
    const records    = todayRes.attendance || [];
    const members    = membersRes.members  || [];
    const presentIds = new Set(records.map(r => r.member_id));
    const absent     = members.filter(m => !presentIds.has(m.id));

    const strip = document.getElementById('absent-strip');
    strip.innerHTML = absent.length
      ? absent.map(m => `
          <div class="absent-pill">
            <div class="absent-pill-av">${initials(m.name)}</div>
            <span>${esc(m.name)}</span>
          </div>`).join('')
      : records.length
        ? `<div style="font-size:.8rem;color:var(--accent);font-weight:600">✓ Full attendance today!</div>`
        : '';

    const el = document.getElementById('admin-today-list');
    el.innerHTML = records.length ? buildAttTable(records, true) : '<div class="empty-state">No check-ins yet today.</div>';
  } catch {}
}

async function loadAdminMembers() {
  try {
    const [mRes, sRes] = await Promise.all([
      api('GET', '/api/members'),
      api('GET', '/api/attendance/stats')
    ]);
    allMembers = mRes.members || [];
    populateMemberSelects(allMembers);
    renderAdminMembers(allMembers, sRes.stats || []);
    setText('ov-members', allMembers.length);
  } catch {}
}

function renderAdminMembers(members, stats) {
  const el = document.getElementById('admin-members-list');
  if (!members.length) { el.innerHTML = '<div class="empty-state">No members yet.</div>'; return; }
  el.innerHTML = members.map(m => {
    const stat = stats.find(s => s.id === m.id);
    const pct  = stat ? stat.percentage : null;
    const cls  = pct === null ? '' : pct >= 80 ? 'good' : pct < 60 ? 'bad' : '';
    return `
      <div class="member-card" onclick="openMemberDetail(${m.id})">
        <div class="member-avatar">${initials(m.name)}</div>
        <div class="member-info">
          <div class="member-item-name">${esc(m.name)}</div>
          <div class="member-item-user">@${m.username}</div>
          ${m.created_at ? `<div class="member-card-meta">Since ${fmtDate(m.created_at.slice(0,10))}</div>` : ''}
        </div>
        ${pct !== null ? `<span class="member-stat-chip ${cls}">${pct}%</span>` : ''}
        <div class="member-card-actions">
          <button class="btn-delete-member"
            onclick="event.stopPropagation();confirmAction('Remove ${esc(m.name)}?','All attendance will be deleted.','⚠',()=>removeMember(${m.id},'${esc(m.name)}'))"
            title="Remove">✕</button>
        </div>
      </div>`;
  }).join('');
}

window.filterMembers = function() {
  const q = document.getElementById('member-search').value.toLowerCase();
  renderAdminMembers(allMembers.filter(m =>
    m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
  ), []);
};

function populateMemberSelects(members) {
  const opts = members.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  ['filter-member','task-assignee','task-filter-assignee'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = (id === 'task-assignee' ? '<option value="">Unassigned</option>' : '<option value="">All Members</option>') + opts;
  });
}

window.openMemberDetail = async function(id) {
  _detailMemberId = id;
  const member = allMembers.find(m => m.id === id);
  if (!member) return;
  setText('mdd-avatar', initials(member.name));
  setText('mdd-name',     member.name);
  setText('mdd-username', `@${member.username}`);
  setText('mdd-since', member.created_at ? `Joined ${fmtDate(member.created_at.slice(0,10))}` : '');
  openModal('modal-member-detail');
  try {
    const [statsRes, histRes, tasksRes] = await Promise.all([
      api('GET', '/api/attendance/stats'),
      api('GET', `/api/attendance?member_id=${id}`),
      api('GET', '/api/tasks')
    ]);
    const stat = (statsRes.stats || []).find(s => s.id === id);
    if (stat) { setText('mdd-present', stat.present_days); setText('mdd-late', stat.late_days); setText('mdd-pct', `${stat.percentage}%`); }
    const hist = (histRes.attendance || []).slice(0, 7);
    document.getElementById('mdd-history').innerHTML = hist.length
      ? hist.map(r => `<div class="mdd-hist-row"><span class="mdd-hist-date">${fmtDate(r.date)}</span><span class="mdd-hist-time">${r.time}</span><span class="hist-badge ${r.is_late ? 'late':'present'}">${r.is_late ? 'Late':'Present'}</span></div>`).join('')
      : '<div class="empty-state" style="padding:8px 0">No records yet.</div>';
    const memberTasks = (tasksRes.tasks || []).filter(t => t.assigned_to === id);
    document.getElementById('mdd-tasks').innerHTML = memberTasks.length
      ? memberTasks.map(t => `<div class="mdd-task-row"><div class="task-pri ${t.priority}" style="width:4px;min-height:20px;border-radius:2px;flex-shrink:0"></div><span class="mdd-task-title">${esc(t.title)}</span><span class="task-status-badge ${t.status}">${fmtStatus(t.status)}</span></div>`).join('')
      : '<div class="empty-state" style="padding:8px 0">No tasks.</div>';
  } catch {}
};

async function removeMember(id, name) {
  await api('DELETE', `/api/members/${id}`);
  toast(`${name} removed`);
  loadAdminMembers(); loadOverview();
}
window.removeMember = removeMember;

document.getElementById('form-add-member').addEventListener('submit', async e => {
  e.preventDefault();
  const name     = document.getElementById('new-member-name').value.trim();
  const username = document.getElementById('new-member-username').value.trim();
  const password = document.getElementById('new-member-password').value;
  if (!name || !username || !password) { toast('All fields required', 'warning'); return; }
  try {
    await api('POST', '/api/members', { name, username, password });
    toast(`${name} added!`, 'success');
    closeModal('modal-add-member');
    e.target.reset();
    loadAdminMembers(); loadOverview();
  } catch (err) { toast(err.message, 'error'); }
});

async function loadAdminLog() {
  const month    = document.getElementById('filter-month').value;
  const memberId = document.getElementById('filter-member').value;
  const params   = new URLSearchParams();
  if (month)    params.set('month', month);
  if (memberId) params.set('member_id', memberId);
  const el = document.getElementById('admin-log-list');
  el.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const res  = await api('GET', `/api/attendance?${params}`);
    const recs = res.attendance || [];
    el.innerHTML = recs.length ? buildAttTable(recs, true) : '<div class="empty-state">No records found.</div>';
  } catch {}
}

async function loadAdminStats() {
  const month = document.getElementById('stats-month').value;
  try {
    const res = await api('GET', `/api/attendance/stats${month ? '?month=' + month : ''}`);
    const el  = document.getElementById('admin-stats-list');
    if (!res.stats.length) { el.innerHTML = '<div class="empty-state">No data.</div>'; return; }
    el.innerHTML = res.stats.map(s => {
      const cls = s.percentage < 60 ? 'low' : s.percentage < 80 ? 'mid' : '';
      return `<div class="stat-row">
        <div class="sr-name">${esc(s.name)}</div>
        <div class="sr-nums">${s.present_days}/${s.working_days} · ${s.late_days}L</div>
        <div class="sr-bar-wrap"><div class="sr-bar ${cls}" style="width:${s.percentage}%"></div></div>
        <div class="sr-pct">${s.percentage}%</div>
      </div>`;
    }).join('');
  } catch {}
}

async function loadAdminTasks() {
  try {
    const res = await api('GET', '/api/tasks');
    allTasks  = res.tasks || [];
    renderAdminTasksFiltered();
    setText('ov-tasks', allTasks.filter(t => t.status !== 'done' && t.status !== 'completed').length);
  } catch {}
}

window.renderAdminTasksFiltered = function() {
  const assignee = document.getElementById('task-filter-assignee').value;
  const priority = document.getElementById('task-filter-priority').value;
  const status   = document.getElementById('task-filter-status').value;
  let filtered   = allTasks;
  if (assignee) filtered = filtered.filter(t => String(t.assigned_to) === assignee);
  if (priority) filtered = filtered.filter(t => t.priority === priority);
  if (status)   filtered = filtered.filter(t => t.status   === status);
  const isBoard = !document.getElementById('tasks-board-view').classList.contains('hidden');
  if (isBoard) renderKanban(filtered); else renderTaskList(filtered);
};

function renderTaskList(tasks) {
  const el = document.getElementById('admin-tasks-list');
  if (!tasks.length) { el.innerHTML = '<div class="empty-state">No tasks match filters.</div>'; return; }
  el.innerHTML = tasks.map(t => `
    <div class="task-item" onclick="openTaskDetail(${t.id})">
      <div class="task-pri ${t.priority}"></div>
      <div class="task-body">
        <div class="task-title-text">${esc(t.title)}</div>
        <div class="task-meta">
          <span>${esc(t.assignee_name || 'Unassigned')}</span>
          ${t.due_date ? `<span>Due: ${t.due_date}${isDue(t.due_date,t.status) ? ' ⚠' : ''}</span>` : ''}
          <span>${cap(t.priority)}</span>
        </div>
      </div>
      <span class="task-status-badge ${t.status}">${fmtStatus(t.status)}</span>
      <div class="task-actions" onclick="event.stopPropagation()">
        <button class="task-btn edit"   onclick="openEditTask(${t.id})">✎</button>
        <button class="task-btn delete" onclick="confirmAction('Delete task?','Cannot be undone.','🗑',()=>deleteTask(${t.id}))">✕</button>
      </div>
    </div>`).join('');
}

function renderKanban(tasks) {
  const cols = { pending:[], 'in-progress':[], done:[] };
  tasks.forEach(t => { const k = t.status === 'completed' ? 'done' : t.status; if (cols[k]) cols[k].push(t); });
  ['pending','in-progress','done'].forEach(s => {
    const el  = document.getElementById(`kanban-${s}`);
    const cnt = document.getElementById(`kcount-${s}`);
    if (cnt) cnt.textContent = cols[s].length;
    if (!el) return;
    el.innerHTML = cols[s].map(t => `
      <div class="kanban-card" onclick="openTaskDetail(${t.id})">
        <div class="kcard-title">${esc(t.title)}</div>
        <div class="kcard-meta">
          <span class="kcard-pri ${t.priority}"></span>
          <span class="kcard-assignee">${esc(t.assignee_name || 'Unassigned')}</span>
          ${t.due_date ? `<span class="kcard-due ${isDue(t.due_date,t.status)?'overdue':''}">${t.due_date}</span>` : ''}
        </div>
      </div>`).join('') || '<div style="font-size:.78rem;color:var(--muted);text-align:center;padding:16px 0">Empty</div>';
  });
}

window.setTaskView = function(view, btn) {
  document.querySelectorAll('.tvt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const listView  = document.getElementById('tasks-list-view');
  const boardView = document.getElementById('tasks-board-view');
  if (view === 'board') { listView.classList.add('hidden'); boardView.classList.remove('hidden'); renderKanban(allTasks); }
  else                  { boardView.classList.add('hidden'); listView.classList.remove('hidden'); renderTaskList(allTasks); }
};

window.openTaskDetail = function(id) {
  const t = allTasks.find(t => t.id === id);
  if (!t) return;
  _detailTaskId = id;
  const colors = { high:'var(--danger)', medium:'var(--late)', low:'var(--accent)' };
  document.getElementById('td-priority-stripe').style.background = colors[t.priority] || 'var(--border)';
  setText('td-title', t.title);
  setText('td-desc',  t.description || '');
  setText('td-assignee',    t.assignee_name || 'Unassigned');
  setText('td-due',         t.due_date ? fmtDate(t.due_date) : '—');
  setText('td-priority-val',cap(t.priority));
  setText('td-created',     t.created_at ? fmtDate(t.created_at.slice(0,10)) : '—');
  document.querySelectorAll('.td-sc').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.status === t.status || (btn.dataset.status === 'done' && t.status === 'completed'))
  );
  openModal('modal-task-detail');
};

window.setTaskStatusFromDetail = async function(status) {
  if (!_detailTaskId) return;
  try {
    await api('PUT', `/api/tasks/${_detailTaskId}`, { status });
    document.querySelectorAll('.td-sc').forEach(btn => btn.classList.toggle('active', btn.dataset.status === status));
    toast(`Status → ${fmtStatus(status)}`, 'success');
    await loadAdminTasks();
  } catch (e) { toast(e.message, 'error'); }
};

function openAddTaskModal() {
  setText('task-modal-title', 'New Task');
  setText('task-submit-btn', 'Create Task');
  document.getElementById('form-add-task').reset();
  document.getElementById('edit-task-id').value = '';
  document.querySelector('[name="task-priority"][value="medium"]').checked = true;
  populateMemberSelects(allMembers);
  openModal('modal-add-task');
}

window.openEditTask = async function(id) {
  const t = allTasks.find(t => t.id === id);
  if (!t) return;
  setText('task-modal-title', 'Edit Task');
  setText('task-submit-btn', 'Save Changes');
  document.getElementById('edit-task-id').value = id;
  document.getElementById('task-title').value   = t.title;
  document.getElementById('task-desc').value    = t.description || '';
  document.getElementById('task-due').value     = t.due_date    || '';
  populateMemberSelects(allMembers);
  document.getElementById('task-assignee').value = t.assigned_to || '';
  const pri = document.querySelector(`[name="task-priority"][value="${t.priority}"]`);
  if (pri) pri.checked = true;
  openModal('modal-add-task');
};

document.getElementById('form-add-task').addEventListener('submit', async e => {
  e.preventDefault();
  const id          = document.getElementById('edit-task-id').value;
  const title       = document.getElementById('task-title').value.trim();
  const description = document.getElementById('task-desc').value.trim();
  const assigned_to = document.getElementById('task-assignee').value || null;
  const due_date    = document.getElementById('task-due').value || null;
  const priority    = document.querySelector('[name="task-priority"]:checked')?.value || 'medium';
  if (!title) { toast('Title is required', 'warning'); return; }
  try {
    if (id) { await api('PUT',  `/api/tasks/${id}`, { title, description, assigned_to, due_date, priority }); toast('Task updated!', 'success'); }
    else    { await api('POST', '/api/tasks',        { title, description, assigned_to, due_date, priority }); toast('Task created!', 'success'); }
    closeModal('modal-add-task');
    loadAdminTasks(); loadOverview();
  } catch (err) { toast(err.message, 'error'); }
});

async function deleteTask(id) {
  await api('DELETE', `/api/tasks/${id}`);
  toast('Task deleted');
  loadAdminTasks(); loadOverview();
}
window.deleteTask = deleteTask;

window.adminTab = function(tab, btn) {
  document.querySelectorAll('#screen-admin .nav-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const map = { today:'admin-today-section', team:'admin-members-section', log:'admin-log-section', tasks:'admin-tasks-section', settings:'admin-settings-section' };
  document.querySelectorAll('.admin-tab-section').forEach(s => s.classList.add('hidden'));
  document.getElementById(map[tab])?.classList.remove('hidden');
};

function exportAttendance() { triggerDownload(`/api/export/attendance${document.getElementById('filter-month').value ? '?month='+document.getElementById('filter-month').value : ''}`); }
function exportTasks()      { triggerDownload('/api/export/tasks'); }
function downloadBackup()   { triggerDownload('/api/export/backup'); }
function triggerDownload(url) { const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); toast('Download started…'); }

// ═══════════════════════════════════════════
// SHARED UTILITIES
// ═══════════════════════════════════════════

window.confirmAction = function(title, body, icon, onConfirm) {
  setText('confirm-title', title);
  setText('confirm-body',  body);
  setText('confirm-icon',  icon);
  openModal('modal-confirm');
  const ok     = document.getElementById('confirm-ok-btn');
  const cancel = document.getElementById('confirm-cancel-btn');
  const newOk     = ok.cloneNode(true);
  const newCancel = cancel.cloneNode(true);
  ok.replaceWith(newOk); cancel.replaceWith(newCancel);
  newOk.onclick     = async () => { closeModal('modal-confirm'); try { await onConfirm(); } catch(e) { toast(e.message,'error'); } };
  newCancel.onclick = () => closeModal('modal-confirm');
};

window.viewPhoto = function(src, meta) {
  document.getElementById('photo-full').src = src;
  setText('photo-meta', meta);
  openModal('modal-photo');
};

window.toast = function(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'◎' };
  el.innerHTML = `<span>${icons[type] || '◎'}</span><span>${esc(message)}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3500);
};

async function api(method, path, body) {
  const token = localStorage.getItem('attendx_token');
  const opts  = { method, headers: {} };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body)  { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res  = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function buildAttTable(rows, showMember = false) {
  const headers = [showMember ? '<th>Member</th>' : '', '<th>Date</th>', '<th>Time</th>', '<th>Status</th>', '<th>Photo</th>', '<th>Location</th>'].filter(Boolean).join('');
  const trs = rows.map(r => {
    const badge = r.is_late ? '<span class="hist-badge late">Late</span>' : '<span class="hist-badge present">On Time</span>';
    const thumb = r.photo_path
      ? `<img class="att-thumb" src="${r.photo_path}" onclick="viewPhoto('${r.photo_path}','${esc(r.member_name||'')} — ${r.date} ${r.time}')" />`
      : `<div class="no-photo-sm">◎</div>`;
    const loc = r.location ? esc(r.location) : '—';
    return `<tr>
      ${showMember ? `<td class="member-name-cell">${esc(r.member_name||'')}</td>` : ''}
      <td>${fmtDate(r.date)}</td><td class="time-cell">${r.time}</td>
      <td>${badge}</td><td>${thumb}</td><td>${loc}</td>
    </tr>`;
  }).join('');
  return `<table class="att-table"><thead><tr>${headers}</tr></thead><tbody>${trs}</tbody></table>`;
}

function initials(name)    { return String(name||'').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase(); }
function setInitials(id,n) { setText(id, initials(n)); }
function setText(id, val)  { const el=document.getElementById(id); if(el) el.textContent=val; }
function esc(s)    { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function cap(s)    { return s ? s[0].toUpperCase()+s.slice(1) : s; }
function fmtDate(d) {
  if (!d) return '—';
  const [y,m,day] = String(d).split('-');
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]} ${parseInt(day)}, ${y}`;
}
function fmtStatus(s) { return {pending:'Pending','in-progress':'In Progress',done:'Done',completed:'Done'}[s]||s; }
function shortLoc(loc) { if(!loc) return '—'; return loc.length>40 ? loc.slice(0,38)+'…' : loc; }
function isDue(d,s)    { if(!d||s==='done'||s==='completed') return false; return new Date(d)<new Date(new Date().toDateString()); }
function sleep(ms)     { return new Promise(r => setTimeout(r, ms)); }
