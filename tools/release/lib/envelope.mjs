// Phong bì `.matupdate` (contract update-package §1): tar ustar không nén, đúng ba thành viên `update.json`,
// `update.sig`, `payload.tar.gz`. Bản Node này chỉ để verify-release.mjs kiểm chữ ký manifest (ca hỏng 12) và để test
// dựng gói mẫu; bộ đọc chuẩn trên thiết bị là `mat-update-verify` (C++, T096).
const BLOCK = 512;
const ORDER = ['update.json', 'update.sig', 'payload.tar.gz'];
const LIMIT = { 'update.json': 256 * 1024, 'update.sig': 128 };

const fail = (code, msg) => {
  throw Object.assign(new Error(`${code}: ${msg}`), { code });
};

function octal(buf, off, len) {
  const s = buf
    .subarray(off, off + len)
    .toString('latin1')
    .replace(/[\0 ]+$/g, '')
    .trim();
  if (!/^[0-7]+$/.test(s)) return NaN;
  return parseInt(s, 8);
}

function header(name, size) {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100, 'latin1');
  h.write('0000000\0', 108, 'latin1');
  h.write('0000000\0', 116, 'latin1');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'latin1');
  h.write('00000000000\0', 136, 'latin1');
  h.write('        ', 148, 'latin1');
  h.write('0', 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'latin1');
  return h;
}

/** Dựng tar ustar từ [[tên, Buffer]...] (kết thúc bằng hai khối 0). */
export function packEnvelope(members) {
  const parts = [];
  for (const [name, data] of members) {
    parts.push(header(name, data.length), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function readHeader(buf, off, want) {
  if (off + BLOCK > buf.length) fail('ENVELOPE_TRUNCATED', `thiếu tiêu đề của ${want}`);
  const h = buf.subarray(off, off + BLOCK);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  if (octal(h, 148, 8) !== sum) fail('ENVELOPE_HEADER', `tổng kiểm tiêu đề của ${want} sai`);
  if (h.subarray(257, 262).toString('latin1') !== 'ustar')
    fail('ENVELOPE_HEADER', 'không phải ustar');
  const type = String.fromCharCode(h[156]);
  if (type !== '0' && h[156] !== 0) fail('ENVELOPE_HEADER', `typeflag ${type}`);
  const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
  if (name !== want) fail('ENVELOPE_ORDER', `gặp ${name}, cần ${want}`);
  const size = octal(h, 124, 12);
  if (!Number.isFinite(size)) fail('ENVELOPE_HEADER', 'kích thước sai');
  if (LIMIT[want] !== undefined && size > LIMIT[want])
    fail('ENVELOPE_SIZE', `${want} ${size} byte`);
  const start = off + BLOCK;
  if (start + size > buf.length) fail('ENVELOPE_TRUNCATED', `${want} bị cắt`);
  return { start, size, next: start + Math.ceil(size / BLOCK) * BLOCK };
}

/** Đọc phong bì; ném Error có `code` ENVELOPE_* khi sai. */
export function readEnvelope(buf) {
  let off = 0;
  const parts = {};
  for (const want of ORDER) {
    const h = readHeader(buf, off, want);
    parts[want] = h;
    off = h.next;
  }
  if (off + BLOCK > buf.length) fail('ENVELOPE_TRUNCATED', 'thiếu khối kết thúc');
  if (buf.subarray(off, off + BLOCK).some((b) => b !== 0))
    fail('ENVELOPE_EXTRA_MEMBER', 'có thành viên thứ tư');
  const j = parts['update.json'];
  const s = parts['update.sig'];
  const p = parts['payload.tar.gz'];
  return {
    manifest: buf.subarray(j.start, j.start + j.size),
    signature: buf.subarray(s.start, s.start + s.size),
    payloadOffset: p.start,
    payloadSize: p.size,
  };
}
