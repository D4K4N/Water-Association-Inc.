const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SECURITY_FILE = path.join(DATA_DIR, 'security.json');
const MASTER_DB_FILE = path.join(DATA_DIR, 'dicklum_master_db.json');

// Ensure data and backup directories exist on the Office PC
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

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
  '.webmanifest': 'application/manifest+json'
};

// Active authenticated session tokens in memory
const activeSessions = new Set();

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

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(String(pin), salt, 10000, 32, 'sha256').toString('hex');
}

function parseCookies(req) {
  const list = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const val = decodeURI(parts.join('='));
    list[key] = val;
  });
  return list;
}

function isRequestAuthenticated(req) {
  const sec = loadSecurityConfig();
  if (!sec || !sec.pinHash) {
    // No PIN created yet -> allow initial setup
    return false;
  }
  const cookies = parseCookies(req);
  const tokenFromCookie = cookies['dwa_session'];
  const tokenFromHeader = req.headers['x-dwa-token'];
  const token = tokenFromHeader || tokenFromCookie;
  return Boolean(token && activeSessions.has(token));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const reqUrl = req.url || '/';
  let reqPath = decodeURI(reqUrl.split('?')[0]);

  // ─── 1. Server-Enforced Login Gate & Office Sync API Routes ───────────────

  if (reqPath === '/api/auth/status' && req.method === 'GET') {
    const sec = loadSecurityConfig();
    const hasPinConfigured = Boolean(sec && sec.pinHash);
    const authenticated = isRequestAuthenticated(req);
    return sendJson(res, 200, {
      hasPinConfigured,
      authenticated,
      hint: sec ? (sec.hint || '') : ''
    });
  }

  if (reqPath === '/api/auth/setup' && req.method === 'POST') {
    try {
      const sec = loadSecurityConfig();
      if (sec && sec.pinHash && !isRequestAuthenticated(req)) {
        return sendJson(res, 403, { error: 'PIN is already configured. Please enter your current PIN to log in.' });
      }
      const body = await readJsonBody(req);
      const pin = String(body.pin || '').trim();
      const hint = String(body.hint || '').trim();
      if (pin.length < 4) {
        return sendJson(res, 400, { error: 'PIN / Password must be at least 4 characters long.' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const pinHash = hashPin(pin, salt);
      saveSecurityConfig({
        salt,
        pinHash,
        hint,
        updatedAt: new Date().toISOString()
      });

      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.add(token);
      return sendJson(
        res,
        200,
        { success: true, token, message: 'Security PIN created and activated!' },
        { 'Set-Cookie': `dwa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000` }
      );
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (reqPath === '/api/auth/login' && req.method === 'POST') {
    try {
      const sec = loadSecurityConfig();
      if (!sec || !sec.pinHash) {
        return sendJson(res, 400, { error: 'No PIN configured yet. Please create a PIN first.' });
      }
      const body = await readJsonBody(req);
      const pin = String(body.pin || '').trim();
      const candidateHash = hashPin(pin, sec.salt);
      if (candidateHash !== sec.pinHash) {
        return sendJson(res, 401, { error: 'Incorrect PIN / Password. Access denied.' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.add(token);
      return sendJson(
        res,
        200,
        { success: true, token },
        { 'Set-Cookie': `dwa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000` }
      );
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  if (reqPath === '/api/auth/change-pin' && req.method === 'POST') {
    try {
      const sec = loadSecurityConfig();
      const body = await readJsonBody(req);
      const currentPin = String(body.currentPin || '').trim();
      const newPin = String(body.newPin || '').trim();
      if (sec && sec.pinHash) {
        const currentHash = hashPin(currentPin, sec.salt);
        if (currentHash !== sec.pinHash) {
          return sendJson(res, 401, { error: 'Current PIN is incorrect.' });
        }
      }
      if (newPin.length < 4) {
        return sendJson(res, 400, { error: 'New PIN must be at least 4 characters.' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const pinHash = hashPin(newPin, salt);
      saveSecurityConfig({
        salt,
        pinHash,
        hint: String(body.hint || '').trim(),
        updatedAt: new Date().toISOString()
      });
      const token = crypto.randomBytes(24).toString('hex');
      activeSessions.add(token);
      return sendJson(
        res,
        200,
        { success: true, token },
        { 'Set-Cookie': `dwa_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000` }
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
        return sendJson(res, 200, { exists: false, data: null });
      }
      const raw = JSON.parse(fs.readFileSync(MASTER_DB_FILE, 'utf8'));
      return sendJson(res, 200, {
        exists: true,
        updatedAt: raw.updatedAt || raw.exportedAt,
        summary: raw.summary || {},
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
      if (!body || !body.data) {
        return sendJson(res, 400, { error: 'Invalid sync payload.' });
      }
      const nowIso = new Date().toISOString();
      const masterRecord = {
        version: 2,
        appName: 'Dicklum Water Association System',
        updatedAt: nowIso,
        exportedAt: body.exportedAt || nowIso,
        summary: {
          consumers: (body.data.consumers || []).length,
          meters: (body.data.meters || []).length,
          clusters: (body.data.clusters || []).length,
          readings: (body.data.readings || []).length,
          bills: (body.data.bills || []).length,
          routes: (body.data.routes || []).length
        },
        data: body.data
      };

      // 1. Write live master database on Office PC hard drive
      fs.writeFileSync(MASTER_DB_FILE, JSON.stringify(masterRecord, null, 2), 'utf8');

      // 2. Write rolling daily snapshot in data/backups/
      const dateStamp = nowIso.slice(0, 10);
      const dailyBackupFile = path.join(BACKUP_DIR, `dicklum_backup_${dateStamp}.json`);
      fs.writeFileSync(dailyBackupFile, JSON.stringify(masterRecord, null, 2), 'utf8');

      return sendJson(res, 200, {
        success: true,
        updatedAt: nowIso,
        syncedAt: nowIso,
        summary: masterRecord.summary,
        counts: masterRecord.summary,
        savedTo: 'data/dicklum_master_db.json'
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Block direct static file access to /data/ directory from outside
  if (reqPath.startsWith('/data/') || reqPath === '/data' || reqPath === '/server.js') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden - Protected Server Storage');
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
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dicklum Water Billing App & Office Sync Server running at http://localhost:${PORT}`);
});
