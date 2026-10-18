/* Optional local helper for กองดอง (Book Pile).
   Serves the static files and proxies the Thai bookshops that send no CORS
   headers. Nothing here is required: the app falls back to a public reader
   when this is not running, so it is purely a speed-up for local use.

   Run:  node server.js        then open http://localhost:5500
*/

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT) || 5500;
const ROOT = __dirname;

// Only these hosts may be proxied, so this never becomes an open relay.
const ALLOWED_HOSTS = [
  'se-ed.com', 'mebmarket.com', 'naiin.com', 'chulabook.com',
  'b2s.co.th', 'kinokuniya.co.th', 'vajirayana.org',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const isAllowed = (host) =>
  ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

async function proxy(req, res, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return send(res, 400, 'text/plain', 'Bad url');
  }
  if (url.protocol !== 'https:' || !isAllowed(url.hostname)) {
    return send(res, 403, 'text/plain', `Host not allowed: ${url.hostname}`);
  }

  const upstream = AbortSignal.timeout(15000);
  try {
    const r = await fetch(url, {
      signal: upstream,
      headers: {
        // Thai shops serve a stripped page to clients that look like bots.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'th,en;q=0.8',
      },
    });
    const text = await r.text();
    send(res, r.ok ? 200 : r.status, 'text/html; charset=utf-8', text);
  } catch (err) {
    send(res, 504, 'text/plain', `Upstream failed: ${err.name}`);
  }
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  // Keep requests inside the project directory.
  if (!file.startsWith(ROOT)) return send(res, 403, 'text/plain', 'Forbidden');
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, 'text/plain', 'Not found');
  }
}

http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, `http://localhost:${PORT}`);

  if (pathname === '/proxy/ping') return send(res, 200, 'text/plain', 'ok');
  if (pathname === '/proxy') {
    const target = searchParams.get('url');
    if (!target) return send(res, 400, 'text/plain', 'Missing ?url=');
    return proxy(req, res, target);
  }
  return serveStatic(res, pathname);
}).listen(PORT, () => {
  console.log(`กองดอง · Book Pile  →  http://localhost:${PORT}`);
  console.log(`Shop proxy   →  /proxy?url=…  (${ALLOWED_HOSTS.join(', ')})`);
});
