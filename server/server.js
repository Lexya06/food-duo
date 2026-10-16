import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { setupWebSocketServer } from './ws-handler.js';
import { persistence } from './persistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// Pure Node.js HTTP Server (Zero web frameworks)
const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse requested URL
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request');
    return;
  }

  let pathname = parsedUrl.pathname;
  if (pathname === '/') {
    pathname = '/index.html';
  }

  // Normalize path & guard against directory traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback: If requesting HTML or route, fallback to index.html for SPA feel
      if (!path.extname(pathname) || pathname.indexOf('.') === -1) {
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        return serveFile(indexPath, '.html', res);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    serveFile(filePath, ext, res);
  });
});

function serveFile(filePath, ext, res) {
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

// WebSocket Server attached to pure HTTP server
const wss = new WebSocketServer({ server });
setupWebSocketServer(wss);

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`📸  SNAP SAFARI - Multi-Player Real-Time Web Game  📸`);
  console.log(`======================================================`);
  console.log(`Server running at:  http://localhost:${PORT}`);
  console.log(`Network address:    http://${HOST}:${PORT}`);
  console.log(`Frameworks used:    NONE (Pure Node.js + Native WebSockets)`);
  console.log(`Database storage:   data/database.json (Atomic Persistence)`);
  console.log(`Conflict engine:    OCC + 3-Way Merge + Microsecond Arbiter`);
  console.log(`Offline resilience: Session Token + LocalStorage Sync`);
  console.log(`======================================================\n`);
});

// Graceful shutdown handling
function gracefulExit() {
  console.log('\n[Server] Flushing persistent storage before exit...');
  persistence.flushSync();
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Gracefully stopped.');
      process.exit(0);
    });
  });
}

process.on('SIGINT', gracefulExit);
process.on('SIGTERM', gracefulExit);
