// The device model of the simulator, without sockets: a request frame goes in, a plan comes out
// (answer, silence or close, with a delay). The TCP layer (sim.mjs) carries the plan out, so every
// rule here is testable on plain buffers.
import {
  EXC,
  encodeAdu,
  exceptionPdu,
  parseAdu,
  parseRequest,
  readResponse,
  writeResponse,
} from './codec.mjs';
import { AREA_OF_FC } from './map.mjs';

export const FAULT_KINDS = [
  'timeout',
  'exception',
  'delay',
  'close',
  'refuse',
  'bad-tid',
  'bad-unit',
  'bad-length',
  'garbage',
];
const LOG_LIMIT = 20000;
export const UNIT_STATES = ['mute', 'late', 'ok'];

export class SimServer {
  constructor({ memory, now = Date.now, rand = Math.random, onLog = null, onRefuseChange = null }) {
    this.memory = memory;
    this.now = now;
    this.rand = rand;
    this.onLog = onLog;
    this.onRefuseChange = onRefuseChange;
    this.faults = [];
    this.refusing = false;
    this.reset();
  }

  reset() {
    this.faults = [];
    this.unitModes = new Map();
    this.setRefusing(false);
    this.stats = {
      requests: 0,
      responses: 0,
      exceptions: 0,
      faults: 0,
      badFrames: 0,
      byFc: {},
      bytesIn: 0,
      bytesOut: 0,
    };
    this.conn = { accepted: 0, closed: 0, current: 0 };
    this.log = [];
    this.seq = 0;
  }

  setRefusing(on) {
    if (this.refusing === on) return;
    this.refusing = on;
    if (this.onRefuseChange) this.onRefuseChange(on);
  }

  /** { kind, unit?, fc?, from?, to?, count?, delayMs?, code?, bytes? } */
  addFault(f) {
    if (f.kind === 'clear') {
      this.clearFaults();
      return;
    }
    if (!FAULT_KINDS.includes(f.kind)) throw new Error(`unknown fault kind: ${f.kind}`);
    if (f.kind === 'refuse') {
      this.setRefusing(true);
      return;
    }
    this.faults.push({ ...f });
  }

  /**
   * Feature 011 (T037/T046): one unit behind a gateway, on command, until told otherwise:
   * { unit, state: 'mute' } never answers, { unit, state: 'late', delayMs } answers after delayMs
   * (with the transaction id of its request), { unit, state: 'ok' } answers again.
   */
  setUnit({ unit, state, delayMs } = {}) {
    if (!Number.isInteger(unit) || unit < 0 || unit > 255) throw new Error('unit must be 0-255');
    if (!UNIT_STATES.includes(state))
      throw new Error(`state must be one of ${UNIT_STATES.join(', ')}`);
    if (state === 'ok') {
      this.unitModes.delete(unit);
      return;
    }
    if (state === 'late') {
      const d = delayMs ?? 1500;
      if (!Number.isInteger(d) || d < 0 || d > 600000) throw new Error('delayMs must be 0-600000');
      this.unitModes.set(unit, { state, delayMs: d });
      return;
    }
    this.unitModes.set(unit, { state });
  }

  units() {
    return Object.fromEntries([...this.unitModes].map(([u, m]) => [u, { ...m }]));
  }

  clearFaults() {
    this.faults = [];
    this.setRefusing(false);
  }

  connOpened() {
    this.conn.accepted++;
    this.conn.current++;
  }

  connClosed() {
    this.conn.closed++;
    this.conn.current = Math.max(0, this.conn.current - 1);
  }

  counters() {
    return { ...this.stats, byFc: { ...this.stats.byFc }, connections: { ...this.conn } };
  }

  logEntries(since = 0) {
    return this.log.filter((e) => e.seq > since);
  }

  record(entry) {
    entry.seq = ++this.seq;
    entry.ts = this.now();
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    if (this.onLog) this.onLog(entry);
  }

  matchFault(unit, req) {
    const lo = req?.address ?? 0;
    const hi = lo + (req?.quantity ?? 1) - 1;
    const i = this.faults.findIndex((f) => {
      if (f.unit !== undefined && f.unit !== unit) return false;
      if (f.fc !== undefined && f.fc !== req?.fc) return false;
      if (f.from !== undefined && hi < f.from) return false;
      if (f.to !== undefined && lo > f.to) return false;
      return true;
    });
    if (i < 0) return null;
    const f = this.faults[i];
    if (f.count !== undefined && --f.count <= 0) this.faults.splice(i, 1);
    return f;
  }

  /** The plan for one request frame: { action: 'respond' | 'silent' | 'close', delayMs, buffers }. */
  handleFrame(frame) {
    this.stats.bytesIn += frame.length;
    const adu = parseAdu(frame);
    if (!adu || adu.protocol !== 0) {
      this.stats.badFrames++;
      return { action: 'silent', delayMs: 0, buffers: [] };
    }
    const req = parseRequest(adu.pdu);
    const entry = {
      unit: adu.unit,
      fc: req?.fc ?? adu.pdu[0],
      address: req?.address,
      quantity: req?.quantity,
      tid: adu.tid,
      result: 'ok',
    };
    // a write also logs what it writes: the scenarios tell a command by its value
    if (req && !req.error && req.fc >= 5)
      entry.data = req.registers ?? req.bits ?? [req.andMask, req.orMask];
    this.stats.requests++;
    this.stats.byFc[String(entry.fc)] = (this.stats.byFc[String(entry.fc)] ?? 0) + 1;

    const mode = this.unitModes.get(adu.unit);
    const fault = mode ? null : this.matchFault(adu.unit, req);
    let plan;
    if (mode?.state === 'mute') {
      entry.result = 'unit:mute';
      plan = { action: 'silent', delayMs: 0, buffers: [] };
    } else if (fault) {
      this.stats.faults++;
      entry.result = `fault:${fault.kind}`;
      plan = this.applyFault(fault, adu, req);
    } else {
      const pdu = this.process(adu.unit, req);
      plan = pdu
        ? { action: 'respond', delayMs: 0, buffers: [encodeAdu(adu.tid, adu.unit, pdu)] }
        : { action: 'silent', delayMs: 0, buffers: [] };
      if (pdu && (pdu[0] & 0x80) !== 0) {
        this.stats.exceptions++;
        entry.result = `exception:${pdu[1].toString(16).padStart(2, '0')}`;
      } else if (!pdu) {
        entry.result = 'silent';
      }
      if (mode?.state === 'late' && plan.action === 'respond') {
        plan.delayMs = mode.delayMs;
        entry.result = 'unit:late';
      }
    }
    if (plan.action === 'respond') {
      this.stats.responses++;
      for (const b of plan.buffers) this.stats.bytesOut += b.length;
    }
    this.record(entry);
    return plan;
  }

  applyFault(f, adu, req) {
    const none = { action: 'silent', delayMs: 0, buffers: [] };
    switch (f.kind) {
      case 'timeout':
        return none;
      case 'close':
        return { action: 'close', delayMs: 0, buffers: [] };
      case 'exception': {
        this.stats.exceptions++;
        const fc = req?.fc ?? adu.pdu[0];
        return {
          action: 'respond',
          delayMs: 0,
          buffers: [encodeAdu(adu.tid, adu.unit, exceptionPdu(fc, f.code ?? EXC.ILLEGAL_ADDRESS))],
        };
      }
      case 'garbage': {
        const n = f.bytes ?? 12;
        const b = Buffer.alloc(n);
        for (let i = 0; i < n; i++) b[i] = Math.floor(this.rand() * 256);
        // never a valid frame by accident: a protocol id that is not 0
        if (n >= 4) b[2] = 0xff;
        return { action: 'respond', delayMs: f.delayMs ?? 0, buffers: [b] };
      }
      default: {
        const pdu = this.process(adu.unit, req);
        if (!pdu) return none;
        const out = encodeAdu(adu.tid, adu.unit, pdu);
        if (f.kind === 'bad-tid') out.writeUInt16BE((adu.tid + 1) & 0xffff, 0);
        if (f.kind === 'bad-unit') out[6] = (adu.unit + 1) & 0xff;
        if (f.kind === 'bad-length') out.writeUInt16BE(out.readUInt16BE(4) + 1, 4);
        return {
          action: 'respond',
          delayMs: f.kind === 'delay' ? (f.delayMs ?? 1000) : 0,
          buffers: [out],
        };
      }
    }
  }

  /** The PDU answer of the device model, or null for silence. */
  process(unit, req) {
    const mem = this.memory;
    if (!mem.has(unit))
      return mem.unknownUnit === 'gateway' && req
        ? exceptionPdu(req.fc, EXC.GATEWAY_NO_RESPONSE)
        : null;
    if (!req) return null;
    if (req.error) return exceptionPdu(req.fc, req.error);
    const area = AREA_OF_FC[req.fc];
    const t = this.now();
    for (let i = 0; i < req.quantity; i++)
      if (!mem.defined(unit, area, req.address + i))
        return exceptionPdu(req.fc, EXC.ILLEGAL_ADDRESS);
    if (req.fc <= 4) {
      const values = [];
      for (let i = 0; i < req.quantity; i++)
        values.push(mem.value(unit, area, req.address + i, t, true));
      return readResponse(req.fc, values);
    }
    if (req.fc === 22) {
      const cur = mem.value(unit, area, req.address, t);
      mem.set(
        unit,
        area,
        req.address,
        ((cur & req.andMask) | (req.orMask & ~req.andMask)) & 0xffff,
      );
    } else {
      const values = req.bits ?? req.registers;
      values.forEach((v, i) => mem.set(unit, area, req.address + i, v));
    }
    return writeResponse(reqPdu(req));
  }
}

// The echo of a write is rebuilt from the parsed request (the request frame is not kept).
function reqPdu(req) {
  const w = (n) => [(n >> 8) & 0xff, n & 0xff];
  switch (req.fc) {
    case 5:
      return Buffer.from([5, ...w(req.address), ...(req.bits[0] ? [0xff, 0] : [0, 0])]);
    case 6:
      return Buffer.from([6, ...w(req.address), ...w(req.registers[0])]);
    case 15:
      return Buffer.from([15, ...w(req.address), ...w(req.quantity)]);
    case 16:
      return Buffer.from([16, ...w(req.address), ...w(req.quantity)]);
    default:
      return Buffer.from([22, ...w(req.address), ...w(req.andMask), ...w(req.orMask)]);
  }
}
