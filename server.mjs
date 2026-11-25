import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, createWebSocketStream } from 'ws';

const secret = process.env.MINEHELP_RELAY_KEY;
if (!secret || secret.length < 32 || secret.length > 256 || /\s/.test(secret)) {
  throw new Error('Set MINEHELP_RELAY_KEY to a random secret of 32–256 non-space characters.');
}
const digest = text => createHash('sha256').update(text).digest();
const credential = digest('Bearer ' + secret);
const authorized = req => timingSafeEqual(credential, digest(req.headers.authorization || ''));
const hosts = new Map();
const pending = new Map();
const limit = 128;
const wss = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024, perMessageDeflate: false });

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') return json(res, 200, { ok: true });
  if (req.method !== 'GET' || req.url !== '/v1/hosts') return json(res, 404, {});
  if (!authorized(req)) return json(res, 401, {});
  json(res, 200, [...hosts.values()].filter(host => host.envelope)
    .map(({ id, envelope }) => ({ id, envelope })));
});
function reject(socket, status) {
  socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}
function register(ws, id) {
  const host = { ws, id, sessions: new Set(), envelope: null };
  hosts.set(id, host);
  const deadline = setTimeout(() => ws.terminate(), 10000);
  ws.on('message', (data, binary) => {
    // One RSA-encrypted enrollment envelope and its MAC.
    if (host.envelope || !binary || data.length !== 288) return ws.terminate();
    host.envelope = data.toString('base64');
    clearTimeout(deadline);
  });
  ws.once('close', () => {
    clearTimeout(deadline);
    if (hosts.get(id) === host) hosts.delete(id);
    for (const session of host.sessions) session.close();
  });
}
function requestSession(owner, host) {
  const ticket = randomBytes(24).toString('hex');
  let remote, closed = false;
  const timeout = setTimeout(close, 12000);
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    pending.delete(ticket);
    host.sessions.delete(session);
    owner.terminate();
    remote?.terminate();
  }
  const session = { close, attach };
  function attach(socket) {
    remote = socket;
    clearTimeout(timeout);
    pending.delete(ticket);
    remote.once('close', close);
    owner.off('message', premature);
    // READY is sent before either stream can emit tunneled TLS records.
    owner.send('READY');
    remote.send('READY');
    const left = createWebSocketStream(owner);
    const right = createWebSocketStream(remote);
    left.on('error', close);
    right.on('error', close);
    left.pipe(right);
    right.pipe(left);
  }
  function premature() { close(); }
  owner.once('message', premature);
  owner.once('close', close);
  host.sessions.add(session);
  pending.set(ticket, session);
  host.ws.send(ticket, err => { if (err) close(); });
}
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  if (!authorized(req)) return reject(socket, '401 Unauthorized');
  if (wss.clients.size >= limit * 5) return reject(socket, '503 Service Unavailable');
  const path = /^\/v1\/(host|connect|accept)\/([0-9a-f]+)$/.exec(req.url);
  if (!path) return reject(socket, '404 Not Found');
  const [, role, id] = path;
  const host = hosts.get(id);
  const session = pending.get(id);
  if (role === 'host' && (id.length !== 64 || host || hosts.size >= limit)) return reject(socket, '409 Conflict');
  if (role === 'connect' && (!host?.envelope || host.sessions.size >= 4)) return reject(socket, '503 Service Unavailable');
  if (role === 'accept' && !session) return reject(socket, '404 Not Found');
  wss.handleUpgrade(req, socket, head, ws => {
    ws.alive = true;
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { ws.alive = true; });
    if (role === 'host') register(ws, id);
    else if (role === 'connect') requestSession(ws, host);
    else session.attach(ws);
  });
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    else { ws.alive = false; ws.ping(); }
  }
}, 30000);
server.listen(Number(process.env.PORT || 10000), process.env.BIND_ADDRESS || '0.0.0.0');
process.on('SIGTERM', () => {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.terminate();
  server.close();
});

