// The BACnet devices of the simulator (feature 020): object tables, priority arrays, ReadProperty,
// ReadPropertyMultiple, WriteProperty (priority 1-16, NULL relinquishes), Who-Is / I-Am, Register-Foreign-Device,
// faults on command. Pure: handle(datagram, from) returns the datagrams to send; sim.mjs owns the UDP socket.
//
// Map: { devices: [{ instance, name?, vendorId?, maxApdu?, network?, mac?, noRpm?, objects: [{ type: 'AI', instance,
// name?, value, units?, flags?, outOfService?, commandable?, drift? }], generate?: [{ type, from, count, value }] }] }
// The first device without `network` answers on the simulator's address; the others sit behind a virtual router
// (their answers carry SNET/SADR).
import {
  BVLC,
  ERROR_CODE,
  OBJECT,
  OBJECT_NAME,
  PDU,
  PROP,
  Reader,
  SERVICE,
  closing,
  contextObject,
  contextUnsigned,
  encodeValue,
  frame,
  opening,
  parseFrame,
} from './codec.mjs';

const ANALOG = new Set(['AI', 'AO', 'AV']);
const BINARY = new Set(['BI', 'BO', 'BV']);
const COMMANDABLE = new Set(['AO', 'AV', 'BO', 'BV', 'MSO', 'MSV']);

function pvValue(typeName, v) {
  if (ANALOG.has(typeName)) return { tag: 'real', value: Number(v) };
  if (BINARY.has(typeName)) return { tag: 'enumerated', value: v ? 1 : 0 };
  return { tag: 'unsigned', value: Math.max(1, Math.round(Number(v))) };
}

export class SimServer {
  constructor({ map, now = Date.now, onLog = null }) {
    this.now = now;
    this.onLog = onLog;
    this.devices = [];
    this.faults = {
      drop: 0,
      dropAll: false,
      delayMs: 0,
      errorCode: null,
      maxApdu: null,
      noRpm: false,
    };
    this.counters = {
      requests: 0,
      responses: 0,
      dropped: 0,
      byService: {},
      errors: 0,
      whoIs: 0,
      registrations: 0,
    };
    this.seq = 0;
    this.log = [];
    for (const d of map.devices ?? []) this.addDevice(d);
  }

  addDevice(d) {
    const dev = {
      instance: d.instance,
      name: d.name ?? `Device ${d.instance}`,
      vendorId: d.vendorId ?? 260,
      maxApdu: d.maxApdu ?? 1476,
      network: d.network ?? 0,
      mac: d.mac ? [...Buffer.from(d.mac, 'hex')] : [],
      noRpm: !!d.noRpm,
      objects: new Map(),
    };
    const add = (o) => {
      const typeName = o.type;
      if (!(typeName in OBJECT)) throw new Error(`object type ${typeName}`);
      const commandable = o.commandable ?? COMMANDABLE.has(typeName);
      dev.objects.set(`${typeName}:${o.instance}`, {
        typeName,
        type: OBJECT[typeName],
        instance: o.instance,
        name: o.name ?? `${typeName}-${o.instance}`,
        value: o.value ?? (BINARY.has(typeName) ? false : ANALOG.has(typeName) ? 0 : 1),
        units: o.units ?? 95, // no-units
        flags: o.flags ?? 0,
        outOfService: !!o.outOfService,
        commandable,
        priority: new Array(16).fill(null),
        drift: o.drift ?? 0,
      });
    };
    for (const o of d.objects ?? []) add(o);
    for (const g of d.generate ?? [])
      for (let i = 0; i < g.count; i++)
        add({ type: g.type, instance: g.from + i, value: g.value ?? i, drift: g.drift ?? 0 });
    this.devices.push(dev);
    return dev;
  }

  device(instance) {
    return this.devices.find((d) => d.instance === instance);
  }
  object(instance, key) {
    return this.device(instance)?.objects.get(key);
  }
  /** present-value: the highest priority set, else the relinquish default (`value`). */
  present(o) {
    if (o.commandable) for (const p of o.priority) if (p !== null) return p;
    return o.value;
  }
  set(instance, key, patch) {
    const o = this.object(instance, key);
    if (!o) throw new Error(`no object ${key} on ${instance}`);
    if ('value' in patch) o.value = patch.value;
    if ('flags' in patch) o.flags = patch.flags;
    if ('outOfService' in patch) o.outOfService = !!patch.outOfService;
    if ('priority' in patch) o.priority = patch.priority;
    return this.describe(o);
  }
  describe(o) {
    return {
      object: `${o.typeName}:${o.instance}`,
      presentValue: this.present(o),
      value: o.value,
      flags: o.flags,
      priority: o.priority,
    };
  }

  addFault(f) {
    switch (f.kind) {
      case 'clear':
        this.faults = {
          drop: 0,
          dropAll: false,
          delayMs: 0,
          errorCode: null,
          maxApdu: null,
          noRpm: false,
        };
        return;
      case 'drop':
        this.faults.drop += f.count ?? 1;
        return;
      case 'dropAll':
        this.faults.dropAll = f.on !== false;
        return;
      case 'delay':
        this.faults.delayMs = f.ms ?? 0;
        return;
      case 'error':
        this.faults.errorCode = f.code ?? null;
        return;
      case 'maxApdu':
        this.faults.maxApdu = f.value ?? null;
        return;
      case 'noRpm':
        this.faults.noRpm = f.on !== false;
        return;
      default:
        throw new Error(`fault kind ${f.kind}`);
    }
  }

  record(e) {
    const entry = { seq: ++this.seq, ts: this.now(), ...e };
    this.log.push(entry);
    if (this.log.length > 2000) this.log.shift();
    this.onLog?.(entry);
  }

  /** The values of a property, or { error } (an error code). */
  read(dev, o, prop, index) {
    if (!o) return { error: ERROR_CODE.UNKNOWN_OBJECT };
    if (o.drift && prop === PROP['present-value']) o.value = Number(o.value) + o.drift;
    switch (prop) {
      case PROP['present-value']:
        return { values: [pvValue(o.typeName, this.present(o))] };
      case PROP['object-name']:
        return { values: [{ tag: 'string', value: o.name }] };
      case PROP['object-identifier']:
        return { values: [{ tag: 'object', value: { type: o.type, instance: o.instance } }] };
      case PROP['object-type']:
        return { values: [{ tag: 'enumerated', value: o.type }] };
      case PROP['status-flags']:
        if (o.typeName === 'DEV') break;
        return {
          values: [{ tag: 'bits', value: (o.flags & 7) | (o.outOfService ? 8 : 0), count: 4 }],
        };
      case PROP['out-of-service']:
        if (o.typeName === 'DEV') break;
        return { values: [{ tag: 'boolean', value: o.outOfService }] };
      case PROP.units:
        if (!ANALOG.has(o.typeName)) break;
        return { values: [{ tag: 'enumerated', value: o.units }] };
      case PROP.reliability:
      case PROP['event-state']:
        if (o.typeName === 'DEV') break;
        return { values: [{ tag: 'enumerated', value: 0 }] };
      case PROP['priority-array']: {
        if (!o.commandable) break;
        const slot = (p) => (p === null ? { tag: 'null' } : pvValue(o.typeName, p));
        if (index === 0) return { values: [{ tag: 'unsigned', value: 16 }] };
        if (index === undefined) return { values: o.priority.map(slot) };
        if (index < 1 || index > 16) return { error: ERROR_CODE.INVALID_ARRAY_INDEX };
        return { values: [slot(o.priority[index - 1])] };
      }
      case PROP['object-list']: {
        if (o.typeName !== 'DEV') break;
        const list = [
          { type: OBJECT.DEV, instance: dev.instance },
          ...[...dev.objects.values()]
            .filter((x) => x !== o)
            .map((x) => ({ type: x.type, instance: x.instance })),
        ];
        if (index === 0) return { values: [{ tag: 'unsigned', value: list.length }] };
        if (index !== undefined) {
          if (index < 1 || index > list.length) return { error: ERROR_CODE.INVALID_ARRAY_INDEX };
          return { values: [{ tag: 'object', value: list[index - 1] }] };
        }
        return { values: list.map((value) => ({ tag: 'object', value })) };
      }
      case PROP['vendor-identifier']:
        if (o.typeName !== 'DEV') break;
        return { values: [{ tag: 'unsigned', value: dev.vendorId }] };
      case PROP['vendor-name']:
        if (o.typeName !== 'DEV') break;
        return { values: [{ tag: 'string', value: 'mAT BACnet simulator' }] };
      case PROP['max-apdu-length-accepted']:
        if (o.typeName !== 'DEV') break;
        return { values: [{ tag: 'unsigned', value: dev.maxApdu }] };
      default:
        break;
    }
    return { error: ERROR_CODE.UNKNOWN_PROPERTY };
  }

  findObject(dev, id) {
    if (id.type === OBJECT.DEV && id.instance === dev.instance) {
      let d = dev.objects.get(`DEV:${dev.instance}`);
      if (!d) {
        d = {
          typeName: 'DEV',
          type: OBJECT.DEV,
          instance: dev.instance,
          name: dev.name,
          value: 0,
          priority: [],
          commandable: false,
        };
        dev.objects.set(`DEV:${dev.instance}`, d);
      }
      return d;
    }
    return dev.objects.get(`${OBJECT_NAME[id.type]}:${id.instance}`);
  }

  errorApdu(invokeId, service, code) {
    const cls = code === ERROR_CODE.UNKNOWN_OBJECT ? 1 : 2; // object, property
    return [
      0x50,
      invokeId,
      service,
      ...encodeValue({ tag: 'enumerated', value: cls }),
      ...encodeValue({ tag: 'enumerated', value: code }),
    ];
  }

  answer(dev, f) {
    const { invokeId, service } = f;
    if (this.faults.errorCode !== null)
      return this.errorApdu(invokeId, service, this.faults.errorCode);
    const r = new Reader(f.data);
    const ack = [0x30, invokeId, service];
    if (service === SERVICE.READ_PROPERTY) {
      const id = r.contextObject(0);
      const prop = r.contextUnsigned(1);
      const index = r.isContext(2) ? r.contextUnsigned(2) : undefined;
      const res = this.read(dev, this.findObject(dev, id), prop, index);
      this.record({
        device: dev.instance,
        service: 'readProperty',
        object: `${OBJECT_NAME[id.type] ?? id.type}:${id.instance}`,
        prop,
        index,
        error: res.error,
      });
      if (res.error) return this.errorApdu(invokeId, service, res.error);
      ack.push(...contextObject(0, id), ...contextUnsigned(1, prop));
      if (index !== undefined) ack.push(...contextUnsigned(2, index));
      ack.push(...opening(3));
      for (const v of res.values) ack.push(...encodeValue(v));
      ack.push(...closing(3));
    } else if (service === SERVICE.READ_PROPERTY_MULTIPLE) {
      if (dev.noRpm || this.faults.noRpm) return [0x60, invokeId, 9]; // reject: unrecognized-service
      let props = 0;
      while (!r.atEnd()) {
        const id = r.contextObject(0);
        const o = this.findObject(dev, id);
        r.expectOpening(1);
        ack.push(...contextObject(0, id), ...opening(1));
        while (!r.isClosing(1)) {
          const prop = r.contextUnsigned(0);
          const index = r.isContext(1) ? r.contextUnsigned(1) : undefined;
          ack.push(...contextUnsigned(2, prop));
          if (index !== undefined) ack.push(...contextUnsigned(3, index));
          const res = this.read(dev, o, prop, index);
          if (res.error) {
            ack.push(
              ...opening(5),
              ...encodeValue({
                tag: 'enumerated',
                value: res.error === ERROR_CODE.UNKNOWN_OBJECT ? 1 : 2,
              }),
              ...encodeValue({ tag: 'enumerated', value: res.error }),
              ...closing(5),
            );
          } else {
            ack.push(...opening(4));
            for (const v of res.values) ack.push(...encodeValue(v));
            ack.push(...closing(4));
          }
          props++;
        }
        r.expectClosing(1);
        ack.push(...closing(1));
      }
      this.record({
        device: dev.instance,
        service: 'readPropertyMultiple',
        props,
        bytes: ack.length,
      });
    } else if (service === SERVICE.WRITE_PROPERTY) {
      const id = r.contextObject(0);
      const prop = r.contextUnsigned(1);
      if (r.isContext(2)) r.contextUnsigned(2);
      r.expectOpening(3);
      const value = r.value();
      r.expectClosing(3);
      const priority = r.isContext(4) ? r.contextUnsigned(4) : 16;
      const o = this.findObject(dev, id);
      const object = `${OBJECT_NAME[id.type] ?? id.type}:${id.instance}`;
      this.record({
        device: dev.instance,
        service: 'writeProperty',
        object,
        prop,
        priority,
        value,
      });
      if (!o) return this.errorApdu(invokeId, service, ERROR_CODE.UNKNOWN_OBJECT);
      if (prop !== PROP['present-value'] || !COMMANDABLE.has(o.typeName))
        return this.errorApdu(invokeId, service, ERROR_CODE.WRITE_ACCESS_DENIED);
      const want = ANALOG.has(o.typeName)
        ? 'real'
        : BINARY.has(o.typeName)
          ? 'enumerated'
          : 'unsigned';
      if (value.tag !== want && value.tag !== 'null')
        return this.errorApdu(invokeId, service, ERROR_CODE.INVALID_DATA_TYPE);
      if (priority < 1 || priority > 16 || priority === 6)
        return this.errorApdu(invokeId, service, ERROR_CODE.VALUE_OUT_OF_RANGE);
      if (want === 'unsigned' && value.tag !== 'null' && value.value < 1)
        return this.errorApdu(invokeId, service, ERROR_CODE.VALUE_OUT_OF_RANGE);
      const v =
        value.tag === 'null' ? null : want === 'enumerated' ? value.value !== 0 : value.value;
      if (o.commandable) o.priority[priority - 1] = v;
      else if (v !== null) o.value = v;
      return [0x20, invokeId, service];
    } else {
      return [0x60, invokeId, 9];
    }
    const limit = Math.min(dev.maxApdu, this.faults.maxApdu ?? 1476, f.maxApdu ?? 1476);
    if (ack.length > limit) return [0x71, invokeId, 4]; // abort: segmentation-not-supported
    return ack;
  }

  iAm(dev) {
    return [
      0x10,
      SERVICE.I_AM,
      ...encodeValue({ tag: 'object', value: { type: OBJECT.DEV, instance: dev.instance } }),
      ...encodeValue({ tag: 'unsigned', value: dev.maxApdu }),
      ...encodeValue({ tag: 'enumerated', value: 3 }),
      ...encodeValue({ tag: 'unsigned', value: dev.vendorId }),
    ];
  }

  /**
   * One datagram from `from` { address, port }. Returns [{ data: Buffer, address, port, broadcast?, delayMs }].
   */
  handle(buf, from) {
    let f;
    try {
      f = parseFrame(buf);
    } catch {
      return [];
    }
    const out = [];
    const routeOf = (dev) => (dev.network ? { snet: dev.network, sadr: dev.mac } : null);
    if (f.bvlc === BVLC.REGISTER_FD) {
      this.counters.registrations++;
      out.push({ data: Buffer.from([0x81, 0x00, 0x00, 0x06, 0x00, 0x00]), ...from, delayMs: 0 });
      return out;
    }
    if (f.pdu === PDU.UNCONFIRMED && f.service === SERVICE.WHO_IS) {
      this.counters.whoIs++;
      let low = -1;
      let high = -1;
      try {
        const r = new Reader(f.data);
        if (!r.atEnd()) {
          low = r.contextUnsigned(0);
          high = r.contextUnsigned(1);
        }
      } catch {
        return [];
      }
      for (const d of this.devices) {
        if (low >= 0 && (d.instance < low || d.instance > high)) continue;
        // I-Am: a broadcast on the network; to a foreign device (Distribute-Broadcast) straight back to it
        out.push({
          data: frame(this.iAm(d), { bvlc: BVLC.BROADCAST, route: routeOf(d) }),
          ...from,
          broadcast: f.bvlc !== BVLC.DISTRIBUTE,
          delayMs: 0,
        });
      }
      this.record({ service: 'whoIs', low, high, found: out.length });
      return out;
    }
    if (f.pdu !== PDU.CONFIRMED) return [];
    const dev = f.dnet
      ? this.devices.find(
          (d) => d.network === f.dnet && Buffer.from(d.mac).equals(Buffer.from(f.dadr)),
        )
      : this.devices.find((d) => !d.network);
    if (!dev) return [];
    this.counters.requests++;
    this.counters.byService[f.service] = (this.counters.byService[f.service] ?? 0) + 1;
    if (this.faults.dropAll || this.faults.drop > 0) {
      if (this.faults.drop > 0) this.faults.drop--;
      this.counters.dropped++;
      return [];
    }
    let apdu;
    try {
      apdu = this.answer(dev, f);
    } catch {
      apdu = [0x60, f.invokeId, 0]; // reject: other
    }
    if (apdu[0] === 0x50) this.counters.errors++;
    this.counters.responses++;
    out.push({ data: frame(apdu, { route: routeOf(dev) }), ...from, delayMs: this.faults.delayMs });
    return out;
  }
}
