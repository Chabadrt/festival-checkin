require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { initGuests } = require('./server');

const CSV_PATH = process.env.CSV_PATH || './submissions.csv';
const BASE_URL = process.env.BASE_URL || 'https://your-app.railway.app';

// ── Email transport ──────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ── Read & deduplicate CSV ───────────────────────────────────────────────────
function loadGuests() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  // Deduplicate: keep latest submission per email
  const byEmail = {};
  records.forEach(r => {
    const email = (r.contactEmail || '').trim().toLowerCase();
    if (!email) return;
    const existing = byEmail[email];
    if (!existing || r.SubmissionId > existing.SubmissionId) {
      byEmail[email] = r;
    }
  });

  return Object.values(byEmail).map(r => ({
    id: r.SubmissionId,
    firstName: (r.firstName || '').trim(),
    lastName: (r.lastName || '').trim(),
    email: (r.contactEmail || '').trim(),
    city: (r.contactCity || '').trim()
  })).filter(g => g.email && g.firstName);
}

// ── Generate QR code image URL (served by Railway) ──────────────────────────
function generateQR(id) {
  return `${BASE_URL}/qr/${id}`;
}

// ── Build email HTML ─────────────────────────────────────────────────────────
function buildEmail(guest, qrDataUrl) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
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
    <img src="${qrDataUrl}" width="220" height="220" alt="Your check-in QR code"
         style="border:3px solid #eee;border-radius:12px;padding:8px;">
    <div style="font-size:0.8rem;color:#aaa;margin-top:8px;">Check-in code for ${guest.firstName} ${guest.lastName}</div>
  </div>

  <div style="background:#f9f9f9;border-radius:10px;padding:20px;margin:24px 0;">
    <h2 style="font-size:1rem;margin:0 0 12px;color:#444;">Everything you need to know:</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;width:28px;">📅</td><td style="padding:6px 0;"><strong>Sunday, June 14</strong></td></tr>
      <tr><td style="padding:6px 0;">📍</td><td style="padding:6px 0;">Dobbs Ferry Waterfront Park</td></tr>
      <tr><td style="padding:6px 0;">🕐</td><td style="padding:6px 0;">1:00–3:00 PM</td></tr>
      <tr><td style="padding:6px 0;">🅿️</td><td style="padding:6px 0;">Plenty of parking right by the park. Police have confirmed no ticketing in the area.</td></tr>
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

</body>
</html>
  `;
}

// ── Send one email ───────────────────────────────────────────────────────────
async function sendEmail(guest, html) {
  await transporter.sendMail({
    from: `"Rabbi Benzion Silverman" <${process.env.GMAIL_USER}>`,
    to: guest.email,
    subject: `You're in — See you Sunday, ${guest.firstName}!`,
    html
  });
}

// ── Main: load, init DB, send emails ────────────────────────────────────────
async function main() {
  const guests = loadGuests();
  console.log(`Loaded ${guests.length} unique guests from CSV.`);

  // Initialize check-in database
  initGuests(guests);
  console.log('Database initialized.');

  const TEST_MODE = process.env.TEST_MODE === 'true';
  const TEST_EMAIL = process.env.TEST_EMAIL || process.env.GMAIL_USER;

  if (TEST_MODE) {
    console.log(`\nTEST MODE — sending all emails to ${TEST_EMAIL}`);
  }

  let sent = 0;
  let failed = 0;

  for (const guest of guests) {
    try {
      const qrUrl = generateQR(guest.id);
      const html = buildEmail(guest, qrUrl);

      if (TEST_MODE) {
        // In test mode, send first 3 to your own email
        if (sent >= 3) { sent++; continue; }
        await transporter.sendMail({
          from: `"Rabbi Benzion Silverman" <${process.env.GMAIL_USER}>`,
          to: TEST_EMAIL,
          subject: `[TEST] ${guest.firstName} ${guest.lastName} — Festival Check-in`,
          html
        });
      } else {
        await sendEmail(guest, html);
      }

      sent++;
      console.log(`✓ ${sent}/${guests.length} — ${guest.firstName} ${guest.lastName} <${guest.email}>`);

      // Small delay to avoid Gmail rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      failed++;
      console.error(`✗ Failed: ${guest.firstName} ${guest.lastName} <${guest.email}> — ${err.message}`);
    }
  }

  console.log(`\nDone. ${sent} sent, ${failed} failed.`);
}

main().catch(console.error);
