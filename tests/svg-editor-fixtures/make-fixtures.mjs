// Sinh fixture của trình vẽ SVG (feature 011, T151; FR-117, SC-030, SC-034), tất định:
//   node tests/svg-editor-fixtures/make-fixtures.mjs           ghi tệp
//   node tests/svg-editor-fixtures/make-fixtures.mjs --check   thoát 1 khi tệp đã commit lệch
// 1. Mười tệp "đã nhập": fixture của feature 008 (tests/fixtures/svg-import: 4 Inkscape THẬT, 3 Illustrator và 3
//    CorelDRAW MÔ PHỎNG) chạy qua `importSvg` (UID theo seed) như Studio lưu vào project.
// 2. Mười tệp độc ở malicious/ (dán từ clipboard) và malicious/expect.json.
// 3. expected.json cho mọi fixture .svg ở thư mục này (kể cả tệp viết tay): sha256, byte, số phần tử, uid, hộp bao.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installDom } from '../../tools/svg-import/chrome-util.mjs';

installDom();
const { importSvg, makeSeededUid } = await import('../../packages/svg-import/src/index.ts');
const edit = await import('../../packages/svg-edit/src/index.ts');

const here = resolve(import.meta.dirname);
const src008 = resolve(here, '../fixtures/svg-import');
const check = process.argv.includes('--check');
const out = new Map();

// --- 1. tệp đã nhập ---------------------------------------------------------------------------------
export const IMPORTED = [
  ['inkscape-01-tank-process.svg', true],
  ['inkscape-02-motor-pump.svg', true],
  ['inkscape-03-panel-text.svg', true],
  ['inkscape-04-pipes-flow.svg', true],
  ['illustrator-01-saveas-legacy.svg', false],
  ['illustrator-02-export-cls.svg', false],
  ['illustrator-03-export-screens.svg', false],
  ['corel-01-mm-css.svg', false],
  ['corel-02-curves-clip.svg', false],
  ['corel-03-blend-pattern.svg', false],
];
for (const [name] of IMPORTED) {
  const r = importSvg(readFileSync(join(src008, name)), {
    uid: makeSeededUid('svg-editor:' + name),
    fileName: name,
  });
  if (!r.ok) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
  out.set('imported-' + name, r.svg);
}

// --- 2. tệp độc -------------------------------------------------------------------------------------
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const keep = '<rect width="10" height="10" fill="#4caf50"/>';
const bomb = () => {
  let s = `<svg ${NS} viewBox="0 0 10 10"><defs><rect id="l0" width="1" height="1"/>`;
  for (let k = 1; k <= 10; k++) {
    s += `<g id="l${k}">`;
    for (let j = 0; j < 10; j++) s += `<use href="#l${k - 1}"/>`;
    s += '</g>';
  }
  return s + '</defs><use href="#l10"/></svg>\n';
};
const MAL = {
  'm01-script.svg': [
    `<svg ${NS} viewBox="0 0 10 10"><script>alert(1)</script><script type="text/javascript"><![CDATA[fetch('//evil.invalid')]]></script>${keep}</svg>\n`,
    { outcome: 'sanitized', forbid: ['<script', 'alert', 'evil.invalid'], reported: ['R_SCRIPT'] },
  ],
  'm02-on-event.svg': [
    `<svg ${NS} viewBox="0 0 10 10" onload="alert(1)"><rect width="10" height="10" onclick="alert(2)" onmouseover="alert(3)"/><g onfocusin="alert(4)">${keep}</g></svg>\n`,
    {
      outcome: 'sanitized',
      forbid: ['onload', 'onclick', 'onmouseover', 'onfocusin', 'alert'],
      reported: ['R_EVENT_ATTR'],
    },
  ],
  'm03-foreign-object.svg': [
    `<svg ${NS} viewBox="0 0 10 10"><foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.invalid"></iframe></div></foreignObject>${keep}</svg>\n`,
    {
      outcome: 'sanitized',
      forbid: ['foreignObject', 'iframe', 'evil.invalid'],
      reported: ['R_FOREIGN'],
    },
  ],
  'm04-external-href.svg': [
    `<svg ${NS} ${XL} viewBox="0 0 10 10"><use href="https://evil.invalid/s.svg#a"/><use xlink:href="//evil.invalid/s.svg#b"/><image href="https://evil.invalid/x.png" width="5" height="5"/><rect width="5" height="5" fill="url(https://evil.invalid/p.svg#g)"/>${keep}</svg>\n`,
    { outcome: 'sanitized', forbid: ['evil.invalid'], reported: ['R_HREF_EXTERNAL'] },
  ],
  'm05-data-uri.svg': [
    `<svg ${NS} viewBox="0 0 10 10"><image width="5" height="5" href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIi8+"/><use href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"/>${keep}</svg>\n`,
    { outcome: 'sanitized', forbid: ['data:'], reported: [] },
  ],
  'm06-use-bomb.svg': [bomb(), { outcome: 'rejected', code: 'SVG_LIMIT' }],
  'm07-depth-33.svg': [
    `<svg ${NS} viewBox="0 0 10 10">` + '<g>'.repeat(31) + keep + '</g>'.repeat(31) + '</svg>\n',
    { outcome: 'rejected', code: 'SVG_LIMIT' },
  ],
  'm08-nodes-20001.svg': [
    `<svg ${NS} viewBox="0 0 10 10">\n` +
      '<rect width="1" height="1"/>\n'.repeat(20_000) +
      '</svg>\n',
    { outcome: 'rejected', code: 'SVG_LIMIT' },
  ],
  'm09-style-import.svg': [
    `<svg ${NS} viewBox="0 0 10 10"><style>@import url(https://evil.invalid/x.css); rect { fill: #f00 } @font-face { src: url(https://evil.invalid/f.woff) }</style><rect width="10" height="10" style="fill:#00f;background:url(https://evil.invalid/b.png)"/></svg>\n`,
    {
      outcome: 'sanitized',
      forbid: ['@import', 'evil.invalid', '<style', '@font-face'],
      reported: [],
    },
  ],
  'm10-javascript-url.svg': [
    `<svg ${NS} ${XL} viewBox="0 0 10 10"><a href="javascript:alert(1)">${keep}</a><use xlink:href="javascript:alert(2)"/><rect width="1" height="1" fill="url(javascript:alert(3))" style="fill:url(javascript:alert(4))"/></svg>\n`,
    { outcome: 'sanitized', forbid: ['javascript:'], reported: [] },
  ],
};
const expectMal = {};
for (const [name, [text, exp]] of Object.entries(MAL)) {
  out.set('malicious/' + name, text);
  expectMal[name] = exp;
}
out.set('malicious/expect.json', JSON.stringify(expectMal, null, 2) + '\n');

// --- 3. expected.json --------------------------------------------------------------------------------
const files = [
  ...readdirSync(here).filter((f) => f.endsWith('.svg') && !f.startsWith('imported-')),
  ...[...out.keys()].filter((k) => k.startsWith('imported-')),
].sort();
const expected = {};
const r3 = (n) => Math.round(n * 1000) / 1000;
for (const f of files) {
  const text = out.get(f) ?? readFileSync(join(here, f), 'utf8');
  const res = edit.parseDrawDoc(text, { uid: makeSeededUid(1) });
  if (!res.ok) throw new Error(`${f}: ${res.code} ${res.message}`);
  const doc = res.doc;
  const uids = [];
  const bboxes = {};
  for (const id of edit.documentOrder(doc)) {
    const u = doc.nodes.get(id).attrs.get('data-mat-uid');
    if (u === undefined) continue;
    uids.push(u);
    const b = edit.bbox(doc, id);
    if (b) bboxes[u] = [r3(b.x), r3(b.y), r3(b.width), r3(b.height)];
  }
  const canonical = edit.serialize(doc);
  expected[f] = {
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text),
    canonicalSha256: createHash('sha256').update(canonical).digest('hex'),
    elements: doc.elementCount,
    removed: res.report.removedElements + res.report.removedAttributes,
    rebuilt: res.report.rebuilt,
    uids,
    bboxes,
  };
}
out.set('expected.json', JSON.stringify(expected, null, 1) + '\n');

let bad = 0;
for (const [rel, text] of out) {
  const p = join(here, rel);
  if (check) {
    let cur = null;
    try {
      cur = readFileSync(p, 'utf8');
    } catch {
      // thiếu tệp
    }
    if (cur !== text) {
      console.error('lệch: ' + rel);
      bad++;
    }
  } else writeFileSync(p, text);
}
if (check && bad > 0) process.exit(1);
console.log(`${check ? 'đã kiểm' : 'đã ghi'} ${out.size} tệp; ${files.length} fixture`);
