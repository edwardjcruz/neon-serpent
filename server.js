const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'leaderboard.json');

function scores() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { return []; }
}
function save(entries) { fs.writeFileSync(DATA, JSON.stringify(entries, null, 2)); }
function top(entries) {
  return entries.sort((a, b) => b.score - a.score || new Date(a.when) - new Date(b.when)).slice(0, 10);
}
function reply(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(body);
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    return reply(res, 200, JSON.stringify(top(scores())));
  }
  if (url.pathname === '/api/leaderboard' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const { name, score } = JSON.parse(raw);
        const cleanName = String(name || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 16);
        const cleanScore = Number(score);
        if (!cleanName || !Number.isInteger(cleanScore) || cleanScore < 1 || cleanScore > 100000) {
          return reply(res, 400, JSON.stringify({ error: 'Invalid score submission.' }));
        }
        const entries = scores();
        const previous = entries.find(e => e.name.toLowerCase() === cleanName.toLowerCase());
        if (previous && previous.score >= cleanScore) return reply(res, 200, JSON.stringify(top(entries)));
        const kept = entries.filter(e => e.name.toLowerCase() !== cleanName.toLowerCase());
        kept.push({ name: cleanName, score: cleanScore, when: new Date().toISOString() });
        save(top(kept));
        reply(res, 201, JSON.stringify(top(kept)));
      } catch { reply(res, 400, JSON.stringify({ error: 'Bad request.' })); }
    });
    return;
  }
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(path.join(PUBLIC, requestPath));
  if (!safePath.startsWith(PUBLIC)) return reply(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(safePath, (error, file) => {
    if (error) return reply(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(safePath);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' };
    reply(res, 200, file, types[ext] || 'application/octet-stream');
  });
}).listen(PORT, () => console.log(`Neon Serpent running at http://localhost:${PORT}`));
