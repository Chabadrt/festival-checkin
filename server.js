require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ── Persistent storage ───────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || '/app/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'checkins.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { guests: {}, checkins: [], emailed: [], pendingDuplicates: [] };
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.emailed) db.emailed = [];
    if (!db.pendingDuplicates) db.pendingDuplicates = [];
    return db;
  } catch (e) {
    return { guests: {}, checkins: [], emailed: [], pendingDuplicates: [] };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function initGuests(guests) {
  const db = loadDB();
  guests.forEach(g => {
    if (!db.guests[g.id]) db.guests[g.id] = { ...g, checkedIn: false, checkedInAt: null };
  });
  saveDB(db);
}

// ── Auth middleware helper ────────────────────────────────────────────────────
function checkAuth(req, res) {
  if (req.query.pw !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

// ── QR code image ────────────────────────────────────────────────────────────
app.get('/qr/:id', async (req, res) => {
  const url = `${process.env.BASE_URL}/checkin?id=${req.params.id}`;
  try {
    const buffer = await QRCode.toBuffer(url, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('QR error');
  }
});

// ── Check-in page ────────────────────────────────────────────────────────────
app.get('/checkin', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send('Invalid QR code.');
  const db = loadDB();
  const guest = db.guests[id];

  if (!guest) return res.send(`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fff1f0;}
    h1{color:#cf1322;font-size:2rem;}p{font-size:1.2rem;}</style></head><body>
    <h1>⚠️ Not Found</h1>
    <p>This QR code was not recognized.<br>Please direct guest to the welcome table.</p>
    </body></html>`);

  if (guest.checkedIn) return res.send(`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fffbe6;}
    h1{color:#d48806;font-size:2rem;}p{font-size:1.2rem;color:#555;}</style></head><body>
    <h1>⚠️ Already Checked In</h1>
    <p><strong>${guest.firstName} ${guest.lastName}</strong><br>
    Checked in at ${guest.checkedInAt}</p></body></html>`);

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  db.guests[id].checkedIn = true;
  db.guests[id].checkedInAt = now;
  db.checkins.push({ id, name: `${guest.firstName} ${guest.lastName}`, time: now });
  saveDB(db);

  res.send(`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f6ffed;}
    h1{color:#389e0d;font-size:3rem;}
    .name{font-size:1.8rem;font-weight:bold;color:#222;margin:12px 0;}
    p{font-size:1.1rem;color:#555;}
    .badge{display:inline-block;background:#389e0d;color:white;padding:8px 24px;border-radius:20px;font-size:1rem;margin-top:16px;}
    </style></head><body>
    <h1>✓</h1>
    <div class="name">${guest.firstName} ${guest.lastName}</div>
    <p>${guest.city || ''}</p>
    <div class="badge">Checked In — ${now}</div>
    </body></html>`);
});

// ── Admin dashboard ──────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  if (req.query.pw !== process.env.ADMIN_PASSWORD) {
    return res.send(`<!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px;}
      input{padding:10px;font-size:1rem;border:1px solid #ccc;border-radius:6px;width:220px;}
      button{padding:10px 20px;font-size:1rem;background:#1677ff;color:white;border:none;border-radius:6px;cursor:pointer;margin-left:8px;}
      </style></head><body>
      <h2>Festival Admin</h2>
      <form onsubmit="window.location='/admin?pw='+document.getElementById('p').value;return false;">
      <input id="p" type="password" placeholder="Enter password">
      <button type="submit">Enter</button></form>
      </body></html>`);
  }

  const db = loadDB();
  const guests = Object.values(db.guests);
  const total = guests.length;
  const checkedIn = guests.filter(g => g.checkedIn).length;
  const emailedIds = new Set(db.emailed || []);
  const pendingDuplicates = db.pendingDuplicates || [];
  const checkedInList = guests.filter(g => g.checkedIn).sort((a, b) => a.checkedInAt > b.checkedInAt ? -1 : 1);
  const notCheckedIn = guests.filter(g => !g.checkedIn).sort((a, b) => a.lastName > b.lastName ? 1 : -1);
  const pw = req.query.pw;

  res.send(`<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
    *{box-sizing:border-box;}
    body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto;background:#f5f5f5;}
    h1{color:#222;margin-bottom:4px;}
    .stat{font-size:3rem;font-weight:bold;color:#1677ff;}
    .card{background:white;border-radius:10px;padding:20px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
    table{width:100%;border-collapse:collapse;}
    td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:0.85rem;}
    th{color:#888;font-weight:500;}
    .green{color:#389e0d;}.gray{color:#aaa;}.orange{color:#d48806;}
    .progress{height:12px;background:#e8e8e8;border-radius:6px;margin:8px 0;}
    .bar{height:12px;background:#1677ff;border-radius:6px;}
    h2{font-size:1rem;color:#444;margin:0 0 12px;}
    .btn{padding:9px 14px;font-size:0.82rem;border:none;border-radius:6px;cursor:pointer;color:white;margin:3px;display:inline-block;}
    .btn-red{background:#cf1322;}.btn-blue{background:#1677ff;}
    .btn-green{background:#389e0d;}.btn-orange{background:#d48806;}.btn-gray{background:#888;}
    .msg{margin-top:8px;font-size:0.85rem;padding:8px 12px;border-radius:6px;}
    .msg-ok{background:#f6ffed;color:#389e0d;border:1px solid #b7eb8f;}
    .msg-warn{background:#fff1f0;color:#cf1322;border:1px solid #ffa39e;}
    input[type=text],input[type=email]{width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;margin-bottom:6px;}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
    .section{margin-top:14px;padding-top:14px;border-top:1px solid #f0f0f0;}
    #log{background:#111;color:#0f0;font-family:monospace;font-size:0.75rem;padding:12px;border-radius:6px;height:250px;overflow-y:auto;white-space:pre-wrap;display:none;margin-top:10px;}
    .toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-size:0.95rem;font-weight:500;color:white;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.2);white-space:nowrap;}
    .toast.show{opacity:1;}.toast.ok{background:#389e0d;}.toast.warn{background:#cf1322;}
    </style></head><body>

    <div class="toast" id="toast"></div>
    <h1>🎉 Festival Check-In Dashboard</h1>

    <!-- Stats -->
    <div class="card">
      <h2>Total checked in</h2>
      <div class="stat">${checkedIn} <span style="font-size:1.5rem;color:#aaa;">/ ${total}</span></div>
      <div class="progress"><div class="bar" style="width:${total > 0 ? Math.round(checkedIn/total*100) : 0}%"></div></div>
      <div style="color:#888;font-size:0.8rem;margin-top:8px;display:flex;align-items:center;gap:12px;">
        <span>${emailedIds.size} emails sent</span>
        <button class="btn btn-gray" style="padding:5px 12px;font-size:0.8rem;" onclick="location.reload()">🔄 Refresh</button>
      </div>
    </div>

    <!-- Guest Management -->
    <div class="card">
      <h2>⚙️ Manage Guest List</h2>
      <button class="btn btn-red" onclick="resetCheckins()">🔄 Reset Check-ins</button>
      <button class="btn btn-green" onclick="downloadList()">⬇️ Download Attendance</button>
      <button class="btn btn-red" onclick="resetGuests()">🗑️ Clear All Guests</button>
      <div id="actionMsg"></div>

      <!-- Add Guest -->
      <div class="section">
        <strong style="font-size:0.9rem;">➕ Add Guest Manually</strong>
        <div class="grid2" style="margin-top:10px;">
          <input type="text" id="addFirst" placeholder="First name *">
          <input type="text" id="addLast" placeholder="Last name *">
          <input type="email" id="addEmail" placeholder="Email *">
          <input type="text" id="addCity" placeholder="City (optional)">
        </div>
        <button class="btn btn-blue" id="addGuestBtn" style="width:100%;margin-top:4px;" onclick="console.log('clicked'); addGuest();">➕ Add Guest</button>
        <div id="addMsg"></div>
        <div id="debugMsg" style="font-size:0.8rem;color:#888;margin-top:4px;"></div>
      </div>

      <!-- Upload CSV -->
      <div class="section">
        <strong style="font-size:0.9rem;">📋 Upload CSV</strong>
        <p style="font-size:0.8rem;color:#888;margin:6px 0;">
          <b>Merge</b> keeps existing check-ins. <b>Replace</b> wipes everything.
        </p>
        <input type="file" id="csvFile" accept=".csv" style="margin-bottom:10px;font-size:0.85rem;width:100%;">
        <p style="font-size:0.8rem;color:#555;margin:0 0 6px;"><b>Duplicate handling:</b></p>
        <div style="margin-bottom:10px;">
          <label style="font-size:0.82rem;margin-right:12px;"><input type="radio" name="dedup" value="none" checked> Email only</label>
          <label style="font-size:0.82rem;margin-right:12px;"><input type="radio" name="dedup" value="auto"> Auto-remove duplicates</label>
          <label style="font-size:0.82rem;"><input type="radio" name="dedup" value="manual"> Flag for review</label>
        </div>
        <button class="btn btn-blue" onclick="uploadCSV('merge')">📋 Merge</button>
        <button class="btn btn-red" onclick="uploadCSV('replace')">⚠️ Replace All</button>
        <div id="uploadMsg"></div>
      </div>
    </div>

    <!-- Send Emails -->
    <div class="card">
      <h2>📧 Send Emails</h2>
      <p style="font-size:0.8rem;color:#888;margin:0 0 10px;">⚠️ <b>Send to All</b> and <b>Send to New</b> should only be used once.</p>
      <button class="btn btn-orange" onclick="sendEmails('test')">🧪 Test (3 to me)</button>
      <button class="btn btn-blue" onclick="sendEmails('all')">📧 Send to All</button>
      <button class="btn btn-green" onclick="sendEmails('new')">✨ New Guests Only</button>
      <div class="section">
        <strong style="font-size:0.85rem;">📧 Send to Specific Person</strong>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center;">
          <input type="text" id="specificEmail" placeholder="Name or email" style="margin:0;flex:1;">
          <button class="btn btn-gray" onclick="sendEmails('specific')" style="white-space:nowrap;margin:0;">Send</button>
        </div>
      </div>
      <div id="log"></div>
    </div>

    <!-- Pending Duplicates -->
    ${pendingDuplicates.length > 0 ? `
    <div class="card" style="border:2px solid #faad14;">
      <h2>⚠️ Possible Duplicates — Review Required (${pendingDuplicates.length})</h2>
      <table>
        <tr><th>Guest A</th><th>Guest B</th><th>Reason</th><th>Action</th></tr>
        ${pendingDuplicates.map(d => `
          <tr>
            <td>${d.a.firstName} ${d.a.lastName}<br><small style="color:#aaa">${d.a.email}</small></td>
            <td>${d.b.firstName} ${d.b.lastName}<br><small style="color:#aaa">${d.b.email}</small></td>
            <td style="color:#d48806;font-size:0.8rem;">${d.reason}</td>
            <td>
              <button class="btn btn-red" style="font-size:0.75rem;padding:5px 8px;margin:2px;" onclick="removeGuest('${d.a.id}')">Remove A</button>
              <button class="btn btn-red" style="font-size:0.75rem;padding:5px 8px;margin:2px;" onclick="removeGuest('${d.b.id}')">Remove B</button>
              <button class="btn btn-gray" style="font-size:0.75rem;padding:5px 8px;margin:2px;" onclick="dismissDuplicate('${d.a.id}','${d.b.id}')">Keep Both</button>
            </td>
          </tr>`).join('')}
      </table>
      <div id="dupMsg"></div>
    </div>` : ''}

    <!-- Checked In -->
    <div class="card">
      <h2>✅ Checked in (${checkedIn})</h2>
      <table>
        <tr><th>Name</th><th>City</th><th>Time</th></tr>
        ${checkedInList.map(g => `
          <tr>
            <td class="green">✓ ${g.firstName} ${g.lastName}</td>
            <td>${g.city || '—'}</td>
            <td>${g.checkedInAt}</td>
          </tr>`).join('')}
      </table>
    </div>

    <!-- Not Arrived -->
    <div class="card">
      <h2>⏳ Not yet arrived (${total - checkedIn})</h2>
      <table>
        <tr><th>Name</th><th>City</th><th>Emailed</th></tr>
        ${notCheckedIn.map(g => `
          <tr>
            <td class="gray">${g.firstName} ${g.lastName}</td>
            <td>${g.city || '—'}</td>
            <td>${emailedIds.has(String(g.id)) ? '<span class="green">✓</span>' : '<span class="orange">Pending</span>'}</td>
          </tr>`).join('')}
      </table>
    </div>

    <script>
    const pw = "${req.query.pw}";
    function toast(msg, ok) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show ' + (ok !== false ? 'ok' : 'warn');
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
    }

    function showMsg(id, ok, text) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="msg ' + (ok ? 'msg-ok' : 'msg-warn') + '">' + text + '</div>';
      toast(text, ok);
    }

    async function resetCheckins() {
      if (!confirm('Reset ALL check-ins? Cannot be undone.')) return;
      try {
        const r = await fetch('/setup/reset?pw=' + pw, { method: 'POST' });
        const d = await r.json();
        showMsg('actionMsg', d.ok, d.message);
        if (d.ok) setTimeout(() => location.reload(), 2000);
      } catch(e) { toast('Network error', false); }
    }

    async function resetGuests() {
      if (!confirm('Delete ALL guests? Cannot be undone.')) return;
      try {
        const r = await fetch('/setup/reset-guests?pw=' + pw, { method: 'POST' });
        const d = await r.json();
        showMsg('actionMsg', d.ok, d.message);
        if (d.ok) setTimeout(() => location.reload(), 2000);
      } catch(e) { toast('Network error', false); }
    }

    function downloadList() {
      window.location.href = '/setup/download?pw=' + pw;
    }

    async function addGuest() {
      document.getElementById('debugMsg').textContent = 'Function called. pw=' + pw;
      const firstName = document.getElementById('addFirst').value.trim();
      const lastName = document.getElementById('addLast').value.trim();
      const email = document.getElementById('addEmail').value.trim();
      const city = document.getElementById('addCity').value.trim();
      if (!firstName || !lastName || !email) {
        showMsg('addMsg', false, 'First name, last name and email are required.');
        return;
      }
      const btn = document.getElementById('addGuestBtn');
      btn.disabled = true;
      btn.textContent = 'Adding...';
      try {
        const r = await fetch('/setup/add-guest?pw=' + pw, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstName, lastName, email, city })
        });
        const d = await r.json();
        showMsg('addMsg', d.ok, d.message);
        if (d.ok) {
          document.getElementById('addFirst').value = '';
          document.getElementById('addLast').value = '';
          document.getElementById('addEmail').value = '';
          document.getElementById('addCity').value = '';
          setTimeout(() => location.reload(), 1500);
        }
      } catch(e) {
        showMsg('addMsg', false, 'Network error: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '➕ Add Guest';
      }
    }

    async function uploadCSV(mode) {
      const fileInput = document.getElementById('csvFile');
      if (!fileInput.files.length) { toast('Please select a CSV file first.', false); return; }
      if (mode === 'replace' && !confirm('Wipe ALL guests and start fresh?')) return;
      const dedup = document.querySelector('input[name="dedup"]:checked').value;
      showMsg('uploadMsg', true, 'Uploading...');
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const r = await fetch('/setup/upload-csv?pw=' + pw + '&mode=' + mode + '&dedup=' + dedup, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csv: e.target.result })
          });
          const d = await r.json();
          showMsg('uploadMsg', d.ok, d.message);
          if (d.ok) setTimeout(() => location.reload(), 2000);
        } catch(e) { showMsg('uploadMsg', false, 'Network error: ' + e.message); }
      };
      reader.readAsText(fileInput.files[0]);
    }

    async function removeGuest(id) {
      if (!confirm('Remove this guest?')) return;
      try {
        const r = await fetch('/setup/remove-guest?pw=' + pw, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        const d = await r.json();
        showMsg('dupMsg', d.ok, d.message);
        if (d.ok) setTimeout(() => location.reload(), 1500);
      } catch(e) { toast('Network error', false); }
    }

    async function dismissDuplicate(aId, bId) {
      try {
        const r = await fetch('/setup/dismiss-duplicate?pw=' + pw, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aId, bId })
        });
        const d = await r.json();
        showMsg('dupMsg', d.ok, d.message);
        if (d.ok) setTimeout(() => location.reload(), 1500);
      } catch(e) { toast('Network error', false); }
    }

    async function sendEmails(mode) {
      const log = document.getElementById('log');
      let url = '/setup/send?pw=' + pw + '&mode=' + mode;
      if (mode === 'specific') {
        const val = document.getElementById('specificEmail').value.trim();
        if (!val) { toast('Enter a name or email.', false); return; }
        url += '&target=' + encodeURIComponent(val);
      }
      if (mode === 'all' && !confirm('Send to ALL guests? Only do this once!')) return;
      log.style.display = 'block';
      log.textContent = 'Starting...\n';
      toast('Sending emails...', true);
      try {
        const r = await fetch(url);
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          log.textContent += decoder.decode(value);
          log.scrollTop = log.scrollHeight;
        }
        toast('Done sending!', true);
      } catch(e) {
        log.textContent += 'Error: ' + e.message;
        toast('Send error', false);
      }
    }
    </script></body></html>`);
});

// ── Reset check-ins ──────────────────────────────────────────────────────────
app.post('/setup/reset', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const db = loadDB();
    Object.keys(db.guests).forEach(k => { db.guests[k].checkedIn = false; db.guests[k].checkedInAt = null; });
    db.checkins = [];
    saveDB(db);
    res.json({ ok: true, message: `✓ Reset complete. ${Object.keys(db.guests).length} guests unmarked.` });
  } catch (err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Reset guest list ─────────────────────────────────────────────────────────
app.post('/setup/reset-guests', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    saveDB({ guests: {}, checkins: [], emailed: [], pendingDuplicates: [] });
    res.json({ ok: true, message: '✓ Guest list cleared. Upload a new CSV to reload.' });
  } catch (err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Add guest manually ───────────────────────────────────────────────────────
app.post('/setup/add-guest', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { firstName, lastName, email, city } = req.body;
    if (!firstName || !lastName || !email) {
      return res.json({ ok: false, message: 'First name, last name and email are required.' });
    }
    const db = loadDB();
    const exists = Object.values(db.guests).find(g => g.email.toLowerCase() === email.toLowerCase());
    if (exists) return res.json({ ok: false, message: `${exists.firstName} ${exists.lastName} already exists with that email.` });
    const id = 'manual_' + Date.now();
    db.guests[id] = { id, firstName, lastName, email, city: city || '', checkedIn: false, checkedInAt: null };
    saveDB(db);
    res.json({ ok: true, message: `✓ ${firstName} ${lastName} added. Total guests: ${Object.keys(db.guests).length}` });
  } catch (err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Upload CSV ───────────────────────────────────────────────────────────────
app.post('/setup/upload-csv', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { csv } = req.body;
    const { mode, dedup } = req.query;
    if (!csv) return res.json({ ok: false, message: 'No CSV data received.' });

    const { parse } = require('csv-parse/sync');
    const records = parse(csv, { columns: true, skip_empty_lines: true });

    const byEmail = {};
    records.forEach(r => {
      const email = (r.contactEmail || '').trim().toLowerCase();
      if (!email) return;
      if (!byEmail[email] || r.SubmissionId > byEmail[email].SubmissionId) byEmail[email] = r;
    });

    const allGuests = Object.values(byEmail).map(r => ({
      id: r.SubmissionId,
      firstName: (r.firstName || '').trim(),
      lastName: (r.lastName || '').trim(),
      email: (r.contactEmail || '').trim(),
      city: (r.contactCity || '').trim()
    })).filter(g => g.email && g.firstName);

    const possibleDuplicates = [];
    if (dedup === 'auto' || dedup === 'manual') {
      for (let i = 0; i < allGuests.length; i++) {
        for (let j = i + 1; j < allGuests.length; j++) {
          const a = allGuests[i], b = allGuests[j];
          const sameLast = a.lastName.toLowerCase() === b.lastName.toLowerCase();
          const aDomain = a.email.split('@')[1] || '';
          const bDomain = b.email.split('@')[1] || '';
          const sameDomain = aDomain && aDomain === bDomain;
          const similarFirst = a.firstName.toLowerCase().startsWith(b.firstName.toLowerCase().slice(0,3)) ||
                               b.firstName.toLowerCase().startsWith(a.firstName.toLowerCase().slice(0,3));
          if (sameLast && (sameDomain || similarFirst)) {
            possibleDuplicates.push({ a, b, reason: sameLast && sameDomain ? 'Same last name + email domain' : 'Same last name + similar first name' });
          }
        }
      }
    }

    const removedIds = new Set();
    if (dedup === 'auto') {
      possibleDuplicates.forEach(({ a, b }) => removedIds.add(String(a.id < b.id ? a.id : b.id)));
    }

    const finalGuests = allGuests.filter(g => !removedIds.has(String(g.id)));
    const db = mode === 'replace' ? { guests: {}, checkins: [], emailed: [], pendingDuplicates: [] } : loadDB();
    let added = 0;
    finalGuests.forEach(g => {
      if (!db.guests[g.id]) { db.guests[g.id] = { ...g, checkedIn: false, checkedInAt: null }; added++; }
    });
    db.pendingDuplicates = dedup === 'manual' ? possibleDuplicates : (db.pendingDuplicates || []);
    saveDB(db);

    let msg = mode === 'replace'
      ? `✓ Replaced guest list. ${Object.keys(db.guests).length} guests loaded.`
      : `✓ Added ${added} new guests. Total: ${Object.keys(db.guests).length}.`;
    if (dedup === 'auto' && removedIds.size > 0) msg += ` Auto-removed ${removedIds.size} duplicate(s).`;
    if (dedup === 'manual' && possibleDuplicates.length > 0) msg += ` Found ${possibleDuplicates.length} possible duplicate(s) — review below.`;
    res.json({ ok: true, message: msg });
  } catch (err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Remove guest ─────────────────────────────────────────────────────────────
app.post('/setup/remove-guest', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { id } = req.body;
    const db = loadDB();
    if (!db.guests[id]) return res.json({ ok: false, message: 'Guest not found.' });
    const name = `${db.guests[id].firstName} ${db.guests[id].lastName}`;
    delete db.guests[id];
    db.pendingDuplicates = (db.pendingDuplicates || []).filter(d => d.a.id !== id && d.b.id !== id);
    saveDB(db);
    res.json({ ok: true, message: `✓ Removed ${name}.` });
  } catch (err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Dismiss duplicate ────────────────────────────────────────────────────────
app.post('/setup/dismiss-duplicate', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const { aId, bId } = req.body;
    const db = loadDB();
    db.pendingDuplicates = (db.pendingDuplicates || []).filter(d => !(d.a.id === aId && d.b.id === bId));
    saveDB(db);
    res.json({ ok: true, message: '✓ Dismissed — both guests kept.' });
  } catch (err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Download attendance ──────────────────────────────────────────────────────
app.get('/setup/download', (req, res) => {
  if (!checkAuth(req, res)) return;
  try {
    const db = loadDB();
    const rows = ['First Name,Last Name,City,Email,Checked In,Time',
      ...Object.values(db.guests).map(g =>
        `"${g.firstName}","${g.lastName}","${g.city||''}","${g.email}","${g.checkedIn?'Yes':'No'}","${g.checkedInAt||''}"`)
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="festival-attendance.csv"');
    res.send(rows);
  } catch (err) { res.status(500).send('Error generating CSV'); }
});

// ── Send emails ──────────────────────────────────────────────────────────────
app.get('/setup/send', async (req, res) => {
  if (!checkAuth(req, res)) return;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  const write = msg => res.write(msg + '\n');

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    const db = loadDB();
    const allGuests = Object.values(db.guests);
    const emailedIds = new Set(db.emailed || []);
    const { mode, target } = req.query;

    let toSend = [];
    if (mode === 'test') {
      toSend = allGuests.slice(0, 3);
      write(`TEST MODE — sending 3 emails to ${process.env.GMAIL_USER}`);
    } else if (mode === 'all') {
      toSend = allGuests;
      write(`Sending to ALL ${toSend.length} guests...`);
    } else if (mode === 'new') {
      toSend = allGuests.filter(g => !emailedIds.has(String(g.id)));
      write(`Sending to ${toSend.length} new/unsent guests...`);
    } else if (mode === 'specific') {
      const t = (target || '').toLowerCase();
      toSend = allGuests.filter(g =>
        g.email.toLowerCase().includes(t) ||
        g.firstName.toLowerCase().includes(t) ||
        g.lastName.toLowerCase().includes(t)
      );
      write(`Found ${toSend.length} matching guest(s) for "${target}"...`);
    }

    if (toSend.length === 0) { write('No guests found to send to.'); return res.end(); }
    write('---');

    let sent = 0, failed = 0;
    for (const guest of toSend) {
      try {
        const qrUrl = `${process.env.BASE_URL}/qr/${guest.id}`;
        const to = mode === 'test' ? process.env.GMAIL_USER : guest.email;
        await transporter.sendMail({
          from: `"Rabbi Benzion Silverman" <${process.env.GMAIL_USER}>`,
          to,
          subject: mode === 'test'
            ? `[TEST] ${guest.firstName} ${guest.lastName} — Festival Check-in`
            : `You're in — See you Sunday, ${guest.firstName}!`,
          html: buildEmail(guest, qrUrl)
        });
        sent++;
        if (mode !== 'test' && !db.emailed.includes(String(guest.id))) db.emailed.push(String(guest.id));
        write(`✓ ${sent}/${toSend.length} — ${guest.firstName} ${guest.lastName} <${to}>`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        failed++;
        write(`✗ FAILED: ${guest.firstName} ${guest.lastName} — ${err.message}`);
      }
    }
    saveDB(db);
    write('---');
    write(`Done! ${sent} sent, ${failed} failed.`);
    if (mode === 'test') write('Check your inbox. If it looks good, click "Send to All".');
    res.end();
  } catch (err) {
    write('ERROR: ' + err.message);
    res.end();
  }
});

// ── Email HTML ───────────────────────────────────────────────────────────────
function buildEmail(guest, qrUrl) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#222;">
  <div style="text-align:center;padding:24px 0 8px;">
    <h1 style="font-size:1.6rem;color:#1a1a1a;margin:0;">You're in. See you Sunday.</h1>
    <p style="color:#555;font-size:1rem;margin:8px 0 0;">Rivertowns Jewish Festival · June 14, 2026</p>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <p style="font-size:1rem;line-height:1.7;">Dear ${guest.firstName},</p>
  <p style="font-size:1rem;line-height:1.7;">We are so excited to welcome you this Sunday to the first-ever Rivertowns Jewish Festival. Over 250 families have reserved their spot — and you're one of them.</p>
  <p style="font-size:1rem;line-height:1.7;"><strong>Your family check-in code is below.</strong> When you arrive, simply show this to our volunteers at the entrance and you'll be checked right in.</p>
  <div style="text-align:center;margin:28px 0;">
    <img src="${qrUrl}" width="220" height="220" alt="Your check-in QR code" style="border:3px solid #eee;border-radius:12px;padding:8px;">
    <div style="font-size:0.8rem;color:#aaa;margin-top:8px;">Check-in code for ${guest.firstName} ${guest.lastName}</div>
  </div>
  <div style="background:#f9f9f9;border-radius:10px;padding:20px;margin:24px 0;">
    <h2 style="font-size:1rem;margin:0 0 12px;color:#444;">Everything you need to know:</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;width:28px;">📅</td><td style="padding:6px 0;"><strong>Sunday, June 14</strong></td></tr>
      <tr><td style="padding:6px 0;">📍</td><td style="padding:6px 0;">Dobbs Ferry Waterfront Park</td></tr>
      <tr><td style="padding:6px 0;">🕐</td><td style="padding:6px 0;">1:00–3:00 PM</td></tr>
      <tr><td style="padding:6px 0;">🅿️</td><td style="padding:6px 0;">Plenty of parking right by the park. Police confirmed no ticketing in the area.</td></tr>
      <tr><td style="padding:6px 0;">🔒</td><td style="padding:6px 0;">Uniformed police presence + private security on site. Come with confidence.</td></tr>
      <tr><td style="padding:6px 0;">🪑</td><td style="padding:6px 0;"><strong>Bring a lawn chair</strong> — enjoy the music and the beautiful day by the river.</td></tr>
      <tr><td style="padding:6px 0;">☀️</td><td style="padding:6px 0;">Bring sunscreen and your appetite.</td></tr>
      <tr><td style="padding:6px 0;">🍽️</td><td style="padding:6px 0;">Israeli street food, Kona Ice, and more. Food available for purchase. Kids activities are free.</td></tr>
      <tr><td style="padding:6px 0;">⏰</td><td style="padding:6px 0;">Arriving around 12:45 means you'll settle in right as the music starts.</td></tr>
    </table>
  </div>
  <p style="font-size:1rem;line-height:1.7;text-align:center;font-style:italic;color:#444;">Jewish life here is alive. It is joyful. It is welcoming.<br>And this Sunday, we get to celebrate that together.</p>
  <p style="font-size:1rem;line-height:1.7;">See you Sunday,</p>
  <p style="font-size:1rem;line-height:1.7;"><strong>Rabbi Benzion Silverman</strong><br><span style="color:#777;">Chabad of the Rivertowns</span></p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:0.8rem;color:#aaa;text-align:center;">Chabad of the Rivertowns · 303 Broadway, Dobbs Ferry, NY · chabadrt.org</p>
</body></html>`;
}

// ── API stats ────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const guests = Object.values(db.guests);
  res.json({ total: guests.length, checkedIn: guests.filter(g => g.checkedIn).length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Festival check-in running on port ${PORT}`));
module.exports = { initGuests };
