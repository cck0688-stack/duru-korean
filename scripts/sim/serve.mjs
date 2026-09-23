// DURU KOREAN — the site, pointed at the TEST project
//
// The verifier has to look at the real pages running the real code —
// otherwise it is testing a copy — but the pages are hard-wired to the
// live project and the live translation endpoint. This serves the
// repository as it is, with exactly two things swapped:
//
//   /js/supabase-config.js      says the test project, not the live one
//   /api/community-translate    the real handler from api/, run here
//                               with the test project's address
//
// Nothing else is changed, and nothing here is deployed: it exists for
// the length of one verification run on the machine running it.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, simEnv } from './lib.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

export async function startSite(port = 0) {
  const env = simEnv();
  // The handler reads its project from the environment when it is first
  // loaded, so the environment is set before it is.
  process.env.SUPABASE_URL = env.url;
  process.env.SUPABASE_ANON_KEY = env.anon;
  process.env.TRANSLATE_CACHE_SECRET = process.env.SIM_TRANSLATE_CACHE_SECRET || '';
  const { default: translate } = await import('../../api/community-translate.js');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/js/supabase-config.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      res.end('window.DURU_SUPABASE_CONFIG = ' + JSON.stringify({
        url: env.url, anonKey: env.anon, siteUrl: 'http://' + req.headers.host
      }) + ';');
      return;
    }
    if (url.pathname === '/api/community-translate') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const shim = {
          statusCode: 200,
          status(c) { this.statusCode = c; return this; },
          json(o) { res.writeHead(this.statusCode, { 'Content-Type': TYPES['.json'] }); res.end(JSON.stringify(o)); },
          setHeader(k, v) { res.setHeader(k, v); }
        };
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch (e) { /* the handler says so */ }
        Promise.resolve(translate({ method: req.method, headers: req.headers, body }, shim))
          .catch((err) => { res.writeHead(500); res.end(String(err && err.message)); });
      });
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { server, base: 'http://127.0.0.1:' + server.address().port, env };
}
