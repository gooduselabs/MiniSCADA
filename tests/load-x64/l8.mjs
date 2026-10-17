// L8 of contracts/test-protocols.md §1 (feature 011, T075; SC-008 x64 part): --silent TLS connections from one source
// (the lan address of the client container) that finish the handshake and then send nothing, then a login from
// another source (the pub address) must take <= 2 s; the RSS of mat-runtime may grow by <= 1 MB. Runs in the client
// container of tests/web-it/compose.yaml (PID namespace of rt shared), started by tools/load/x64.mjs.
//   node l8.mjs --fp <fingerprint> [--silent 40] [--hold-s 20]
// Password of the account `admin`: MAT_IT_PW_ADMIN. Prints one JSON line { checks, measures, pass }.
import { readFileSync, readdirSync } from 'node:fs';
import { login, pinnedConnect } from '../../tools/measure/device-api.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const fp = opt('--fp', '');
const silent = Number(opt('--silent', '40'));
const holdS = Number(opt('--hold-s', '20'));
const lanIp = process.env.MAT_IT_LAN_IP;
const pubIp = process.env.MAT_IT_PUB_IP;
const rtLan = lanIp.replace(/\.\d+$/, '.10');
const rtPub = pubIp.replace(/\.\d+$/, '.10');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const measures = {};
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail: detail === undefined ? undefined : String(detail) });

function rssKb() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/cmdline`, 'utf8').startsWith('/build/x64/bin/mat-runtime'))
        return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${d}/status`, 'utf8'))[1]);
    } catch {
      // gone
    }
  }
  return null;
}

try {
  const pw = process.env.MAT_IT_PW_ADMIN;
  const base0 = await login(`https://${rtPub}:8443`, fp, 'admin', pw, { localAddress: pubIp });
  measures.loginBeforeMs = Math.round(base0.handshakeMs + base0.requestMs);
  await sleep(1000);
  const rss0 = rssKb();
  const socks = [];
  let refused = 0;
  for (let i = 0; i < silent; i++) {
    try {
      const c = await pinnedConnect(`https://${rtLan}:8443`, fp, { localAddress: lanIp, timeoutMs: 5000 });
      c.socket.on('error', () => {});
      c.socket.on('end', () => c.socket.destroy());
      c.socket.resume();
      socks.push(c.socket);
    } catch {
      refused++;
    }
  }
  measures.silentOpen = socks.length;
  measures.silentRefused = refused;
  await sleep(2000);
  const t0 = performance.now();
  const r = await login(`https://${rtPub}:8443`, fp, 'admin', pw, { localAddress: pubIp, timeoutMs: 10000 });
  const ms = performance.now() - t0;
  measures.loginWhileSilentMs = Math.round(ms);
  measures.loginStatus = r.status;
  const rss1 = rssKb(); // the silent connections still open (the server closes idle ones later)
  const openNow = socks.filter((s) => !s.destroyed && !s.readableEnded).length;
  await sleep(holdS * 1000);
  measures.rssBeforeKb = rss0;
  measures.rssWithSilentKb = rss1;
  measures.rssDeltaKb = rss1 - rss0;
  measures.silentOpenAtLogin = openNow;
  measures.rssAfterHoldKb = rssKb();
  measures.silentClosedByServerWithinHoldS = socks.filter((s) => s.destroyed || s.readableEnded).length;
  measures.holdS = holdS;
  for (const s of socks) s.destroy();
  check(`${silent} silent TLS connections from one source opened`, socks.length === silent, `${socks.length} open, ${refused} refused`);
  check('login from another source while they are open: 200 in <= 2 s', r.status === 200 && ms <= 2000, `${r.status} in ${Math.round(ms)} ms`);
  check('RSS of mat-runtime grows by <= 1 MB (1024 kB) while they are open', rss1 - rss0 <= 1024, `${rss1 - rss0} kB, ${openNow} open at that time`);
} catch (e) {
  check('scenario ran to the end', false, e.stack ?? String(e));
}
console.log(JSON.stringify({ scenario: 'L8', checks, measures, pass: checks.length > 0 && checks.every((c) => c.pass) }));
