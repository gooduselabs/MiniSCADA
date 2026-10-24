// The device model of the S7 simulator, without sockets: a TPKT frame of one connection goes in, a
// plan comes out (answer, silence or close, with a delay). The TCP layer (sim.mjs) carries the plan
// out, so every rule here is testable on plain buffers.
import {
  encodeCc,
  encodeDr,
  FN,
  headerError,
  MAX_ITEMS,
  parseCotp,
  parseJob,
  RC,
  readResponse,
  readResponseSize,
  setBit,
  setupResponse,
  TS,
  wrapDt,
  writeResponse,
} from './codec.mjs';

export const FAULT_KINDS = ['silent', 'close', 'delay', 'garbage', 'refuse', 'putget'];
const FN_NAME = { [FN.SETUP]: 'setup', [FN.READ]: 'read', [FN.WRITE]: 'write' };
const LOG_LIMIT = 20000;
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const silent = () => ({ action: 'silent', delayMs: 0, buffers: [] });
const close = () => ({ action: 'close', delayMs: 0, buffers: [] });
const respond = (pdu) => ({ action: 'respond', delayMs: 0, buffers: [wrapDt(pdu)], pdu });

export class SimServer {
  constructor({ memory, now = Date.now, onLog = null, onRefuseChange = null }) {
    this.memory = memory;
    this.now = now;
    this.onLog = onLog;
    this.onRefuseChange = onRefuseChange;
    this.refusing = false;
    this.reset();
  }

  /** Faults, counters and log; `memory: true` also puts the values of the map back. */
  reset({ memory = false } = {}) {
    this.faults = [];
    this.putget = false;
    this.setRefusing(false);
    if (memory) this.memory.reload();
    this.stats = {
      connections: 0,
      connectionsOpen: 0,
      requests: 0,
      byFunction: {},
      items: 0,
      maxRequestPdu: 0,
      maxResponsePdu: 0,
      pduSize: null,
      errors: 0,
      faults: 0,
      rejected: 0,
    };
    this.log = [];
    this.seq = 0;
  }

  setRefusing(on) {
    if (this.refusing === on) return;
    this.refusing = on;
    if (this.onRefuseChange) this.onRefuseChange(on);
  }

  /** { kind, count?, delayMs? }. Without `count` a fault stays until DELETE /fault. */
  addFault(f) {
    if (!FAULT_KINDS.includes(f.kind)) throw new Error(`unknown fault kind: ${f.kind}`);
    if (f.count !== undefined && !(Number.isInteger(f.count) && f.count >= 1))
      throw new Error('count must be an integer >= 1');
    if (f.delayMs !== undefined && !(Number.isInteger(f.delayMs) && f.delayMs >= 0))
      throw new Error('delayMs must be an integer >= 0');
    if (f.kind === 'refuse') this.setRefusing(true);
    else if (f.kind === 'putget') this.putget = true;
    else this.faults.push({ ...f });
  }

  clearFaults() {
    this.faults = [];
    this.putget = false;
    this.setRefusing(false);
  }

  /** A new TCP connection: its own COTP state and negotiated PDU. */
  connOpened() {
    this.stats.connections++;
    this.stats.connectionsOpen++;
    return new Connection(this);
  }

  connClosed() {
    this.stats.connectionsOpen = Math.max(0, this.stats.connectionsOpen - 1);
  }

  counters() {
    return { ...this.stats, byFunction: { ...this.stats.byFunction } };
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

  takeFault() {
    const f = this.faults[0];
    if (!f) return null;
    if (f.count !== undefined && --f.count <= 0) this.faults.shift();
    return f;
  }

  /** Item rc of the address part of an item (read or write). */
  check(it) {
    if (!it.area) return RC.NOT_FOUND;
    if (it.ts !== TS.BIT && it.ts !== TS.BYTE && it.ts !== TS.CHAR) return RC.TYPE_NOT_SUPPORTED;
    const name = it.area === 'DB' ? `DB${it.db}` : it.area;
    if (this.memory.denied.has(name)) return RC.DENIED;
    const buf = this.memory.area(name);
    if (!buf) return RC.NOT_FOUND;
    const size = it.bit === null ? it.size : 1;
    if (size < 1 || it.byte + size > buf.length) return RC.OUT_OF_RANGE;
    return RC.OK;
  }

  bufferOf(it) {
    return this.memory.area(it.area === 'DB' ? `DB${it.db}` : it.area);
  }

  readItems(items) {
    this.memory.tick(this.now());
    return items.map((it) => {
      const rc = this.check(it);
      if (rc !== RC.OK) return { rc, bit: false, data: Buffer.alloc(0) };
      const buf = this.bufferOf(it);
      if (it.bit !== null)
        return { rc, bit: true, data: Buffer.from([(buf[it.byte] >> it.bit) & 1]) };
      return { rc, bit: false, data: Buffer.from(buf.subarray(it.byte, it.byte + it.size)) };
    });
  }

  writeItems(items) {
    return items.map((it) => {
      const rc = this.check(it);
      if (rc !== RC.OK) return rc;
      const buf = this.bufferOf(it);
      if (it.bit !== null) {
        if (it.dts !== 0x03 || it.data.length !== 1) return RC.TYPE_INCONSISTENT;
        buf[it.byte] = setBit(buf[it.byte], it.bit, it.data[0] !== 0);
        return RC.OK;
      }
      if (![0x04, 0x09].includes(it.dts) || it.data.length !== it.size) return RC.TYPE_INCONSISTENT;
      it.data.copy(buf, it.byte);
      return RC.OK;
    });
  }
}

/** The COTP and S7 state of one TCP connection. */
export class Connection {
  constructor(sim) {
    this.sim = sim;
    this.connected = false;
    this.pdu = sim.memory.pduSize;
    this.parts = [];
  }

  /** The plan for one TPKT frame: { action: 'respond' | 'silent' | 'close', delayMs, buffers, closeAfter? }. */
  handleFrame(frame) {
    const sim = this.sim;
    const cotp = parseCotp(frame);
    if (cotp?.type === 'CR' && !this.connected) {
      const want = sim.memory.remoteTsap;
      if (want && cotp.remoteTsap !== want) {
        sim.stats.rejected++;
        return { action: 'respond', delayMs: 0, buffers: [encodeDr(cotp)], closeAfter: true };
      }
      this.connected = true;
      return { action: 'respond', delayMs: 0, buffers: [encodeCc(cotp)] };
    }
    if (cotp?.type !== 'DT' || !this.connected) {
      sim.stats.errors++;
      return close();
    }
    // a DT without EOT waits for the next one
    this.parts.push(cotp.payload);
    if (!cotp.eot) return silent();
    const pdu = Buffer.concat(this.parts);
    this.parts = [];
    return this.handleS7(pdu);
  }

  handleS7(pdu) {
    const sim = this.sim;
    if (pdu.length < 10 || pdu[0] !== 0x32) {
      sim.stats.errors++;
      return close();
    }
    const job = parseJob(pdu);
    const ref = pdu.readUInt16BE(4);
    const fn = job ? (FN_NAME[job.fn] ?? `0x${hex2(job.fn)}`) : 'invalid';
    const items = job?.items ?? [];
    const st = sim.stats;
    st.requests++;
    st.byFunction[fn] = (st.byFunction[fn] ?? 0) + 1;
    st.items += items.length;
    st.maxRequestPdu = Math.max(st.maxRequestPdu, pdu.length);
    const entry = {
      fn,
      ref,
      items: items.map(({ area, db, byte, bit, size }) => ({ area, db, byte, bit, size })),
      result: 'ok',
    };
    const fault = sim.takeFault();
    let plan;
    if (fault?.kind === 'silent') plan = silent();
    else if (fault?.kind === 'close') plan = close();
    else if (fault?.kind === 'garbage')
      // never a TPKT: version FF
      plan = {
        action: 'respond',
        delayMs: 0,
        buffers: [Buffer.from('FF00000A0BADBAD0BAD0', 'hex')],
      };
    else plan = this.answer(job, pdu, ref, entry);
    if (fault) {
      st.faults++;
      entry.result = `fault:${fault.kind}`;
      if (fault.kind === 'delay') plan.delayMs = fault.delayMs ?? 1000;
    }
    if (plan.pdu) st.maxResponsePdu = Math.max(st.maxResponsePdu, plan.pdu.length);
    sim.record(entry);
    return plan;
  }

  /** The device's answer to one S7 PDU. Sets entry.result on an error. */
  answer(job, pdu, ref, entry) {
    const sim = this.sim;
    const fail = (eclass, ecode, protocolError) => {
      if (protocolError) sim.stats.errors++;
      entry.result = `error:${hex2(eclass)}${hex2(ecode)}`;
      return respond(headerError(ref, eclass, ecode));
    };
    if (pdu.length > this.pdu) return fail(0x85, 0x00, true);
    if (!job || job.error) return fail(0x84, 0x00, true);
    if (job.fn === FN.SETUP) {
      this.pdu = Math.min(job.pduSize, sim.memory.pduSize);
      sim.stats.pduSize = this.pdu;
      return respond(setupResponse(ref, job.amqCaller, job.amqCallee, this.pdu));
    }
    if (job.fn !== FN.READ && job.fn !== FN.WRITE) return fail(0x84, 0x01, true);
    if (job.items.length > MAX_ITEMS) return fail(0x85, 0x00, true);
    if (sim.memory.putGetDisabled || sim.putget) return fail(0x81, 0x04, false);
    if (job.fn === FN.READ) {
      const results = sim.readItems(job.items);
      if (readResponseSize(results) > this.pdu) return fail(0x85, 0x00, true);
      const bad = results.filter((r) => r.rc !== RC.OK);
      if (bad.length) entry.result = `items:${results.map((r) => hex2(r.rc)).join(',')}`;
      return respond(readResponse(ref, results));
    }
    const rcs = sim.writeItems(job.items);
    entry.data = job.items.map((it) => it.data.toString('hex').toUpperCase());
    if (rcs.some((rc) => rc !== RC.OK)) entry.result = `items:${rcs.map(hex2).join(',')}`;
    return respond(writeResponse(ref, rcs));
  }
}
