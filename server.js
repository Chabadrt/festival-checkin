require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const DB_FILE = path.join(__dirname, 'checkins.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { guests: {}, checkins: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// Initialize DB with guests from CSV on startup
function initGuests(guests) {
  const db = loadDB();
  guests.forEach(g => {
    if (!db.guests[g.id]) {
      db.guests[g.id] = { ...g, checkedIn: false, checkedInAt: null };
    }
  });
  saveDB(db);
}

// QR code image endpoint — serves QR as real PNG for email clients
app.get('/qr/:id', async (req, res) => {
  const { id } = req.params;
  const url = `${process.env.BASE_URL}/checkin?id=${id}`;
  try {
    const buffer = await QRCode.toBuffer(url, { width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('QR error');
  }
});

// Check-in endpoint — volunteer scans QR, this page loads on their phone
app.get('/checkin', (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).send('Invalid QR code.');

  const db = loadDB();
  const guest = db.guests[id];

  if (!guest) {
    return res.send(`
      <!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fff1f0;}
      h1{color:#cf1322;font-size:2rem;}p{font-size:1.2rem;}</style></head><body>
      <h1>⚠️ Not Found</h1>
      <p>This QR code was not recognized.<br>Please direct guest to the welcome table.</p>
      </body></html>
    `);
  }

  if (guest.checkedIn) {
    return res.send(`
      <!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#fffbe6;}
      h1{color:#d48806;font-size:2rem;}p{font-size:1.2rem;color:#555;}</style></head><body>
      <h1>⚠️ Already Checked In</h1>
      <p><strong>${guest.firstName} ${guest.lastName}</strong><br>
      Checked in at ${guest.checkedInAt}</p>
      </body></html>
    `);
  }

  // Mark as checked in
  const now = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  db.guests[id].checkedIn = true;
  db.guests[id].checkedInAt = now;
  db.checkins.push({ id, name: `${guest.firstName} ${guest.lastName}`, time: now });
  saveDB(db);

  res.send(`
    <!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f6ffed;}
    h1{color:#389e0d;font-size:3rem;margin-bottom:8px;}
    .name{font-size:1.8rem;font-weight:bold;color:#222;margin:12px 0;}
    p{font-size:1.1rem;color:#555;}
    .badge{display:inline-block;background:#389e0d;color:white;padding:8px 24px;
    border-radius:20px;font-size:1rem;margin-top:16px;}</style></head><body>
    <h1>✓</h1>
    <div class="name">${guest.firstName} ${guest.lastName}</div>
    <p>${guest.city || ''}</p>
    <div class="badge">Checked In — ${now}</div>
    </body></html>
  `);
});

// Admin dashboard
app.get('/admin', (req, res) => {
  const { pw } = req.query;
  if (pw !== process.env.ADMIN_PASSWORD) {
    return res.send(`
      <!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px;}
      input{padding:10px;font-size:1rem;border:1px solid #ccc;border-radius:6px;width:220px;}
      button{padding:10px 20px;font-size:1rem;background:#1677ff;color:white;border:none;
      border-radius:6px;cursor:pointer;margin-left:8px;}</style></head><body>
      <h2>Festival Admin</h2>
      <form onsubmit="window.location='/admin?pw='+document.getElementById('p').value;return false;">
      <input id="p" type="password" placeholder="Enter password">
      <button type="submit">Enter</button></form>
      </body></html>
    `);
  }

  const db = loadDB();
  const guests = Object.values(db.guests);
  const total = guests.length;
  const checkedIn = guests.filter(g => g.checkedIn).length;
  const checkedInList = guests.filter(g => g.checkedIn)
    .sort((a, b) => a.checkedInAt > b.checkedInAt ? -1 : 1);
  const notCheckedIn = guests.filter(g => !g.checkedIn)
    .sort((a, b) => a.lastName > b.lastName ? 1 : -1);

  res.send(`
    <!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="30">
    <style>
    body{font-family:sans-serif;padding:20px;max-width:800px;margin:0 auto;background:#f5f5f5;}
    h1{color:#222;} .stat{font-size:3rem;font-weight:bold;color:#1677ff;}
    .card{background:white;border-radius:10px;padding:20px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
    table{width:100%;border-collapse:collapse;}
    td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #f0f0f0;font-size:0.9rem;}
    th{color:#888;font-weight:500;} .green{color:#389e0d;} .gray{color:#aaa;}
    .progress{height:12px;background:#e8e8e8;border-radius:6px;margin:8px 0;}
    .bar{height:12px;background:#1677ff;border-radius:6px;transition:width 0.3s;}
    h2{font-size:1rem;color:#555;margin:0 0 4px;}
    </style></head><body>
    <h1>🎉 Festival Check-In</h1>
    <div class="card">
      <h2>Total checked in</h2>
      <div class="stat">${checkedIn} <span style="font-size:1.5rem;color:#aaa;">/ ${total}</span></div>
      <div class="progress"><div class="bar" style="width:${Math.round(checkedIn/total*100)}%"></div></div>
      <div style="color:#888;font-size:0.85rem;">Page refreshes every 30 seconds</div>
    </div>
    <div class="card">
      <h2>Checked in (${checkedIn})</h2>
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
    <div class="card">
      <h2>Not yet arrived (${total - checkedIn})</h2>
      <table>
        <tr><th>Name</th><th>City</th></tr>
        ${notCheckedIn.map(g => `
          <tr>
            <td class="gray">${g.firstName} ${g.lastName}</td>
            <td>${g.city || '—'}</td>
          </tr>`).join('')}
      </table>
    </div>
    </body></html>
  `);
});

// API for stats (optional future use)
app.get('/api/stats', (req, res) => {
  const db = loadDB();
  const guests = Object.values(db.guests);
  res.json({
    total: guests.length,
    checkedIn: guests.filter(g => g.checkedIn).length
  });
});

// ── CSV Upload page ──────────────────────────────────────────────────────────
app.get('/setup', (req, res) => {
  const { pw } = req.query;
  if (pw !== process.env.ADMIN_PASSWORD) {
    return res.send(`
      <!DOCTYPE html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:60px;}
      input{padding:10px;font-size:1rem;border:1px solid #ccc;border-radius:6px;width:220px;}
      button{padding:10px 20px;font-size:1rem;background:#1677ff;color:white;border:none;
      border-radius:6px;cursor:pointer;margin-left:8px;}</style></head><body>
      <h2>Festival Setup</h2>
      <form onsubmit="window.location='/setup?pw='+document.getElementById('p').value;return false;">
      <input id="p" type="password" placeholder="Enter password">
      <button type="submit">Enter</button></form>
      </body></html>
    `);
  }

  const csvExists = fs.existsSync(path.join(__dirname, 'submissions.csv'));
  const dbExists = fs.existsSync(DB_FILE);
  let guestCount = 0;
  if (dbExists) {
    const db = loadDB();
    guestCount = Object.keys(db.guests).length;
  }

  res.send(`
    <!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
    body{font-family:sans-serif;padding:30px;max-width:700px;margin:0 auto;background:#f5f5f5;}
    .card{background:white;border-radius:10px;padding:24px;margin:16px 0;box-shadow:0 1px 4px rgba(0,0,0,0.08);}
    h1{color:#222;font-size:1.4rem;} h2{font-size:1rem;color:#444;margin:0 0 12px;}
    textarea{width:100%;height:200px;font-family:monospace;font-size:0.8rem;padding:10px;
    border:1px solid #ddd;border-radius:6px;box-sizing:border-box;}
    button{padding:12px 24px;font-size:1rem;background:#1677ff;color:white;border:none;
    border-radius:6px;cursor:pointer;margin-top:10px;width:100%;}
    button.green{background:#389e0d;} button.red{background:#cf1322;}
    .status{padding:10px;border-radius:6px;margin:8px 0;font-size:0.9rem;}
    .ok{background:#f6ffed;color:#389e0d;border:1px solid #b7eb8f;}
    .warn{background:#fffbe6;color:#d48806;border:1px solid #ffe58f;}
    #log{background:#111;color:#0f0;font-family:monospace;font-size:0.8rem;padding:16px;
    border-radius:6px;height:300px;overflow-y:auto;white-space:pre-wrap;display:none;margin-top:12px;}
    </style></head><body>
    <h1>🎉 Festival Setup Panel</h1>

    <div class="card">
      <h2>Status</h2>
      <div class="status ${csvExists ? 'ok' : 'warn'}">
        CSV file: ${csvExists ? '✓ Uploaded' : '⚠ Not uploaded yet'}
      </div>
      <div class="status ${guestCount > 0 ? 'ok' : 'warn'}">
        Guest database: ${guestCount > 0 ? `✓ ${guestCount} guests loaded` : '⚠ Empty'}
      </div>
    </div>

    <div class="card">
      <h2>Step 1 — Upload CSV</h2>
      <p style="font-size:0.9rem;color:#666;">Open your submissions CSV, select all (Ctrl+A), copy (Ctrl+C), paste below.</p>
      <textarea id="csvData" placeholder="Paste CSV contents here..."></textarea>
      <button id="uploadBtn" style="margin-top:10px;">Upload CSV</button>
      <div id="csvStatus"></div>
    </div>

    <div class="card">
      <h2>Step 2 — Send Emails</h2>
      <p style="font-size:0.9rem;color:#666;">
        <strong>Test mode</strong> sends 3 emails to your own address first.<br>
        <strong>Send all</strong> sends to all guests — only do this once!
      </p>
      <button id="testBtn" style="background:#d48806;margin-bottom:8px;">
        Send Test (3 emails to me)
      </button>
      <button id="sendAllBtn" class="red">
        Send to ALL Guests
      </button>
      <div id="log"></div>
    </div>

    <script>
    const pw = new URLSearchParams(window.location.search).get('pw');

    window.onload = function() {
      document.getElementById('uploadBtn').addEventListener('click', uploadCSV);
      document.getElementById('testBtn').addEventListener('click', function(){ sendEmails('test'); });
      document.getElementById('sendAllBtn').addEventListener('click', function(){ sendEmails('all'); });
    };

    async function uploadCSV() {
      const data = document.getElementById('csvData').value.trim();
      if (!data) { alert('Please paste CSV data first.'); return; }
      document.getElementById('csvStatus').innerHTML = '<div class="status warn">Uploading...</div>';
      try {
        const res = await fetch('/setup/upload-csv?pw=' + pw, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ csv: data })
        });
        const json = await res.json();
        document.getElementById('csvStatus').innerHTML =
          '<div class="status ' + (json.ok ? 'ok' : 'warn') + '">' + json.message + '</div>';
        if (json.ok) setTimeout(() => location.reload(), 2000);
      } catch(err) {
        document.getElementById('csvStatus').innerHTML =
          '<div class="status warn">Error: ' + err.message + '</div>';
      }
    }

    async function sendEmails(mode) {
      const log = document.getElementById('log');
      log.style.display = 'block';
      log.textContent = 'Starting...\n';
      try {
        const res = await fetch('/setup/send?pw=' + pw + '&mode=' + mode);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          log.textContent += decoder.decode(value);
          log.scrollTop = log.scrollHeight;
        }
      } catch(err) {
        log.textContent += 'Error: ' + err.message;
      }
    }
    </script>
    </body></html>
  `);
});

// ── CSV upload endpoint ──────────────────────────────────────────────────────
app.post('/setup/upload-csv', express.json({ limit: '10mb' }), (req, res) => {
  const { pw } = req.query;
  if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).json({ ok: false, message: 'Unauthorized' });

  try {
    const { csv } = req.body;
    if (!csv) return res.json({ ok: false, message: 'No CSV data received.' });

    fs.writeFileSync(path.join(__dirname, 'submissions.csv'), csv, 'utf8');

    // Parse and init guests immediately
    const { parse } = require('csv-parse/sync');
    const records = parse(csv, { columns: true, skip_empty_lines: true });
    const byEmail = {};
    records.forEach(r => {
      const email = (r.contactEmail || '').trim().toLowerCase();
      if (!email) return;
      if (!byEmail[email] || r.SubmissionId > byEmail[email].SubmissionId) byEmail[email] = r;
    });
    const guests = Object.values(byEmail).map(r => ({
      id: r.SubmissionId,
      firstName: (r.firstName || '').trim(),
      lastName: (r.lastName || '').trim(),
      email: (r.contactEmail || '').trim(),
      city: (r.contactCity || '').trim()
    })).filter(g => g.email && g.firstName);

    initGuests(guests);
    res.json({ ok: true, message: `✓ CSV uploaded. ${guests.length} unique guests loaded into database.` });
  } catch (err) {
    res.json({ ok: false, message: 'Error: ' + err.message });
  }
});

// ── Send emails endpoint (streaming) ────────────────────────────────────────
app.get('/setup/send', async (req, res) => {
  const { pw, mode } = req.query;
  if (pw !== process.env.ADMIN_PASSWORD) return res.status(401).send('Unauthorized');

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const write = (msg) => res.write(msg + '\n');

  try {
    const { parse } = require('csv-parse/sync');
    const nodemailer = require('nodemailer');

    const csvPath = path.join(__dirname, 'submissions.csv');
    if (!fs.existsSync(csvPath)) {
      write('ERROR: submissions.csv not found. Upload it first.');
      return res.end();
    }

    const raw = fs.readFileSync(csvPath, 'utf8');
    const records = parse(raw, { columns: true, skip_empty_lines: true });
    const byEmail = {};
    records.forEach(r => {
      const email = (r.contactEmail || '').trim().toLowerCase();
      if (!email) return;
      if (!byEmail[email] || r.SubmissionId > byEmail[email].SubmissionId) byEmail[email] = r;
    });
    const guests = Object.values(byEmail).map(r => ({
      id: r.SubmissionId,
      firstName: (r.firstName || '').trim(),
      lastName: (r.lastName || '').trim(),
      email: (r.contactEmail || '').trim(),
      city: (r.contactCity || '').trim()
    })).filter(g => g.email && g.firstName);

    write(`Loaded ${guests.length} unique guests.`);

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });

    const isTest = mode === 'test';
    const toSend = isTest ? guests.slice(0, 3) : guests;
    write(isTest ? `TEST MODE — sending 3 emails to ${process.env.GMAIL_USER}` : `Sending to all ${toSend.length} guests...`);
    write('---');

    let sent = 0, failed = 0;

    for (const guest of toSend) {
      try {
        const qrUrl = `${process.env.BASE_URL}/qr/${guest.id}`;
        const html = buildEmail(guest, qrUrl);
        const to = isTest ? process.env.GMAIL_USER : guest.email;

        await transporter.sendMail({
          from: `"Rabbi Benzion Silverman" <${process.env.GMAIL_USER}>`,
          to,
          subject: isTest
            ? `[TEST] ${guest.firstName} ${guest.lastName} — Festival Check-in`
            : `You're in — See you Sunday, ${guest.firstName}!`,
          html
        });

        sent++;
        write(`✓ ${sent}/${toSend.length} — ${guest.firstName} ${guest.lastName} <${isTest ? process.env.GMAIL_USER : guest.email}>`);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        failed++;
        write(`✗ FAILED: ${guest.firstName} ${guest.lastName} — ${err.message}`);
      }
    }

    write('---');
    write(`Done! ${sent} sent, ${failed} failed.`);
    if (isTest) write('\nCheck your inbox. If QR codes look good, click "Send to ALL Guests".');
    res.end();

  } catch (err) {
    write('ERROR: ' + err.message);
    res.end();
  }
});

// ── Email HTML builder (used by send endpoint) ───────────────────────────────
function buildEmail(guest, qrUrl) {
  return `
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#222;">
  <div style="text-align:center;padding:24px 0 8px;">
    <h1 style="font-size:1.6rem;color:#1a1a1a;margin:0;">You're in. See you Sunday.</h1>
    <p style="color:#555;font-size:1rem;margin:8px 0 0;">Rivertowns Jewish Festival · June 14, 2026</p>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
  <p style="font-size:1rem;line-height:1.7;">Dear ${guest.firstName},</p>
  <p style="font-size:1rem;line-height:1.7;">
    We are so excited to welcome you this Sunday to the first-ever Rivertowns Jewish Festival.
    Over 250 families have reserved their spot — and you're one of them.
  </p>
  <p style="font-size:1rem;line-height:1.7;">
    <strong>Your personal check-in code is below.</strong> When you arrive, simply show this
    to our volunteers at the entrance and you'll be checked right in.
  </p>
  <div style="text-align:center;margin:28px 0;">
    <img src="${qrUrl}" width="220" height="220" alt="Your check-in QR code"
         style="border:3px solid #eee;border-radius:12px;padding:8px;">
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
      <tr><td style="padding:6px 0;">🪑</td><td style="padding:6px 0;">Bring a lawn chair — enjoy the music by the river.</td></tr>
      <tr><td style="padding:6px 0;">☀️</td><td style="padding:6px 0;">Bring sunscreen and your appetite.</td></tr>
      <tr><td style="padding:6px 0;">🍽️</td><td style="padding:6px 0;">Israeli street food, Kona Ice, and more. Food available for purchase. Kids activities are free.</td></tr>
      <tr><td style="padding:6px 0;">⏰</td><td style="padding:6px 0;">Arriving around 12:45 means you'll settle in right as the music starts.</td></tr>
    </table>
  </div>
  <p style="font-size:1rem;line-height:1.7;text-align:center;font-style:italic;color:#444;">
    Jewish life here is alive. It is joyful. It is welcoming.<br>
    And this Sunday, we get to celebrate that together.
  </p>
  <p style="font-size:1rem;line-height:1.7;">See you Sunday,</p>
  <p style="font-size:1rem;line-height:1.7;">
    <strong>Rabbi Benzion Silverman</strong><br>
    <span style="color:#777;">Chabad of the Rivertowns</span>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="font-size:0.8rem;color:#aaa;text-align:center;">
    Chabad of the Rivertowns · 303 Broadway, Dobbs Ferry, NY · chabadrt.org
  </p>
</body></html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Festival check-in running on port ${PORT}`));

module.exports = { initGuests };
