# Rivertowns Jewish Festival — Check-In System

## What this does
1. Reads your reservations CSV
2. Sends each guest a personalized email with a unique QR code
3. Volunteers scan QR codes at the entrance — phone shows green checkmark with guest name
4. Admin dashboard shows live count: "147 / 250 checked in"

---

## Setup (do this once)

### Step 1 — Gmail App Password
Gmail requires an "App Password" for sending via scripts.
1. Go to myaccount.google.com → Security → 2-Step Verification (must be on)
2. Search "App passwords" → create one named "Festival"
3. Copy the 16-character password

### Step 2 — Deploy to Railway
1. Go to railway.app → New Project → Deploy from GitHub repo
   (or drag this folder into Railway's dashboard)
2. Add these environment variables in Railway's dashboard:
   - BASE_URL → your Railway app URL (e.g. https://festival-checkin.railway.app)
   - GMAIL_USER → your Gmail address
   - GMAIL_APP_PASSWORD → the 16-char app password from Step 1
   - ADMIN_PASSWORD → pick something (e.g. festival2026)
   - PORT → 3000

### Step 3 — Add your CSV
Copy your submissions CSV into this folder and name it: submissions.csv

### Step 4 — Test first (important!)
In Railway environment variables, set:
  TEST_MODE=true
  TEST_EMAIL=your@gmail.com

Then run: npm run send

You'll receive 3 test emails at your own address. Check they look right.

### Step 5 — Send for real
Change TEST_MODE=false in Railway, then run: npm run send

Watch the terminal — it logs every email as it sends.

---

## On the day

### Admin dashboard
Open on any phone or laptop:
https://your-app.railway.app/admin?pw=festival2026

Refreshes every 30 seconds automatically.

### Volunteer scanning
Volunteers open their phone camera, point at guest's QR code.
Phone opens the check-in page automatically.

Green screen = checked in ✓
Yellow screen = already scanned (duplicate)
Red screen = not found (direct to welcome table)

### Walk-ins (no reservation)
Direct them to the welcome table to sign in manually.
You can add them to checkins.json directly if needed.

---

## Files
- server.js — the web server (check-in + admin dashboard)
- send-emails.js — reads CSV, generates QR codes, sends emails
- checkins.json — created automatically, stores all check-in data
- .env — your private credentials (never commit this to GitHub)
