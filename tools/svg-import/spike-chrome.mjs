// Spike T006 (feature 008, research R9, R10; ADR-024 rủi ro 1, 2; ADR-026 rủi ro 3): kiểm hành vi Chrome
// cho hợp biến đổi, hoạt ảnh Web Animations, clipPath trong Shadow DOM, elementsFromPoint, pointer-events.
// Dùng: node tools/svg-import/spike-chrome.mjs [--out docs/reports/008-spike-chrome.json]
// Chrome lấy từ CHROME_PATH hoặc đường dẫn cài đặt mặc định. Mã thoát: 0 = mọi kiểm đạt; 1 = có kiểm không đạt; 2 = không chạy được.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';
import { decodePng } from './png-decode.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : '';

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}

const isRed = ([r, g, b]) => r > 200 && g < 60 && b < 60;
const isWhite = ([r, g, b]) => r > 240 && g > 240 && b > 240;

const results = { checks: [], data: {} };
function check(id, ok, detail) {
  results.checks.push({ id, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ĐẠT ' : 'LỖI '} ${id}: ${detail}`);
}

const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  results.browserVersion = await browser.version();
  results.measuredAt = new Date().toISOString();
  console.log(results.browserVersion);
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 700, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.setContent(
    '<!doctype html><html><head><style>html,body{margin:0;background:#fff}</style></head><body><div id="host" style="position:absolute;left:0;top:0"></div></body></html>',
  );

  // ---------- (a) chuỗi biến đổi hợp ----------
  const a = await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const host = document.getElementById('host');
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '900');
    svg.setAttribute('height', '600');
    svg.style.display = 'block';
    root.appendChild(svg);
    const f = (n) => Number(n.toFixed(6));
    const chain = (p, m0) =>
      `translate(${p.tx}px, ${p.ty}px) matrix(${m0.a},${m0.b},${m0.c},${m0.d},${m0.e},${m0.f}) ` +
      `translate(${p.cr[0]}px, ${p.cr[1]}px) rotate(${p.rot}deg) translate(${-p.cr[0]}px, ${-p.cr[1]}px) ` +
      `translate(${p.cs[0]}px, ${p.cs[1]}px) scale(${p.sx}, ${p.sy}) translate(${-p.cs[0]}px, ${-p.cs[1]}px)`;
    const expectBox = (p, m0) => {
      let m = new DOMMatrix()
        .translate(p.tx, p.ty)
        .multiply(new DOMMatrix([m0.a, m0.b, m0.c, m0.d, m0.e, m0.f]));
      m = m.translate(p.cr[0], p.cr[1]).rotate(p.rot).translate(-p.cr[0], -p.cr[1]);
      m = m.translate(p.cs[0], p.cs[1]).scale(p.sx, p.sy).translate(-p.cs[0], -p.cs[1]);
      const pts = [
        [10, 20],
        [70, 20],
        [70, 50],
        [10, 50],
      ].map(([x, y]) => m.transformPoint({ x, y }));
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      return { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    };
    const cases = [
      { name: 'M0 = dời', m0: 'translate(100 50)' },
      { name: 'M0 = quay 90', m0: 'rotate(90)' },
      { name: 'M0 = co giãn', m0: 'scale(2 0.5)' },
      { name: 'M0 = lệch', m0: 'skewX(20)' },
      {
        name: 'M0 = hợp (dời, quay 30, co giãn, lệch)',
        m0: 'translate(30 40) rotate(30) scale(1.5 0.8) skewY(10)',
      },
      { name: 'M0 = đơn vị (không có transform gốc)', m0: '' },
    ];
    const params = [
      { tx: 0, ty: 0, rot: 0, cr: [40, 35], sx: 1, sy: 1, cs: [40, 35] },
      { tx: 200, ty: 100, rot: 90, cr: [40, 35], sx: 1, sy: 1, cs: [40, 35] },
      { tx: 15, ty: -10, rot: 37, cr: [10, 20], sx: 1.5, sy: 0.75, cs: [70, 50] },
      { tx: 120, ty: 60, rot: 200, cr: [40, 35], sx: 0.5, sy: 2, cs: [10, 20] },
    ];
    const rows = [];
    let worst = 0;
    for (const c of cases) {
      for (const p of params) {
        const el = document.createElementNS(NS, 'rect');
        el.setAttribute('x', '10');
        el.setAttribute('y', '20');
        el.setAttribute('width', '60');
        el.setAttribute('height', '30');
        if (c.m0) el.setAttribute('transform', c.m0);
        svg.appendChild(el);
        const m0 = c.m0 ? el.transform.baseVal.consolidate().matrix : new DOMMatrix();
        el.style.transformOrigin = '0 0';
        el.style.transformBox = 'view-box';
        el.style.transform = chain(p, m0);
        const r = el.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        const e = expectBox(p, m0);
        const err = Math.max(
          Math.abs(r.left - s.left - e.x),
          Math.abs(r.top - s.top - e.y),
          Math.abs(r.right - s.left - e.r),
          Math.abs(r.bottom - s.top - e.b),
        );
        worst = Math.max(worst, err);
        rows.push({ m0: c.name, rot: p.rot, err: f(err) });
        el.remove();
      }
    }
    // Ca tính tay: M0 = rotate(90), tx=200, ty=100, không quay thêm, rect (10,20,60,30)
    // (x, y) -> (-y, x) => x trong [-50, -20], y trong [10, 70]; dời => x 150..180, y 110..170.
    const el = document.createElementNS(NS, 'rect');
    el.setAttribute('x', '10');
    el.setAttribute('y', '20');
    el.setAttribute('width', '60');
    el.setAttribute('height', '30');
    el.setAttribute('transform', 'rotate(90)');
    svg.appendChild(el);
    const m0 = el.transform.baseVal.consolidate().matrix;
    el.style.transformOrigin = '0 0';
    el.style.transformBox = 'view-box';
    el.style.transform = chain(
      { tx: 200, ty: 100, rot: 0, cr: [0, 0], sx: 1, sy: 1, cs: [0, 0] },
      m0,
    );
    const r = el.getBoundingClientRect();
    const s = svg.getBoundingClientRect();
    const byHand = {
      left: f(r.left - s.left),
      top: f(r.top - s.top),
      right: f(r.right - s.left),
      bottom: f(r.bottom - s.top),
    };
    // Nếu không có CSS transform (chỉ thuộc tính) thì kết quả khác: chứng minh CSS che thuộc tính (R9, lỗi 0.2).
    el.style.transform = 'rotate(45deg)';
    const overridden = el.getBoundingClientRect();
    return { rows, worst, byHand, cssOverridesAttr: Math.abs(overridden.width - r.width) > 1 };
  });
  results.data.a = a;
  check(
    'a1',
    a.worst < 0.01,
    `${a.rows.length} ca (6 M0 x 4 bộ tham số): sai lệch lớn nhất ${a.worst} px so với tính bằng DOMMatrix`,
  );
  check(
    'a2',
    a.byHand.left === 150 &&
      a.byHand.top === 110 &&
      a.byHand.right === 180 &&
      a.byHand.bottom === 170,
    `ca tính tay (M0 quay 90 + dời 200,100): hộp ${JSON.stringify(a.byHand)}, mong đợi 150,110,180,170`,
  );
  check(
    'a3',
    a.cssOverridesAttr,
    'CSS transform che thuộc tính transform gốc (xác nhận lỗi im lặng của 0.2 mà R9 sửa)',
  );

  // ---------- (b) Web Animations ----------
  const b = await page.evaluate(async () => {
    const NS = 'http://www.w3.org/2000/svg';
    const host = document.getElementById('host');
    const root = host.shadowRoot;
    root.replaceChildren();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '900');
    svg.setAttribute('height', '600');
    svg.style.display = 'block';
    root.appendChild(svg);
    const el = document.createElementNS(NS, 'rect');
    el.setAttribute('x', '10');
    el.setAttribute('y', '20');
    el.setAttribute('width', '60');
    el.setAttribute('height', '30');
    el.setAttribute('transform', 'translate(30 40) rotate(30) scale(1.5 0.8) skewX(10)');
    svg.appendChild(el);
    const m0 = el.transform.baseVal.consolidate().matrix;
    el.style.transformOrigin = '0 0';
    el.style.transformBox = 'view-box';
    const cr = [40, 35];
    const base = { tx: 100, ty: 60, sx: 1.2, sy: 0.9 };
    const str = (p, rot) =>
      `translate(${p.tx}px, ${p.ty}px) matrix(${m0.a},${m0.b},${m0.c},${m0.d},${m0.e},${m0.f}) ` +
      `translate(${cr[0]}px, ${cr[1]}px) rotate(${rot}deg) translate(${-cr[0]}px, ${-cr[1]}px) ` +
      `translate(${cr[0]}px, ${cr[1]}px) scale(${p.sx}, ${p.sy}) translate(${-cr[0]}px, ${-cr[1]}px)`;
    const expectBox = (p, rot) => {
      let m = new DOMMatrix()
        .translate(p.tx, p.ty)
        .multiply(new DOMMatrix([m0.a, m0.b, m0.c, m0.d, m0.e, m0.f]));
      m = m.translate(cr[0], cr[1]).rotate(rot).translate(-cr[0], -cr[1]);
      m = m.translate(cr[0], cr[1]).scale(p.sx, p.sy).translate(-cr[0], -cr[1]);
      const pts = [
        [10, 20],
        [70, 20],
        [70, 50],
        [10, 50],
      ].map(([x, y]) => m.transformPoint({ x, y }));
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
    };
    const diff = (p, rot) => {
      const r = el.getBoundingClientRect();
      const s = svg.getBoundingClientRect();
      const e = expectBox(p, rot);
      return Math.max(
        Math.abs(r.left - s.left - e.l),
        Math.abs(r.top - s.top - e.t),
        Math.abs(r.right - s.left - e.r),
        Math.abs(r.bottom - s.top - e.b),
      );
    };
    const anim = el.animate([{ transform: str(base, 0) }, { transform: str(base, 360) }], {
      duration: 1000,
      iterations: Infinity,
    });
    // (b1) tua theo thời gian: so với kết quả tính tay tại mỗi mốc
    anim.pause();
    let seekWorst = 0;
    for (let t = 0; t < 1000; t += 25) {
      anim.currentTime = t;
      seekWorst = Math.max(seekWorst, diff(base, t * 0.36));
    }
    // (b2) chạy thật 1,5 s, so tức thời theo currentTime trong từng khung
    anim.play();
    const frames = [];
    await new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const ct = Number(anim.currentTime);
        frames.push({ ct, err: diff(base, (ct % 1000) * 0.36) });
        if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const liveWorst = Math.max(...frames.map((x) => x.err));
    // (b3) updatePlaybackRate giữ thời gian
    const before = Number(anim.currentTime);
    anim.updatePlaybackRate(3);
    const after = Number(anim.currentTime);
    await new Promise((r) => setTimeout(r, 300));
    const afterWait = Number(anim.currentTime);
    // (b4) setKeyframes giữ thời gian, đổi tx
    const base2 = { ...base, tx: 250, sx: 0.7 };
    const b4 = Number(anim.currentTime);
    anim.effect.setKeyframes([{ transform: str(base2, 0) }, { transform: str(base2, 360) }]);
    const a4 = Number(anim.currentTime);
    anim.pause();
    anim.currentTime = 500;
    const kfErr = diff(base2, 180);
    // (b5) hiệu năng setKeyframes (chuỗi mới mỗi lần), 1000 lần
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const p = { ...base, tx: 100 + (i % 50) };
      anim.effect.setKeyframes([{ transform: str(p, 0) }, { transform: str(p, 360) }]);
    }
    const setKeyframesMs = (performance.now() - t0) / 1000;
    anim.cancel();
    return {
      seekWorst,
      liveFrames: frames.length,
      liveWorst,
      rateBefore: before,
      rateAfter: after,
      rateAfterWait: afterWait,
      kfBefore: b4,
      kfAfter: a4,
      kfErr,
      setKeyframesMs,
    };
  });
  results.data.b = b;
  check(
    'b1',
    b.seekWorst < 0.01,
    `tua 40 mốc (hai khung hình cùng cấu trúc, M0 gồm quay, co giãn, lệch): sai lệch lớn nhất ${b.seekWorst.toFixed(6)} px`,
  );
  check(
    'b2',
    b.liveWorst < 0.5,
    `chạy thật ${b.liveFrames} khung: sai lệch lớn nhất so với currentTime của khung ${b.liveWorst.toFixed(4)} px (không giật)`,
  );
  check(
    'b3',
    Math.abs(b.rateAfter - b.rateBefore) < 20 && b.rateAfterWait - b.rateAfter > 600,
    `updatePlaybackRate(3): currentTime ${b.rateBefore.toFixed(1)} -> ${b.rateAfter.toFixed(1)} ms (liên tục), sau 300 ms thực ${b.rateAfterWait.toFixed(1)}`,
  );
  check(
    'b4',
    Math.abs(b.kfAfter - b.kfBefore) < 20 && b.kfErr < 0.01,
    `setKeyframes: currentTime ${b.kfBefore.toFixed(1)} -> ${b.kfAfter.toFixed(1)} ms; hình đúng với tx, sx mới (sai lệch ${b.kfErr.toFixed(6)})`,
  );
  check(
    'b5',
    b.setKeyframesMs < 0.5,
    `setKeyframes: ${b.setKeyframesMs.toFixed(3)} ms/lần (1000 lần)`,
  );

  // ---------- (c) clipPath trong Shadow DOM ----------
  // Hình đỏ 100x100 tại gốc cục bộ; cắt chỉ giữ phần dưới (y từ 60 đến 100 cục bộ).
  // Điểm "trong" cục bộ (50, 80) phải đỏ, điểm "ngoài" cục bộ (50, 30) phải trắng.
  const variants = [
    {
      id: 'c1',
      name: 'clipPath userSpaceOnUse, transform thuộc tính translate',
      attrT: 'translate(50 40)',
      mode: 'clipPath',
      m: [1, 0, 0, 1, 50, 40],
    },
    {
      id: 'c2',
      name: 'clipPath userSpaceOnUse, transform thuộc tính dời + quay 90',
      attrT: 'translate(300 20) rotate(90)',
      mode: 'clipPath',
      m: [0, 1, -1, 0, 300, 20],
    },
    {
      id: 'c3',
      name: 'clipPath, CSS transform kiểu R9 (M0 = dời + co giãn)',
      attrT: 'translate(20 10) scale(1.5)',
      mode: 'clipPath-css',
      m: [1.5, 0, 0, 1.5, 20 + 100, 10 + 50],
    },
    {
      id: 'c4',
      name: 'clip-path: inset() trên phần tử, transform thuộc tính dời',
      attrT: 'translate(50 40)',
      mode: 'inset',
      m: [1, 0, 0, 1, 50, 40],
    },
    {
      id: 'c5',
      name: 'clip-path: inset() trên phần tử, transform quay 90',
      attrT: 'translate(300 20) rotate(90)',
      mode: 'inset',
      m: [0, 1, -1, 0, 300, 20],
    },
  ];
  results.data.c = [];
  for (const v of variants) {
    await page.evaluate((v) => {
      const NS = 'http://www.w3.org/2000/svg';
      // Mồi trong cây thường: cùng id mà cắt phần trên (nếu phân giải nhầm thì kết quả đảo)
      document.getElementById('decoy')?.remove();
      const decoy = document.createElement('div');
      decoy.id = 'decoy';
      decoy.innerHTML =
        '<svg width="0" height="0" style="position:absolute"><defs><clipPath id="mat-clip-x" clipPathUnits="userSpaceOnUse"><rect x="0" y="0" width="100" height="40"/></clipPath></defs></svg>';
      document.body.appendChild(decoy);
      const root = document.getElementById('host').shadowRoot;
      root.replaceChildren();
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '600');
      svg.setAttribute('height', '300');
      svg.style.display = 'block';
      const defs = document.createElementNS(NS, 'defs');
      svg.appendChild(defs);
      const el = document.createElementNS(NS, 'rect');
      el.id = 'target';
      el.setAttribute('width', '100');
      el.setAttribute('height', '100');
      el.setAttribute('fill', '#ff0000');
      el.setAttribute('transform', v.attrT);
      if (v.mode.startsWith('clipPath')) {
        const cp = document.createElementNS(NS, 'clipPath');
        cp.id = 'mat-clip-x';
        cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
        const r = document.createElementNS(NS, 'rect');
        r.setAttribute('x', '0');
        r.setAttribute('y', '60');
        r.setAttribute('width', '100');
        r.setAttribute('height', '40');
        cp.appendChild(r);
        defs.appendChild(cp);
        el.setAttribute('clip-path', 'url(#mat-clip-x)');
      } else {
        el.style.clipPath = 'inset(60% 0 0 0)';
      }
      if (v.mode === 'clipPath-css') {
        el.style.transformOrigin = '0 0';
        el.style.transformBox = 'view-box';
        const m0 = '1.5, 0, 0, 1.5, 20, 10';
        el.style.transform = `translate(100px, 50px) matrix(${m0})`;
      }
      svg.appendChild(el);
      root.appendChild(svg);
    }, v);
    const shot = decodePng(
      await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 600, height: 300 } }),
    );
    const pt = (lx, ly) => {
      const [a, b, c, d, e, f] = v.m;
      return [Math.round(a * lx + c * ly + e), Math.round(b * lx + d * ly + f)];
    };
    const [ix, iy] = pt(50, 80);
    const [ox, oy] = pt(50, 30);
    const inside = shot.at(ix, iy);
    const outside = shot.at(ox, oy);
    const ok = isRed(inside) && isWhite(outside);
    results.data.c.push({ id: v.id, name: v.name, inside, outside, ok });
    check(
      v.id,
      ok,
      `${v.name}: trong (${ix},${iy}) = ${inside.join(',')} (cần đỏ), ngoài (${ox},${oy}) = ${outside.join(',')} (cần trắng)`,
    );
  }
  // Cập nhật động: đổi y/height của rect cắt thì hình đổi theo (không dựng lại phần tử)
  {
    await page.evaluate(() => {
      const root = document.getElementById('host').shadowRoot;
      const svg = root.querySelector('svg');
      svg.querySelector('#target')?.remove();
      const NS = 'http://www.w3.org/2000/svg';
      const el = document.createElementNS(NS, 'rect');
      el.setAttribute('width', '100');
      el.setAttribute('height', '100');
      el.setAttribute('fill', '#ff0000');
      el.setAttribute('transform', 'translate(50 40)');
      el.setAttribute('clip-path', 'url(#mat-clip-x)');
      svg.appendChild(el);
      const cp = document.createElementNS(NS, 'clipPath');
      cp.id = 'mat-clip-x';
      cp.setAttribute('clipPathUnits', 'userSpaceOnUse');
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', '0');
      r.setAttribute('y', '60');
      r.setAttribute('width', '100');
      r.setAttribute('height', '40');
      cp.appendChild(r);
      svg.querySelector('defs').appendChild(cp);
      // Cập nhật sau khi đã dựng: chỉ đổi y/height của rect cắt
      r.setAttribute('y', '0');
      r.setAttribute('height', '50');
    });
    const shot = decodePng(
      await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 600, height: 300 } }),
    );
    const top = shot.at(100, 40 + 30);
    const bottom = shot.at(100, 40 + 80);
    const ok = isRed(top) && isWhite(bottom);
    results.data.cDynamic = { top, bottom, ok };
    check(
      'c6',
      ok,
      `đổi y/height của rect cắt lúc chạy: phần trên (local y=30) ${top.join(',')} (cần đỏ), phần dưới (y=80) ${bottom.join(',')} (cần trắng)`,
    );
  }

  // ---------- (d) elementsFromPoint, 20.000 phần tử ----------
  const d = await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const root = document.getElementById('host').shadowRoot;
    root.replaceChildren();
    document.getElementById('decoy')?.remove();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '900');
    svg.setAttribute('height', '600');
    svg.style.display = 'block';
    root.appendChild(svg);
    const g1 = document.createElementNS(NS, 'g');
    g1.setAttribute('transform', 'translate(10 10) scale(0.9)');
    const g2 = document.createElementNS(NS, 'g');
    g2.setAttribute('transform', 'translate(5 5)');
    g1.appendChild(g2);
    svg.appendChild(g1);
    const N = 20000;
    const cols = 200;
    for (let i = 0; i < N; i++) {
      const tag = i % 3 === 0 ? 'polygon' : i % 3 === 1 ? 'line' : 'rect';
      const el = document.createElementNS(NS, tag);
      const x = (i % cols) * 4;
      const y = Math.floor(i / cols) * 5;
      if (tag === 'rect') {
        el.setAttribute('x', String(x));
        el.setAttribute('y', String(y));
        el.setAttribute('width', '4');
        el.setAttribute('height', '4');
        el.setAttribute('fill', '#88aadd');
      } else if (tag === 'line') {
        el.setAttribute('x1', String(x));
        el.setAttribute('y1', String(y));
        el.setAttribute('x2', String(x + 4));
        el.setAttribute('y2', String(y + 4));
        el.setAttribute('stroke', '#334');
      } else {
        el.setAttribute('points', `${x},${y} ${x + 4},${y} ${x + 4},${y + 4}`);
        el.setAttribute('fill', '#acd');
      }
      (i % 2 ? g2 : g1).appendChild(el);
    }
    const t0 = performance.now();
    const first = root.elementsFromPoint(300, 300);
    const coldMs = performance.now() - t0;
    const times = [];
    let sum = 0;
    for (let i = 0; i < 200; i++) {
      const x = 20 + ((i * 37) % 800);
      const y = 20 + ((i * 53) % 500);
      const s = performance.now();
      const r = root.elementsFromPoint(x, y);
      times.push(performance.now() - s);
      sum += r.length;
    }
    times.sort((p, q) => p - q);
    const s2 = performance.now();
    const one = root.elementFromPoint(300, 300);
    const oneMs = performance.now() - s2;
    return {
      count: svg.querySelectorAll('*').length,
      firstHits: first.length,
      coldMs,
      medianMs: times[100],
      p95Ms: times[190],
      maxMs: times[199],
      avgHits: sum / 200,
      elementFromPointMs: oneMs,
      oneTag: one?.tagName ?? null,
    };
  });
  results.data.d = d;
  check(
    'd',
    d.p95Ms <= 50,
    `shadowRoot.elementsFromPoint, ${d.count} phần tử: lần đầu ${d.coldMs.toFixed(2)} ms, trung vị ${d.medianMs.toFixed(2)}, p95 ${d.p95Ms.toFixed(2)}, lớn nhất ${d.maxMs.toFixed(2)} ms; trung bình ${d.avgHits.toFixed(1)} phần tử/điểm (ngưỡng ADR-026: <= 50 ms)`,
  );

  // ---------- (e) pointer-events: all trên hình fill="none" ----------
  const e = await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const root = document.getElementById('host').shadowRoot;
    root.replaceChildren();
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '900');
    svg.setAttribute('height', '600');
    svg.style.display = 'block';
    root.appendChild(svg);
    const mk = (id, x, setup) => {
      const r = document.createElementNS(NS, 'rect');
      r.id = id;
      r.setAttribute('x', String(x));
      r.setAttribute('y', '100');
      r.setAttribute('width', '100');
      r.setAttribute('height', '100');
      r.setAttribute('fill', 'none');
      setup?.(r);
      svg.appendChild(r);
      return r;
    };
    mk('plain', 0);
    mk('attrAll', 150, (r) => r.setAttribute('pointer-events', 'all'));
    mk('styleAll', 300, (r) => (r.style.pointerEvents = 'all'));
    mk('strokeOnly', 450, (r) => {
      r.setAttribute('stroke', '#000');
      r.setAttribute('stroke-width', '4');
    });
    mk('strokeAll', 600, (r) => {
      r.setAttribute('stroke', '#000');
      r.setAttribute('stroke-width', '4');
      r.setAttribute('pointer-events', 'all');
    });
    const hit = (x) => {
      const h = root.elementFromPoint(x + 50, 150);
      return h?.id || h?.tagName || null;
    };
    return {
      plain: hit(0),
      attrAll: hit(150),
      styleAll: hit(300),
      strokeOnlyCenter: hit(450),
      strokeAllCenter: hit(600),
    };
  });
  results.data.e = e;
  check(
    'e',
    e.plain === 'svg' &&
      e.attrAll === 'attrAll' &&
      e.styleAll === 'styleAll' &&
      e.strokeOnlyCenter === 'svg' &&
      e.strokeAllCenter === 'strokeAll',
    `fill="none": mặc định ${e.plain} (không nhận), thuộc tính all ${e.attrAll}, style all ${e.styleAll}; có stroke, giữa hình: mặc định ${e.strokeOnlyCenter}, all ${e.strokeAllCenter}`,
  );

  results.pageErrors = pageErrors;
  results.allPassed = results.checks.every((c) => c.ok) && pageErrors.length === 0;
  if (pageErrors.length) console.error('Lỗi trang:', pageErrors);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
  }
  console.log(results.allPassed ? 'TẤT CẢ ĐẠT' : 'CÓ KIỂM KHÔNG ĐẠT');
  process.exitCode = results.allPassed ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 2;
} finally {
  await browser.close();
}
