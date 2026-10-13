import https from 'node:https';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const puppeteer = createRequire('/work/node_modules/x.js')('puppeteer-core');
const pem = fs.readFileSync('/spike/server.pem');
const out = [];
let i = 0;
for (const [label, flags] of [
  ['server.pem of the runtime, trusted as a peer (P,,)', 'P,,'],
  ['not trusted', ''],
]) {
  const port = 9700 + i;
  const home = `/tmp/h${i}`;
  i++;
  const srv = https
    .createServer({ key: pem, cert: pem }, (q, r) => r.end('<h1>ok</h1>'))
    .listen(port, '127.0.0.1');
  fs.mkdirSync(`${home}/.pki/nssdb`, { recursive: true });
  execFileSync('certutil', ['-N', '-d', `sql:${home}/.pki/nssdb`, '--empty-password']);
  if (flags)
    execFileSync('certutil', [
      '-A',
      '-d',
      `sql:${home}/.pki/nssdb`,
      '-n',
      't',
      '-t',
      flags,
      '-i',
      '/tmp/crt.pem',
    ]);
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/chromium-browser',
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', `--user-data-dir=/tmp/ud${i}`],
    env: { ...process.env, HOME: home },
  });
  const p = await b.newPage();
  let res;
  try {
    const r = await p.goto(`https://127.0.0.1:${port}/`, { timeout: 15000 });
    res = 'HTTP ' + r.status();
  } catch (e) {
    res = e.message.split(' at ')[0];
  }
  out.push(`${label}: ${res}`);
  await b.close();
  srv.close();
}
console.log(out.join('\n'));
