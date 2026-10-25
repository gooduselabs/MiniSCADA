// Máy chủ SMTP giả cho kiểm tích hợp email alarm (feature 023, tools/email-it.ps1): STARTTLS bằng chứng chỉ thử
// (--cert/--key, PEM), AUTH PLAIN/LOGIN với một tài khoản (--user, mật khẩu từ biến môi trường MAT_IT_SMTP_PW), giữ thư
// trong bộ nhớ. Cổng điều khiển HTTP: GET /mails, POST /reset, POST /pause (ngừng nhận kết nối: "mất mạng"),
// POST /resume. Không dùng cho gì khác ngoài thử nghiệm.
//   node fake-smtp.mjs --port 2525 --control 2580 --cert /certs/cert.pem --key /certs/key.pem --user mat
import { readFileSync } from 'node:fs';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'node:net';
import { TLSSocket } from 'node:tls';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const port = Number(opt('--port', '2525'));
const control = Number(opt('--control', '2580'));
const user = opt('--user', 'mat');
const pass = process.env.MAT_IT_SMTP_PW ?? '';
const key = readFileSync(opt('--key', '/certs/key.pem'));
const cert = readFileSync(opt('--cert', '/certs/cert.pem'));

const mails = [];
let connections = 0;
let server = null;
const sockets = new Set();

function session(raw) {
  connections++;
  sockets.add(raw);
  raw.on('close', () => sockets.delete(raw));
  let sock = raw;
  let tls = false;
  let buf = '';
  let mode = 'cmd';
  let authUser = null;
  let loginStep = 0;
  let loginUser = '';
  let mail = null;
  const send = (s) => sock.write(s + '\r\n');
  const onLine = (line) => {
    if (mode === 'data') {
      if (line === '.') {
        mode = 'cmd';
        mails.push({ ...mail, tls, auth: authUser, at: Date.now() });
        mail = null;
        send('250 2.0.0 queued');
        return;
      }
      mail.data += (line.startsWith('.') ? line.slice(1) : line) + '\r\n';
      return;
    }
    if (loginStep === 1) {
      loginUser = Buffer.from(line, 'base64').toString();
      loginStep = 2;
      send('334 UGFzc3dvcmQ6');
      return;
    }
    if (loginStep === 2) {
      loginStep = 0;
      const p = Buffer.from(line, 'base64').toString();
      if (loginUser === user && p === pass && pass) {
        authUser = user;
        send('235 2.7.0 ok');
      } else send('535 5.7.8 bad credentials');
      return;
    }
    const up = line.toUpperCase();
    if (up.startsWith('EHLO') || up.startsWith('HELO')) {
      const ext = ['250-fake-smtp', '250-8BITMIME'];
      if (!tls) ext.push('250-STARTTLS');
      if (tls) ext.push('250-AUTH PLAIN LOGIN');
      ext.push('250 SIZE 1048576');
      send(ext.join('\r\n'));
    } else if (up === 'STARTTLS' && !tls) {
      send('220 2.0.0 ready');
      raw.removeAllListeners('data');
      const t = new TLSSocket(raw, { isServer: true, key, cert });
      sock = t;
      tls = true;
      buf = '';
      t.on('data', onData);
      t.on('error', () => raw.destroy());
    } else if (up.startsWith('AUTH PLAIN')) {
      const parts = Buffer.from(line.slice(11), 'base64').toString().split('\0');
      if (parts[1] === user && parts[2] === pass && pass) {
        authUser = user;
        send('235 2.7.0 ok');
      } else send('535 5.7.8 bad credentials');
    } else if (up === 'AUTH LOGIN') {
      loginStep = 1;
      send('334 VXNlcm5hbWU6');
    } else if (up.startsWith('MAIL FROM:')) {
      if (!tls || !authUser) return send('530 5.7.0 authentication required');
      mail = { from: line.slice(line.indexOf('<') + 1, line.indexOf('>')), to: [], data: '' };
      send('250 2.1.0 ok');
    } else if (up.startsWith('RCPT TO:')) {
      if (!mail) return send('503 5.5.1 MAIL first');
      mail.to.push(line.slice(line.indexOf('<') + 1, line.indexOf('>')));
      send('250 2.1.5 ok');
    } else if (up === 'DATA') {
      if (!mail || !mail.to.length) return send('503 5.5.1 RCPT first');
      mode = 'data';
      send('354 go ahead');
    } else if (up === 'QUIT') {
      send('221 2.0.0 bye');
      sock.end();
    } else if (up === 'RSET' || up === 'NOOP') send('250 ok');
    else send('502 5.5.2 not implemented');
  };
  function onData(d) {
    buf += d.toString('latin1');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = Buffer.from(buf.slice(0, i), 'latin1').toString('utf8');
      buf = buf.slice(i + 2);
      onLine(line);
    }
  }
  raw.on('data', onData);
  raw.on('error', () => {});
  send('220 fake-smtp ESMTP');
}

function listen() {
  server = createServer(session);
  server.listen(port, '0.0.0.0');
}
listen();

httpServer((req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/mails') return reply(200, { connections, mails });
  if (req.method === 'POST' && req.url === '/reset') {
    mails.length = 0;
    return reply(200, { ok: true });
  }
  if (req.method === 'POST' && req.url === '/pause') {
    server?.close();
    server = null;
    for (const s of sockets) s.destroy();
    return reply(200, { ok: true });
  }
  if (req.method === 'POST' && req.url === '/resume') {
    if (!server) listen();
    return reply(200, { ok: true });
  }
  reply(404, { error: 'NOT_FOUND' });
}).listen(control, '0.0.0.0');
console.log(`fake-smtp on :${port}, control :${control}`);
