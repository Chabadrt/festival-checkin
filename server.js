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
  if (!fs.existsSync(DB_FILE)) return { guests: {}, checkins: [], emailed: [] };
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!db.emailed) db.emailed = [];
    return db;
  } catch(e) {
    return { guests: {}, checkins: [], emailed: [] };
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

function parseCSV(csv) {
  const { parse } = require('csv-parse/sync');
  const records = parse(csv, { columns: true, skip_empty_lines: true, relax_column_count: true });
  const byEmail = {};
  records.forEach(function(r) {
    // Support multiple possible column name formats
    const email = (r.contactEmail || r.email || r.Email || '').trim().toLowerCase();
    const id = r.SubmissionId || r.submissionId || r.id || ('manual_' + Date.now() + Math.random());
    if (!email) return;
    if (!byEmail[email] || String(id) > String(byEmail[email].id)) byEmail[email] = r;
  });
  return Object.values(byEmail).map(function(r) {
    const firstName = (r.firstName || r.first_name || r['First Name'] || '').trim();
    const lastName = (r.lastName || r.last_name || r['Last Name'] || '').trim();
    const email = (r.contactEmail || r.email || r.Email || '').trim();
    const city = (r.contactCity || r.city || r.City || '').trim();
    const id = String(r.SubmissionId || r.submissionId || r.id || ('manual_' + Date.now()));
    return { id: id, firstName: firstName, lastName: lastName, email: email, city: city };
  }).filter(function(g) { return g.email && g.firstName; });
}

// ── QR code ──────────────────────────────────────────────────────────────────
app.get('/qr/:id', async function(req, res) {
  try {
    const url = process.env.BASE_URL + '/checkin?id=' + req.params.id;
    const buffer = await QRCode.toBuffer(url, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch(err) { res.status(500).send('QR error'); }
});

// ── Check-in page ────────────────────────────────────────────────────────────
app.get('/checkin', function(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).send('Invalid QR code.');
  const db = loadDB();
  const guest = db.guests[id];

  if (!guest) return res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fff1f0;}h1{color:#cf1322;font-size:2rem;}p{font-size:1.2rem;}</style></head><body><h1>&#9888; Not Found</h1><p>QR code not recognized.<br>Please go to the welcome table.</p></body></html>');

  if (guest.checkedIn) return res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fffbe6;}h1{color:#d48806;font-size:2rem;}p{font-size:1.2rem;color:#555;}</style></head><body><h1>&#9888; Already Checked In</h1><p><strong>' + guest.firstName + ' ' + guest.lastName + '</strong><br>Checked in at ' + guest.checkedInAt + '</p></body></html>');

  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  db.guests[id].checkedIn = true;
  db.guests[id].checkedInAt = now;
  db.checkins.push({ id: id, name: guest.firstName + ' ' + guest.lastName, time: now });
  saveDB(db);

  res.send('<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f6ffed;}h1{color:#389e0d;font-size:3rem;}.name{font-size:1.8rem;font-weight:bold;color:#222;margin:12px 0;}.badge{display:inline-block;background:#389e0d;color:white;padding:8px 24px;border-radius:20px;font-size:1rem;margin-top:16px;}</style></head><body><h1>&#10003;</h1><div class="name">' + guest.firstName + ' ' + guest.lastName + '</div><p>' + (guest.city || '') + '</p><div class="badge">Checked In &mdash; ' + now + '</div></body></html>');
});

// ── Guest list API (for autocomplete) ────────────────────────────────────────
app.get('/api/guests', function(req, res) {
  if (!checkAuth(req, res)) return;
  const db = loadDB();
  const q = (req.query.q || '').toLowerCase();
  const guests = Object.values(db.guests).filter(function(g) {
    return !q || g.firstName.toLowerCase().indexOf(q) >= 0 || g.lastName.toLowerCase().indexOf(q) >= 0 || g.email.toLowerCase().indexOf(q) >= 0;
  }).slice(0, 10).map(function(g) {
    return { id: g.id, name: g.firstName + ' ' + g.lastName, email: g.email };
  });
  res.json(guests);
});

// ── Admin dashboard ──────────────────────────────────────────────────────────
app.get('/admin', function(req, res) {
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
  const pct = total > 0 ? Math.round(checkedIn / total * 100) : 0;

  var checkedInRows = '';
  for (var i = 0; i < checkedInList.length; i++) {
    var g = checkedInList[i];
    checkedInRows += '<tr><td style="color:#389e0d">&#10003; ' + esc(g.firstName) + ' ' + esc(g.lastName) + '</td><td>' + esc(g.city||'') + '</td><td>' + (g.checkedInAt||'') + '</td></tr>';
  }

  var notCheckedInRows = '';
  for (var i = 0; i < notCheckedIn.length; i++) {
    var g = notCheckedIn[i];
    var emailed = emailedIds.indexOf(String(g.id)) >= 0 ? '<span style="color:#389e0d">&#10003;</span>' : '<span style="color:#d48806">Pending</span>';
    notCheckedInRows += '<tr><td style="color:#aaa">' + esc(g.firstName) + ' ' + esc(g.lastName) + '</td><td>' + esc(g.city||'') + '</td><td>' + emailed + '</td></tr>';
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var html = '<!DOCTYPE html><html><head>';
  html += '<meta name="viewport" content="width=device-width,initial-scale=1">';
  html += '<title>Festival Dashboard</title>';
  html += '<style>';
  html += '*{box-sizing:border-box;}body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto;background:#f5f5f5;}';
  html += 'h1{color:#222;margin-bottom:4px;}.stat{font-size:3rem;font-weight:bold;color:#1677ff;}';
  html += '.card{background:white;border-radius:10px;padding:20px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,.08);}';
  html += 'table{width:100%;border-collapse:collapse;}td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:.85rem;}th{color:#888;font-weight:500;}';
  html += '.progress{height:12px;background:#e8e8e8;border-radius:6px;margin:8px 0;}.bar{height:12px;background:#1677ff;border-radius:6px;}';
  html += 'h2{font-size:1rem;color:#444;margin:0 0 12px;}';
  html += '.btn{padding:9px 14px;font-size:.82rem;border:none;border-radius:6px;cursor:pointer;color:white;margin:3px;display:inline-block;}';
  html += '.red{background:#cf1322;}.blue{background:#1677ff;}.green{background:#389e0d;}.orange{background:#d48806;}.gray{background:#888;}';
  html += '.msg{margin-top:8px;font-size:.85rem;padding:8px 12px;border-radius:6px;}';
  html += '.ok{background:#f6ffed;color:#389e0d;border:1px solid #b7eb8f;}.warn{background:#fff1f0;color:#cf1322;border:1px solid #ffa39e;}';
  html += 'input[type=text],input[type=email]{width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:.85rem;margin-bottom:6px;}';
  html += '.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;}.section{margin-top:14px;padding-top:14px;border-top:1px solid #f0f0f0;}';
  html += '.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-size:.95rem;font-weight:500;color:white;z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,.2);}';
  html += '.toast.show{opacity:1;}.toast.tok{background:#389e0d;}.toast.twarn{background:#cf1322;}';
  html += '#suggestions{position:absolute;background:white;border:1px solid #ddd;border-radius:6px;width:100%;max-height:200px;overflow-y:auto;z-index:100;display:none;box-shadow:0 4px 12px rgba(0,0,0,.1);}';
  html += '#suggestions div{padding:10px 12px;cursor:pointer;font-size:.9rem;border-bottom:1px solid #f0f0f0;}#suggestions div:hover{background:#f5f5f5;}';
  html += '</style></head><body>';

  html += '<div class="toast" id="toast"></div>';
  html += '<h1>&#127881; Festival Check-In Dashboard</h1>';

  // Stats
  html += '<div class="card">';
  html += '<h2>Total checked in</h2>';
  html += '<div class="stat">' + checkedIn + ' <span style="font-size:1.5rem;color:#aaa;">/ ' + total + '</span></div>';
  html += '<div class="progress"><div class="bar" style="width:' + pct + '%"></div></div>';
  html += '<div style="color:#888;font-size:.8rem;margin-top:8px;display:flex;align-items:center;gap:12px;">';
  html += '<span>' + emailedIds.length + ' emails sent</span>';
  html += '<button class="btn gray" onclick="location.reload()">&#8635; Refresh</button>';
  html += '</div></div>';

  // Manage
  html += '<div class="card">';
  html += '<h2>&#9881;&#65039; Manage Guest List</h2>';
  html += '<button class="btn red" onclick="doReset()">Reset Check-ins</button>';
  html += '<button class="btn green" onclick="doDownload()">&#8659; Download Attendance</button>';
  html += '<button class="btn red" onclick="doClearGuests()">Clear All Guests</button>';
  html += '<div id="actionMsg"></div>';

  // Add guest
  html += '<div class="section">';
  html += '<strong>&#10133; Add Guest Manually</strong>';
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
  html += '<strong>&#128203; Upload Guest List (CSV)</strong>';
  html += '<p style="font-size:.8rem;color:#888;margin:6px 0;">';
  html += '<b>Merge</b> — adds new guests, keeps existing check-ins.<br>';
  html += '<b>Replace All</b> — wipes everything and starts fresh.';
  html += '</p>';
  html += '<input type="file" id="csvFile" accept=".csv" style="margin-bottom:10px;font-size:.85rem;width:100%;">';
  html += '<p style="font-size:.8rem;color:#555;margin:0 0 8px;"><b>Duplicate handling:</b> Choose how to handle guests who appear more than once.</p>';
  html += '<div style="margin-bottom:12px;background:#f9f9f9;padding:10px;border-radius:6px;">';
  html += '<label style="display:block;font-size:.85rem;margin-bottom:6px;cursor:pointer;">';
  html += '<input type="radio" name="dedup" value="none" checked style="margin-right:6px;">';
  html += '<strong>Email only</strong> — keep latest entry per email address (recommended)';
  html += '</label>';
  html += '<label style="display:block;font-size:.85rem;margin-bottom:6px;cursor:pointer;">';
  html += '<input type="radio" name="dedup" value="auto" style="margin-right:6px;">';
  html += '<strong>Auto-remove duplicates</strong> — also remove entries with same last name + email domain';
  html += '</label>';
  html += '</div>';
  html += '<div style="display:flex;gap:8px;">';
  html += '<button class="btn blue" style="flex:1;" onclick="doUpload(\'merge\')">&#128203; Merge with Existing</button>';
  html += '<button class="btn red" style="flex:1;" onclick="doUpload(\'replace\')">&#9888; Replace All</button>';
  html += '</div>';
  html += '<div id="uploadMsg"></div>';
  html += '</div></div>';

  // Send emails - NOTE: only works from local computer
  html += '<div class="card">';
  html += '<h2>&#128139; Send Emails</h2>';
  html += '<div style="background:#fffbe6;border:1px solid #ffe58f;border-radius:6px;padding:10px;margin-bottom:12px;font-size:.85rem;color:#874d00;">';
  html += '&#9888;&#65039; Emails must be sent from the local computer using <code>node send-emails.js</code>. Use the options below to send to a specific person via the server.';
  html += '</div>';
  html += '<button class="btn orange" onclick="doSend(\'test\')">&#129514; Test (3 to Faith)</button>';
  html += '<button class="btn blue" onclick="doSend(\'all\')">&#128139; Send to All</button>';
  html += '<button class="btn green" onclick="doSend(\'new\')">&#10024; New Guests Only</button>';
  html += '<div class="section">';
  html += '<strong style="font-size:.85rem;">&#128139; Send to Specific Person</strong>';
  html += '<p style="font-size:.8rem;color:#888;margin:4px 0 8px;">Type a name or email — matching guests will appear below.</p>';
  html += '<div style="position:relative;">';
  html += '<input type="text" id="specificEmail" placeholder="Start typing name or email..." style="margin:0;" oninput="searchGuests(this.value)">';
  html += '<div id="suggestions"></div>';
  html += '</div>';
  html += '<button class="btn gray" id="sendSpecificBtn" onclick="doSend(\'specific\')" style="width:100%;margin-top:8px;" disabled>Select a guest above to send</button>';
  html += '</div>';
  html += '<div id="sendStatus" style="display:none;margin-top:12px;"></div>';
  html += '</div>';

  // Checked in
  html += '<div class="card">';
  html += '<h2>&#9989; Checked in (' + checkedIn + ')</h2>';
  html += '<table><tr><th>Name</th><th>City</th><th>Time</th></tr>' + checkedInRows + '</table>';
  html += '</div>';

  // Not arrived
  html += '<div class="card">';
  html += '<h2>&#9203; Not yet arrived (' + (total - checkedIn) + ')</h2>';
  html += '<table><tr><th>Name</th><th>City</th><th>Emailed</th></tr>' + notCheckedInRows + '</table>';
  html += '</div>';

  // JavaScript
  html += '<script>';
  html += 'var PW = "' + pw + '";';
  html += 'var selectedGuest = null;';

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
  html += '  if (!confirm("Reset ALL check-ins? Cannot be undone.")) return;';
  html += '  fetch("/setup/reset?pw=" + PW, {method:"POST"}).then(function(r){return r.json();}).then(function(d){';
  html += '    showMsg("actionMsg", d.ok, d.message);';
  html += '    if (d.ok) setTimeout(function(){ location.reload(); }, 2000);';
  html += '  }).catch(function(e){ toast("Error: " + e.message, false); });';
  html += '}';

  html += 'function doClearGuests() {';
  html += '  if (!confirm("Delete ALL guests? You will need to re-upload the CSV.")) return;';
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
  html += '    if (d.ok) { ["addFirst","addLast","addEmail","addCity"].forEach(function(id){ document.getElementById(id).value=""; }); setTimeout(function(){ location.reload(); }, 1500); }';
  html += '    btn.disabled = false; btn.textContent = "Add Guest";';
  html += '  }).catch(function(e){ toast("Error: "+e.message, false); btn.disabled=false; btn.textContent="Add Guest"; });';
  html += '}';

  html += 'function doUpload(mode) {';
  html += '  var fi = document.getElementById("csvFile");';
  html += '  if (!fi || !fi.files || !fi.files.length) { toast("Please select a CSV file first.", false); return; }';
  html += '  if (mode === "replace" && !confirm("This will wipe ALL guests and check-ins. Are you sure?")) return;';
  html += '  var dedup = "none";';
  html += '  var dedupEl = document.querySelector("input[name=dedup]:checked");';
  html += '  if (dedupEl) dedup = dedupEl.value;';
  html += '  var uploadMsg = document.getElementById("uploadMsg");';
  html += '  uploadMsg.innerHTML = "<div class=\'msg ok\'>Reading file...</div>";';
  html += '  var reader = new FileReader();';
  html += '  reader.onload = function(e) {';
  html += '    uploadMsg.innerHTML = "<div class=\'msg ok\'>Uploading...</div>";';
  html += '    fetch("/setup/upload-csv?pw=" + PW + "&mode=" + mode + "&dedup=" + dedup, {';
  html += '      method:"POST",';
  html += '      headers:{"Content-Type":"application/json"},';
  html += '      body: JSON.stringify({csv: e.target.result})';
  html += '    }).then(function(r){ return r.json(); }).then(function(d){';
  html += '      showMsg("uploadMsg", d.ok, d.message);';
  html += '      if (d.ok) setTimeout(function(){ location.reload(); }, 2000);';
  html += '    }).catch(function(e){ showMsg("uploadMsg", false, "Error: " + e.message); });';
  html += '  };';
  html += '  reader.onerror = function() { showMsg("uploadMsg", false, "Could not read file."); };';
  html += '  reader.readAsText(fi.files[0]);';
  html += '}';

  html += 'function searchGuests(q) {';
  html += '  var box = document.getElementById("suggestions");';
  html += '  var btn = document.getElementById("sendSpecificBtn");';
  html += '  selectedGuest = null;';
  html += '  btn.disabled = true; btn.textContent = "Select a guest above to send";';
  html += '  if (!q || q.length < 2) { box.style.display = "none"; return; }';
  html += '  fetch("/api/guests?pw=" + PW + "&q=" + encodeURIComponent(q))';
  html += '    .then(function(r){ return r.json(); })';
  html += '    .then(function(guests){';
  html += '      if (!guests.length) { box.style.display = "none"; return; }';
  html += '      box.innerHTML = "";';
  html += '      guests.forEach(function(g){';
  html += '        var div = document.createElement("div");';
  html += '        div.textContent = g.name + " (" + g.email + ")";';
  html += '        div.onclick = function(){';
  html += '          document.getElementById("specificEmail").value = g.name;';
  html += '          selectedGuest = g;';
  html += '          box.style.display = "none";';
  html += '          btn.disabled = false;';
  html += '          btn.textContent = "Send to " + g.name;';
  html += '        };';
  html += '        box.appendChild(div);';
  html += '      });';
  html += '      box.style.display = "block";';
  html += '    });';
  html += '}';

  html += 'function doSend(mode) {';
  html += '  var url = "/setup/send?pw=" + PW + "&mode=" + mode;';
  html += '  if (mode === "specific") {';
  html += '    if (!selectedGuest) { toast("Please select a guest from the list.", false); return; }';
  html += '    url += "&target=" + encodeURIComponent(selectedGuest.email);';
  html += '  }';
  html += '  if (mode === "all" && !confirm("Send to ALL guests? Only do this once!")) return;';
  html += '  var status = document.getElementById("sendStatus");';
  html += '  status.style.display = "block";';
  html += '  status.innerHTML = "<div style=\'padding:16px;background:#f0f7ff;border-radius:8px;border:1px solid #91caff;text-align:center;\'><div style=\'font-size:1.5rem;\'>&#9203;</div><div style=\'margin-top:8px;font-weight:500;color:#1677ff;\'>Sending emails...</div><div style=\'font-size:.85rem;color:#888;margin-top:4px;\' id=\'sendCount\'></div></div>";';
  html += '  var sent = 0;';
  html += '  fetch(url).then(function(r){';
  html += '    var reader = r.body.getReader();';
  html += '    var decoder = new TextDecoder();';
  html += '    var buffer = "";';
  html += '    function read() {';
  html += '      reader.read().then(function(result){';
  html += '        if (result.done) {';
  html += '          status.innerHTML = "<div style=\'padding:16px;background:#f6ffed;border-radius:8px;border:1px solid #b7eb8f;text-align:center;\'><div style=\'font-size:2rem;\'>&#10003;</div><div style=\'margin-top:8px;font-weight:500;color:#389e0d;font-size:1.1rem;\'>Done!</div><div style=\'font-size:.85rem;color:#555;margin-top:4px;\'>" + sent + " email(s) sent</div></div>";';
  html += '          toast("Done! " + sent + " email(s) sent.", true);';
  html += '          return;';
  html += '        }';
  html += '        buffer += decoder.decode(result.value);';
  html += '        var lines = buffer.split("\\n");';
  html += '        buffer = lines.pop();';
  html += '        lines.forEach(function(line){';
  html += '          if (line.indexOf("\\u2713") >= 0) { sent++; var el = document.getElementById("sendCount"); if (el) el.textContent = sent + " sent so far..."; }';
  html += '          if (line.indexOf("FAILED") >= 0 || line.indexOf("No guests") >= 0) { toast(line, false); }';
  html += '        });';
  html += '        read();';
  html += '      });';
  html += '    }';
  html += '    read();';
  html += '  }).catch(function(e){ status.innerHTML = "<div style=\'padding:12px;background:#fff1f0;border-radius:8px;color:#cf1322;\'>Error: " + e.message + "</div>"; });';
  html += '}';

  html += 'document.addEventListener("click", function(e){ var box = document.getElementById("suggestions"); if (box && !box.contains(e.target) && e.target.id !== "specificEmail") box.style.display = "none"; });';
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
    saveDB({ guests: {}, checkins: [], emailed: [] });
    res.json({ ok: true, message: 'Guest list cleared.' });
  } catch(err) { res.json({ ok: false, message: 'Error: ' + err.message }); }
});

// ── Add guest ────────────────────────────────────────────────────────────────
app.post('/setup/add-guest', function(req, res) {
  if (!checkAuth(req, res)) return;
  try {
    var firstName = (req.body.firstName || '').trim();
    var lastName = (req.body.lastName || '').trim();
    var email = (req.body.email || '').trim();
    var city = (req.body.city || '').trim();
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
    var mode = req.query.mode || 'merge';
    var dedup = req.query.dedup || 'none';
    if (!csv) return res.json({ ok: false, message: 'No CSV data received.' });

    var guests = parseCSV(csv);
    if (guests.length === 0) return res.json({ ok: false, message: 'No valid guests found in CSV. Make sure your file has firstName, lastName, contactEmail columns.' });

    // Auto dedup
    if (dedup === 'auto') {
      var seen = {};
      guests = guests.filter(function(g) {
        var domain = g.email.split('@')[1] || '';
        var key = g.lastName.toLowerCase() + '|' + domain;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    var db = mode === 'replace' ? { guests: {}, checkins: [], emailed: [] } : loadDB();
    var added = 0;
    guests.forEach(function(g) {
      if (!db.guests[g.id]) {
        db.guests[g.id] = { id: g.id, firstName: g.firstName, lastName: g.lastName, email: g.email, city: g.city, checkedIn: false, checkedInAt: null };
        added++;
      }
    });
    saveDB(db);

    var msg = mode === 'replace'
      ? 'Replaced guest list. ' + Object.keys(db.guests).length + ' guests loaded.'
      : 'Added ' + added + ' new guests. Total: ' + Object.keys(db.guests).length + ' guests.';
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
      rows.push('"' + (g.firstName||'') + '","' + (g.lastName||'') + '","' + (g.city||'') + '","' + (g.email||'') + '","' + (g.checkedIn?'Yes':'No') + '","' + (g.checkedInAt||'') + '"');
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="festival-attendance.csv"');
    res.send(rows.join('\n'));
  } catch(err) { res.status(500).send('Error'); }
});

// ── Send emails (streaming) ──────────────────────────────────────────────────
app.get('/setup/send', async function(req, res) {
  if (!checkAuth(req, res)) return;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');
  function write(msg) { res.write(msg + '\n'); }

  try {
    var nodemailer = require('nodemailer');
    var transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

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
      toSend = allGuests.filter(function(g) {
        return g.email.toLowerCase() === t || (g.firstName + ' ' + g.lastName).toLowerCase().indexOf(t) >= 0;
      });
      write('Found ' + toSend.length + ' matching guest(s)...');
    }

    if (toSend.length === 0) { write('No guests found. Upload your CSV first.'); return res.end(); }
    write('---');

    var sent = 0, failed = 0;
    for (var i = 0; i < toSend.length; i++) {
      var guest = toSend[i];
      try {
        var qrUrl = process.env.BASE_URL + '/qr/' + guest.id;
        var to = mode === 'test' ? 'yourva.aly18@gmail.com' : guest.email;
        var subject = mode === 'test' ? '[TEST] ' + guest.firstName + ' ' + guest.lastName + ' - Festival Check-in' : "You're in - See you Sunday, " + guest.firstName + '!';
        await transporter.sendMail({ from: '"Rabbi Benjy Silverman" <' + process.env.GMAIL_USER + '>', to: to, subject: subject, html: buildEmail(guest, qrUrl) });
        sent++;
        if (mode !== 'test' && emailedIds.indexOf(String(guest.id)) < 0) emailedIds.push(String(guest.id));
        write('\u2713 ' + sent + '/' + toSend.length + ' \u2014 ' + guest.firstName + ' ' + guest.lastName);
        await new Promise(function(r){ setTimeout(r, 300); });
      } catch(err) {
        failed++;
        write('FAILED: ' + guest.firstName + ' ' + guest.lastName + ' \u2014 ' + err.message);
      }
    }
    db.emailed = emailedIds;
    saveDB(db);
    write('---');
    write('Done! ' + sent + ' sent, ' + failed + ' failed.');
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
    + '<p style="font-size:1rem;line-height:1.7;"><strong>Rabbi Benjy Silverman</strong><br><span style="color:#777;">Chabad of the Rivertowns</span></p>'
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
