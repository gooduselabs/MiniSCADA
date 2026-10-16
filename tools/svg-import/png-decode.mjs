// Bộ giải PNG tối thiểu (8 bit, không xen kẽ, RGB hoặc RGBA) cho các spike đọc điểm ảnh của ảnh chụp Chrome.
// Không thêm thư viện (feature 008, Quy ước "Thư viện"). Trả về { w, h, at(x, y) -> [r, g, b] }.
import { inflateSync } from 'node:zlib';

export function decodePng(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (ct !== 6 && ct !== 2) throw new Error(`Kiểu màu PNG ${ct} chưa hỗ trợ`);
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + x] = r & 255;
    }
  }
  return {
    w,
    h,
    px,
    bpp,
    at: (x, y) => [
      px[y * stride + x * bpp],
      px[y * stride + x * bpp + 1],
      px[y * stride + x * bpp + 2],
    ],
  };
}
