require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Storage ──────────────────────────────────────────────────────────────────
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
  } catch(e) {
    return { guests: {}, checkins: [], emailed: [], pendingDuplicates: [] };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function checkAuth(req, res) {
  if (req.query.pw !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

// ── QR code ──────────────────────────────────────────────────────────────────
app.get('/qr/:id', async (req, res) => {
  try {
    const url = process.env.BASE_URL + '/checkin?id=' + req.params.id;
    const buffer = await QRCode.toBuffer(url, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch(err) { res.status(500).send('QR error'); }
});

// ── Check-in page ────────────────────────────────────────────────────────────
app.get('/checkin', (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).send('Invalid QR code.');
  const db = loadDB();
  const guest = db.guests[id];

  if (!guest) {
    return res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fff1f0;}h1{color:#cf1322;font-size:2rem;}p{font-size:1.2rem;}</style></head><body><h1>Not Found</h1><p>QR code not recognized.<br>Please go to the welcome table.</p></body></html>');
  }

  if (guest.checkedIn) {
    return res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fffbe6;}h1{color:#d48806;font-size:2rem;}p{font-size:1.2rem;color:#555;}</style></head><body><h1>Already Checked In</h1><p><strong>' + guest.firstName + ' ' + guest.lastName + '</strong><br>Checked in at ' + guest.checkedInAt + '</p></body></html>');
  }

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  db.guests[id].checkedIn = true;
  db.guests[id].checkedInAt = now;
  db.checkins.push({ id: id, name: guest.firstName + ' ' + guest.lastName, time: now });
  saveDB(db);

  res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f6ffed;}h1{color:#389e0d;font-size:3rem;}.name{font-size:1.8rem;font-weight:bold;color:#222;margin:12px 0;}.badge{display:inline-block;background:#389e0d;color:white;padding:8px 24px;border-radius:20px;font-size:1rem;margin-top:16px;}</style></head><body><h1>&#10003;</h1><div class="name">' + guest.firstName + ' ' + guest.lastName + '</div><p>' + (guest.city || '') + '</p><div class="badge">Checked In &mdash; ' + now + '</div></body></html>');
});

// ── Admin dashboard ──────────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  const pw = req.query.pw;
  if (pw !== process.env.ADMIN_PASSWORD) {
    return res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:60px;}input{padding:10px;font-size:1rem;border:1px solid #ccc;border-radius:6px;width:220px;}button{padding:10px 20px;font-size:1rem;background:#1677ff;color:white;border:none;border-radius:6px;cursor:pointer;margin-left:8px;}</style></head><body><h2>Festival Admin</h2><form onsubmit="window.location=\'/admin?pw=\'+document.getElementById(\'p\').value;return false;"><input id="p" type="password" placeholder="Enter password"><button type="submit">Enter</button></form></body></html>');
  }

  const db = loadDB();
  const guests = Object.values(db.guests);
  const total = guests.length;
  const checkedIn = guests.filter(function(g){ return g.checkedIn; }).length;
  const emailedIds = db.emailed || [];
  const checkedInList = guests.filter(function(g){ return g.checkedIn; }).sort(function(a,b){ return a.checkedInAt > b.checkedInAt ? -1 : 1; });
  const notCheckedIn = guests.filter(function(g){ return !g.checkedIn; }).sort(function(a,b){ return a.lastName > b.lastName ? 1 : -1; });

  var checkedInRows = '';
  for (var i = 0; i < checkedInList.length; i++) {
    var g = checkedInList[i];
    checkedInRows += '<tr><td style="color:#389e0d">&#10003; ' + g.firstName + ' ' + g.lastName + '</td><td>' + (g.city || '&mdash;') + '</td><td>' + g.checkedInAt + '</td></tr>';
  }

  var notCheckedInRows = '';
  for (var i = 0; i < notCheckedIn.length; i++) {
    var g = notCheckedIn[i];
    var emailed = emailedIds.indexOf(String(g.id)) >= 0 ? '<span style="color:#389e0d">&#10003;</span>' : '<span style="color:#d48806">Pending</span>';
    notCheckedInRows += '<tr><td style="color:#aaa">' + g.firstName + ' ' + g.lastName + '</td><td>' + (g.city || '&mdash;') + '</td><td>' + emailed + '</td></tr>';
  }

  var pct = total > 0 ? Math.round(checkedIn / total * 100) : 0;

  var html = '<!DOCTYPE html><html><head>';
  html += '<meta name="viewport" content="width=device-width,initial-scale=1">';
  html += '<title>Festival Dashboard</title>';
  html += '<style>';
  html += '*{box-sizing:border-box;}';
  html += 'body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto;background:#f5f5f5;}';
  html += 'h1{color:#222;margin-bottom:4px;}';
  html += '.stat{font-size:3rem;font-weight:bold;color:#1677ff;}';
  html += '.card{background:white;border-radius:10px;padding:20px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,.08);}';
  html += 'table{width:100%;border-collapse:collapse;}';
  html += 'td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:.85rem;}';
  html += 'th{color:#888;font-weight:500;}';
  html += '.progress{height:12px;background:#e8e8e8;border-radius:6px;margin:8px 0;}';
  html += '.bar{height:12px;background:#1677ff;border-radius:6px;}';
  html += 'h2{font-size:1rem;color:#444;margin:0 0 12px;}';
  html += '.btn{padding:9px 14px;font-size:.82rem;border:none;border-radius:6px;cursor:pointer;color:white;margin:3px;display:inline-block;}';
  html += '.red{background:#cf1322;}.blue{background:#1677ff;}.green{background:#389e0d;}.orange{background:#d48806;}.gray{background:#888;}';
  html += '.msg{margin-top:8px;font-size:.85rem;padding:8px 12px;border-radius:6px;}';
  html += '.ok{background:#f6ffed;color:#389e0d;border:1px solid #b7eb8f;}';
  html += '.warn{background:#fff1f0;color:#cf1322;border:1px solid #ffa39e;}';
  html += 'input[type=text],input[type=email]{width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:.85rem;margin-bottom:6px;}';
  html += '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}';
  html += '.section{margin-top:14px;padding-top:14px;border-top:1px solid #f0f0f0;}';
  html += '#log{background:#111;color:#0f0;font-family:monospace;font-size:.75rem;padding:12px;border-radius:6px;height:250px;overflow-y:auto;white-space:pre-wrap;display:none;margin-top:10px;}';
  html += '.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-size:.95rem;font-weight:500;color:white;z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.2);}';
  html += '.toast.show{opacity:1;}.toast.tok{background:#389e0d;}.toast.twarn{background:#cf1322;}';
  html += '</style></head><body>';

  html += '<div class="toast" id="toast"></div>';
  html += '<h1>Festival Check-In Dashboard</h1>';

  // Stats
  html += '<div class="card">';
  html += '<h2>Total checked in</h2>';
  html += '<div class="stat">' + checkedIn + ' <span style="font-size:1.5rem;color:#aaa;">/ ' + total + '</span></div>';
  html += '<div class="progress"><div class="bar" style="width:' + pct + '%"></div></div>';
  html += '<div style="color:#888;font-size:.8rem;margin-top:8px;display:flex;align-items:center;gap:12px;">';
  html += '<span>' + emailedIds.length + ' emails sent</span>';
  html += '<button class="btn gray" onclick="location.reload()">Refresh</button>';
  html += '</div></div>';

  // Manage
  html += '<div class="card">';
  html += '<h2>Manage Guest List</h2>';
  html += '<button class="btn red" onclick="doReset()">Reset Check-ins</button>';
  html += '<button class="btn green" onclick="doDownload()">Download Attendance</button>';
  html += '<button class="btn red" onclick="doClearGuests()">Clear All Guests</button>';
  html += '<div id="actionMsg"></div>';

  // Add guest
  html += '<div class="section">';
  html += '<strong>Add Guest Manually</strong>';
  html += '<div class="grid2" style="margin-top:10px;">';
  html += '<input type="text" id="addFirst" placeholder="First name *">';
  html += '<input type="text" id="addLast" placeholder="Last name *">';
  html += '<input type="email" id="addEmail" placeholder="Email *">';
  html += '<input type="text" id="addCity" placeholder="City (optional)">';
  html += '</div>';
  html += '<button class="btn blue" id="addBtn" style="width:100%;margin-top:4px;" onclick="doAddGuest()">Add Guest</button>';
  html += '<div id="addMsg"></div>';
  html += '</div>';

  // Upload CSV
  html += '<div class="section">';
  html += '<strong>Upload CSV</strong>';
  html += '<p style="font-size:.8rem;color:#888;margin:6px 0;"><b>Merge</b> keeps existing. <b>Replace</b> wipes everything.</p>';
  html += '<input type="file" id="csvFile" accept=".csv" style="margin-bottom:10px;font-size:.85rem;width:100%;">';
  html += '<p style="font-size:.8rem;color:#555;margin:0 0 6px;"><b>Duplicate handling:</b></p>';
  html += '<div style="margin-bottom:10px;">';
  html += '<label style="font-size:.82rem;margin-right:12px;"><input type="radio" name="dedup" value="none" checked> Email only</label>';
  html += '<label style="font-size:.82rem;margin-right:12px;"><input type="radio" name="dedup" value="auto"> Auto-remove</label>';
  html += '<label style="font-size:.82rem;"><input type="radio" name="dedup" value="manual"> Flag for review</label>';
  html += '</div>';
  html += '<button class="btn blue" onclick="doUpload(\'merge\')">Merge</button>';
  html += '<button class="btn red" onclick="doUpload(\'replace\')">Replace All</button>';
  html += '<div id="uploadMsg"></div>';
  html += '</div></div>';

  // Send emails
  html += '<div class="card">';
  html += '<h2>Send Emails</h2>';
  html += '<p style="font-size:.8rem;color:#888;margin:0 0 10px;">Send to All and Send to New should only be used once.</p>';
  html += '<button class="btn orange" onclick="doSend(\'test\')">Test (3 to Faith)</button>';
  html += '<button class="btn blue" onclick="doSend(\'all\')">Send to All</button>';
  html += '<button class="btn green" onclick="doSend(\'new\')">New Guests Only</button>';
  html += '<div class="section">';
  html += '<strong style="font-size:.85rem;">Send to Specific Person</strong>';
  html += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;">';
  html += '<input type="text" id="specificEmail" placeholder="Name or email" style="margin:0;flex:1;">';
  html += '<button class="btn gray" onclick="doSend(\'specific\')" style="white-space:nowrap;margin:0;">Send</button>';
  html += '</div></div>';
  html += '<div id="log"></div>';
  html += '</div>';

  // Checked in
  html += '<div class="card">';
  html += '<h2>Checked in (' + checkedIn + ')</h2>';
  html += '<table><tr><th>Name</th><th>City</th><th>Time</th></tr>';
  html += checkedInRows;
  html += '</table></div>';

  // Not arrived
  html += '<div class="card">';
  html += '<h2>Not yet arrived (' + (total - checkedIn) + ')</h2>';
  html += '<table><tr><th>Name</th><th>City</th><th>Emailed</th></tr>';
  html += notCheckedInRows;
  html += '</table></div>';

  // JavaScript - completely separate from HTML string building
  html += '<script>';
  html += 'var PW = "' + pw + '";';
  html += 'function toast(msg, ok) {';
  html += '  var t = document.getElementById("toast");';
  html += '  t.textContent = msg;';
  html += '  t.className = "toast show " + (ok !== false ? "tok" : "twarn");';
  html += '  clearTimeout(window._tt);';
  html += '  window._tt = setTimeout(function(){ t.classList.remove("show"); }, 3500);';
  html += '}';
  html += 'function showMsg(id, ok, text) {';
  html += '  var el = document.getElementById(id);';
  html += '  if (el) el.innerHTML = "<div class=\'msg " + (ok ? "ok" : "warn") + "\'>" + text + "</div>";';
  html += '  toast(text, ok);';
  html += '}';
  html += 'function doReset() {';
  html += '  if (!confirm("Reset ALL check-ins?")) return;';
  html += '  fetch("/setup/reset?pw=" + PW, {method:"POST"}).then(function(r){return r.json();}).then(function(d){';
  html += '    showMsg("actionMsg", d.ok, d.message);';
  html += '    if (d.ok) setTimeout(function(){ location.reload(); }, 2000);';
  html += '  }).catch(function(e){ toast("Error: " + e.message, false); });';
  html += '}';
  html += 'function doClearGuests() {';
  html += '  if (!confirm("Delete ALL guests?")) return;';
  html += '  fetch("/setup/reset-guests?pw=" + PW, {method:"POST"}).then(function(r){return r.json();}).then(function(d){';
  html += '    showMsg("actionMsg", d.ok, d.message);';
  html += '    if (d.ok) setTimeout(function(){ location.reload(); }, 2000);';
  html += '  }).catch(function(e){ toast("Error: " + e.message, false); });';
  html += '}';
  html += 'function doDownload() { window.location.href = "/setup/download?pw=" + PW; }';
  html += 'function doAddGuest() {';
  html += '  var fn = document.getElementById("addFirst").value.trim();';
  html += '  var ln = document.getElementById("addLast").value.trim();';
  html += '  var em = document.getElementById("addEmail").value.trim();';
  html += '  var ct = document.getElementById("addCity").value.trim();';
  html += '  if (!fn || !ln || !em) { showMsg("addMsg", false, "First name, last name and email required."); return; }';
  html += '  var btn = document.getElementById("addBtn");';
  html += '  btn.disabled = true; btn.textContent = "Adding...";';
  html += '  fetch("/setup/add-guest?pw=" + PW, {';
  html += '    method:"POST", headers:{"Content-Type":"application/json"},';
  html += '    body: JSON.stringify({firstName:fn, lastName:ln, email:em, city:ct})';
  html += '  }).then(function(r){return r.json();}).then(function(d){';
  html += '    showMsg("addMsg", d.ok, d.message);';
  html += '    if (d.ok) { document.getElementById("addFirst").value=""; document.getElementById("addLast").value=""; document.getElementById("addEmail").value=""; document.getElementById("addCity").value=""; setTimeout(function(){ location.reload(); }, 1500); }';
  html += '    btn.disabled = false; btn.textContent = "Add Guest";';
  html += '  }).catch(function(e){ toast("Error: "+e.message,false); btn.disabled=false; btn.textContent="Add Guest"; });';
  html += '}';
  html += 'function doUpload(mode) {';
  html += '  var fi = document.getElementById("csvFile");';
  html += '  if (!fi.files.length) { toast("Please select a CSV file first.", false); return; }';
  html += '  if (mode === "replace" && !confirm("Wipe ALL guests and start fresh?")) return;';
  html += '  var dedup = document.querySelector("input[name=dedup]:checked").value;';
  html += '  showMsg("uploadMsg", true, "Uploading...");';
  html += '  var reader = new FileReader();';
  html += '  reader.onload = function(e) {';
  html += '    fetch("/setup/upload-csv?pw=" + PW + "&mode=" + mode + "&dedup=" + dedup, {';
  html += '      method:"POST", headers:{"Content-Type":"application/json"},';
  html += '      body: JSON.stringify({csv: e.target.result})';
  html += '    }).then(function(r){return r.json();}).then(function(d){';
  html += '      showMsg("uploadMsg", d.ok, d.message);';
  html += '      if (d.ok) setTimeout(function(){ location.reload(); }, 2000);';
  html += '    }).catch(function(e){ showMsg("uploadMsg",false,"Error: "+e.message); });';
  html += '  };';
  html += '  reader.readAsText(fi.files[0]);';
  html += '}';
  html += 'function doSend(mode) {';
  html += '  var url = "/setup/send?pw=" + PW + "&mode=" + mode;';
  html += '  if (mode === "specific") {';
  html += '    var val = document.getElementById("specificEmail").value.trim();';
  html += '    if (!val) { toast("Enter a name or email.", false); return; }';
  html += '    url += "&target=" + encodeURIComponent(val);';
  html += '  }';
  html += '  if (mode === "all" && !confirm("Send to ALL guests? Only do this once!")) return;';
  html += '  var log = document.getElementById("log");';
  html += '  log.style.display = "block"; log.textContent = "Starting...\n";';
  html += '  toast("Sending...", true);';
  html += '  fetch(url).then(function(r){';
  html += '    var reader = r.body.getReader();';
  html += '    var decoder = new TextDecoder();';
  html += '    function read() {';
  html += '      reader.read().then(function(result){';
  html += '        if (result.done) { toast("Done!", true); return; }';
  html += '        log.textContent += decoder.decode(result.value);';
  html += '        log.scrollTop = log.scrollHeight;';
  html += '        read();';
  html += '      });';
  html += '    }';
  html += '    read();';
  html += '  }).catch(function(e){ log.textContent += "Error: "+e.message; toast("Error",false); });';
  html += '}';
  html += '</script></body></html>';

  res.send(html);
});

// ── Reset check-ins ──────────────────────────────────────────────────────────
app.post('/setup/reset', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    var db = loadDB();
    Object.keys(db.guests).forEach(function(k) { db.guests[k].checkedIn = false; db.guests[k].checkedInAt = null; });
    db.checkins = [];
    saveDB(db);
    res.json({ ok: true, message: 'Reset complete. ' + Object.keys(db.guests).length + ' guests unmarked.' });
  } catch(err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Reset guests ─────────────────────────────────────────────────────────────
app.post('/setup/reset-guests', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    saveDB({ guests: {}, checkins: [], emailed: [], pendingDuplicates: [] });
    res.json({ ok: true, message: 'Guest list cleared.' });
  } catch(err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Add guest ────────────────────────────────────────────────────────────────
app.post('/setup/add-guest', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    var firstName = req.body.firstName;
    var lastName = req.body.lastName;
    var email = req.body.email;
    var city = req.body.city || '';
    if (!firstName || !lastName || !email) return res.json({ ok: false, message: 'First name, last name and email required.' });
    var db = loadDB();
    var exists = Object.values(db.guests).find(function(g) { return g.email.toLowerCase() === email.toLowerCase(); });
    if (exists) return res.json({ ok: false, message: exists.firstName + ' ' + exists.lastName + ' already exists with that email.' });
    var id = 'manual_' + Date.now();
    db.guests[id] = { id: id, firstName: firstName, lastName: lastName, email: email, city: city, checkedIn: false, checkedInAt: null };
    saveDB(db);
    res.json({ ok: true, message: firstName + ' ' + lastName + ' added. Total: ' + Object.keys(db.guests).length + ' guests.' });
  } catch(err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Upload CSV ───────────────────────────────────────────────────────────────
app.post('/setup/upload-csv', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    var csv = req.body.csv;
    var mode = req.query.mode;
    var dedup = req.query.dedup;
    if (!csv) return res.json({ ok: false, message: 'No CSV data received.' });

    var parse = require('csv-parse/sync').parse;
    var records = parse(csv, { columns: true, skip_empty_lines: true });

    var byEmail = {};
    records.forEach(function(r) {
      var email = (r.contactEmail || '').trim().toLowerCase();
      if (!email) return;
      if (!byEmail[email] || r.SubmissionId > byEmail[email].SubmissionId) byEmail[email] = r;
    });

    var allGuests = Object.values(byEmail).map(function(r) {
      return { id: r.SubmissionId, firstName: (r.firstName||'').trim(), lastName: (r.lastName||'').trim(), email: (r.contactEmail||'').trim(), city: (r.contactCity||'').trim() };
    }).filter(function(g) { return g.email && g.firstName; });

    var db = mode === 'replace' ? { guests: {}, checkins: [], emailed: [], pendingDuplicates: [] } : loadDB();
    var added = 0;
    allGuests.forEach(function(g) {
      if (!db.guests[g.id]) { db.guests[g.id] = { id: g.id, firstName: g.firstName, lastName: g.lastName, email: g.email, city: g.city, checkedIn: false, checkedInAt: null }; added++; }
    });
    saveDB(db);

    var msg = mode === 'replace' ? 'Replaced guest list. ' + Object.keys(db.guests).length + ' guests loaded.' : 'Added ' + added + ' new guests. Total: ' + Object.keys(db.guests).length + '.';
    res.json({ ok: true, message: msg });
  } catch(err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Remove guest ─────────────────────────────────────────────────────────────
app.post('/setup/remove-guest', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    var id = req.body.id;
    var db = loadDB();
    if (!db.guests[id]) return res.json({ ok: false, message: 'Guest not found.' });
    var name = db.guests[id].firstName + ' ' + db.guests[id].lastName;
    delete db.guests[id];
    saveDB(db);
    res.json({ ok: true, message: 'Removed ' + name + '.' });
  } catch(err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Download attendance ──────────────────────────────────────────────────────
app.get('/setup/download', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    var db = loadDB();
    var rows = ['First Name,Last Name,City,Email,Checked In,Time'];
    Object.values(db.guests).forEach(function(g) {
      rows.push('"' + g.firstName + '","' + g.lastName + '","' + (g.city||'') + '","' + g.email + '","' + (g.checkedIn?'Yes':'No') + '","' + (g.checkedInAt||'') + '"');
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="festival-attendance.csv"');
    res.send(rows.join('\n'));
  } catch(err) { res.status(500).send('Error'); }
});

// ── Send emails ──────────────────────────────────────────────────────────────
app.get('/setup/send', async function(req, res) {
  if (!checkAuth(req, res)) return;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  function write(msg) { res.write(msg + '\n'); }

  try {
    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
    var db = loadDB();
    var allGuests = Object.values(db.guests);
    var emailedIds = db.emailed || [];
    var mode = req.query.mode;
    var target = req.query.target || '';
    var toSend = [];

    if (mode === 'test') {
      toSend = allGuests.slice(0, 3);
      write('TEST MODE — sending 3 emails to yourva.aly18@gmail.com');
    } else if (mode === 'all') {
      toSend = allGuests;
      write('Sending to ALL ' + toSend.length + ' guests...');
    } else if (mode === 'new') {
      toSend = allGuests.filter(function(g) { return emailedIds.indexOf(String(g.id)) < 0; });
      write('Sending to ' + toSend.length + ' new guests...');
    } else if (mode === 'specific') {
      var t = target.toLowerCase();
      toSend = allGuests.filter(function(g) { return g.email.toLowerCase().indexOf(t) >= 0 || g.firstName.toLowerCase().indexOf(t) >= 0 || g.lastName.toLowerCase().indexOf(t) >= 0; });
      write('Found ' + toSend.length + ' matching guest(s) for "' + target + '"...');
    }

    if (toSend.length === 0) { write('No guests found.'); return res.end(); }
    write('---');

    var sent = 0, failed = 0;
    for (var i = 0; i < toSend.length; i++) {
      var guest = toSend[i];
      try {
        var qrUrl = process.env.BASE_URL + '/qr/' + guest.id;
        var to = mode === 'test' ? 'yourva.aly18@gmail.com' : guest.email;
        var subject = mode === 'test' ? '[TEST] ' + guest.firstName + ' ' + guest.lastName + ' - Festival Check-in' : "You're in - See you Sunday, " + guest.firstName + '!';
        await transporter.sendMail({ from: '"Rabbi Benzion Silverman" <' + process.env.GMAIL_USER + '>', to: to, subject: subject, html: buildEmail(guest, qrUrl) });
        sent++;
        if (mode !== 'test' && emailedIds.indexOf(String(guest.id)) < 0) emailedIds.push(String(guest.id));
        write('✓ ' + sent + '/' + toSend.length + ' — ' + guest.firstName + ' ' + guest.lastName + ' <' + to + '>');
        await new Promise(function(r){ setTimeout(r, 300); });
      } catch(err) {
        failed++;
        write('✗ FAILED: ' + guest.firstName + ' ' + guest.lastName + ' — ' + err.message);
      }
    }
    db.emailed = emailedIds;
    saveDB(db);
    write('---');
    write('Done! ' + sent + ' sent, ' + failed + ' failed.');
    if (mode === 'test') write('Check yourva.aly18@gmail.com. If it looks good, click Send to All.');
    res.end();
  } catch(err) { write('ERROR: ' + err.message); res.end(); }
});

// ── Email HTML ───────────────────────────────────────────────────────────────
function buildEmail(guest, qrUrl) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#222;">'
    + '<div style="text-align:center;padding:24px 0 8px;"><h1 style="font-size:1.6rem;color:#1a1a1a;margin:0;">You\'re in. See you Sunday.</h1>'
    + '<p style="color:#555;font-size:1rem;margin:8px 0 0;">Rivertowns Jewish Festival &middot; June 14, 2026</p></div>'
    + '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">'
    + '<p style="font-size:1rem;line-height:1.7;">Dear ' + guest.firstName + ',</p>'
    + '<p style="font-size:1rem;line-height:1.7;">We are so excited to welcome you this Sunday to the first-ever Rivertowns Jewish Festival. Over 250 families have reserved their spot &mdash; and you\'re one of them.</p>'
    + '<p style="font-size:1rem;line-height:1.7;"><strong>Your family check-in code is below.</strong> When you arrive, simply show this to our volunteers at the entrance and you\'ll be checked right in.</p>'
    + '<div style="text-align:center;margin:28px 0;"><img src="' + qrUrl + '" width="220" height="220" alt="Check-in QR code" style="border:3px solid #eee;border-radius:12px;padding:8px;">'
    + '<div style="font-size:.8rem;color:#aaa;margin-top:8px;">Check-in code for ' + guest.firstName + ' ' + guest.lastName + '</div></div>'
    + '<div style="background:#f9f9f9;border-radius:10px;padding:20px;margin:24px 0;">'
    + '<h2 style="font-size:1rem;margin:0 0 12px;color:#444;">Everything you need to know:</h2>'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td style="padding:6px 0;width:28px;">&#128197;</td><td style="padding:6px 0;"><strong>Sunday, June 14</strong></td></tr>'
    + '<tr><td style="padding:6px 0;">&#128205;</td><td style="padding:6px 0;">Dobbs Ferry Waterfront Park</td></tr>'
    + '<tr><td style="padding:6px 0;">&#128336;</td><td style="padding:6px 0;">1:00&ndash;3:00 PM</td></tr>'
    + '<tr><td style="padding:6px 0;">&#127837;</td><td style="padding:6px 0;">Plenty of parking right by the park. Police confirmed no ticketing in the area.</td></tr>'
    + '<tr><td style="padding:6px 0;">&#128274;</td><td style="padding:6px 0;">Uniformed police presence + private security on site. Come with confidence.</td></tr>'
    + '<tr><td style="padding:6px 0;">&#129681;</td><td style="padding:6px 0;"><strong>Bring a lawn chair</strong> &mdash; enjoy the music and the beautiful day by the river.</td></tr>'
    + '<tr><td style="padding:6px 0;">&#9728;&#65039;</td><td style="padding:6px 0;">Bring sunscreen and your appetite.</td></tr>'
    + '<tr><td style="padding:6px 0;">&#127869;&#65039;</td><td style="padding:6px 0;">Israeli street food, Kona Ice, and more. Food available for purchase. Kids activities are free.</td></tr>'
    + '<tr><td style="padding:6px 0;">&#9200;</td><td style="padding:6px 0;">Arriving around 12:45 means you\'ll settle in right as the music starts.</td></tr>'
    + '</table></div>'
    + '<p style="font-size:1rem;line-height:1.7;text-align:center;font-style:italic;color:#444;">Jewish life here is alive. It is joyful. It is welcoming.<br>And this Sunday, we get to celebrate that together.</p>'
    + '<p style="font-size:1rem;line-height:1.7;">See you Sunday,</p>'
    + '<p style="font-size:1rem;line-height:1.7;"><strong>Rabbi Benzion Silverman</strong><br><span style="color:#777;">Chabad of the Rivertowns</span></p>'
    + '<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">'
    + '<p style="font-size:.8rem;color:#aaa;text-align:center;">Chabad of the Rivertowns &middot; 303 Broadway, Dobbs Ferry, NY &middot; chabadrt.org</p>'
    + '</body></html>';
}

// ── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/stats', function(req, res) {
  var db = loadDB();
  var guests = Object.values(db.guests);
  res.json({ total: guests.length, checkedIn: guests.filter(function(g){ return g.checkedIn; }).length });
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function(){ console.log('Festival check-in running on port ' + PORT); });
module.exports = { loadDB: loadDB };
