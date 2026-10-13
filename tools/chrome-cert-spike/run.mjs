import https from 'node:https';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const puppeteer = createRequire('/work/node_modules/x.js')('puppeteer-core');
// [ten, tep cert may chu, khoa, tep tin cay, co tin cay]
const cases = [
  ['leaf SAN dung, P', 'good', 'good', 'P,,'],
  ['leaf SAN IP sai, P', 'badsan', 'badsan', 'P,,'],
  ['leaf chi DNS:localhost, P', 'noext', 'noext', 'P,,'],
  ['khong tin', 'good', 'good', ''],
];
const out = [];
let i = 0;
for (const [label, name, trust, flags] of cases) {
  const port = 9500 + i;
  const home = `/tmp/h${i}`;
  i++;
  const key = fs.readFileSync(`/spike/${name === 'v4' ? 'v4' : name}.key`);
  const crt =
    name === 'v4'
      ? fs.readFileSync('/spike/v4.crt', 'utf8') + fs.readFileSync('/spike/ca.crt', 'utf8')
      : fs.readFileSync(`/spike/${name}.crt`);
  const srv = https
    .createServer({ key, cert: crt }, (q, r) => r.end('<h1>ok</h1>'))
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
      `/spike/${trust}.crt`,
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
