// Một client WebSocket tối giản cho web-it (feature 013): kết nối HTTPS đã ghim fingerprint, gửi Cookie và Origin
// (WebSocket của Node không đặt được hai header này), đọc khung văn bản của máy chủ, gửi khung có mặt nạ, trả lời ping.
// Chỉ dùng cho kiểm thử: không phân mảnh, không nén.
import { pinnedConnect } from '../../../tools/measure/device-api.mjs';
import { BASE, ORIGIN } from './api.mjs';

/**
 * Mở /api/v1/live. Trả { status, messages, raw, send, close, waitFor, closeCode } — `messages` là các tin JSON đã
 * nhận theo thứ tự, `raw` là văn bản gốc (để tìm một giá trị bất kỳ).
 */
export async function liveConnect(fp, { cookie, origin = ORIGIN, localAddress, base } = {}) {
  const target = base ?? BASE;
  const conn = await pinnedConnect(target, fp, { timeoutMs: 5000, localAddress });
  const socket = conn.socket;
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const lines = [
    'GET /api/v1/live HTTP/1.1',
    `Host: ${new URL(target).host}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
  ];
  if (cookie) lines.push(`Cookie: __Host-mat_sid=${cookie}`);
  if (origin) lines.push(`Origin: ${origin}`);
  const c = { status: 0, messages: [], raw: [], closeCode: null };
  let buf = Buffer.alloc(0);
  let upgraded = false;
  const waiters = new Set();
  const notify = () => {
    for (const w of [...waiters]) w();
  };
  const sendFrame = (opcode, payload) => {
    const data = Buffer.from(payload);
    const mask = Buffer.from(crypto.getRandomValues(new Uint8Array(4)));
    let head;
    if (data.length < 126) head = Buffer.from([0x80 | opcode, 0x80 | data.length]);
    else if (data.length < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | opcode;
      head[1] = 0x80 | 126;
      head.writeUInt16BE(data.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | opcode;
      head[1] = 0x80 | 127;
      head.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    if (!socket.destroyed) socket.write(Buffer.concat([head, mask, masked]));
  };
  const parse = () => {
    for (;;) {
      if (buf.length < 2) return;
      const opcode = buf[0] & 0x0f;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (buf.length < off + len) return;
      const payload = buf.subarray(off, off + len);
      buf = buf.subarray(off + len);
      if (opcode === 1) {
        const text = payload.toString('utf8');
        c.raw.push(text);
        try {
          c.messages.push(JSON.parse(text));
        } catch {
          // không phải JSON
        }
      } else if (opcode === 8) {
        c.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        socket.destroy();
      } else if (opcode === 9) {
        sendFrame(10, payload);
      }
      notify();
    }
  };
  await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), 4000);
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.subarray(0, end).toString('latin1');
        c.status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0);
        buf = buf.subarray(end + 4);
        upgraded = true;
        clearTimeout(timer);
        resolve();
      }
      parse();
    });
    socket.on('close', () => {
      clearTimeout(timer);
      notify();
      resolve();
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.write(lines.join('\r\n') + '\r\n\r\n');
  });
  c.send = (obj) => sendFrame(1, JSON.stringify(obj));
  c.close = () => {
    try {
      sendFrame(8, Buffer.from([0x03, 0xe8]));
    } catch {
      // đã đóng
    }
    socket.destroy();
  };
  /** Đợi tới khi `pred(messages)` trả giá trị khác rỗng, tối đa `ms`. */
  c.waitFor = (pred, ms = 5000) =>
    new Promise((resolve) => {
      const check = () => {
        const v = pred(c.messages);
        if (v) {
          waiters.delete(check);
          clearTimeout(timer);
          resolve(v);
        } else if (socket.destroyed) {
          waiters.delete(check);
          clearTimeout(timer);
          resolve(null);
        }
      };
      const timer = setTimeout(() => {
        waiters.delete(check);
        resolve(null);
      }, ms);
      waiters.add(check);
      check();
    });
  c.closed = () => socket.destroyed;
  return c;
}
