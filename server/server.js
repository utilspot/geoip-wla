'use strict';

/**
 * GeoIP emulation server.
 *
 * Purpose: stand in for the real GeoIP service (which will use the
 * `geoip-api-c` library, https://github.com/maxmind/geoip-api-c) while the UI is
 * developed. It returns a hardcoded JSON response chosen from a list of presets.
 * The active preset is changed at runtime from `admin.html`.
 *
 * No npm dependencies — Node's built-in `http`/`fs` only.
 *
 *   GET  /                     -> static client files from ../dist
 *   POST /lookup               -> { ip } ... current preset's JSON response
 *   GET  /lookup?ip=...        -> same, for quick curl testing
 *   GET  /admin.html           -> admin page (this folder)
 *   GET  /api/admin/presets    -> all presets + which one is active
 *   GET  /api/admin/state      -> active preset id + its response
 *   POST /api/admin/state      -> { preset } ... switch the active preset
 *   GET  /api/health           -> liveness probe
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { presets, DEFAULT_PRESET_ID } = require('./presets');

const PORT = Number(process.env.PORT) || 8787;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const ADMIN_HTML = path.join(__dirname, 'admin.html');

// In-memory state: the id of the preset currently being served.
// Resets to the default on restart.
let currentPresetId = DEFAULT_PRESET_ID;

const getPreset = (id) => presets.find((p) => p.id === id) || null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  setCors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

/** Build the GeoIP response for the active preset, echoing back the address. */
function buildGeoipResponse(ip) {
  const preset = getPreset(currentPresetId) || getPreset(DEFAULT_PRESET_ID);
  // Deep clone so the frozen preset definitions are never mutated.
  const resp = JSON.parse(JSON.stringify(preset.response));
  return { ip: ip || null, preset: preset.id, ...resp };
}

function serveFile(res, absPath, fallbackStatusText) {
  fs.readFile(absPath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: fallbackStatusText });
      return;
    }
    setCors(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(absPath)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Resolve within DIST_DIR and reject path traversal.
  const abs = path.normalize(path.join(DIST_DIR, rel));
  if (abs !== DIST_DIR && !abs.startsWith(DIST_DIR + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  fs.readFile(abs, (err, data) => {
    if (err) {
      const built = fs.existsSync(path.join(DIST_DIR, 'index.html'));
      sendJson(res, 404, {
        error: built
          ? `Not found: ${rel}`
          : 'dist/ is not built yet — run "npm run build", then reload.',
      });
      return;
    }
    setCors(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = req.url || '/';
  const pathname = url.split('?')[0];

  if (method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // --- GeoIP lookup (used by the UI) ---
    if (pathname === '/lookup' && method === 'POST') {
      const body = await parseJsonBody(req);
      const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
      sendJson(res, 200, buildGeoipResponse(ip));
      return;
    }
    if (pathname === '/lookup' && method === 'GET') {
      const q = new URL(url, 'http://localhost').searchParams;
      sendJson(res, 200, buildGeoipResponse((q.get('ip') || '').trim()));
      return;
    }

    // --- Admin API ---
    if (pathname === '/api/admin/presets' && method === 'GET') {
      sendJson(res, 200, {
        current: currentPresetId,
        presets: presets.map((p) => ({
          id: p.id,
          label: p.label,
          description: p.description,
          response: p.response,
        })),
      });
      return;
    }
    if (pathname === '/api/admin/state' && method === 'GET') {
      const preset = getPreset(currentPresetId);
      sendJson(res, 200, {
        current: currentPresetId,
        response: preset ? preset.response : null,
      });
      return;
    }
    if (pathname === '/api/admin/state' && method === 'POST') {
      const body = await parseJsonBody(req);
      const id = typeof body.preset === 'string' ? body.preset : '';
      if (!getPreset(id)) {
        sendJson(res, 400, {
          error: `Unknown preset: ${JSON.stringify(id)}`,
          available: presets.map((p) => p.id),
        });
        return;
      }
      currentPresetId = id;
      console.log(`[admin] active preset -> ${currentPresetId}`);
      sendJson(res, 200, {
        ok: true,
        current: currentPresetId,
        response: getPreset(id).response,
      });
      return;
    }

    // --- Admin page (part of the server, lives in this folder) ---
    if (pathname === '/admin.html' || pathname === '/admin') {
      serveFile(res, ADMIN_HTML, 'admin.html is missing');
      return;
    }

    if (pathname === '/api/health') {
      sendJson(res, 200, { ok: true, current: currentPresetId });
      return;
    }

    // --- Static client files ---
    if (method === 'GET') {
      serveStatic(res, pathname);
      return;
    }

    sendJson(res, 404, { error: `Cannot ${method} ${pathname}` });
  } catch (err) {
    sendJson(res, 400, {
      error: err instanceof Error ? err.message : 'Bad request',
    });
  }
});

server.listen(PORT, () => {
  const origin = `http://localhost:${PORT}`;
  console.log('GeoIP emulation server (emulates geoip-api-c)');
  console.log(`  UI     : ${origin}/            (serves ../dist)`);
  console.log(`  Admin  : ${origin}/admin.html`);
  console.log(`  Lookup : POST ${origin}/lookup   body: { "ip": "8.8.8.8" }`);
  console.log(`  Preset : ${currentPresetId}`);
});
