// Modbus TCP frames, server side. Written on its own from the Modbus Application Protocol
// Specification V1.1b3 (ADR-014): it shares nothing with drivers/modbus of the runtime, so that a
// misreading of the standard cannot hide on both sides. Both are checked against the vectors of
// tests/modbus-vectors/frames.

export const MAX_ADU = 260;

export const EXC = {
  ILLEGAL_FUNCTION: 1,
  ILLEGAL_ADDRESS: 2,
  ILLEGAL_VALUE: 3,
  DEVICE_FAILURE: 4,
  GATEWAY_NO_PATH: 10,
  GATEWAY_NO_RESPONSE: 11,
};

const be16 = (b, at) => (b[at] << 8) | b[at + 1];

/** MBAP + PDU. */
export function encodeAdu(tid, unit, pdu) {
  const out = Buffer.alloc(7 + pdu.length);
  out.writeUInt16BE(tid & 0xffff, 0);
  out.writeUInt16BE(0, 2);
  out.writeUInt16BE(pdu.length + 1, 4);
  out[6] = unit & 0xff;
  Buffer.from(pdu).copy(out, 7);
  return out;
}

/**
 * Cuts the frames out of a byte stream by the length field. A length below 2 or above 254 cannot
 * be a frame: `lost` is set and the caller closes the connection.
 */
export function splitAdus(buf) {
  const frames = [];
  let at = 0;
  while (buf.length - at >= 6) {
    const len = be16(buf, at + 4);
    if (len < 2 || len > MAX_ADU - 6) return { frames, rest: Buffer.alloc(0), lost: true };
    if (buf.length - at < 6 + len) break;
    frames.push(buf.subarray(at, at + 6 + len));
    at += 6 + len;
  }
  return { frames, rest: buf.subarray(at), lost: false };
}

/** A whole frame: { tid, protocol, unit, pdu }. */
export function parseAdu(frame) {
  if (frame.length < 8) return null;
  return {
    tid: be16(frame, 0),
    protocol: be16(frame, 2),
    unit: frame[6],
    pdu: frame.subarray(7),
  };
}

const READ_LIMIT = { 1: 2000, 2: 2000, 3: 125, 4: 125 };

/**
 * A request PDU: { fc, ... } or { fc, error: <exception code> } when it is not one the device
 * answers (unknown function: 1; wrong quantity, byte count or value: 3).
 */
export function parseRequest(pdu) {
  if (pdu.length < 1) return null;
  const fc = pdu[0];
  switch (fc) {
    case 1:
    case 2:
    case 3:
    case 4: {
      if (pdu.length !== 5) return { fc, error: EXC.ILLEGAL_VALUE };
      const address = be16(pdu, 1);
      const quantity = be16(pdu, 3);
      if (quantity < 1 || quantity > READ_LIMIT[fc])
        return { fc, error: EXC.ILLEGAL_VALUE, address, quantity };
      return { fc, address, quantity };
    }
    case 5: {
      if (pdu.length !== 5) return { fc, error: EXC.ILLEGAL_VALUE };
      const address = be16(pdu, 1);
      const value = be16(pdu, 3);
      if (value !== 0xff00 && value !== 0x0000)
        return { fc, error: EXC.ILLEGAL_VALUE, address, quantity: 1 };
      return { fc, address, quantity: 1, bits: [value === 0xff00 ? 1 : 0] };
    }
    case 6: {
      if (pdu.length !== 5) return { fc, error: EXC.ILLEGAL_VALUE };
      return { fc, address: be16(pdu, 1), quantity: 1, registers: [be16(pdu, 3)] };
    }
    case 15: {
      if (pdu.length < 6) return { fc, error: EXC.ILLEGAL_VALUE };
      const address = be16(pdu, 1);
      const quantity = be16(pdu, 3);
      const count = pdu[5];
      if (
        quantity < 1 ||
        quantity > 1968 ||
        count !== Math.ceil(quantity / 8) ||
        pdu.length !== 6 + count
      )
        return { fc, error: EXC.ILLEGAL_VALUE, address, quantity };
      const bits = [];
      for (let i = 0; i < quantity; i++) bits.push((pdu[6 + (i >> 3)] >> (i & 7)) & 1);
      return { fc, address, quantity, bits };
    }
    case 16: {
      if (pdu.length < 6) return { fc, error: EXC.ILLEGAL_VALUE };
      const address = be16(pdu, 1);
      const quantity = be16(pdu, 3);
      const count = pdu[5];
      if (quantity < 1 || quantity > 123 || count !== quantity * 2 || pdu.length !== 6 + count)
        return { fc, error: EXC.ILLEGAL_VALUE, address, quantity };
      const registers = [];
      for (let i = 0; i < quantity; i++) registers.push(be16(pdu, 6 + 2 * i));
      return { fc, address, quantity, registers };
    }
    case 22: {
      if (pdu.length !== 7) return { fc, error: EXC.ILLEGAL_VALUE };
      return {
        fc,
        address: be16(pdu, 1),
        quantity: 1,
        andMask: be16(pdu, 3),
        orMask: be16(pdu, 5),
      };
    }
    default:
      return { fc, error: EXC.ILLEGAL_FUNCTION };
  }
}

export const exceptionPdu = (fc, code) => Buffer.from([(fc | 0x80) & 0xff, code & 0xff]);

/** Response PDU of a read: bits are 0/1 values, registers are 16-bit numbers. */
export function readResponse(fc, values) {
  if (fc === 1 || fc === 2) {
    const n = Math.ceil(values.length / 8);
    const out = Buffer.alloc(2 + n);
    out[0] = fc;
    out[1] = n;
    values.forEach((v, i) => {
      if (v) out[2 + (i >> 3)] |= 1 << (i & 7);
    });
    return out;
  }
  const out = Buffer.alloc(2 + values.length * 2);
  out[0] = fc;
  out[1] = values.length * 2;
  values.forEach((v, i) => out.writeUInt16BE(v & 0xffff, 2 + 2 * i));
  return out;
}

/** Response PDU of a write: the echo of the request fields (5, 6, 22) or address and quantity (15, 16). */
export function writeResponse(pdu) {
  const fc = pdu[0];
  if (fc === 15 || fc === 16) return Buffer.from(pdu.subarray(0, 5));
  return Buffer.from(pdu);
}
