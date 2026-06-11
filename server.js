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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Festival check-in running on port ${PORT}`));

module.exports = { initGuests };
