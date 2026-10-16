// Kịch bản Chrome của web-it cho feature 008 (T084, T107, T108): svg, svg-events, open-svg, f5x10-svg, load-svg.
// Nạp từ tests/web-it/browser.mjs (nhận các hàm dùng chung qua `env`). Chrome thật (puppeteer-core) trên máy dev vào runtime x64
// trong Docker qua loopback; số đo là số x64 qua loopback, KHÔNG thay số BL335 (T123, T124).
import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit, login as bearerLogin } from '../../tools/measure/device-api.mjs';
import { startFakeRuntime } from '../../apps/runtime-web/tests/e2e/fake-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const WRITE_FCS = new Set([5, 6, 15, 16, 22]);

/** Mã chạy trong trang: các gốc Shadow DOM chứa SVG của mọi item `svg` (mat-screen › .item › .svg-host). */
const PAGE_LIB = `
  const svgRoots = () => {
    const out = [];
    for (const ms of document.querySelectorAll('mat-screen')) {
      const sr = ms.shadowRoot;
      if (!sr) continue;
      for (const item of sr.querySelectorAll('.item[data-item-id]')) {
        const h = item.querySelector('.svg-host');
        if (h && h.shadowRoot) out.push([item.getAttribute('data-item-id'), h.shadowRoot]);
      }
    }
    return out;
  };
  const deepAll = (sel) => {
    const out = [];
    for (const [, r] of svgRoots()) for (const e of r.querySelectorAll(sel)) out.push(e);
    return out;
  };
`;

/** Đọc các tệp binding của một project trên đĩa: danh sách { screen, item, uid, target, tagId, animation, event }. */
function projectFacts(dir) {
  const tags = JSON.parse(readFileSync(join(dir, 'tags.json'), 'utf8')).tags;
  const kind = new Map(tags.map((t) => [t.id, t.kind]));
  const bindings = [];
  const events = [];
  const screenDir = join(dir, 'screens');
  for (const f of readdirSync(screenDir).filter((x) => x.endsWith('.bindings.json'))) {
    const b = JSON.parse(readFileSync(join(screenDir, f), 'utf8'));
    for (const el of b.elements ?? []) {
      for (const bd of el.bindings ?? [])
        bindings.push({
          screen: b.screenId,
          item: b.itemId,
          uid: el.elementUid,
          target: bd.target,
          tagId: bd.source?.tagId,
          animation: bd.animation,
          binding: bd.id,
        });
      if (el.events?.click)
        events.push({ screen: b.screenId, item: b.itemId, uid: el.elementUid, ...el.events.click });
    }
  }
  return { tags, kind, bindings, events };
}

export function svgScenarios(env) {
  const {
    opt,
    BASE,
    HTTP_BASE,
    SIM_BASE,
    check,
    measures,
    newPage,
    live,
    hash,
    until,
    sleep,
    waitDeep,
    deepEval,
    deepCount,
    deepText,
    deepClick,
  } = env;

  // ------------------------------------------------------------------------------- giả lập Modbus
  const sim = async (method, path, body) => {
    const r = await fetch(`${SIM_BASE}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return r.json();
  };
  const simSet = (area, address, value) => sim('POST', '/set', { unit: 1, area, address, value });
  const simMem = async (area, address) =>
    (await sim('GET', `/mem?unit=1&area=${area}&address=${address}&count=1`)).values[0];
  const simMark = async () => (await sim('GET', '/log?since=0')).entries.at(-1)?.seq ?? 0;
  const simWrites = async (since) =>
    (await sim('GET', `/log?since=${since}`)).entries.filter((e) => WRITE_FCS.has(e.fc));

  // ------------------------------------------------------------------------------- tiện ích trang
  const goto = async (page, url) => {
    await page.goto('about:blank');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  };
  /** Chờ Trực tuyến; nếu quá nửa thời gian chưa được thì ghi lại biểu ngữ của trang rồi tải lại một lần (đếm ở measures.onlineRetries). */
  const waitOnline = async (page, ms = 20000) => {
    try {
      await until(
        async () => (await live(page)) === 'Trực tuyến',
        'Trực tuyến',
        Math.round(ms / 2),
      );
    } catch {
      measures.onlineRetries = (measures.onlineRetries ?? 0) + 1;
      measures.onlineRetryBanner = await page
        .evaluate(
          () =>
            (document.querySelector('#app-banner')?.textContent ?? '') +
            ' | ' +
            (document.querySelector('#app-live')?.textContent ?? ''),
        )
        .catch(() => '');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await until(
        async () => (await live(page)) === 'Trực tuyến',
        'Trực tuyến (sau khi tải lại)',
        ms,
      );
    }
  };
  const waitSvg = (page, uid, ms = 20000) =>
    until(
      async () =>
        (await page.evaluate(
          `(function(){ ${PAGE_LIB} return deepAll('[data-mat-uid="${uid}"]').length; })()`,
        )) > 0,
      `phần tử ${uid}`,
      ms,
    );
  const attrOf = (page, uid, name) =>
    page.evaluate(
      `(function(){ ${PAGE_LIB} const e = deepAll('[data-mat-uid="${uid}"]')[0]; return e ? e.getAttribute(${JSON.stringify(name)}) : undefined; })()`,
    );
  const clickEl = (page, uid) =>
    page.evaluate(
      `(function(){ ${PAGE_LIB} const e = deepAll('[data-mat-uid="${uid}"]')[0]; if (!e) return false; e.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); return true; })()`,
    );
  const statusText = (page) =>
    deepEval(
      page,
      '[role="status"]',
      'return els.map((e) => e.textContent.replace(/\\s+/g, " ").trim()).filter(Boolean).join(" | ");',
    );
  const login = async (page, user, pass) => {
    await page.click('#app-login-btn');
    await page.waitForSelector('dialog[open] input[autocomplete="username"]');
    await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
    await page.type('dialog[open] input[autocomplete="username"]', user);
    await page.type('dialog[open] input[autocomplete="current-password"]', pass);
    await page.keyboard.press('Enter');
    await until(
      async () =>
        await page.$eval('#app-user', (e, u) => !e.hidden && e.textContent.includes(u), user),
      `${user} đăng nhập`,
      15000,
    );
  };

  /** Ghi lại mọi giá trị `data-mat-lock` đã thấy trên các phần tử theo dõi (kể cả trạng thái thoáng qua như BUSY). */
  const WATCH_SRC = (uids) => `(function(){
    ${PAGE_LIB}
    const seen = (window.__locks = {});
    const uids = ${JSON.stringify(uids)};
    for (const u of uids) seen[u] = [];
    setInterval(() => {
      for (const u of uids) {
        const e = deepAll('[data-mat-uid="' + u + '"]')[0];
        if (!e) continue;
        const code = e.getAttribute('data-mat-lock') || 'READY';
        const arr = seen[u];
        if (arr.length === 0 || arr[arr.length - 1] !== code) arr.push(code);
      }
    }, 8);
  })()`;
  const lockHistory = (page, uid) =>
    page.evaluate(`window.__locks && window.__locks[${JSON.stringify(uid)}]`);

  /** Móc WebSocket: giữ giá trị Tag gần nhất theo id (đủ cho phép so) và đếm delta, mất sequence, đóng kết nối. */
  const WS_HOOK = `(function(){
    const S = (window.__seq = { snaps: 0, deltas: 0, gaps: 0, closes: 0, opens: 0, bytes: 0, entries: 0 });
    const L = (window.__live = { tags: {}, cur: [] });
    const Orig = window.WebSocket;
    const Hooked = function (url, protocols) {
      const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
      S.opens++;
      let sub = null; let last = 0; let ids = [];
      ws.addEventListener('message', (ev) => {
        if (typeof ev.data !== 'string') return;
        S.bytes += ev.data.length;
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'snapshot') {
          sub = m.subscriptionId; last = m.sequence; S.snaps++;
          ids = m.tags.map((t) => t.id);
          L.cur = ids;
          for (const t of m.tags) L.tags[t.id] = { value: t.value, quality: t.quality, reason: t.reason };
        } else if (m.type === 'delta') {
          if (m.subscriptionId !== sub) return;
          S.deltas++;
          S.entries += m.tags.length;
          if (m.sequence !== last + 1) S.gaps++;
          last = m.sequence;
          for (const [i, v, q, r] of m.tags) L.tags[ids[i]] = { value: v, quality: q, reason: r };
        }
      });
      ws.addEventListener('close', () => { S.closes++; });
      return ws;
    };
    Hooked.prototype = Orig.prototype;
    Object.assign(Hooked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = Hooked;
  })()`;

  /** Cây Tag cuối cùng mà trang thấy qua WebSocket. */
  const liveTags = (page) => page.evaluate('window.__live.tags');
  const liveCur = (page) => page.evaluate('window.__live.cur');

  // =============================================================================== svg (T107, SC-006)

  /** Bản chụp các phần tử có data-mat-uid: thuộc tính, chữ, kiểu hiển thị tính toán, hoạt ảnh (Web Animations). */
  const SNAP_SRC = `(function(){
    ${PAGE_LIB}
    const out = {};
    for (const [item, root] of svgRoots()) {
      for (const e of root.querySelectorAll('[data-mat-uid]')) {
        const cs = getComputedStyle(e);
        const tn = e.tagName.toLowerCase();
        out[item + '/' + e.getAttribute('data-mat-uid')] = {
          tag: tn,
          attrs: [...e.getAttributeNames()].sort().map((n) => [n, e.getAttribute(n)]),
          text: tn === 'text' || tn === 'tspan' ? e.textContent : null,
          // Giá trị tính toán của thuộc tính đang chạy hoạt ảnh đổi theo từng khung hình: ghi 'anim' thay cho giá trị
          cs: ['fill', 'stroke', 'opacity', 'visibility', 'transform', 'strokeDasharray', 'display'].map((k) => (e.getAnimations().length && (k === 'transform' || k === 'opacity') ? 'anim' : cs[k])),
          anims: e.getAnimations().map((a) => {
            const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
            return [a.effect && a.effect.getKeyframes ? a.effect.getKeyframes().length : 0, t.duration, t.iterations, t.direction];
          }),
        };
      }
    }
    return out;
  })()`;
  const snapshot = (page) => page.evaluate(SNAP_SRC);

  /** Quay trên phần tử có `transform` gốc (project spin-tr): giữ transform gốc, quay quanh tâm phần tử, dừng thì về nguyên chỗ (ADR-024). */
  async function spinScenario(browser) {
    await simSet('coils', 10, 1);
    await sleep(3000);
    const { ctx, page } = await newPage(browser);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.evaluateOnNewDocument(WS_HOOK);
    await goto(page, `${BASE}/`);
    await waitOnline(page);
    await waitSvg(page, 'el_fan');
    const info = () =>
      page.evaluate(`(function(){ ${PAGE_LIB}
        const e = deepAll('[data-mat-uid="el_fan"]')[0];
        const r = e.getBoundingClientRect();
        return { transform: e.getAttribute('transform'), anims: e.getAnimations().length, states: e.getAnimations().map((a) => a.playState), run: window.__live.tags['R.RUN'], cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      })()`);
    await until(async () => (await info()).anims > 0, 'phần tử quay (có hoạt ảnh)', 15000);
    const run = [];
    for (let i = 0; i < 4; i++) {
      run.push(await info());
      await sleep(250);
    }
    check(
      'bơm chạy: phần tử có transform gốc translate(200 150) vẫn giữ thuộc tính transform và có hoạt ảnh quay',
      run.every((s) => s.transform === 'translate(200 150)' && s.anims >= 1),
      JSON.stringify(run[0]),
    );
    const drift = Math.max(...run.map((s) => Math.hypot(s.cx - run[0].cx, s.cy - run[0].cy)));
    measures.spinCenterDriftPx = Math.round(drift * 100) / 100;
    check(
      `khi quay, tâm hộp bao không trôi (lệch ≤ 2 px, đo ${measures.spinCenterDriftPx} px): quay quanh tâm, không bật về gốc`,
      drift <= 2,
    );
    await simSet('coils', 10, 0);
    await until(
      async () => (await info()).states.every((x) => x !== 'running'),
      'dừng quay',
      15000,
    ).catch(async (e) => {
      measures.spinStopDebug = await info();
      throw e;
    });
    await sleep(300);
    const stop = await info();
    check(
      'bơm dừng: không còn hoạt ảnh đang chạy (tạm dừng), transform gốc nguyên vẹn, tâm phần tử không đổi',
      stop.transform === 'translate(200 150)' &&
        Math.hypot(stop.cx - run[0].cx, stop.cy - run[0].cy) <= 2,
      JSON.stringify(stop),
    );
    await ctx.close();
  }

  async function svgScenario(browser) {
    if (opt('--part', 'main') === 'spin') return spinScenario(browser);
    const dir = join(REPO, 'projects/svg-demo');
    const facts = projectFacts(dir);
    const simTags = new Set(facts.tags.filter((t) => t.kind === 'simulation').map((t) => t.id));
    // Tag do kịch bản điều khiển qua giả lập Modbus (tất định): mức bồn, lệnh bơm, lỗi, trạng thái
    const STATE = new Set([
      'TANK01.LEVEL',
      'PUMP01.RUN_CMD',
      'R.RUN',
      'PUMP01.FAULT',
      'PUMP01.STATE',
      'PUMP01.STATE_TEXT',
    ]);
    const key = (b) => `${b.item}/${b.uid}`;
    const byEl = new Map();
    for (const b of facts.bindings) {
      const k = `${b.screen}|${key(b)}`;
      if (!byEl.has(k)) byEl.set(k, []);
      byEl.get(k).push(b);
    }
    const isSimEl = (bs) => bs.some((b) => simTags.has(b.tagId));
    const stateEls = [...byEl].filter(([, bs]) => bs.every((b) => STATE.has(b.tagId)));
    measures.bindingsInProject = facts.bindings.length;
    measures.targetKinds = [
      ...new Set(facts.bindings.map((b) => b.target + (b.animation ? '+' + b.animation : ''))),
    ].sort();
    measures.boundElements = byEl.size;
    measures.simBoundElements = [...byEl].filter(([, bs]) => isSimEl(bs)).length;
    measures.stateElements = stateEls.length;

    const stateA = [
      ['coils', 10, 1],
      ['holding', 100, 13824],
      ['holding', 12, 8],
      ['holding', 10, 1],
      // HR11 và HR13 không có trong bản đồ modbus-demo: khối đọc HR12-13 (R.I32_CDAB) trả exception 02 làm PUMP01.FAULT (HR12.3) BAD
      ['holding', 11, 0],
      ['holding', 13, 0],
    ];
    const stateB = [
      ['coils', 10, 0],
      ['holding', 100, 24883],
      ['holding', 12, 0],
      ['holding', 10, 0],
    ];
    const apply = async (st) => {
      for (const [a, ad, v] of st) await simSet(a, ad, v);
    };

    // ---- Phía runtime x64 thật
    const real = {};
    const liveAt = {};
    const { ctx, page } = await newPage(browser);
    // Máy dev mặc định prefers-reduced-motion: reduce (không có hoạt ảnh): bỏ để hoạt ảnh chạy thật
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.evaluateOnNewDocument(WS_HOOK);
    await apply(stateA);
    await sleep(3000);
    await goto(page, `${BASE}/#/bon-nuoc`);
    await waitOnline(page);
    await waitSvg(page, 'el_tank_vertical_liquid');
    const settle = async (levelWant, runWant) => {
      await sleep(2500); // chu kỳ quét của kênh Modbus (nhóm normal 1 s) cộng độ trễ đẩy
      await until(
        async () => {
          const t = await liveTags(page);
          const cur = await liveCur(page);
          return (
            (!cur.includes('TANK01.LEVEL') ||
              Math.abs((t['TANK01.LEVEL']?.value ?? -1) - levelWant) < 0.6) &&
            (!cur.includes('PUMP01.RUN_CMD') || t['PUMP01.RUN_CMD']?.value === runWant)
          );
        },
        `Tag đổi sang trạng thái (mức ${levelWant}, bơm ${runWant})`,
        20000,
      );
      await sleep(1500);
    };
    await settle(50, true);
    real['A|bon-nuoc'] = await snapshot(page);
    liveAt.A = await liveTags(page);
    await page.evaluate(() => (location.hash = '#/tong-quan'));
    await until(async () => (await hash(page)) === '#/tong-quan', 'sang Tổng quan');
    await waitSvg(page, 'el_tank_horizontal_body');
    await sleep(1200);
    real['A|tong-quan'] = await snapshot(page);
    liveAt.A = { ...liveAt.A, ...(await liveTags(page)) };
    await apply(stateB);
    await settle(90, false);
    real['B|tong-quan'] = await snapshot(page);
    liveAt.B = await liveTags(page);
    await page.evaluate(() => (location.hash = '#/bon-nuoc'));
    await until(async () => (await hash(page)) === '#/bon-nuoc', 'về Bồn nước');
    await waitSvg(page, 'el_tank_vertical_liquid');
    await sleep(1500);
    real['B|bon-nuoc'] = await snapshot(page);
    liveAt.B = { ...liveAt.B, ...(await liveTags(page)) };
    const errs = await page.evaluate(() => document.body.innerText.slice(0, 300));
    check(
      'trang x64 dựng đủ và không báo lỗi tải',
      !/Không tải được|lỗi/i.test(errs),
      errs.replace(/\s+/g, ' ').slice(0, 120),
    );
    const activeJson = await page.evaluate(
      `(async () => await (await fetch('/api/v1/projects/active')).json())()`,
    );
    await ctx.close();

    // ---- Kiểm tuyệt đối trên trang x64 (không nhờ bản xem trước): màu đèn bơm và chữ mức
    const cell = (st, scr, k) => real[`${st}|${scr}`][k];
    const lampA = cell('A', 'bon-nuoc', 'pump_centrifugal_1/el_pump_centrifugal_lamp');
    const lampB = cell('B', 'bon-nuoc', 'pump_centrifugal_1/el_pump_centrifugal_lamp');
    check(
      'đèn bơm (style.fill, discreteMap): bơm chạy = #2fbf63, tắt = #9e9e9e',
      lampA?.cs[0] === 'rgb(47, 191, 99)' && lampB?.cs[0] === 'rgb(158, 158, 158)',
      `${lampA?.cs[0]} / ${lampB?.cs[0]}`,
    );
    const txtA = cell('A', 'bon-nuoc', 'tank_vertical_1/el_tank_vertical_text')?.text;
    const txtB = cell('B', 'bon-nuoc', 'tank_vertical_1/el_tank_vertical_text')?.text;
    check(
      'chữ mức bồn (text.content, định dạng 1 số lẻ + " %"): 50.0 % rồi 90.0 %',
      /^50[.,]0\s?%$/.test(txtA ?? '') && /^(89[.,]9|90[.,]0)\s?%$/.test(txtB ?? ''),
      `${txtA} / ${txtB}`,
    );
    const bodyA = cell('A', 'bon-nuoc', 'tank_vertical_1/el_tank_vertical_body')?.cs[0];
    const bodyB = cell('B', 'bon-nuoc', 'tank_vertical_1/el_tank_vertical_body')?.cs[0];
    check(
      'thân bồn (style.fill, rangeMap): mức 50 % = #eceff1, mức 90 % = #ffe0b2',
      bodyA === 'rgb(236, 239, 241)' && bodyB === 'rgb(255, 224, 178)',
      `${bodyA} / ${bodyB}`,
    );
    const animA = cell('A', 'bon-nuoc', 'pump_centrifugal_1/el_pump_centrifugal_impeller')?.anims
      .length;
    const animB = cell('B', 'bon-nuoc', 'pump_centrifugal_1/el_pump_centrifugal_impeller')?.anims
      .length;
    check(
      'cánh bơm (transform.rotate + spin): có hoạt ảnh khi bơm chạy, không có khi dừng',
      animA >= 1 && animB === 0,
      `${animA} / ${animB}`,
    );

    // ---- 100 % phần tử đích do trạng thái Tag đổi: bản chụp A khác B
    const stage = (st, scr) => real[`${st}|${scr}`];
    let changed = 0;
    const unchanged = [];
    for (const [k, bs] of stateEls) {
      const scr = bs[0].screen;
      const kk = key(bs[0]);
      if (!stage('A', scr)?.[kk] || !stage('B', scr)?.[kk]) continue;
      if (JSON.stringify(stage('A', scr)[kk]) !== JSON.stringify(stage('B', scr)[kk])) changed++;
      else unchanged.push(k);
    }
    const visited = stateEls.filter(([, bs]) => stage('A', bs[0].screen)?.[key(bs[0])]).length;
    measures.stateElementsChecked = visited;
    measures.stateElementsChanged = changed;
    check(
      `100 % phần tử đích của Tag trạng thái đổi giữa hai trạng thái (${changed}/${visited})`,
      visited > 0 && changed === visited,
      unchanged
        .map(
          (k) =>
            k +
            ' ' +
            JSON.stringify(stage('A', 'bon-nuoc')[k.split('|')[1]]) +
            ' vs ' +
            JSON.stringify(stage('B', 'bon-nuoc')[k.split('|')[1]]),
        )
        .join('; ')
        .slice(0, 1500) +
        ' | tags ' +
        JSON.stringify([
          liveAt.A['PUMP01.FAULT'],
          liveAt.B['PUMP01.FAULT'],
          liveAt.A['PUMP01.RUN_CMD'],
          liveAt.B['PUMP01.RUN_CMD'],
        ]),
    );

    // ---- Phần tử có transform gốc và hoạt ảnh quay: giữ transform gốc (ADR-024)
    const spinEls = facts.bindings.filter((b) => b.animation === 'spin');
    let spinWithOwn = 0;
    let spinKept = 0;
    for (const b of spinEls) {
      const itemFile = JSON.parse(
        readFileSync(join(dir, `screens/${b.screen}.screen.json`), 'utf8'),
      );
      const it = itemFile.items.find((i) => i.id === b.item);
      const svg = readFileSync(join(dir, it.svgFile), 'utf8');
      const tagText = new RegExp(`<[^>]*data-mat-uid="${b.uid}"[^>]*>`).exec(svg)?.[0] ?? '';
      const own = /\stransform="([^"]+)"/.exec(tagText)?.[1];
      if (!own) continue;
      spinWithOwn++;
      const rec = real['A|bon-nuoc'][key(b)] ?? real['A|tong-quan'][key(b)];
      const now = rec?.attrs.find(([n]) => n === 'transform')?.[1];
      if (now === own) spinKept++;
    }
    measures.spinWithOwnTransform = spinWithOwn;
    measures.spinKeptOwnTransform = spinKept;
    check(
      `quay trên phần tử có transform gốc giữ transform gốc (${spinKept}/${spinWithOwn} ca trong svg-demo)`,
      spinKept === spinWithOwn,
      spinWithOwn === 0 ? 'svg-demo không có ca này; ca kiểm riêng ở e2e anim (T067)' : '',
    );

    // ---- Phía "xem trước": cùng <mat-screen>/DomApplier chạy trên runtime giả, cùng giá trị Tag mà runtime x64 đã giao
    const files = new Map();
    const readTree = (rel = '') => {
      for (const n of readdirSync(join(dir, rel))) {
        const r = rel ? `${rel}/${n}` : n;
        const full = join(dir, r);
        if (statSync(full).isDirectory()) readTree(r);
        else if (n.endsWith('.svg'))
          files.set(r, { text: readFileSync(full, 'utf8'), type: 'image/svg+xml' });
        else if (n.endsWith('.screen.json'))
          files.set(r, { json: JSON.parse(readFileSync(full, 'utf8')) });
        else if (n.endsWith('.json')) files.set(r, { text: readFileSync(full, 'utf8') });
      }
    };
    readTree();
    const fake = await startFakeRuntime({
      staticDir: join(REPO, 'apps/runtime-web/dist-device'),
      drift: false,
      fixture: () => ({ active: activeJson, files }),
    });
    const preview = {};
    const applyLive = (map) => {
      for (const [id, v] of Object.entries(map))
        fake.setValue(id, v.value, v.quality ?? 'GOOD', v.reason);
    };
    const f = await newPage(browser);
    await f.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    try {
      applyLive(liveAt.A);
      await goto(f.page, `${fake.httpsUrl}/#/bon-nuoc`);
      await waitOnline(f.page);
      await waitSvg(f.page, 'el_tank_vertical_liquid');
      await sleep(1500);
      preview['A|bon-nuoc'] = await snapshot(f.page);
      await f.page.evaluate(() => (location.hash = '#/tong-quan'));
      await waitSvg(f.page, 'el_tank_horizontal_body');
      await sleep(1200);
      preview['A|tong-quan'] = await snapshot(f.page);
      applyLive(liveAt.B);
      await sleep(1500);
      preview['B|tong-quan'] = await snapshot(f.page);
      await f.page.evaluate(() => (location.hash = '#/bon-nuoc'));
      await waitSvg(f.page, 'el_tank_vertical_liquid');
      await sleep(1500);
      preview['B|bon-nuoc'] = await snapshot(f.page);
    } finally {
      await f.ctx.close();
      await fake.close();
    }
    // So bằng nhau: mọi phần tử có data-mat-uid, trừ phần tử gắn Tag mô phỏng (giá trị đổi theo đồng hồ của runtime)
    let compared = 0;
    let equal = 0;
    let skippedSim = 0;
    const diffs = [];
    for (const stg of Object.keys(real)) {
      const scr = stg.split('|')[1];
      for (const [k, rec] of Object.entries(real[stg])) {
        const bs = byEl.get(`${scr}|${k}`) ?? [];
        if (isSimEl(bs)) {
          skippedSim++;
          continue;
        }
        compared++;
        const other = preview[stg]?.[k];
        if (other && JSON.stringify(other) === JSON.stringify(rec)) equal++;
        else if (diffs.length < 8) diffs.push(`${stg} ${k}`);
      }
    }
    measures.domCompared = compared;
    measures.domEqual = equal;
    measures.domSkippedSimulation = skippedSim;
    check(
      `DOM và kiểu hiển thị giống bản xem trước ở 100 % phần tử (${equal}/${compared}; bỏ ${skippedSim} phần tử gắn Tag mô phỏng đổi theo đồng hồ)`,
      compared > 0 && equal === compared,
      diffs.join('; '),
    );
    const sameSet = Object.keys(real).every(
      (stg) =>
        JSON.stringify(Object.keys(real[stg]).sort()) ===
        JSON.stringify(Object.keys(preview[stg] ?? {}).sort()),
    );
    check('cùng tập phần tử có data-mat-uid ở mọi trạng thái và màn hình', sameSet);
  }

  // =============================================================================== svg-events (T084, SC-013)

  async function svgEvents(browser) {
    const fp = opt('--fp', '');
    const PUMP = 'el_pump_centrifugal_hit';
    const PUMP_BODY = 'el_pump_centrifugal_body';
    const MOTOR = 'el_motor_ac_hit';
    const TANK_HIT = 'el_tank_vertical_hit';
    const pwOf = (u) => process.env[`MAT_IT_PW_${u.toUpperCase()}`] ?? '';
    const watch = [PUMP, MOTOR];
    const openBon = async (url = `${BASE}/#/bon-nuoc`, p = null) => {
      const np = p ?? (await newPage(browser));
      await np.page.evaluateOnNewDocument(WATCH_SRC(watch));
      await np.page.evaluateOnNewDocument(WS_HOOK);
      await goto(np.page, url);
      await waitOnline(np.page, 15000).catch(async () => {
        await np.page.reload({ waitUntil: 'domcontentloaded' });
        await waitOnline(np.page, 25000);
      });
      await waitSvg(np.page, PUMP);
      await sleep(600);
      return np;
    };
    const adm = await bearerLogin(BASE, fp, 'admin', pwOf('admin'));
    const auditRows = async (extra = {}) => {
      const r = await audit(BASE, fp, adm.json.token, {
        action: 'tag.write',
        limit: 200,
        ...extra,
      });
      return (r.json?.records ?? []).map((x) => ({
        ...x,
        d: typeof x.detail === 'object' && x.detail ? x.detail : JSON.parse(x.detail ?? '{}'),
      }));
    };
    const dlg = (page) => deepCount(page, '[role="alertdialog"]');

    // Bản đồ modbus-demo chỉ có coil 10: coil 11 (R.PULSE của sự kiện xung) trả exception 02 nên Tag BAD; khai coil 11 để Tag đọc được
    await simSet('coils', 11, 0);
    await sleep(3500);
    // ---- 1. Khách: khóa NO_SESSION, thuộc tính, lý do ở vùng status, không gửi gì
    const mark0 = await simMark();
    const g = await openBon();
    const lockG = await attrOf(g.page, PUMP, 'data-mat-lock');
    check(
      'khách: phần tử nhấp được có data-mat-lock=NO_SESSION, role=button, tabindex=0, aria-disabled=true',
      lockG === 'NO_SESSION' &&
        (await attrOf(g.page, PUMP, 'role')) === 'button' &&
        (await attrOf(g.page, PUMP, 'tabindex')) === '0' &&
        (await attrOf(g.page, PUMP, 'aria-disabled')) === 'true',
      lockG,
    );
    check(
      'khách: có aria-label (nhãn của sự kiện)',
      /Bật tắt Bơm 1/.test((await attrOf(g.page, PUMP, 'aria-label')) ?? ''),
      await attrOf(g.page, PUMP, 'aria-label'),
    );
    await clickEl(g.page, PUMP);
    await sleep(400);
    const stG = await statusText(g.page);
    check(
      'khách: nhấp hiện lý do khóa ở vùng status, không có hộp xác nhận',
      stG.length > 0 && (await dlg(g.page)) === 0,
      stG,
    );
    // Bàn phím: Enter trên phần tử có tiêu điểm cũng chỉ hiện lý do
    await g.page.evaluate(
      `(function(){ ${PAGE_LIB} const e = deepAll('[data-mat-uid="${PUMP}"]')[0]; e.focus(); })()`,
    );
    await g.page.keyboard.press('Enter');
    await sleep(300);
    check('khách: Enter trên phần tử khóa không mở hộp xác nhận', (await dlg(g.page)) === 0);
    check('khách: 0 lệnh tới giả lập', (await simWrites(mark0)).length === 0);
    const lockSet = new Set(['NO_SESSION']);

    // ---- 2. Viewer: ROLE
    await login(g.page, 'xem1', pwOf('xem1'));
    await sleep(500);
    const lockV = await attrOf(g.page, PUMP, 'data-mat-lock');
    lockSet.add(lockV);
    check('viewer xem1: khóa ROLE', lockV === 'ROLE', lockV);
    await clickEl(g.page, PUMP);
    await sleep(300);
    check(
      'viewer: nhấp không mở hộp xác nhận, 0 lệnh',
      (await dlg(g.page)) === 0 && (await simWrites(mark0)).length === 0,
    );
    await g.page.click('#app-logout-btn');
    await g.ctx.close();

    // ---- 3. Operator: xác nhận → ghi → CONFIRMED; Hủy không ghi
    const o = await openBon();
    await login(o.page, 'vh1', pwOf('vh1'));
    await sleep(600);
    const lockO = await attrOf(o.page, PUMP, 'data-mat-lock');
    check(
      'operator vh1: phần tử sẵn sàng (không có data-mat-lock)',
      lockO === null || lockO === undefined,
      lockO,
    );
    const coilBefore = await simMem('coils', 10);
    const m1 = await simMark();
    await clickEl(o.page, PUMP);
    await waitDeep(o.page, '[role="alertdialog"]', 1, 8000);
    const dtext = (await deepText(o.page, '[role="alertdialog"]')) ?? '';
    check(
      'hộp xác nhận hiện Tag PUMP01.RUN_CMD, giá trị mới và tài khoản vh1',
      /PUMP01\.RUN_CMD/.test(dtext) && /vh1/.test(dtext),
      dtext.slice(0, 160),
    );
    // OTHER_DIALOG: phần tử khác của cùng màn hình bị khóa khi hộp đang mở
    await sleep(300);
    const hMotor = await lockHistory(o.page, MOTOR);
    check(
      'hộp đang mở: phần tử ghi khác bị khóa OTHER_DIALOG',
      hMotor.includes('OTHER_DIALOG'),
      hMotor.join('>'),
    );
    lockSet.add('OTHER_DIALOG');
    await deepClick(o.page, '[data-cancel]');
    await sleep(700);
    check(
      'Hủy xác nhận: 0 lệnh tới giả lập',
      (await simWrites(m1)).length === 0 && (await dlg(o.page)) === 0,
    );
    const t0 = Date.now();
    await clickEl(o.page, PUMP);
    await waitDeep(o.page, '[data-ok]', 1, 8000);
    await deepClick(o.page, '[data-ok]');
    await until(
      async () => /Đã ghi và xác nhận/.test(await statusText(o.page)),
      'CONFIRMED',
      15000,
    );
    measures.clickToConfirmedMs = Date.now() - t0;
    const hPump = await lockHistory(o.page, PUMP);
    check(
      'trong lúc gửi: phần tử BUSY (thoáng qua), rồi trở lại sẵn sàng',
      hPump.includes('BUSY') && hPump.at(-1) === 'READY',
      hPump.join('>'),
    );
    lockSet.add('BUSY');
    const w1 = (await simWrites(m1)).filter((e) => e.fc === 5 && e.address === 10);
    check(
      'ghi từ phần tử SVG: đúng 1 lệnh FC5 tới coil 10, không gửi hai lần',
      w1.length === 1,
      w1.length,
    );
    check(
      'giá trị ở giả lập đảo so với trước (toggle)',
      (await simMem('coils', 10)) === (coilBefore ? 0 : 1),
      `${coilBefore} -> ${await simMem('coils', 10)}`,
    );
    await sleep(800);
    const rows = (await auditRows({ target: 'PUMP01.RUN_CMD' })).filter(
      (r) => r.d.context?.widget === PUMP,
    );
    check(
      `audit: có dòng tag.write của phần tử ${PUMP} (context.widget = elementUid, context.screen = bon-nuoc)`,
      rows.length >= 1 && rows.every((r) => r.d.context?.screen === 'bon-nuoc'),
      rows.length,
    );
    const channels = new Set(rows.map((r) => r.channel ?? r.d.channel));
    check(
      'audit: channel = web, user = vh1',
      channels.size === 1 && channels.has('web') && rows.every((r) => r.user === 'vh1'),
      [...channels].join(','),
    );
    check(
      'audit có kết quả ok sau dòng nhận lệnh',
      rows.some((r) => r.result === 'ok') && rows.some((r) => r.result === 'started'),
      rows.map((r) => r.result).join(','),
    );
    check(
      'elementUid hợp mẫu context.widget (^[a-z][a-z0-9_-]{0,63}$)',
      /^[a-z][a-z0-9_-]{0,63}$/.test(PUMP),
    );

    // ---- 4. Điều hướng và popup
    await clickEl(o.page, TANK_HIT);
    await until(
      async () => (await hash(o.page)) === '#/tong-quan',
      'navigate sang Tổng quan',
      8000,
    );
    check(
      'sự kiện navigate: sang màn hình Tổng quan, không hỏi xác nhận',
      (await dlg(o.page)) === 0,
    );
    await o.page.evaluate(() => (location.hash = '#/bon-nuoc'));
    await waitSvg(o.page, PUMP_BODY);
    await sleep(500);
    await clickEl(o.page, PUMP_BODY);
    await waitDeep(o.page, '[role="dialog"]', 1, 8000);
    check('sự kiện popup: mở popup Bơm 1, hash không đổi', (await hash(o.page)) === '#/bon-nuoc');
    await o.page.keyboard.press('Escape');
    await until(
      async () => (await deepCount(o.page, '[role="dialog"]')) === 0,
      'Esc đóng popup',
      5000,
    );
    check('Esc đóng popup', true);
    await clickEl(o.page, PUMP_BODY);
    await waitDeep(o.page, '[role="dialog"]', 1, 8000);
    const closed = await o.page.evaluate(`(function(){ ${PAGE_LIB}
      const roots = []; for (const ms of document.querySelectorAll('mat-screen')) roots.push(ms);
      return roots.length; })()`);
    void closed;
    // closePopup: phần tử "hit" của bơm trong popup (cùng uid kiểu `el_pump_centrifugal_hit` ở màn hình popup)
    await sleep(500);
    const popHits = await o.page.evaluate(`(function(){
      const out = [];
      const walk = (root) => { for (const e of root.querySelectorAll('*')) { if (e.getAttribute && e.getAttribute('data-mat-uid') === '${PUMP}') out.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
      walk(document); return out.length; })()`);
    measures.pumpHitsWithPopup = popHits;
    await o.page.evaluate(`(function(){
      const out = [];
      const walk = (root) => { for (const e of root.querySelectorAll('*')) { if (e.getAttribute && e.getAttribute('data-mat-uid') === '${PUMP}') out.push(e); if (e.shadowRoot) walk(e.shadowRoot); } };
      walk(document);
      const last = out.at(-1);
      if (last) last.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    })()`);
    await until(
      async () => (await deepCount(o.page, '[role="dialog"]')) === 0,
      'closePopup đóng popup',
      5000,
    );
    check('sự kiện closePopup: đóng popup từ phần tử SVG trong popup', true);

    // ---- 5. Xung: nhấp → xác nhận → ACCEPTED rồi đóng trình duyệt NGAY; bit phải tự về 0 do runtime giữ nhịp
    await sleep(800);
    const m2 = await simMark();
    await clickEl(o.page, MOTOR);
    await waitDeep(o.page, '[data-ok]', 1, 8000);
    await deepClick(o.page, '[data-ok]');
    const hMot = await until(
      async () => {
        const h = await lockHistory(o.page, MOTOR);
        return h.includes('BUSY') ? h : null;
      },
      'lệnh xung đã nhận (BUSY)',
      8000,
    );
    void hMot;
    await o.ctx.close(); // đóng trình duyệt ngay khi lệnh xung đang chờ
    const pulseBit = [];
    const tp = Date.now();
    let released = false;
    while (Date.now() - tp < 6000) {
      const v = await simMem('coils', 11);
      pulseBit.push(v);
      if (pulseBit.includes(1) && v === 0) {
        released = true;
        break;
      }
      await sleep(100);
    }
    const wp = (await simWrites(m2)).filter((e) => e.fc === 5 && e.address === 11);
    measures.pulseBitSeen = pulseBit.join('');
    check(
      'xung đóng trình duyệt ngay: bit R.PULSE lên 1 rồi tự về 0 (runtime giữ nhịp)',
      released && (await simMem('coils', 11)) === 0,
      `bit: ${pulseBit.slice(0, 40).join('')}`,
    );
    check('giả lập thấy đúng 2 lệnh FC5 ở coil 11 (đóng rồi nhả)', wp.length === 2, wp.length);
    await sleep(800);
    const prow = (await auditRows({ target: 'R.PULSE' })).filter(
      (r) => r.d.context?.widget === MOTOR,
    );
    check(
      'audit xung: có dòng nhận lệnh và dòng kết quả, context.widget = elementUid, channel web',
      prow.some((r) => r.result === 'started') &&
        prow.some((r) => r.result === 'ok') &&
        prow.every((r) => (r.channel ?? r.d.channel) === 'web'),
      prow.map((r) => r.result).join(','),
    );

    // ---- 6. Các khóa còn lại trên runtime thật
    // QUALITY_BAD: giả lập từ chối kết nối, Tag PUMP01.RUN_CMD thành BAD
    const q = await openBon();
    await login(q.page, 'vh1', pwOf('vh1'));
    await sim('POST', '/fault', { kind: 'refuse' });
    const badSeen = await until(
      async () => ((await lockHistory(q.page, PUMP)) ?? []).includes('QUALITY_BAD'),
      'QUALITY_BAD',
      40000,
    ).catch(() => false);
    check(
      'mất kết nối thiết bị (giả lập từ chối): phần tử khóa QUALITY_BAD',
      badSeen,
      (await lockHistory(q.page, PUMP)).join('>'),
    );
    lockSet.add('QUALITY_BAD');
    await sim('DELETE', '/fault');
    await until(
      async () => (await attrOf(q.page, PUMP, 'data-mat-lock')) == null,
      'hết khóa khi thiết bị trở lại',
      40000,
    ).catch(() => undefined);
    // LIVE_LOST: đóng WebSocket của trang (client tự nối lại)
    await q.page.evaluate(`(function(){ window.__origWS = window.WebSocket; })()`);
    const cdp = await q.page.createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    const liveLost = await until(
      async () => ((await lockHistory(q.page, PUMP)) ?? []).includes('LIVE_LOST'),
      'LIVE_LOST',
      30000,
    ).catch(() => false);
    check(
      'mất kết nối live (mạng tắt): phần tử khóa LIVE_LOST',
      liveLost,
      (await lockHistory(q.page, PUMP)).join('>'),
    );
    lockSet.add('LIVE_LOST');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await until(
      async () => (await attrOf(q.page, PUMP, 'data-mat-lock')) == null,
      'nối lại live',
      40000,
    ).catch(() => undefined);
    // SESSION_EXPIRED: hủy phiên ở máy chủ (đăng xuất bằng fetch mà không qua nút), live bị đóng 4401
    await q.page.evaluate(
      `(async () => { const s = await (await fetch('/api/v1/web/session')).json(); await fetch('/api/v1/web/logout', { method: 'POST', headers: { 'X-MAT-CSRF': s.csrfToken } }); })()`,
    );
    const sawExpired = () =>
      until(
        async () => ((await lockHistory(q.page, PUMP)) ?? []).includes('SESSION_EXPIRED'),
        'SESSION_EXPIRED',
        8000,
      ).then(
        () => true,
        () => false,
      );
    let expiredVia = 'đóng live 4401';
    let expired = await sawExpired();
    if (!expired) {
      // Trang chưa biết phiên đã mất: nhấp phần tử, xác nhận, máy chủ trả 401 cho lệnh ghi
      expiredVia = 'lệnh ghi bị 401';
      await clickEl(q.page, PUMP);
      await waitDeep(q.page, '[data-ok]', 1, 8000).catch(() => undefined);
      await deepClick(q.page, '[data-ok]');
      expired = await sawExpired();
    }
    measures.sessionExpiredVia = expired ? expiredVia : null;
    check(
      `phiên bị hủy ở máy chủ: phần tử khóa SESSION_EXPIRED (nhận ra qua ${expiredVia})`,
      expired,
      ((await lockHistory(q.page, PUMP)) ?? []).join('>'),
    );
    if (expired) lockSet.add('SESSION_EXPIRED');
    await q.ctx.close();
    // INSECURE: trang HTTP
    const h = await openBon(`${HTTP_BASE}/#/bon-nuoc`);
    const lockH = await attrOf(h.page, PUMP, 'data-mat-lock');
    lockSet.add(lockH);
    check('trang HTTP: khóa INSECURE', lockH === 'INSECURE', lockH);
    await clickEl(h.page, PUMP);
    await sleep(300);
    check('trang HTTP: nhấp không mở hộp xác nhận', (await dlg(h.page)) === 0);
    await h.ctx.close();
    // HTTPS_DOWN: trang HTTP khi system/info báo cảnh báo HTTPS_DOWN (chặn và sửa phản hồi system/info của runtime thật)
    const hd = await newPage(browser);
    await hd.page.setRequestInterception(true);
    hd.page.on('request', async (req) => {
      if (/\/api\/v1\/system\/info/.test(req.url())) {
        try {
          const real = await (await fetch(req.url().replace(HTTP_BASE, HTTP_BASE))).json();
          real.warnings = [...(real.warnings ?? []), 'HTTPS_DOWN'];
          if (real.web) real.web.https = false;
          return req.respond({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(real),
          });
        } catch {
          return req.continue();
        }
      }
      return req.continue();
    });
    await hd.page.evaluateOnNewDocument(WATCH_SRC(watch));
    await goto(hd.page, `${HTTP_BASE}/#/bon-nuoc`);
    await waitSvg(hd.page, PUMP);
    await sleep(1500);
    const lockD = await attrOf(hd.page, PUMP, 'data-mat-lock');
    check(
      'HTTP khi HTTPS không chạy (system/info.warnings có HTTPS_DOWN, phản hồi bị sửa): khóa HTTPS_DOWN',
      lockD === 'HTTPS_DOWN',
      lockD,
    );
    if (lockD === 'HTTPS_DOWN') lockSet.add('HTTPS_DOWN');
    await hd.ctx.close();
    measures.lockCodesObservedOnX64 = [...lockSet].sort();
    measures.lockCodesNotReachableOnX64 = [
      'TAG_UNKNOWN',
      'TAG_READONLY',
      'NO_VALUE',
      'PROJECT_CHANGING',
    ];
    check(
      `khóa quan sát được trên runtime thật: ${lockSet.size}/13 mã (${[...lockSet].sort().join(', ')}); 4 mã còn lại cần Tag không hợp lệ hoặc thời điểm thoáng qua, kiểm bằng Vitest svg-action-controller`,
      lockSet.size >= 9,
    );
    measures.lockCodesCount = lockSet.size;
  }

  // =============================================================================== open-svg, f5x10-svg, load-svg (T108)

  /** Điều kiện "có giá trị sống": mọi phần tử chữ gắn Tag của project hiện số thập phân, trang Trực tuyến, đủ item. */
  function openCfg(projectDir) {
    const f = projectFacts(join(REPO, projectDir));
    const texts = f.bindings.filter(
      (b) =>
        b.target === 'text.content' &&
        !f.tags.find((t) => t.id === b.tagId && t.kind === 'calculated'),
    );
    const uids = [...new Set(texts.map((b) => b.uid))];
    const items = new Set(f.bindings.map((b) => `${b.screen}/${b.item}`));
    const entry = JSON.parse(
      readFileSync(join(REPO, projectDir, 'project.json'), 'utf8'),
    ).entryScreen;
    const onEntry = texts.filter((b) => b.screen === entry);
    const hosts = new Set(f.bindings.filter((b) => b.screen === entry).map((b) => b.item)).size;
    return {
      uids,
      expected: onEntry.length,
      hosts,
      bindings: f.bindings.length,
      events: f.events.length,
      items: items.size,
    };
  }
  const OPEN_SRC = (cfg) => `(function(){
    ${PAGE_LIB}
    window.__open = { t: null };
    const tick = () => {
      try {
        const up = (document.querySelector('#app-live') || {}).textContent === 'Trực tuyến';
        if (up && svgRoots().length >= ${cfg.hosts}) {
          let ok = true; let total = 0;
          for (const u of ${JSON.stringify(cfg.uids)}) {
            for (const e of deepAll('[data-mat-uid="' + u + '"]')) { total++; if (!/\\d+\\.\\d/.test(e.textContent)) ok = false; }
          }
          if (ok && total === ${cfg.expected}) { window.__open.t = performance.now(); window.__open.epoch = performance.timeOrigin + window.__open.t; return; }
        }
      } catch (e) { /* trang chưa sẵn sàng */ }
      setTimeout(tick, 10);
    };
    tick();
  })()`;
  const openTime = async (page, ms = 30000) => {
    await until(
      async () => (await page.evaluate('window.__open && window.__open.t')) != null,
      'giá trị sống',
      ms,
    );
    return page.evaluate('window.__open.t');
  };
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  async function openSvg(browser) {
    const cases = [
      [
        'std',
        'tests/web-it/out/std-3b',
        'màn hình chuẩn 3b (≈ 3.000 phần tử, 30 binding, 10 hoạt ảnh, 5 sự kiện, 100 Tag)',
      ],
      ['40', 'tests/web-it/out/svg-40', 'màn hình 40 item svg'],
    ];
    const which = opt('--which', 'std');
    for (const [name, dir, label] of cases.filter((c) => c[0] === which)) {
      const cfg = openCfg(dir);
      measures[`${name}Config`] = cfg;
      const runs = [];
      let elements = 0;
      for (let i = 0; i < 6; i++) {
        const { ctx, page } = await newPage(browser); // ngữ cảnh mới = bộ nhớ đệm trống
        await page.setViewport({ width: 1920, height: 1080 });
        await page.evaluateOnNewDocument(OPEN_SRC(cfg));
        await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
        runs.push(Math.round(await openTime(page)));
        if (i === 0)
          elements = await page.evaluate(
            `(function(){ ${PAGE_LIB} return svgRoots().reduce((n, [, r]) => n + r.querySelectorAll('*').length, 0); })()`,
          );
        await ctx.close();
      }
      measures[`${name}RunsMs`] = runs;
      measures[`${name}MedianMs`] = median(runs);
      measures[`${name}MaxMs`] = Math.max(...runs);
      measures[`${name}Elements`] = elements;
      check(
        `${label}: giá trị sống đầu tiên ≤ 2 s kể từ lúc nhập địa chỉ, bộ nhớ đệm trống (6 lần: ${runs.join(', ')} ms)`,
        runs.every((r) => r <= 2000),
        `trung vị ${median(runs)} ms, chậm nhất ${Math.max(...runs)} ms, ${elements} phần tử SVG đã dựng`,
      );
    }
  }

  async function f5x10Svg(browser) {
    const cfg = openCfg('tests/web-it/out/std-3b');
    const N = 10;
    const pages = [];
    for (let i = 0; i < N; i++) {
      const p = await newPage(browser);
      await p.page.setViewport({ width: 1920, height: 1080 });
      await p.page.evaluateOnNewDocument(OPEN_SRC(cfg));
      pages.push(p);
    }
    await Promise.all(
      pages.map(({ page }) => page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })),
    );
    await Promise.all(pages.map(({ page }) => openTime(page, 40000)));
    const rounds = [];
    for (let k = 0; k < 3; k++) {
      await sleep(1500);
      const t0 = Date.now();
      const times = await Promise.all(
        pages.map(async ({ page }) => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          try {
            await openTime(page, 20000);
            return (await page.evaluate('window.__open.epoch')) - t0;
          } catch {
            return Infinity;
          }
        }),
      );
      rounds.push(times.map((t) => Math.round(t)));
    }
    const worst = rounds.map((t) => Math.max(...t));
    measures.roundsMs = rounds;
    measures.worstMs = worst;
    measures.medianMs = median(rounds.flat());
    check(
      `10 phiên F5 cùng lúc trên màn hình chuẩn 3b: mọi trang có giá trị sống ≤ 5 s (3 vòng, chậm nhất ${worst.join(', ')} ms)`,
      worst.every((w) => w <= 5000),
      JSON.stringify(rounds),
    );
    const banners = await Promise.all(
      pages.map(({ page }) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))),
    );
    check(
      '0 trang báo "Đầy" (4429) do dựng phiên chậm',
      banners.every((t) => !/4429|Đầy|đầy chỗ|Đã đủ/i.test(t)),
      banners.filter((t) => /4429|Đầy|đầy chỗ|Đã đủ/i.test(t)).length,
    );
    for (const p of pages) await p.ctx.close();
  }

  async function loadSvg(browser) {
    const seconds = Number(opt('--seconds', '300'));
    const client = opt('--client', '');
    const cfg = openCfg('tests/web-it/out/load-3b');
    const N = 10;
    const pages = [];
    for (let i = 0; i < N; i++) {
      const p = await newPage(browser);
      await p.page.setViewport({ width: 1920, height: 1080 });
      await p.page.evaluateOnNewDocument(WS_HOOK);
      await p.page.evaluateOnNewDocument(OPEN_SRC({ ...cfg, expected: cfg.expected }));
      pages.push(p);
    }
    await Promise.all(
      pages.map(({ page }) => page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })),
    );
    await Promise.all(pages.map(({ page }) => openTime(page, 60000)));
    check('10 trang Chrome mở màn hình chuẩn 3b (500 Tag) và có giá trị sống', true);
    await sleep(5000);
    const sampler = new Promise((resolveP) => {
      if (!client) return resolveP(null);
      execFile(
        'docker',
        [
          'exec',
          client,
          'node',
          '/src/tests/web-it/proc-sample.mjs',
          '--seconds',
          String(seconds),
          '--interval',
          '5',
        ],
        { maxBuffer: 1 << 20 },
        (err, out) => {
          const line = String(out)
            .split('\n')
            .filter((l) => l.startsWith('{'))
            .at(-1);
          resolveP(line ? JSON.parse(line) : { error: String(err) });
        },
      );
    });
    const gapsAt = [];
    const t0 = Date.now();
    while (Date.now() - t0 < seconds * 1000) {
      await sleep(Math.min(60000, seconds * 1000 - (Date.now() - t0)) || 1);
      const st = await Promise.all(
        pages.map(({ page }) => page.evaluate('window.__seq').catch(() => null)),
      );
      gapsAt.push({
        s: Math.round((Date.now() - t0) / 1000),
        deltas: st.reduce((a, x) => a + (x?.deltas ?? 0), 0),
        gaps: st.reduce((a, x) => a + (x?.gaps ?? 0), 0),
      });
    }
    const proc = await sampler;
    const st = await Promise.all(pages.map(({ page }) => page.evaluate('window.__seq')));
    const onlineNow = await Promise.all(pages.map(({ page }) => live(page)));
    const totalDeltas = st.reduce((a, x) => a + x.deltas, 0);
    const totalGaps = st.reduce((a, x) => a + x.gaps, 0);
    const closes = st.reduce((a, x) => a + x.closes, 0);
    measures.seconds = seconds;
    measures.runtime = proc;
    measures.deltasTotal = totalDeltas;
    measures.deltasPerPage = Math.round(totalDeltas / N);
    measures.sequenceGaps = totalGaps;
    measures.wsCloses = closes;
    measures.wsKBPerPageSec =
      Math.round(st.reduce((a, x) => a + x.bytes, 0) / N / seconds / 102.4) / 10;
    measures.progress = gapsAt;
    const lf = projectFacts(join(REPO, 'tests/web-it/out/load-3b'));
    measures.tagsBoundOnScreen = new Set(lf.bindings.map((b) => b.tagId)).size;
    measures.tagUpdatesPerPageSec = Math.round(st.reduce((a, x) => a + x.entries, 0) / N / seconds);
    measures.runtimeTagsInProject = lf.tags.length;
    measures.runtimeSimulationTags = lf.tags.filter((t) => t.kind === 'simulation').length;
    check(
      `0 mất sequence trên 10 client trong ${seconds} s (${totalDeltas} delta nhận)`,
      totalGaps === 0 && totalDeltas > 0,
      `gaps ${totalGaps}`,
    );
    check(
      '10 client còn Trực tuyến đến cuối và không đóng kết nối giữa chừng',
      onlineNow.every((x) => x === 'Trực tuyến') && closes === 0,
      `${onlineNow.filter((x) => x === 'Trực tuyến').length}/10, đóng ${closes}`,
    );
    if (proc && !proc.error) {
      check(
        `CPU trung bình của mat-runtime ≤ 30 % một lõi (đo ${proc.cpuAvgPct} %, cửa sổ 5 s cao nhất ${proc.cpuMaxWindowPct} %)`,
        proc.cpuAvgPct <= 30,
      );
      check(
        `RSS của mat-runtime ≤ 150 MB (đầu ${proc.rssStartMB}, trung bình ${proc.rssAvgMB}, cao nhất ${proc.rssMaxMB}, cuối ${proc.rssEndMB} MB)`,
        proc.rssMaxMB <= 150,
      );
      check('mat-runtime không khởi động lại trong lúc đo', proc.runtimeGone === false);
    } else check('đo được CPU/RSS của mat-runtime', false, JSON.stringify(proc));
    for (const p of pages) await p.ctx.close();
  }

  return {
    svg: svgScenario,
    'svg-events': svgEvents,
    'open-svg': openSvg,
    'f5x10-svg': f5x10Svg,
    'load-svg': loadSvg,
  };
}
