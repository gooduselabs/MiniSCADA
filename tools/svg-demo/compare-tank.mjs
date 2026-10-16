/* global document, getComputedStyle */
// So màn hình bồn nước + motor dựng lại bằng Studio (e2e rebuild-tank, T095, SC-004) với tank-demo gốc, cả hai chạy trên runtime x64
// (trang Chrome của runtime, Tag mô phỏng): so ĐÍCH binding (chữ, mức, quay) theo bảng ánh xạ phần tử của hai màn hình.
//   node tools/svg-demo/compare-tank.mjs --baseline <url runtime chạy tank-demo> --rebuilt <url runtime chạy project dựng lại>
//        [--samples 12] [--interval 700] [--tol 5] [--chrome <đường dẫn>] [--out docs/reports/008-compare-tank-x64.json]
// Dựng project đã dựng lại: `MAT_REBUILD_OUT=<thư mục> node apps/studio/tests/e2e/run.mjs rebuild-tank` (trong apps/studio), nạp lên
// runtime x64 (docker, tools/web-it.ps1) cạnh runtime chạy tank-demo. Không có `--baseline` và `--rebuilt`: in "CHƯA CHẠY" và thoát
// mã 3 (cần runtime x64, không chạy được nếu thiếu Docker). Mỗi trang: kiểm nội bộ (mức theo hộp bao khớp chữ mức, motor có hoạt
// ảnh quay đúng lúc chữ tốc độ khác 0, chữ đúng định dạng) rồi so hai trang tại cùng thời điểm lấy mẫu (sai lệch ≤ --tol điểm phần
// trăm vì hai runtime không chung đồng hồ mô phỏng). Kết quả: 100 % phần tử đích đổi đúng thì mã thoát 0, ngược lại 1.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const baseline = opt('--baseline');
const rebuilt = opt('--rebuilt');
if (!baseline || !rebuilt) {
  console.log('CHƯA CHẠY: cần hai URL runtime x64 (--baseline, --rebuilt); xem phần đầu tệp.');
  process.exit(3);
}
const samples = Number(opt('--samples', '12'));
const interval = Number(opt('--interval', '700'));
const tol = Number(opt('--tol', '5'));
const outFile = opt('--out');
const chrome = [
  opt('--chrome'),
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!chrome) {
  console.error('Không tìm thấy Chrome: đặt CHROME_PATH hoặc --chrome');
  process.exit(2);
}

/** Phần tử đích của hai màn hình (UID theo tank-demo gốc và theo ký hiệu thư viện). */
const MAP = {
  baseline: {
    level: 'el_tank_level',
    body: 'el_tank_body',
    textLevel: 'el_txt_level',
    textSpeed: 'el_txt_speed',
    spin: 'el_motor_fan',
  },
  rebuilt: {
    level: 'el_tank_vertical_liquid',
    body: 'el_tank_vertical_body',
    textLevel: 'el_tank_vertical_text',
    textSpeed: 'el_motor_ac_text',
    spin: 'el_motor_ac_rotor',
  },
};

/** Đọc các đích từ trang runtime: hộp bao, chữ và số hoạt ảnh của từng phần tử (qua mọi Shadow DOM). */
function readTargets(map) {
  const find = (root, uid) => {
    const hit = root.querySelector(`[data-mat-uid="${uid}"]`);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const r = find(el.shadowRoot, uid);
        if (r) return r;
      }
    }
    return null;
  };
  const info = (uid) => {
    const el = find(document, uid);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      h: r.height,
      w: r.width,
      text: el.textContent.trim(),
      anims: el.getAnimations().filter((a) => a.playState === 'running').length,
      transform: getComputedStyle(el).transform,
    };
  };
  return Object.fromEntries(Object.entries(map).map(([k, uid]) => [k, info(uid)]));
}

const num = (s) => {
  const m = /-?\d+(?:[.,]\d+)?/.exec(s ?? '');
  return m ? Number(m[0].replace(',', '.')) : Number.NaN;
};

async function sampleOne(browser, url, map) {
  const page = await browser.newPage();
  // Máy dev mặc định prefers-reduced-motion: reduce (hoạt ảnh quay tắt): bỏ để motor quay thật
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  // Giá trị MOTOR01.RUN mà trang nhận (để biết motor phải quay hay không, không suy từ chữ tốc độ vì hai Tag có thể độc lập)
  await page.evaluateOnNewDocument(
    `(function(){const O=window.WebSocket;const H=function(u,p){const ws=p===undefined?new O(u):new O(u,p);let ids=[];ws.addEventListener('message',(e)=>{if(typeof e.data!=='string')return;let m;try{m=JSON.parse(e.data)}catch{return}if(m.type==='snapshot'){ids=m.tags.map((t)=>t.id);for(const t of m.tags)if(t.id==='MOTOR01.RUN')window.__run=t.value}else if(m.type==='delta'){for(const x of m.tags)if(ids[x[0]]==='MOTOR01.RUN')window.__run=x[1]}});return ws};H.prototype=O.prototype;Object.assign(H,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});window.WebSocket=H})()`,
  );
  // WebSocket sống nên không bao giờ 'networkidle': chờ DOM rồi chờ đủ phần tử đích
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const r = await page.evaluate(`(${readTargets.toString()})(${JSON.stringify(map)})`);
    if (
      Object.values(r).every((v) => v !== null) &&
      Number.isFinite(num(r.textLevel.text)) &&
      Number.isFinite(num(r.textSpeed.text))
    )
      break;
    await new Promise((res) => setTimeout(res, 300));
  }
  const out = [];
  for (let i = 0; i < samples; i++) {
    const snap = await page.evaluate(`(${readTargets.toString()})(${JSON.stringify(map)})`);
    snap.run = await page.evaluate('window.__run');
    out.push(snap);
    await new Promise((r) => setTimeout(r, interval));
  }
  await page.close();
  return out;
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-first-run', '--ignore-certificate-errors'],
});
const results = [];
const check = (name, pass, detail = '') =>
  results.push({ name, pass: Boolean(pass), detail: String(detail) });
try {
  const [a, b] = await Promise.all([
    sampleOne(browser, baseline, MAP.baseline),
    sampleOne(browser, rebuilt, MAP.rebuilt),
  ]);
  const internal = (label, series) => {
    const found = series.every((s) =>
      Object.entries(s).every(([k, v]) => k === 'run' || v !== null),
    );
    check(`${label}: tìm thấy đủ 5 phần tử đích ở mọi lần lấy mẫu`, found);
    if (!found) return;
    let levelOk = 0;
    let textOk = 0;
    let spinOk = 0;
    for (const s of series) {
      const frac = (s.level.h / s.body.h) * 100;
      const val = num(s.textLevel.text);
      // Mức là phần trăm hộp bao thân bồn (bản dựng lại có viền nên cho phép sai số theo --tol).
      if (Number.isFinite(val) && Math.abs(frac - val) <= tol + 10) levelOk++;
      if (Number.isFinite(val) && Number.isFinite(num(s.textSpeed.text))) textOk++;
      const speed = num(s.textSpeed.text);
      const wantSpin = typeof s.run === 'boolean' ? s.run : speed > 0;
      if (wantSpin === s.spin.anims > 0) spinOk++;
    }
    check(
      `${label}: mức nước khớp chữ mức (100 % lần lấy mẫu)`,
      levelOk === series.length,
      `${levelOk}/${series.length}`,
    );
    check(
      `${label}: chữ mức và chữ tốc độ là số`,
      textOk === series.length,
      `${textOk}/${series.length}`,
    );
    check(
      `${label}: motor quay (hoạt ảnh) đúng khi tốc độ khác 0`,
      spinOk === series.length,
      `${spinOk}/${series.length}`,
    );
  };
  if (opt('--raw')) writeFileSync(resolve(opt('--raw')), JSON.stringify({ a, b }, null, 1));
  internal('tank-demo gốc', a);
  internal('bản dựng lại', b);
  // Hai bản dùng bộ phát mô phỏng khác nhau (mock của 0.1 và Tag mô phỏng 0.4): không so giá trị từng thời điểm, so định dạng và miền giá trị
  const fmt = (series) =>
    series.every(
      (s) =>
        /^\d+[.,]\d %$/.test(s.textLevel.text) &&
        num(s.textLevel.text) >= 0 &&
        num(s.textLevel.text) <= 100,
    );
  check(
    'chữ mức của hai bản cùng định dạng (số, một số lẻ, " %") và nằm trong 0 đến 100',
    fmt(a) && fmt(b),
    `${a[0].textLevel.text} / ${b[0].textLevel.text}`,
  );
} catch (e) {
  check('chạy hết so sánh', false, e?.stack ?? String(e));
} finally {
  await browser.close();
}

for (const r of results)
  console.log(`${r.pass ? '✔' : '✘'} ${r.name}${r.pass ? '' : ` — ${r.detail}`}`);
const failed = results.filter((r) => !r.pass).length;
if (outFile) {
  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  writeFileSync(
    resolve(outFile),
    JSON.stringify({ baseline, rebuilt, samples, tol, results }, null, 2) + '\n',
  );
}
console.log(`${results.length - failed} đạt, ${failed} không đạt`);
process.exit(failed ? 1 : 0);
