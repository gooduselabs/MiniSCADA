// The PLC logic of the FINS simulator (feature 018): commands 0101, 0102, 0104, 0501 on the memory,
// scripted faults, counters and a log of the commands. Transport-free: sim.mjs feeds it the frames of
// UDP datagrams and of FINS/TCP messages.
//
// Faults (POST /fault of control.mjs), each applies to `count` commands (default 1) after `skip`:
//   { kind: "silent" }                    no answer (a lost datagram)
//   { kind: "late", delayMs }             the answer comes after delayMs
//   { kind: "endCode", endCode: "1103" }  the answer carries this end code
//   { kind: "badSid" }                    an answer with another SID, then the right one
//   { kind: "garbage" }                   2 bytes of nonsense (UDP) / a stream that is not FINS (TCP)
//   { kind: "close" }                     TCP: the connection is closed
//   { kind: "tcpRefuse", error: 32 }      TCP: the node handshakes are refused with this error code
//   filters: command ("0101", "0102", "0104"), from / to (word addresses of 0101 / 0102), transport
import { buildResponse, isWordCode, parseCommand, wordCodeOf } from './codec.mjs';
import { FinsMemory } from './memory.mjs';

const KINDS = new Set([
  'silent',
  'late',
  'endCode',
  'badSid',
  'garbage',
  'close',
  'tcpRefuse',
  'clear',
]);
const MODEL = Buffer.from('CJ2M-CPU31 (fins-sim)'.padEnd(20, ' ').slice(0, 20), 'latin1');

export class SimServer {
  constructor({ memory, now = Date.now, onLog = null }) {
    this.memory = memory instanceof FinsMemory ? memory : new FinsMemory(memory);
    this.now = now;
    this.onLog = onLog;
    this.faults = [];
    this.tcpError = 0;
    this.plcStatus = 0;
    this.nextClientNode = 100;
    this.reset();
  }
  reset() {
    this.faults = [];
    this.tcpError = 0;
    this.seq = 0;
    this.log = [];
    this.count = {
      commands: 0,
      responses: 0,
      endCodes: 0,
      faults: 0,
      byCommand: {},
      udp: 0,
      tcp: 0,
      handshakes: 0,
      bytesIn: 0,
      bytesOut: 0,
    };
  }
  addFault(f) {
    if (!KINDS.has(f.kind)) throw new Error(`unknown fault kind ${f.kind}`);
    if (f.kind === 'clear') return this.clearFaults();
    if (f.kind === 'tcpRefuse') {
      this.tcpError = f.error ?? 0x20;
      return;
    }
    this.faults.push({ count: 1, skip: 0, ...f });
  }
  clearFaults() {
    this.faults = [];
    this.tcpError = 0;
  }
  counters() {
    return { ...this.count, byCommand: { ...this.count.byCommand } };
  }
  logEntries(since = 0) {
    return this.log.filter((e) => e.seq > since);
  }
  /** FINS/TCP node handshake: { error, client, server }. */
  handshake(asked) {
    this.count.handshakes++;
    if (this.tcpError) return { error: this.tcpError };
    const client = asked !== 0 ? asked : this.nextClientNode++;
    if (this.nextClientNode > 250) this.nextClientNode = 100;
    return { error: 0, client, server: this.memory.node };
  }

  /**
   * One command frame -> { action: "respond" | "silent" | "close" | "garbage", buffers, delayMs }.
   * `transport`: "udp" or "tcp" (the faults may filter on it).
   */
  handleFrame(frame, transport = 'udp') {
    this.count.bytesIn += frame.length;
    const c = parseCommand(frame);
    if (!c || (c.icf & 0x40) !== 0) return { action: 'silent', buffers: [], delayMs: 0 };
    this.count.commands++;
    this.count[transport]++;
    const cmdHex = c.command.toString(16).padStart(4, '0');
    this.count.byCommand[cmdHex] = (this.count.byCommand[cmdHex] ?? 0) + 1;
    const entry = {
      seq: ++this.seq,
      ts: this.now(),
      transport,
      command: cmdHex,
      sid: c.sid,
      da1: c.da1,
      sa1: c.sa1,
      code: c.code,
      address: c.address,
      bit: c.bit,
      count: c.count,
      items: c.items?.length,
      result: 'ok',
    };
    this.log.push(entry);
    if (this.log.length > 20000) this.log.splice(0, this.log.length - 20000);

    const fault = this.takeFault(c, cmdHex, transport);
    if (fault?.kind === 'silent') return this.done(entry, 'silent', { action: 'silent' });
    if (fault?.kind === 'close') return this.done(entry, 'close', { action: 'close' });
    if (fault?.kind === 'garbage')
      return this.done(entry, 'garbage', {
        action: 'garbage',
        buffers: [Buffer.from([0xde, 0xad])],
      });
    const { endCode, data = Buffer.alloc(0) } =
      fault?.kind === 'endCode'
        ? { endCode: parseInt(String(fault.endCode ?? '1103'), 16) }
        : this.execute(c);
    if (endCode !== 0) this.count.endCodes++;
    const resp = buildResponse(c, endCode, data, this.plcStatus);
    const buffers = [];
    if (fault?.kind === 'badSid') {
      const bad = Buffer.from(resp);
      bad[9] = (c.sid + 1) & 0xff;
      buffers.push(bad);
    }
    buffers.push(resp);
    entry.result = endCode ? endCode.toString(16).padStart(4, '0') : fault ? fault.kind : 'ok';
    for (const b of buffers) this.count.bytesOut += b.length;
    this.count.responses++;
    this.onLog?.(entry);
    return {
      action: 'respond',
      buffers,
      delayMs: fault?.kind === 'late' ? (fault.delayMs ?? 2000) : 0,
    };
  }

  done(entry, result, plan) {
    entry.result = result;
    this.onLog?.(entry);
    return { buffers: [], delayMs: 0, ...plan };
  }

  takeFault(c, cmdHex, transport) {
    for (let i = 0; i < this.faults.length; i++) {
      const f = this.faults[i];
      if (f.command && f.command.toLowerCase() !== cmdHex) continue;
      if (f.transport && f.transport !== transport) continue;
      if (f.from !== undefined) {
        if (c.address === undefined) continue;
        const end = c.address + Math.max(1, isWordCode(c.code) ? c.count : 1) - 1;
        if (end < f.from || c.address > (f.to ?? f.from)) continue;
      }
      if (f.skip > 0) {
        f.skip--;
        continue;
      }
      this.count.faults++;
      if (--f.count <= 0) this.faults.splice(i, 1);
      return f;
    }
    return null;
  }

  execute(c) {
    const m = this.memory;
    const now = this.now();
    if (c.command === 0x0501)
      return { endCode: 0, data: Buffer.concat([MODEL, Buffer.alloc(20, 0x20)]) };
    if (c.command === 0x0104) {
      if (!c.items.length) return { endCode: 0x1002 };
      const out = [];
      for (const it of c.items) {
        if (m.outside(it.code, it.address)) return { endCode: 0x1103 };
        if (isWordCode(it.code)) {
          const v = m.word(it.code, it.address, now);
          out.push(it.code, v >> 8, v & 0xff);
        } else if (it.code === 0x09) {
          out.push(it.code, m.flag(it.address) ? 1 : 0);
        } else {
          out.push(it.code, (m.word(it.code, it.address, now) >> it.bit) & 1);
        }
      }
      return { endCode: 0, data: Buffer.from(out) };
    }
    if (c.command !== 0x0101 && c.command !== 0x0102) return { endCode: 0x0401 };
    if (c.code === undefined) return { endCode: 0x1002 };
    if (c.count < 1 || c.count > 999) return { endCode: 0x1103 };
    const word = isWordCode(c.code);
    const lastWord = word
      ? c.address + c.count - 1
      : c.address + Math.floor((c.bit + c.count - 1) / 16);
    if (m.outside(c.code, c.address) || m.outside(c.code, lastWord)) return { endCode: 0x1103 };
    if (c.command === 0x0101) {
      const out = Buffer.alloc(c.count * (word ? 2 : 1));
      for (let k = 0; k < c.count; k++) {
        if (word) out.writeUInt16BE(m.word(c.code, c.address + k, now), 2 * k);
        else if (c.code === 0x09) out[k] = m.flag(c.address + k) ? 1 : 0;
        else {
          const b = c.bit + k;
          out[k] = (m.word(c.code, c.address + Math.floor(b / 16), now) >> (b % 16)) & 1;
        }
      }
      return { endCode: 0, data: out };
    }
    // 0102
    if (c.code === 0x09) return { endCode: 0x2101 }; // flags cannot be written
    if (wordCodeOf(c.code) === 0xb3 && c.address < 448) return { endCode: 0x2101 }; // A0-A447
    if (c.data.length !== c.count * (word ? 2 : 1)) return { endCode: 0x1003 };
    for (let k = 0; k < c.count; k++) {
      if (word) m.setWord(c.code, c.address + k, c.data.readUInt16BE(2 * k));
      else {
        const b = c.bit + k;
        const addr = c.address + Math.floor(b / 16);
        const mask = 1 << (b % 16);
        const w = m.word(c.code, addr, now);
        m.setWord(c.code, addr, c.data[k] ? w | mask : w & ~mask);
      }
    }
    return { endCode: 0, data: Buffer.alloc(0) };
  }
}
