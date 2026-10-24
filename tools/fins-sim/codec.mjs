// Frames of the Omron FINS simulator (feature 018; FINS Commands Reference W342 §3, §5; FINS/TCP W421 §6).
// Written apart from the C++ driver (drivers/fins/frame.cpp); both are checked on tests/fins-vectors/frames.json.

export const AREA_CODES = {
  CIO: { word: 0xb0, bit: 0x30 },
  W: { word: 0xb1, bit: 0x31 },
  H: { word: 0xb2, bit: 0x32 },
  A: { word: 0xb3, bit: 0x33 },
  D: { word: 0x82, bit: 0x02 },
  T: { word: 0x89, bit: 0x09 },
  C: { word: 0x89, bit: 0x09 },
};
for (let bank = 0; bank <= 12; bank++)
  AREA_CODES[`E${bank.toString(16).toUpperCase()}`] = { word: 0xa0 + bank, bit: 0x20 + bank };

/** Word area code of a code (a bit code gives its word code). */
export function wordCodeOf(code) {
  if (code >= 0x30 && code <= 0x33) return code + 0x80;
  if (code === 0x02) return 0x82;
  if (code >= 0x20 && code <= 0x2c) return code + 0x80;
  return code;
}
/** A word code reads 2 bytes per item; bit codes and the T/C flags (0x09) 1 byte. */
export const isWordCode = (c) =>
  (c >= 0xb0 && c <= 0xb3) || c === 0x82 || (c >= 0xa0 && c <= 0xac) || c === 0x98 || c === 0x89;

/** Parses a command frame: header, command, parameters (null when shorter than 12 bytes). */
export function parseCommand(buf) {
  if (buf.length < 12) return null;
  const c = {
    icf: buf[0],
    gct: buf[2],
    dna: buf[3],
    da1: buf[4],
    da2: buf[5],
    sna: buf[6],
    sa1: buf[7],
    sa2: buf[8],
    sid: buf[9],
    command: buf.readUInt16BE(10),
    params: buf.subarray(12),
  };
  const p = c.params;
  if ((c.command === 0x0101 || c.command === 0x0102) && p.length >= 6) {
    c.code = p[0];
    c.address = p.readUInt16BE(1);
    c.bit = p[3];
    c.count = p.readUInt16BE(4);
    c.data = p.subarray(6);
  } else if (c.command === 0x0104) {
    c.items = [];
    for (let i = 0; i + 4 <= p.length; i += 4)
      c.items.push({ code: p[i], address: p.readUInt16BE(i + 1), bit: p[i + 3] });
  }
  return c;
}

/** The response to command `c`: addresses swapped, ICF 0xC0, the end code and the data. */
export function buildResponse(c, endCode, data = Buffer.alloc(0), plcStatus = 0) {
  const h = Buffer.from([
    0xc0,
    0x00,
    0x02,
    c.sna,
    c.sa1,
    c.sa2,
    c.dna,
    c.da1,
    c.da2,
    c.sid,
    c.command >> 8,
    c.command & 0xff,
    (endCode >> 8) & 0xff,
    (endCode & 0xff) | (plcStatus & 0xc0),
  ]);
  return endCode === 0 ? Buffer.concat([h, data]) : h;
}

export const TCP_NODE_REQUEST = 0;
export const TCP_NODE_RESPONSE = 1;
export const TCP_FRAME = 2;
const MAGIC = 0x46494e53;
const MAX_FRAME = 2012;

/** A FINS/TCP message: "FINS", length (from the command field), command, error, body. */
export function tcpMessage(command, error, body = Buffer.alloc(0)) {
  const h = Buffer.alloc(16);
  h.writeUInt32BE(MAGIC, 0);
  h.writeUInt32BE(8 + body.length, 4);
  h.writeUInt32BE(command, 8);
  h.writeUInt32BE(error, 12);
  return Buffer.concat([h, body]);
}

/** Cuts whole messages from a stream: { messages: [{command, error, body}], rest, lost }. */
export function splitTcp(buf) {
  const messages = [];
  let at = 0;
  for (;;) {
    const left = buf.length - at;
    if (left < 8) break;
    if (buf.readUInt32BE(at) !== MAGIC) return { messages, rest: Buffer.alloc(0), lost: true };
    const len = buf.readUInt32BE(at + 4);
    if (len < 8 || len > 8 + MAX_FRAME) return { messages, rest: Buffer.alloc(0), lost: true };
    if (left < 8 + len) break;
    messages.push({
      command: buf.readUInt32BE(at + 8),
      error: buf.readUInt32BE(at + 12),
      body: buf.subarray(at + 16, at + 8 + len),
    });
    at += 8 + len;
  }
  return { messages, rest: buf.subarray(at), lost: false };
}
