/* global document, window */
// e2e trang vận hành lọc lại SVG (feature 008, T061, FR-023, US1-12): runtime giả phục vụ một project có file SVG
// chứa `script`, `onload`, `onclick`, `javascript:`, ảnh/use/iframe/CSS tải từ ngoài (SVG không qua Studio, tức trang
// là lớp phòng thủ cuối). Trang chỉ dựng bằng đường `mountScreen` đã đổi ở T022. Kỳ vọng: `window.__pwned` vẫn null kể cả
// sau khi nhấp mọi phần tử, 0 yêu cầu tới nguồn ngoài, DOM trong Shadow DOM không còn script, on*, href ngoài; phần tử
// hợp lệ (data-mat-uid) vẫn được vẽ. Đối chứng: cùng nội dung mở như tài liệu SVG độc lập làm `__pwned` khác null, nên
// canary và đếm mạng có hiệu lực. File độc hại được đưa vào bằng chặn yêu cầu của trình duyệt, không sửa runtime giả.
import { sleep, waitDeep } from './util.mjs';

export const options = { project: 'anim', drift: false };

const EVIL = 'http://evil.invalid';
const MALICIOUS = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 300" onload="window.__pwned='onload-root'">
  <script>window.__pwned='script'</script>
  <defs><script>window.__pwned='script-defs'</script></defs>
  <style>@import url(${EVIL}/a.css); rect { fill: url(${EVIL}/f.svg#x); }</style>
  <g transform="translate(20 20)"><path data-mat-uid="el_curve" onclick="window.__pwned='onclick'" onmouseover="window.__pwned='mouseover'" d="M0 100 C 0 0 100 0 100 100 Z" fill="#ef4444"/></g>
  <a href="javascript:window.__pwned='js-href'" xlink:href="javascript:window.__pwned='js-xlink'"><rect data-mat-uid="el_group" x="150" y="20" width="110" height="100" fill="#3b82f6"/></a>
  <image href="${EVIL}/x.png" x="0" y="0" width="10" height="10"/>
  <use href="${EVIL}/s.svg#a"/>
  <use xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/>
  <foreignObject x="0" y="0" width="100" height="100"><iframe xmlns="http://www.w3.org/1999/xhtml" src="${EVIL}/frame"/><body xmlns="http://www.w3.org/1999/xhtml" onload="window.__pwned='fo-body'"/></foreignObject>
  <animate attributeName="href" values="javascript:window.__pwned='smil'" dur="1s" repeatCount="indefinite"/>
  <set attributeName="onclick" to="window.__pwned='set'"/>
  <rect data-mat-uid="el_blink" x="300" y="200" width="30" height="30" fill="#f59e0b" style="fill:url(${EVIL}/g.svg#y)" filter="url(${EVIL}/h.svg#z)"/>
</svg>`;

export default async function run(ctx) {
  const { page, rt, browser } = ctx;
  const origin = new URL(rt.httpUrl).origin;
  const external = [];
  let served = 0;

  /** Chặn mọi yêu cầu; file SVG của màn hình `anim` được thay bằng bản độc hại; yêu cầu ra ngoài nguồn bị đếm và hủy. */
  const guard = async (p, rawUrl) => {
    await p.setRequestInterception(true);
    p.on('request', (req) => {
      const u = req.url();
      if (u.endsWith('/project/screens/anim.svg')) {
        served++;
        req.respond({ status: 200, contentType: 'image/svg+xml', body: MALICIOUS });
      } else if (rawUrl && u === rawUrl) {
        req.respond({ status: 200, contentType: 'image/svg+xml', body: MALICIOUS });
      } else if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) {
        req.continue();
      } else {
        external.push(u);
        req.abort();
      }
    });
    await p.evaluateOnNewDocument(() => {
      window.__pwned = null;
    });
  };

  await guard(page);
  ctx.allowConsole.push('evil.invalid', 'ERR_FAILED', 'Content Security Policy', 'javascript:');
  await page.goto(ctx.url, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, '[data-mat-uid="el_curve"]', 1);
  await sleep(500);

  ctx.check(
    'trang nhận file SVG độc hại qua đường /project/',
    served >= 1,
    `đã phục vụ ${served} lần`,
  );

  const state = () =>
    page.evaluate(() => {
      const root = document
        .querySelector('mat-screen')
        .shadowRoot.querySelector('.svg-host').shadowRoot;
      const all = [...root.querySelectorAll('*')];
      const attrs = all.flatMap((e) =>
        [...e.attributes].map((a) => [e.localName, a.name, a.value]),
      );
      return {
        pwned: window.__pwned,
        tags: all.map((e) => e.localName),
        onAttrs: attrs.filter(([, n]) => n.toLowerCase().startsWith('on')).length,
        badHref: attrs.filter(
          ([, n, v]) => /(^|:)href$/i.test(n) && !/^#|^data:image\//i.test(v.trim()),
        ).length,
        styleExternal: attrs.filter(([, n, v]) => /url\s*\(\s*['"]?\s*(?!#)/i.test(v) && n !== 'd')
          .length,
        uids: all
          .filter((e) => e.hasAttribute('data-mat-uid'))
          .map((e) => e.getAttribute('data-mat-uid')),
      };
    });

  const s0 = await state();
  ctx.check('sau khi dựng: __pwned là null', s0.pwned === null, String(s0.pwned));
  ctx.check(
    'không còn script, foreignObject, iframe, animate, set, use ngoài trong DOM',
    !s0.tags.some((t) =>
      ['script', 'foreignobject', 'iframe', 'animate', 'set', 'body'].includes(t),
    ),
    s0.tags.join(','),
  );
  ctx.check('không còn thuộc tính on*', s0.onAttrs === 0, String(s0.onAttrs));
  ctx.check('không còn href ngoài (chỉ #id hoặc data:image)', s0.badHref === 0, String(s0.badHref));
  ctx.check(
    'không còn url() ngoài trong thuộc tính',
    s0.styleExternal === 0,
    String(s0.styleExternal),
  );
  ctx.check(
    'phần tử hợp lệ vẫn được vẽ (el_curve, el_group, el_blink)',
    ['el_curve', 'el_group', 'el_blink'].every((u) => s0.uids.includes(u)),
    s0.uids.join(','),
  );

  // nhấp thật và bắn sự kiện trên mọi phần tử
  for (const uid of ['el_curve', 'el_group', 'el_blink']) {
    const box = await page.evaluate((u) => {
      const root = document
        .querySelector('mat-screen')
        .shadowRoot.querySelector('.svg-host').shadowRoot;
      const r = root.querySelector(`[data-mat-uid="${u}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, uid);
    await page.mouse.move(box.x, box.y);
    await page.mouse.click(box.x, box.y);
  }
  await page.evaluate(() => {
    const root = document
      .querySelector('mat-screen')
      .shadowRoot.querySelector('.svg-host').shadowRoot;
    for (const el of root.querySelectorAll('*'))
      for (const t of ['click', 'mouseover', 'focus', 'load', 'error'])
        el.dispatchEvent(new Event(t, { bubbles: true }));
  });
  await sleep(1500); // chờ SMIL (nếu còn) và bộ đếm giờ
  const s1 = await state();
  ctx.check(
    'sau khi nhấp mọi phần tử và chờ 1,5 giây: __pwned vẫn null',
    s1.pwned === null,
    String(s1.pwned),
  );
  ctx.check('0 yêu cầu mạng ra ngoài nguồn runtime', external.length === 0, external.join(', '));
  await ctx.shot('da-loc');

  // đối chứng: cùng nội dung mở như tài liệu SVG độc lập làm canary kích hoạt và mạng bị đếm
  const control = await browser.newPage();
  const rawUrl = `${origin}/__control.svg`;
  const before = external.length;
  await guard(control, rawUrl);
  await control.goto(rawUrl, { waitUntil: 'load' }).catch(() => undefined);
  await sleep(300);
  const pwned = await control.evaluate(() => window.__pwned).catch(() => null);
  ctx.check('đối chứng: bản gốc không lọc làm __pwned khác null', pwned !== null, String(pwned));
  ctx.check(
    'đối chứng: bản gốc làm trình duyệt xin tài nguyên ngoài (việc đếm mạng có hiệu lực)',
    external.length > before,
    `${external.length - before} yêu cầu`,
  );
  await control.close();
}
