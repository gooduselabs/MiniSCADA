// Sinh bộ vector dùng chung của driver Mitsubishi MC (feature 017; specs/017-driver-mc/plan.md "Địa chỉ Tag MC",
// contracts/mc-protocol.md): TS (@mat/tag-codec parseMcAddress, tools/mc-sim) và C++ (drivers/mc).
//
//   node tests/mc-vectors/generate.mjs
//
// Ra: address.json (địa chỉ Tag), frames.json (khung binary/ASCII, 3E/4E). Mọi kết quả VIẾT TAY từ hợp đồng, không
// tính bằng mã được kiểm. Khung binary theo cấu trúc trong tài liệu công khai của Mitsubishi (SLMP Reference Manual
// SH-080956ENG, MELSEC Communication Protocol Reference Manual SH-080008): 0401 D100 3 điểm, 0401/0001 M100 8 điểm
// (trả lời 00 01 00 11), 1401, 0403, trả lời lỗi 9 byte. Chưa đối chiếu với PLC thật (spec Assumptions).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const writeCases = (file, cases) =>
  writeFileSync(
    join(here, file),
    `{\n"cases": [\n${cases.map((c) => '  ' + JSON.stringify(c)).join(',\n')}\n]\n}\n`,
  );

// ---------------- address.json ----------------
// Mỗi ca: address, rawType, [stringLength], [xyNotation: hex|octal], [access: R|RW]; expect là
// { normalized, device, code (mã binary), bitDevice, number, words, bit } hoặc { error }.
// words: số word trên dây (thiết bị bit: 1 điểm, tính 1).
const A = [];
const ok = (name, address, rawType, expect, extra = {}) =>
  A.push({ name, address, rawType, ...extra, expect });
const err = (name, address, rawType, error, extra = {}) =>
  A.push({ name, address, rawType, ...extra, expect: { error } });
const r = (normalized, device, code, bitDevice, number, words, bit = null) => ({
  normalized,
  device,
  code,
  bitDevice,
  number,
  words,
  bit,
});

// thiết bị word, thập phân
ok('d100-int16', 'D100', 'INT16', r('D100', 'D', 0xa8, false, 100, 1));
ok('d0-uint16', 'D0', 'UINT16', r('D0', 'D', 0xa8, false, 0, 1));
ok('d200-float32', 'D200', 'FLOAT32', r('D200', 'D', 0xa8, false, 200, 2));
ok('d300-int32', 'D300', 'INT32', r('D300', 'D', 0xa8, false, 300, 2));
ok('d400-uint32', 'D400', 'UINT32', r('D400', 'D', 0xa8, false, 400, 2));
ok('d500-float64', 'D500', 'FLOAT64', r('D500', 'D', 0xa8, false, 500, 4));
ok('d600-int64', 'D600', 'INT64', r('D600', 'D', 0xa8, false, 600, 4));
ok('d700-string-10', 'D700', 'STRING', r('D700', 'D', 0xa8, false, 700, 5), { stringLength: 10 });
ok('d800-string-11', 'D800', 'STRING', r('D800', 'D', 0xa8, false, 800, 6), { stringLength: 11 });
ok('d-lower', 'd12', 'INT16', r('D12', 'D', 0xa8, false, 12, 1));
ok('d-leading-zero', 'D0010', 'INT16', r('D0010', 'D', 0xa8, false, 10, 1));
ok('r10', 'R10', 'INT16', r('R10', 'R', 0xaf, false, 10, 1));
ok('zr1000', 'ZR1000', 'INT32', r('ZR1000', 'ZR', 0xb0, false, 1000, 2));
ok('zr-big', 'ZR16777214', 'INT16', r('ZR16777214', 'ZR', 0xb0, false, 16777214, 1));
ok('sd210', 'SD210', 'UINT16', r('SD210', 'SD', 0xa9, false, 210, 1));
ok('tn0', 'TN0', 'INT16', r('TN0', 'TN', 0xc2, false, 0, 1));
ok('cn3', 'CN3', 'UINT16', r('CN3', 'CN', 0xc5, false, 3, 1));
// thiết bị word, hex
ok('w1a', 'W1A', 'INT16', r('W1A', 'W', 0xb4, false, 26, 1));
ok('w-lower', 'w1fff', 'UINT16', r('W1FFF', 'W', 0xb4, false, 8191, 1));
// bit trong word
ok('d100-bit5', 'D100.5', 'BOOL', r('D100.5', 'D', 0xa8, false, 100, 1, 5));
ok('d100-bitf', 'D100.F', 'BOOL', r('D100.F', 'D', 0xa8, false, 100, 1, 15));
ok('d100-bita-lower', 'd100.a', 'BOOL', r('D100.A', 'D', 0xa8, false, 100, 1, 10));
ok('w10-bit0', 'W10.0', 'BOOL', r('W10.0', 'W', 0xb4, false, 16, 1, 0));
ok('sd0-bit1', 'SD0.1', 'BOOL', r('SD0.1', 'SD', 0xa9, false, 0, 1, 1));
// thiết bị bit
ok('m10', 'M10', 'BOOL', r('M10', 'M', 0x90, true, 10, 1));
ok('m8191', 'M8191', 'BOOL', r('M8191', 'M', 0x90, true, 8191, 1));
ok('x1f-hex', 'X1F', 'BOOL', r('X1F', 'X', 0x9c, true, 31, 1));
ok('y20-hex', 'Y20', 'BOOL', r('Y20', 'Y', 0x9d, true, 32, 1), { access: 'RW' });
ok('x17-octal', 'X17', 'BOOL', r('X17', 'X', 0x9c, true, 15, 1), { xyNotation: 'octal' });
ok('y20-octal', 'Y20', 'BOOL', r('Y20', 'Y', 0x9d, true, 16, 1), { xyNotation: 'octal' });
ok('b-hex-octal-dev', 'B1F', 'BOOL', r('B1F', 'B', 0xa0, true, 31, 1), { xyNotation: 'octal' });
ok('l5', 'L5', 'BOOL', r('L5', 'L', 0x92, true, 5, 1));
ok('sm400', 'SM400', 'BOOL', r('SM400', 'SM', 0x91, true, 400, 1));
ok('m-rw', 'M100', 'BOOL', r('M100', 'M', 0x90, true, 100, 1), { access: 'RW' });
ok('d-bit-rw', 'D10.3', 'BOOL', r('D10.3', 'D', 0xa8, false, 10, 1, 3), { access: 'RW' });
ok('max-range', 'D16777215', 'INT16', r('D16777215', 'D', 0xa8, false, 16777215, 1));
// cú pháp
err('empty', '', 'INT16', 'E_ADDR_SYNTAX');
err('no-number', 'D', 'INT16', 'E_ADDR_SYNTAX');
err('unknown-device', 'Q100', 'INT16', 'E_ADDR_SYNTAX');
err('modbus-style', 'HR100', 'INT16', 'E_ADDR_SYNTAX');
err('space', 'D 100', 'INT16', 'E_ADDR_SYNTAX');
err('trailing-space', 'D100 ', 'INT16', 'E_ADDR_SYNTAX');
err('hex-in-decimal', 'D1A', 'INT16', 'E_ADDR_SYNTAX');
err('octal-8', 'X18', 'BOOL', 'E_ADDR_SYNTAX', { xyNotation: 'octal' });
err('bit-two-digits', 'D100.10', 'BOOL', 'E_ADDR_SYNTAX');
err('bit-g', 'D100.G', 'BOOL', 'E_ADDR_SYNTAX');
err('bit-empty', 'D100.', 'BOOL', 'E_ADDR_SYNTAX');
err('decimal-too-long', 'D123456789', 'INT16', 'E_ADDR_SYNTAX');
err('hex-too-long', 'W1234567', 'INT16', 'E_ADDR_SYNTAX');
err('negative', 'D-1', 'INT16', 'E_ADDR_SYNTAX');
// vùng, kiểu
err('bit-device-int', 'M10', 'INT16', 'E_ADDR_AREA');
err('bit-device-with-bit', 'M10.1', 'BOOL', 'E_ADDR_AREA');
err('word-bool-no-bit', 'D100', 'BOOL', 'E_ADDR_AREA');
err('bit-on-int16', 'D100.5', 'INT16', 'E_ADDR_AREA');
err('x-rw', 'X10', 'BOOL', 'E_ADDR_AREA', { access: 'RW' });
// khoảng
err('range-dword-end', 'D16777215', 'INT32', 'E_ADDR_RANGE');
err('range-number', 'ZR16777216', 'INT16', 'E_ADDR_RANGE');
err('range-hex', 'WFFFFFF', 'FLOAT64', 'E_ADDR_RANGE');
ok('range-hex-last', 'WFFFFFF', 'INT16', r('WFFFFFF', 'W', 0xb4, false, 16777215, 1));

writeCases('address.json', A);

// ---------------- frames.json ----------------
// Mỗi ca: options { frame: 3E|4E, code: binary|ascii, network, station, moduleIo, moduleStation, timer, serial,
// xyOctal }, request { cmd: batchReadWords|batchReadBits|batchWriteWords|batchWriteBits|randomRead, device,
// number, points, words, bits, randomWords, randomDwords }, wire (hex với binary, chữ với ASCII), và responses: mỗi
// trả lời { wire, expect: { issue: none|format|route|serial|length, endCode, words, bits } }.
// Thiết bị trong request: { device, number } với device là tên ở hợp đồng §1.
const F = [];
const BASE = {
  frame: '3E',
  code: 'binary',
  network: 0,
  station: 255,
  moduleIo: 0x03ff,
  moduleStation: 0,
  timer: 16,
  serial: 0,
  xyOctal: false,
};
const frame = (name, options, request, wire, responses) =>
  F.push({ name, options: { ...BASE, ...options }, request, wire, responses });

// 0401 word: D100, 3 điểm
frame(
  'b3e-read-d100-3',
  {},
  { cmd: 'batchReadWords', device: 'D', number: 100, points: 3 },
  '50 00 00 FF FF 03 00 0C 00 10 00 01 04 00 00 64 00 00 A8 03 00',
  [
    {
      wire: 'D0 00 00 FF FF 03 00 08 00 00 00 34 12 02 00 EF 1D',
      expect: { issue: 'none', endCode: 0, words: [0x1234, 0x0002, 0x1def] },
    },
    // trả lời lỗi: end code C056 + 9 byte thông tin lỗi
    {
      wire: 'D0 00 00 FF FF 03 00 0B 00 56 C0 00 FF FF 03 00 01 04 00 00',
      expect: { issue: 'none', endCode: 0xc056 },
    },
    // thiếu một word
    { wire: 'D0 00 00 FF FF 03 00 06 00 00 00 34 12 02 00', expect: { issue: 'length' } },
    // khác trạm (PC no 01)
    {
      wire: 'D0 00 00 01 FF 03 00 08 00 00 00 34 12 02 00 EF 1D',
      expect: { issue: 'route' },
    },
    // subheader sai
    { wire: 'D4 00 00 FF FF 03 00 08 00 00 00 34 12 02 00 EF 1D', expect: { issue: 'format' } },
  ],
);
// 0401 bit: M100, 8 điểm, trả lời 00 01 00 11
frame(
  'b3e-read-bits-m100-8',
  {},
  { cmd: 'batchReadBits', device: 'M', number: 100, points: 8 },
  '50 00 00 FF FF 03 00 0C 00 10 00 01 04 01 00 64 00 00 90 08 00',
  [
    {
      wire: 'D0 00 00 FF FF 03 00 06 00 00 00 00 01 00 11',
      expect: { issue: 'none', endCode: 0, bits: [0, 0, 0, 1, 0, 0, 1, 1] },
    },
  ],
);
// 0401 bit lẻ điểm: 3 điểm -> 2 byte, nibble thấp của byte cuối bỏ qua
frame(
  'b3e-read-bits-odd',
  {},
  { cmd: 'batchReadBits', device: 'Y', number: 0x20, points: 3 },
  '50 00 00 FF FF 03 00 0C 00 10 00 01 04 01 00 20 00 00 9D 03 00',
  [
    {
      wire: 'D0 00 00 FF FF 03 00 04 00 00 00 10 10',
      expect: { issue: 'none', endCode: 0, bits: [1, 0, 1] },
    },
  ],
);
// 0401 word trên thiết bị bit: M0..M31 (2 word)
frame(
  'b3e-read-words-of-bits',
  {},
  { cmd: 'batchReadWords', device: 'M', number: 0, points: 2 },
  '50 00 00 FF FF 03 00 0C 00 10 00 01 04 00 00 00 00 00 90 02 00',
  [
    {
      wire: 'D0 00 00 FF FF 03 00 06 00 00 00 01 80 00 00',
      expect: { issue: 'none', endCode: 0, words: [0x8001, 0] },
    },
  ],
);
// ZR (số lớn), X (hex)
frame(
  'b3e-read-zr',
  {},
  { cmd: 'batchReadWords', device: 'ZR', number: 70000, points: 1 },
  '50 00 00 FF FF 03 00 0C 00 10 00 01 04 00 00 70 11 01 B0 01 00',
  [
    {
      wire: 'D0 00 00 FF FF 03 00 04 00 00 00 FF FF',
      expect: { issue: 'none', endCode: 0, words: [0xffff] },
    },
  ],
);
// 1401 word: D100 = 0x1995, D101 = 0x1202
frame(
  'b3e-write-d100',
  {},
  { cmd: 'batchWriteWords', device: 'D', number: 100, words: [0x1995, 0x1202] },
  '50 00 00 FF FF 03 00 10 00 10 00 01 14 00 00 64 00 00 A8 02 00 95 19 02 12',
  [
    { wire: 'D0 00 00 FF FF 03 00 02 00 00 00', expect: { issue: 'none', endCode: 0 } },
    // ghi khi RUN bị cấm (ví dụ): end code khác 0
    {
      wire: 'D0 00 00 FF FF 03 00 0B 00 5B C0 00 FF FF 03 00 01 14 00 00',
      expect: { issue: 'none', endCode: 0xc05b },
    },
    // trả lời có dữ liệu thừa
    { wire: 'D0 00 00 FF FF 03 00 04 00 00 00 00 00', expect: { issue: 'length' } },
  ],
);
// 1401 bit: M100..M103 = 1 0 1 1
frame(
  'b3e-write-bits-m100',
  {},
  { cmd: 'batchWriteBits', device: 'M', number: 100, bits: [1, 0, 1, 1] },
  '50 00 00 FF FF 03 00 0E 00 10 00 01 14 01 00 64 00 00 90 04 00 10 11',
  [{ wire: 'D0 00 00 FF FF 03 00 02 00 00 00', expect: { issue: 'none', endCode: 0 } }],
);
// 1401 bit một điểm OFF
frame(
  'b3e-write-bit-y20-off',
  {},
  { cmd: 'batchWriteBits', device: 'Y', number: 0x20, bits: [0] },
  '50 00 00 FF FF 03 00 0D 00 10 00 01 14 01 00 20 00 00 9D 01 00 00',
  [{ wire: 'D0 00 00 FF FF 03 00 02 00 00 00', expect: { issue: 'none', endCode: 0 } }],
);
// 0403: word D0, TN0, M100 (word); dword D1500, Y160
frame(
  'b3e-random-read',
  {},
  {
    cmd: 'randomRead',
    randomWords: [
      { device: 'D', number: 0 },
      { device: 'TN', number: 0 },
      { device: 'M', number: 100 },
    ],
    randomDwords: [
      { device: 'D', number: 1500 },
      { device: 'Y', number: 0x160 },
    ],
  },
  '50 00 00 FF FF 03 00 1C 00 10 00 03 04 00 00 03 02 00 00 00 A8 00 00 00 C2 64 00 00 90 DC 05 00 A8 60 01 00 9D',
  [
    {
      wire: 'D0 00 00 FF FF 03 00 10 00 00 00 95 19 02 12 30 20 4F 48 C3 02 B9 6B 12 00',
      // dword: word thấp trước -> [low, high]
      expect: {
        issue: 'none',
        endCode: 0,
        words: [0x1995, 0x1202, 0x2030, 0x484f, 0x02c3, 0x6bb9, 0x0012],
      },
    },
  ],
);
// định tuyến khác mặc định
frame(
  'b3e-route',
  { network: 1, station: 2, moduleIo: 0x03e0, moduleStation: 5, timer: 3 },
  { cmd: 'batchReadWords', device: 'W', number: 0x100, points: 1 },
  '50 00 01 02 E0 03 05 0C 00 03 00 01 04 00 00 00 01 00 B4 01 00',
  [
    {
      wire: 'D0 00 01 02 E0 03 05 04 00 00 00 07 00',
      expect: { issue: 'none', endCode: 0, words: [7] },
    },
    { wire: 'D0 00 01 02 E0 03 00 04 00 00 00 07 00', expect: { issue: 'route' } },
  ],
);
// 4E binary
frame(
  'b4e-read-d100',
  { frame: '4E', serial: 0x1234 },
  { cmd: 'batchReadWords', device: 'D', number: 100, points: 1 },
  '54 00 34 12 00 00 00 FF FF 03 00 0C 00 10 00 01 04 00 00 64 00 00 A8 01 00',
  [
    {
      wire: 'D4 00 34 12 00 00 00 FF FF 03 00 04 00 00 00 2A 00',
      expect: { issue: 'none', endCode: 0, words: [42] },
    },
    { wire: 'D4 00 35 12 00 00 00 FF FF 03 00 04 00 00 00 2A 00', expect: { issue: 'serial' } },
    { wire: 'D0 00 00 FF FF 03 00 04 00 00 00 2A 00', expect: { issue: 'format' } },
  ],
);
// ASCII 3E: mọi trường là chữ hex in hoa, big-endian dạng chữ; độ dài đếm ký tự (contracts §3)
frame(
  'a3e-read-d100-3',
  { code: 'ascii' },
  { cmd: 'batchReadWords', device: 'D', number: 100, points: 3 },
  '500000FF03FF000018001004010000D*0001000003',
  [
    {
      wire: 'D00000FF03FF0000100000123400021DEF',
      expect: { issue: 'none', endCode: 0, words: [0x1234, 0x0002, 0x1def] },
    },
    // end code C056 + 18 ký tự thông tin lỗi
    {
      wire: 'D00000FF03FF000016C05600FF03FF0004010000',
      expect: { issue: 'none', endCode: 0xc056 },
    },
    { wire: 'D00000FF03FF0000100000123400021DEG', expect: { issue: 'format' } },
    { wire: 'D00000FF03FF00000C0000123400021DEF', expect: { issue: 'length' } },
  ],
);
frame(
  'a3e-read-bits-x',
  { code: 'ascii' },
  { cmd: 'batchReadBits', device: 'X', number: 0x1a0, points: 4 },
  '500000FF03FF000018001004010001X*0001A00004',
  [
    {
      wire: 'D00000FF03FF00000800001011',
      expect: { issue: 'none', endCode: 0, bits: [1, 0, 1, 1] },
    },
  ],
);
// X bát phân (FX5): X17 = 15, viết 000017
frame(
  'a3e-read-x-octal',
  { code: 'ascii', xyOctal: true },
  { cmd: 'batchReadBits', device: 'X', number: 15, points: 1 },
  '500000FF03FF000018001004010001X*0000170001',
  [{ wire: 'D00000FF03FF00000500001', expect: { issue: 'none', endCode: 0, bits: [1] } }],
);
// ZR viết hex trong ASCII: 1000 = 0003E8
frame(
  'a3e-write-zr',
  { code: 'ascii' },
  { cmd: 'batchWriteWords', device: 'ZR', number: 1000, words: [0xabcd] },
  '500000FF03FF00001C001014010000ZR0003E80001ABCD',
  [{ wire: 'D00000FF03FF0000040000', expect: { issue: 'none', endCode: 0 } }],
);
frame(
  'a3e-write-bits',
  { code: 'ascii' },
  { cmd: 'batchWriteBits', device: 'M', number: 100, bits: [1, 0, 1] },
  '500000FF03FF00001B001014010001M*0001000003101',
  [{ wire: 'D00000FF03FF0000040000', expect: { issue: 'none', endCode: 0 } }],
);
frame(
  'a3e-random-read',
  { code: 'ascii' },
  {
    cmd: 'randomRead',
    randomWords: [
      { device: 'D', number: 0 },
      { device: 'SD', number: 210 },
    ],
    randomDwords: [{ device: 'D', number: 1500 }],
  },
  '500000FF03FF000028001004030000' + '0201D*000000SD000210D*001500',
  [
    {
      // dword 0x0002484F viết 8 chữ: word thấp 484F, word cao 0002
      wire: 'D00000FF03FF0000140000199512020002484F',
      expect: { issue: 'none', endCode: 0, words: [0x1995, 0x1202, 0x484f, 0x0002] },
    },
  ],
);
// ASCII 4E
frame(
  'a4e-read-d100',
  { frame: '4E', code: 'ascii', serial: 0x00ab },
  { cmd: 'batchReadWords', device: 'D', number: 100, points: 1 },
  '540000AB0000' + '00FF03FF000018001004010000D*0001000001',
  [
    {
      wire: 'D40000AB0000' + '00FF03FF0000080000002A',
      expect: { issue: 'none', endCode: 0, words: [42] },
    },
    { wire: 'D40000AC0000' + '00FF03FF0000080000002A', expect: { issue: 'serial' } },
  ],
);

writeCases('frames.json', F);
console.log(`address.json: ${A.length} ca, frames.json: ${F.length} ca`);
