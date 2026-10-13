import { describe, expect, it } from 'vitest';
import {
  isColor,
  isDataImage,
  isFontFamily,
  isHexColor,
  isHref,
  isId,
  isLength,
  isLocalUrl,
  isName,
  isNumber,
  isNumberList,
  isPaint,
  isPathData,
  isPoints,
  isUid,
  parseDeclarations,
  parseLocalUrl,
} from './css-value.ts';

const PNG = 'iVBORw0KGgo=';
const JPEG = '/9j/4A==';
const GIF = 'R0lGODlh';
const WEBP = 'UklGRgAAAABXRUJQ';

describe('isNumber, isNumberList, isLength', () => {
  it.each(['0', '1', '-1.5', '+2', '.5', '5.', '1e3', '1E-3', ' 7 ', '1e9', '-1e9'])(
    'số hợp lệ %s',
    (v) => expect(isNumber(v)).toBe(true),
  );
  it.each([
    '',
    'NaN',
    'Infinity',
    '-Infinity',
    '0x10',
    '1e999',
    '1e10',
    '1,5',
    '1 2',
    '1px',
    'e5',
    '--1',
    '1e',
    '1.2.3',
  ])('số không hợp lệ %j', (v) => expect(isNumber(v)).toBe(false));

  it('danh sách số', () => {
    expect(isNumberList('1 2,3 , 4')).toBe(true);
    expect(isNumberList('1,,2')).toBe(false);
    expect(isNumberList('1 2 NaN')).toBe(false);
    expect(isNumberList('')).toBe(false);
  });

  it.each(['10', '10px', '1.5em', '2ex', '50%', '1pt', '1pc', '1mm', '1cm', '1in', '-3e2px'])(
    'độ dài hợp lệ %s',
    (v) => expect(isLength(v)).toBe(true),
  );
  it.each(['10vw', '10rem', 'calc(1px+2px)', 'var(--x)', '1 px', 'px', '10PX2', 'auto'])(
    'độ dài không hợp lệ %s',
    (v) => expect(isLength(v)).toBe(false),
  );
});

describe('isColor, isPaint, url nội bộ', () => {
  it.each([
    '#f00',
    '#f00a',
    '#ff0000',
    '#ff0000aa',
    'rgb(1,2,3)',
    'rgb(1 2 3)',
    'rgba(1,2,3,0.5)',
    'rgb(10%, 20%, 30%)',
    'hsl(120, 50%, 50%)',
    'hsla(120,50%,50%,0.3)',
    'red',
    'Red',
    'rebeccapurple',
    'lightgoldenrodyellow',
    'currentColor',
    'currentcolor',
    'transparent',
    'inherit',
  ])('màu hợp lệ %s', (v) => expect(isColor(v)).toBe(true));
  it.each([
    '#ff',
    '#ggg',
    '#12345',
    'rgb(1,2)',
    'rgb(NaN,1,2)',
    'rgb(1,2,3',
    'redd',
    'var(--c)',
    'env(x)',
    'url(#g)',
    'none',
    'red;stroke:blue',
    'rgb(1,2,3);x',
    'calc(1)',
  ])('màu không hợp lệ %s', (v) => expect(isColor(v)).toBe(false));

  it('isHexColor', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#abcdef')).toBe(true);
    expect(isHexColor('#abcd')).toBe(false);
    expect(isHexColor('red')).toBe(false);
  });

  it.each([
    'none',
    'red',
    'url(#g1)',
    "url('#g1')",
    'url("#g1")',
    'url( #g1 )',
    'url(#g1) red',
    'url(#g1) none',
  ])('sơn hợp lệ %s', (v) => expect(isPaint(v)).toBe(true));
  it.each([
    'url(http://evil/x.svg#g)',
    'url(javascript:alert(1))',
    'url(//evil/x)',
    'url(#)',
    'url(#g1',
    'url(#g 1)',
    'url(#g1) url(#g2)',
    'url(#g1) bogus',
    'var(--p)',
    'url(data:image/png;base64,AAAA)',
  ])('sơn không hợp lệ %s', (v) => expect(isPaint(v)).toBe(false));

  it('isLocalUrl và parseLocalUrl', () => {
    expect(isLocalUrl('url(#abc)')).toBe(true);
    expect(isLocalUrl("url( '#abc' )")).toBe(true);
    expect(isLocalUrl('url(abc)')).toBe(false);
    expect(isLocalUrl('url(#abc) x')).toBe(false);
    expect(parseLocalUrl('url(#abc) red')).toEqual({ id: 'abc', rest: 'red' });
    expect(parseLocalUrl('url(http://x)')).toBeNull();
  });
});

describe('href và ảnh nhúng', () => {
  it('href nội bộ', () => {
    expect(isHref('#a')).toBe(true);
    expect(isHref(' #a ')).toBe(true);
    expect(isHref('#')).toBe(false);
    expect(isHref('http://x/y.svg#a')).toBe(false);
    expect(isHref('https://x')).toBe(false);
    expect(isHref('file:///etc/passwd')).toBe(false);
    expect(isHref('javascript:alert(1)')).toBe(false);
    expect(isHref('data:text/html,<script>1</script>')).toBe(false);
    expect(isHref('img.png')).toBe(false);
    expect(isHref(`data:image/png;base64,${PNG}`)).toBe(false); // chỉ khi cho phép ảnh
    expect(isHref(`data:image/png;base64,${PNG}`, true)).toBe(true);
    expect(isHref('#a', true)).toBe(true);
  });

  it.each([
    [`data:image/png;base64,${PNG}`, true],
    [`data:image/jpeg;base64,${JPEG}`, true],
    [`data:image/gif;base64,${GIF}`, true],
    [`data:image/webp;base64,${WEBP}`, true],
    [`DATA:IMAGE/PNG;BASE64,${PNG}`, true],
    [`data:image/png;base64,${PNG.slice(0, 4)}\n${PNG.slice(4)}`, true], // Inkscape ngắt dòng
    [`data:image/png;base64,${JPEG}`, false], // sai chữ ký
    [`data:image/jpeg;base64,${PNG}`, false],
    [`data:image/gif;base64,${PNG}`, false],
    [`data:image/webp;base64,${GIF}`, false],
    ['data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==', false],
    ['data:image/png;base64,', false],
    [`data:image/png,${PNG}`, false],
    [`data:image/png;base64,${PNG}!`, false],
    ['data:image/png;base64,iVBORw0KGgo', false], // thiếu đệm
    ['data:image/png;base64,iV=BORw0KGgo=', false],
    ['http://evil/x.png', false],
    ['data:text/html;base64,PHNjcmlwdD4=', false],
  ])('isDataImage(%s)', (v, ok) => expect(isDataImage(v)).toBe(ok));
});

describe('isPathData, isPoints', () => {
  it.each(['M0 0L10 10z', 'M0,0 h10 v10 H0 Z', 'm1.5-2.5c1 1 2 2 3 3', 'M1e2 1e-2L3 4', 'M0 0 a5 5 0 1 0 10 0'])(
    'path hợp lệ %s',
    (v) => expect(isPathData(v)).toBe(true),
  );
  it.each([
    '',
    'L10 10',
    'M0 0 foo',
    'M0 0 <script>',
    'M0 0 L NaN 1',
    'M0 0 L 1e12 1',
    'M0 0 B 1 1',
    'M0 0;fill:red',
    'M0 0 L 1 1)',
  ])('path không hợp lệ %j', (v) => expect(isPathData(v)).toBe(false));
  it('path quá 1 MiB bị từ chối', () => {
    expect(isPathData('M0 0' + ' L1 1'.repeat(220000))).toBe(false);
  });

  it('points: số chẵn các số', () => {
    expect(isPoints('0,0 10,10')).toBe(true);
    expect(isPoints('0 0 10 10 5 5')).toBe(true);
    expect(isPoints('0,0 10')).toBe(false);
    expect(isPoints('0,0 a,b')).toBe(false);
    expect(isPoints('')).toBe(false);
  });
});

describe('isFontFamily', () => {
  it.each([
    'Arial',
    'Arial, Helvetica, sans-serif',
    "'Segoe UI', Arial",
    '"Times New Roman", serif',
    'Noto Sans CJK JP',
    'Tahoma',
  ])('hợp lệ %s', (v) => expect(isFontFamily(v)).toBe(true));
  it.each([
    'url(http://evil/f.woff)',
    'Arial; fill:red',
    'Arial{',
    'Arial\\',
    "'Arial",
    'a,,b',
    '',
    'Arial, url',
    '"x(y)"',
  ])('không hợp lệ %s', (v) => expect(isFontFamily(v)).toBe(false));
});

describe('isId, isUid, isName', () => {
  it('isId', () => {
    for (const v of ['a', '_a', 'tank-1.x:y_z', 'A'.repeat(128)]) expect(isId(v)).toBe(true);
    for (const v of ['', '1a', '-a', 'a b', "a'b", 'a<b', 'a&b', 'a"b', 'A'.repeat(129)])
      expect(isId(v)).toBe(false);
  });
  it('isUid', () => {
    for (const v of ['el_abc', 'el_a2c4e6g8h0', 'el_' + 'a'.repeat(40)]) expect(isUid(v)).toBe(true);
    for (const v of ['', 'el_', 'el_ab', 'el_ABC', 'el_a-c', 'x_abc', 'el_' + 'a'.repeat(41), 'el_abc '])
      expect(isUid(v)).toBe(false);
  });
  it('isName', () => {
    expect(isName('Bồn chứa 1')).toBe(true);
    expect(isName('a'.repeat(80))).toBe(true);
    expect(isName('a'.repeat(81))).toBe(false);
    expect(isName('a\u0007b')).toBe(false);
    expect(isName('a\nb')).toBe(false);
    expect(isName('')).toBe(false);
  });
});

describe('parseDeclarations (bộ tách từ vựng CSS)', () => {
  it('tách khai báo, bỏ bình luận, nhận !important', () => {
    expect(parseDeclarations('fill: red; /* x;y */ stroke:#000 !important;opacity:.5')).toEqual([
      { prop: 'fill', value: 'red', important: false },
      { prop: 'stroke', value: '#000', important: true },
      { prop: 'opacity', value: '.5', important: false },
    ]);
  });

  it('dấu ; trong chuỗi và trong ngoặc không tách', () => {
    expect(
      parseDeclarations(`font-family:"a;b";fill:url(data:image/png;base64,AAAA);stroke:red`),
    ).toEqual([
      { prop: 'font-family', value: '"a;b"', important: false },
      { prop: 'fill', value: 'url(data:image/png;base64,AAAA)', important: false },
      { prop: 'stroke', value: 'red', important: false },
    ]);
  });

  it('giải thoát một lần (\\75rl -> url) rồi trả giá trị đã giải', () => {
    const d = parseDeclarations('fill:\\75rl(http://evil/x)');
    expect(d).toHaveLength(1);
    expect(d[0].value).toBe('url(http://evil/x)');
    expect(isPaint(d[0].value)).toBe(false);
  });

  it('tên thuộc tính thoát và hoa thường', () => {
    expect(parseDeclarations('FILL:red; \\66ill:blue').map((d) => d.prop)).toEqual(['fill', 'fill']);
  });

  it('bỏ khai báo hỏng, không ném lỗi', () => {
    expect(parseDeclarations('novalue; :x; fill:; stroke:red')).toEqual([
      { prop: 'stroke', value: 'red', important: false },
    ]);
    expect(parseDeclarations('fill:red;;;')).toHaveLength(1);
    expect(parseDeclarations('/* chưa đóng')).toEqual([]);
    expect(parseDeclarations('fill:"chưa đóng')).toEqual([]);
  });
});
