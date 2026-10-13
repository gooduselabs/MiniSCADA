/* global document */
// Hàm dùng chung của các kịch bản e2e của trang vận hành (không phải kịch bản: run.mjs chỉ chạy *.e2e.mjs).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mã chạy trong trang: tìm phần tử theo bộ chọn, đi xuyên Shadow DOM mở. */
const DEEP = `
  const deepAll = (root, sel, out = []) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.matches(sel)) out.push(el);
    }
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) deepAll(el.shadowRoot, sel, out);
    return out;
  };
  const fullText = (n) => {
    let t = '';
    for (const c of (n.shadowRoot ?? n).childNodes) {
      if (c.nodeType === 3) t += c.textContent;
      else if (c.nodeType === 1 && c.tagName !== 'STYLE') t += ' ' + fullText(c) + ' ';
    }
    if (n.shadowRoot) for (const c of n.childNodes) if (c.nodeType === 3) t += c.textContent;
    return t;
  };
`;

/** Đoạn văn bản (rút gọn khoảng trắng) của phần tử đầu tiên khớp, hoặc null. */
/** Chạy `body` trong trang với `sel`, `arg` và hàm DEEP; `page.evaluate` nhận biểu thức chuỗi (không cần new Function). */
const inPage = (page, body, sel, arg) =>
  page.evaluate(
    `(function (sel, arg) { ${DEEP} ${body} })(${JSON.stringify(sel)}, ${JSON.stringify(arg ?? null)})`,
  );

/** Đoạn văn bản (rút gọn khoảng trắng) của phần tử đầu tiên khớp, hoặc null. */
export async function deepText(page, sel) {
  const t = await inPage(
    page,
    'const e = deepAll(document, sel)[0]; return e ? fullText(e) : null;',
    sel,
  );
  return t === null ? null : t.replace(/\s+/g, ' ').trim();
}

export function deepCount(page, sel) {
  return inPage(page, 'return deepAll(document, sel).length;', sel);
}

/** Chạy `fnBody` (chuỗi, `els` = mọi phần tử khớp, `arg`) trong trang. */
export function deepEval(page, sel, fnBody, arg) {
  return inPage(page, `const els = deepAll(document, sel); ${fnBody}`, sel, arg);
}

export const deepClick = (page, sel, index = 0) =>
  deepEval(page, sel, 'const e = els[arg]; if (!e) return false; e.click(); return true;', index);

/** Chờ tới khi `deepCount(sel) >= n`. */
export async function waitDeep(page, sel, n = 1, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await deepCount(page, sel)) >= n) return;
    await sleep(50);
  }
  throw new Error(`hết giờ chờ "${sel}" (cần ${n})`);
}

/** Chờ điều kiện đồng bộ trong Node (hàm async trả boolean). */
export async function until(fn, label, timeout = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(50);
  }
  throw new Error(`hết giờ chờ: ${label}`);
}

export const bodyText = (page) =>
  page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());

export async function setTheme(page, theme) {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await sleep(80);
}

/** axe ở cả hai theme (sáng rồi tối). */
export async function axeBoth(ctx, label) {
  await setTheme(ctx.page, 'light');
  await ctx.axe(`${label}, theme sáng`);
  await setTheme(ctx.page, 'dark');
  await ctx.axe(`${label}, theme tối`);
  await setTheme(ctx.page, 'light');
}
