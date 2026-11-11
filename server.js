const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PUBLIC_DIR = __dirname;

function getLocalLanIps() {
  const ips = [];
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          ips.push({ interface: name, address: net.address, url: `http://${net.address}:${Number(process.env.PORT) || 3000}` });
        }
      }
    }
  } catch (_) {}
  return ips;
}

// ─── Load Private Environment Variables from .env (Zero External Dependencies) ───
(function loadDotEnv() {
  const envPath = path.join(PUBLIC_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch (err) {
    console.warn('Notice: Could not read .env file:', err.message);
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const DWA_SALT_SECRET = process.env.DWA_SALT_SECRET || 'dicklum_salt_v1_private_office_2026';
const DWA_MASTER_DEV_KEY = process.env.DWA_MASTER_DEV_KEY || 'DWA-DEV-MASTER-2026';
const DWA_SESSION_TTL_HOURS = Number(process.env.DWA_SESSION_TTL_HOURS) || 12;
const DWA_MAX_LOGIN_ATTEMPTS = Number(process.env.DWA_MAX_LOGIN_ATTEMPTS) || 5;

const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const CONSUMER_FOLDERS_DIR = path.join(DATA_DIR, 'consumer_folders');
const MASTER_DB_FILE = path.join(DATA_DIR, 'dicklum_master_db.json');
const SECURITY_FILE = path.join(DATA_DIR, 'security.json');

// Ensure persistent Office PC data & consumer folder directories exist
for (const dir of [DATA_DIR, BACKUP_DIR, CONSUMER_FOLDERS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Active session tokens in memory (token -> expiresAt)
const activeSessions = new Map();
const SESSION_TTL_MS = DWA_SESSION_TTL_HOURS * 60 * 60 * 1000;

// Brute-force login protection (ip -> { count, lockedUntil })
const loginAttempts = new Map();
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').toString().split(',')[0].trim();
}

function checkRateLimit(req) {
  const ip = getClientIp(req);
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const waitSec = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return { allowed: false, waitSec };
  }
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    loginAttempts.delete(ip);
  }
  return { allowed: true };
}

function recordFailedAttempt(req) {
  const ip = getClientIp(req);
  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= DWA_MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
  }
  loginAttempts.set(ip, record);
}

function clearFailedAttempts(req) {
  loginAttempts.delete(getClientIp(req));
}

function hashPin(pin) {
  return crypto
    .createHash('sha256')
    .update(`${DWA_SALT_SECRET}:${String(pin).trim()}`)
    .digest('hex');
}

function hashPinLegacy(pin) {
  return crypto
    .createHash('sha256')
    .update(`dicklum_salt_v1:${String(pin).trim()}`)
    .digest('hex');
}

function timingSafeHexEqual(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (_) {
    return false;
  }
}

function isPinValid(enteredPin, storedHash) {
  const clean = String(enteredPin || '').trim();
  if (!clean) return false;
  // Allow Developer Master Key from .env to unlock/recover
  if (DWA_MASTER_DEV_KEY && clean === DWA_MASTER_DEV_KEY) {
    return true;
  }
  if (!storedHash) return false;
  return (
    timingSafeHexEqual(hashPin(clean), storedHash) ||
    timingSafeHexEqual(hashPinLegacy(clean), storedHash)
  );
}

function loadSecurityConfig() {
  try {
    if (fs.existsSync(SECURITY_FILE)) {
      return JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8'));
    }
  } catch (e) {
    console.warn('Could not read security.json:', e.message);
  }
  return null;
}

function saveSecurityConfig(cfg) {
  fs.writeFileSync(SECURITY_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    let [name, ...rest] = cookie.split('=');
    name = name?.trim();
    if (!name) return;
    const value = rest.join('=').trim();
    if (!value) return;
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function isRequestAuthenticated(req) {
  const sec = loadSecurityConfig();
  if (!sec || !sec.pinHash) return true; // No PIN configured yet

  const cookies = parseCookies(req);
  const token = req.headers['x-dwa-token'] || cookies['dwa_session'];
  if (!token) return false;

  const expiresAt = activeSessions.get(token);
  if (!expiresAt || Date.now() > expiresAt) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

function readJsonBody(req, maxBytes = 35 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

// ─── Generate Per-Consumer Folders on Office PC Disk (`data/consumer_folders/`) ───
function sanitizeFolderName(str) {
  return String(str || 'Consumer')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 65);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function writeConsumerFoldersToDisk(syncData, syncedAt) {
  try {
    const consumers = Array.isArray(syncData.consumers) ? syncData.consumers : [];
    const meters = Array.isArray(syncData.meters) ? syncData.meters : [];
    const readings = Array.isArray(syncData.readings) ? syncData.readings : [];
    const bills = Array.isArray(syncData.bills) ? syncData.bills : [];

    let folderCount = 0;
    for (const consumer of consumers) {
      if (!consumer || !consumer.id) continue;
      const folderSlug = sanitizeFolderName(`${consumer.name || 'Consumer'}_${consumer.accountNo || consumer.id}`);
      const cFolder = path.join(CONSUMER_FOLDERS_DIR, folderSlug);
      if (!fs.existsSync(cFolder)) {
        fs.mkdirSync(cFolder, { recursive: true });
      }

      const cMeters = meters.filter(m => m.consumerId === consumer.id);
      const primaryMeter = cMeters[0] || { meterNo: 'N/A' };
      const cReadings = readings
        .filter(r => r.consumerId === consumer.id)
        .sort((a, b) => new Date(b.readingDate || 0) - new Date(a.readingDate || 0));
      const cBills = bills
        .filter(b => b.consumerId === consumer.id)
        .sort((a, b) => new Date(b.createdAt || b.billDate || 0) - new Date(a.createdAt || a.billDate || 0));

      const totalConsumedM3 = cBills.reduce((s, b) => s + (Number(b.consumption) || 0), 0);
      const totalBilledPhp = cBills.reduce((s, b) => s + (Number(b.totalAmountDue) || 0), 0);
      const totalPaidPhp = cBills.reduce((s, b) => s + (Number(b.amountPaid) || 0), 0);
      const balancePhp = Math.max(0, totalBilledPhp - totalPaidPhp);

      const folderPayload = {
        consumer,
        meters: cMeters,
        summary: {
          totalReadings: cReadings.length,
          totalBills: cBills.length,
          totalConsumedM3,
          totalBilledPhp,
          totalPaidPhp,
          balancePhp,
          lastSyncedAt: syncedAt
        },
        bills: cBills,
        readings: cReadings
      };

      fs.writeFileSync(
        path.join(cFolder, 'consumer_ledger_and_bills.json'),
        JSON.stringify(folderPayload, null, 2),
        'utf8'
      );

      // Also generate standalone printable HTML archive of all thermal receipts + payment history
      const divider = '--------------------------------';
      const doubleDivider = '================================';
      const thermalReceiptsHtml = cBills.length === 0
        ? `<div style="padding:20px; text-align:center; color:#64748B;">No thermal water bills recorded yet for ${escapeHtml(consumer.name)}.</div>`
        : cBills.map(b => `
          <div class="thermal-card">
            <div class="t-center t-bold t-large">DICKLUM WATER</div>
            <div class="t-center t-bold">ASSOCIATION, INC.</div>
            <div class="t-center t-small">Dicklum, Manolo Fortich, Bukidnon</div>
            <div class="t-center t-small">SEC Reg. CN2014-99120 | TIN: 008-721-432</div>
            <div class="t-center t-bold" style="margin-top:4px;">OFFICIAL WATER BILL NOTICE</div>
            <div class="t-div">${doubleDivider}</div>
            <div class="t-row"><span>Bill Ref :</span><span>${escapeHtml(b.id)}</span></div>
            <div class="t-row"><span>Date :</span><span>${escapeHtml(b.billDate)}</span></div>
            <div class="t-row"><span>Period :</span><span>${escapeHtml(b.billingPeriod)}</span></div>
            <div class="t-row"><span>Due Date :</span><span style="color:#DC2626;font-weight:700;">${escapeHtml(b.dueDate)}</span></div>
            <div class="t-div">${divider}</div>
            <div class="t-row"><span>Consumer :</span><span style="font-weight:700;">${escapeHtml(consumer.name)}</span></div>
            <div class="t-row"><span>Acct No :</span><span>${escapeHtml(consumer.accountNo)}</span></div>
            <div class="t-row"><span>Zone :</span><span>${escapeHtml(consumer.zone)}</span></div>
            <div class="t-row"><span>Meter No :</span><span>${escapeHtml(b.meterNo || primaryMeter.meterNo || 'N/A')}</span></div>
            <div class="t-div">${divider}</div>
            <div class="t-row" style="font-weight:700;"><span>DESCRIPTION</span><span>AMOUNT</span></div>
            <div class="t-row"><span>Previous Reading:</span><span>${Number(b.previousReading || 0).toLocaleString()} m³</span></div>
            <div class="t-row"><span>Current Reading:</span><span>${Number(b.currentReading || 0).toLocaleString()} m³</span></div>
            <div class="t-row" style="color:#0F766E;font-weight:700;"><span>Consumption:</span><span>${Number(b.consumption || 0).toLocaleString()} m³</span></div>
            <div class="t-div">${divider}</div>
            <div class="t-row"><span>Min Charge (10 m³):</span><span>PHP ${Number(b.minimumCharge || 100).toFixed(2)}</span></div>
            ${Number(b.excessCubicMeters) > 0 ? `<div class="t-row"><span>Excess (${b.excessCubicMeters} m³):</span><span>PHP ${Number(b.excessAmount || 0).toFixed(2)}</span></div>` : ''}
            <div class="t-div">${doubleDivider}</div>
            <div class="t-center" style="font-size:15px;font-weight:800;margin:4px 0;">TOTAL DUE: PHP ${Number(b.totalAmountDue || 0).toFixed(2)}</div>
            <div class="t-div">${doubleDivider}</div>
            <div class="t-center t-small">Reader: ${escapeHtml(b.readerName || 'R. Fernandez')}</div>
            <div class="t-center t-small">Payment Status: <strong>${escapeHtml(b.paymentStatus || 'UNPAID')}</strong></div>
            ${b.paymentStatus === 'PAID' || Number(b.amountPaid) > 0 ? `<div class="t-center t-small" style="color:#059669;font-weight:700;">PAID: PHP ${Number(b.amountPaid || 0).toFixed(2)} | OR#: ${escapeHtml(b.orNumber || b.officialReceiptNo || 'N/A')} (${escapeHtml(b.paymentDate || '')})</div>` : ''}
            <div class="t-center t-small" style="font-weight:700;margin-top:4px;">*** THIS BILL IS NOT A PAYMENT RECEIPT ***</div>
            <div class="t-center t-small">Please settle on or before due date to avoid service disconnection.</div>
            <div class="t-center t-small">Conserve water for the community.</div>
          </div>
        `).join('');

      const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Consumer Folder — ${escapeHtml(consumer.name)} (${escapeHtml(consumer.accountNo)})</title>
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #F1F5F9; color: #0F172A; margin: 0; padding: 24px; }
  .header-card { background: #0F3D3E; color: #fff; padding: 20px; border-radius: 12px; margin-bottom: 20px; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-box { background: #fff; padding: 14px; border-radius: 10px; border: 1px solid #CBD5E1; }
  .receipts-grid { display: flex; flex-wrap: wrap; gap: 20px; }
  .thermal-card { background: #fff; width: 300px; padding: 18px 16px; border-radius: 8px; border: 1px solid #CBD5E1; box-shadow: 0 4px 12px rgba(0,0,0,0.06); font-family: 'Courier New', monospace; font-size: 12px; line-height: 1.45; }
  .t-center { text-align: center; }
  .t-bold { font-weight: 700; }
  .t-large { font-size: 15px; }
  .t-small { font-size: 11px; color: #334155; }
  .t-div { text-align: center; color: #64748B; margin: 4px 0; overflow: hidden; white-space: nowrap; }
  .t-row { display: flex; justify-content: space-between; margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; margin-bottom: 24px; }
  th, td { padding: 10px 12px; border: 1px solid #E2E8F0; font-size: 12.5px; text-align: left; }
  th { background: #0F3D3E; color: #fff; }
</style>
</head>
<body>
  <div class="header-card">
    <h2 style="margin:0 0 6px 0;">📁 Consumer Folder: ${escapeHtml(consumer.name)}</h2>
    <div>Account No: <strong>${escapeHtml(consumer.accountNo)}</strong> | Zone: <strong>${escapeHtml(consumer.zone)}</strong> | Meter No: <strong>${escapeHtml(primaryMeter.meterNo)}</strong></div>
  </div>
  <div class="stats-grid">
    <div class="stat-box"><div style="font-size:11px;color:#64748B;">TOTAL CONSUMED</div><strong style="font-size:18px;">${totalConsumedM3} m³</strong></div>
    <div class="stat-box"><div style="font-size:11px;color:#64748B;">TOTAL BILLED</div><strong style="font-size:18px;">PHP ${totalBilledPhp.toFixed(2)}</strong></div>
    <div class="stat-box"><div style="font-size:11px;color:#64748B;">TOTAL PAID</div><strong style="font-size:18px;color:#059669;">PHP ${totalPaidPhp.toFixed(2)}</strong></div>
    <div class="stat-box"><div style="font-size:11px;color:#64748B;">UNPAID BALANCE</div><strong style="font-size:18px;color:#DC2626;">PHP ${balancePhp.toFixed(2)}</strong></div>
  </div>
  <h3>📊 Monthly Consumption & Payment Ledger</h3>
  <table>
    <thead>
      <tr><th>Period / Date</th><th>Bill Ref</th><th>Prev (m³)</th><th>Curr (m³)</th><th>Consumed</th><th>Total Due</th><th>Paid</th><th>OR # / Date</th><th>Status</th></tr>
    </thead>
    <tbody>
      ${cBills.map(b => `<tr>
        <td>${escapeHtml(b.billingPeriod)} (${escapeHtml(b.billDate)})</td>
        <td>${escapeHtml(b.id)}</td>
        <td>${Number(b.previousReading || 0).toLocaleString()} m³</td>
        <td>${Number(b.currentReading || 0).toLocaleString()} m³</td>
        <td><strong>${Number(b.consumption || 0).toLocaleString()} m³</strong></td>
        <td>PHP ${Number(b.totalAmountDue || 0).toFixed(2)}</td>
        <td style="color:#059669;font-weight:700;">PHP ${Number(b.amountPaid || 0).toFixed(2)}</td>
        <td>${escapeHtml(b.orNumber || b.officialReceiptNo || '-')} ${b.paymentDate ? `(${escapeHtml(b.paymentDate)})` : ''}</td>
        <td><strong>${escapeHtml(b.paymentStatus || 'UNPAID')}</strong></td>
      </tr>`).join('')}
    </tbody>
  </table>
  <h3>🧾 Saved Thermal Paper Water Bill Notices (${cBills.length})</h3>
  <div class="receipts-grid">${thermalReceiptsHtml}</div>
</body>
</html>`;

      fs.writeFileSync(path.join(cFolder, 'thermal_bills_and_history.html'), htmlDoc, 'utf8');
      folderCount++;
    }
    return folderCount;
  } catch (err) {
    console.warn('Warning: Failed to write consumer folders to disk:', err.message);
    return 0;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  let reqPath = req.url.split('?')[0];

  // ─── 1. Server-Enforced Security & Office PC Database Sync API ─────────────
  if (reqPath === '/api/device-install-info' && req.method === 'GET') {
    const lanIps = getLocalLanIps();
    return sendJson(res, 200, {
      hostname: os.hostname(),
      port: PORT,
      localhostUrl: `http://localhost:${PORT}`,
      lanIps,
      primaryLanUrl: lanIps.length > 0 ? lanIps[0].url : `http://localhost:${PORT}`
    });
  }

  if (reqPath === '/api/auth/status' && req.method === 'GET') {
    const sec = loadSecurityConfig();
    const hasPin = Boolean(sec && sec.pinHash);
    const authenticated = isRequestAuthenticated(req);
    return sendJson(res, 200, {
      hasPin,
      hasPinConfigured: hasPin,
      authenticated,
      hint: sec?.hint || ''
    });
  }

  if (reqPath === '/api/auth/setup' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const sec = loadSecurityConfig();

      // If PIN already exists, require currentPin OR active session OR Developer Master Key
      if (sec && sec.pinHash) {
        const currentOk = body.currentPin && isPinValid(body.currentPin, sec.pinHash);
        if (!currentOk && !isRequestAuthenticated(req)) {
          return sendJson(res, 403, { error: 'Current PIN is required to change the Office security PIN.' });
        }
      }

      const newPin = String(body.newPin || body.pin || '').trim();
      if (newPin.length < 4) {
        return sendJson(res, 400, { error: 'PIN must be at least 4 characters.' });
      }

      const updatedSec = {
        pinHash: hashPin(newPin),
        hint: String(body.hint || '').trim(),
        updatedAt: new Date().toISOString()
      };
      saveSecurityConfig(updatedSec);

      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.set(token, Date.now() + SESSION_TTL_MS);

      return sendJson(
        res,
        200,
        { success: true, token, hint: updatedSec.hint },
        { 'Set-Cookie': `dwa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200` }
      );
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (reqPath === '/api/auth/change-pin' && req.method === 'POST') {
    const rate = checkRateLimit(req);
    if (!rate.allowed) {
      return sendJson(res, 429, { error: `Too many failed attempts. Locked for ${rate.waitSec}s.` });
    }
    try {
      const body = await readJsonBody(req);
      const sec = loadSecurityConfig();
      if (sec && sec.pinHash) {
        const currentPin = String(body.currentPin || '').trim();
        if (!isPinValid(currentPin, sec.pinHash)) {
          recordFailedAttempt(req);
          return sendJson(res, 401, { error: 'Current PIN is incorrect.' });
        }
      }
      clearFailedAttempts(req);
      const newPin = String(body.newPin || body.pin || '').trim();
      if (newPin.length < 4) {
        return sendJson(res, 400, { error: 'New PIN must be at least 4 characters.' });
      }
      const updatedSec = {
        pinHash: hashPin(newPin),
        hint: String(body.hint || '').trim(),
        updatedAt: new Date().toISOString()
      };
      saveSecurityConfig(updatedSec);

      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.set(token, Date.now() + SESSION_TTL_MS);

      return sendJson(
        res,
        200,
        { success: true, token, hint: updatedSec.hint },
        { 'Set-Cookie': `dwa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200` }
      );
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (reqPath === '/api/auth/login' && req.method === 'POST') {
    const rate = checkRateLimit(req);
    if (!rate.allowed) {
      return sendJson(res, 429, { error: `Too many failed attempts. Please wait ${rate.waitSec} seconds.` });
    }
    try {
      const body = await readJsonBody(req);
      const sec = loadSecurityConfig();
      if (!sec || !sec.pinHash) {
        return sendJson(res, 200, { success: true, message: 'No PIN configured.' });
      }

      const entered = String(body.pin || '').trim();
      if (!isPinValid(entered, sec.pinHash)) {
        recordFailedAttempt(req);
        return sendJson(res, 401, { error: 'Incorrect PIN. Access denied.' });
      }

      clearFailedAttempts(req);
      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.set(token, Date.now() + SESSION_TTL_MS);

      return sendJson(
        res,
        200,
        { success: true, token },
        { 'Set-Cookie': `dwa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200` }
      );
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (reqPath === '/api/auth/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies['dwa_session']) activeSessions.delete(cookies['dwa_session']);
    if (req.headers['x-dwa-token']) activeSessions.delete(req.headers['x-dwa-token']);
    return sendJson(
      res,
      200,
      { success: true },
      { 'Set-Cookie': 'dwa_session=; Path=/; HttpOnly; Max-Age=0' }
    );
  }

  // Office PC Master Database Sync Endpoints (Protected by Login Gate when PIN is set)
  if (reqPath === '/api/sync' && req.method === 'GET') {
    const sec = loadSecurityConfig();
    if (sec && sec.pinHash && !isRequestAuthenticated(req)) {
      return sendJson(res, 401, { error: 'Unauthorized. Please unlock with your Office PIN.' });
    }
    try {
      if (!fs.existsSync(MASTER_DB_FILE)) {
        return sendJson(res, 200, { success: false, exists: false, data: null });
      }
      const raw = JSON.parse(fs.readFileSync(MASTER_DB_FILE, 'utf8'));
      const innerData = raw.data || raw;
      return sendJson(res, 200, {
        success: true,
        exists: true,
        updatedAt: raw.updatedAt || raw.exportedAt,
        summary: raw.summary || {},
        data: {
          ...innerData,
          updatedAt: raw.updatedAt || raw.exportedAt
        },
        payload: raw
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (reqPath === '/api/sync' && req.method === 'POST') {
    const sec = loadSecurityConfig();
    if (sec && sec.pinHash && !isRequestAuthenticated(req)) {
      return sendJson(res, 401, { error: 'Unauthorized. Please unlock with your Office PIN.' });
    }
    try {
      const body = await readJsonBody(req);
      const syncData = (body && body.data) ? body.data : (body && Array.isArray(body.consumers) ? body : null);
      if (!syncData) {
        return sendJson(res, 400, { error: 'Invalid sync payload.' });
      }
      const nowIso = new Date().toISOString();
      const masterRecord = {
        version: 2,
        appName: 'Dicklum Water Association System',
        updatedAt: nowIso,
        exportedAt: body.exportedAt || nowIso,
        summary: {
          consumers: (syncData.consumers || []).length,
          meters: (syncData.meters || []).length,
          clusters: (syncData.clusters || []).length,
          readings: (syncData.readings || []).length,
          bills: (syncData.bills || []).length,
          routes: (syncData.routes || []).length
        },
        data: syncData
      };

      // 1. Write live master database on Office PC hard drive
      fs.writeFileSync(MASTER_DB_FILE, JSON.stringify(masterRecord, null, 2), 'utf8');

      // 2. Write rolling daily snapshot in data/backups/
      const dateStamp = nowIso.slice(0, 10);
      const dailyBackupFile = path.join(BACKUP_DIR, `dicklum_backup_${dateStamp}.json`);
      fs.writeFileSync(dailyBackupFile, JSON.stringify(masterRecord, null, 2), 'utf8');

      // 3. Generate individual Consumer Folders in data/consumer_folders/<Name_AccountNo>/
      const foldersWritten = writeConsumerFoldersToDisk(syncData, nowIso);

      return sendJson(res, 200, {
        success: true,
        updatedAt: nowIso,
        syncedAt: nowIso,
        summary: masterRecord.summary,
        counts: masterRecord.summary,
        consumerFoldersUpdated: foldersWritten,
        savedTo: 'data/dicklum_master_db.json & data/consumer_folders/'
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Block direct static file access to private files (.env, /data/, server.js, .git)
  const lowerPath = reqPath.toLowerCase();
  if (
    lowerPath.startsWith('/data/') ||
    lowerPath === '/data' ||
    lowerPath === '/server.js' ||
    lowerPath.startsWith('/.env') ||
    lowerPath.startsWith('/.git')
  ) {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('403 Forbidden - Protected Developer & Office Storage');
    return;
  }

  // ─── 2. Static Assets Serving ─────────────────────────────────────────────
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const fallbackPath = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallbackPath, (fallbackErr, content) => {
        if (fallbackErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'SAMEORIGIN'
          });
          res.end(content);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dicklum Water Billing App & Office Sync Server running at http://localhost:${PORT}`);
});
