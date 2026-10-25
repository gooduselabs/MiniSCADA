// Địa chỉ Tag của kênh MQTT (feature 022, specs/022-driver-mqtt/spec.md):
// `[sub:|pub:|both:]<topic>[|<jsonPath>][;qos=0|1][;retain]`. Mặc định `sub`; topic của `pub`/`both` không có
// wildcard và không bắt đầu bằng `$`. Đường dẫn JSON: `$` rồi các bước `.tên` hoặc `[chỉ số]`. Bản C++ giống hệt:
// drivers/mqtt/address.cpp; vector chung tests/mqtt-vectors/address.json.

export type MqttDirection = 'sub' | 'pub' | 'both';
export type MqttAddressErrorCode = 'E_ADDR_SYNTAX' | 'E_ADDR_RANGE';

export type MqttAddressResult =
  | {
      ok: true;
      dir: MqttDirection;
      /** Topic, hoặc topic filter của Tag `sub`. */
      topic: string;
      /** Đường dẫn JSON như đã viết; không có khi lấy nguyên payload. */
      path?: string;
      qos: 0 | 1;
      retain: boolean;
      /** Topic có `+` hoặc `#`. */
      wildcard: boolean;
    }
  | { ok: false; error: MqttAddressErrorCode };

const MAX_STEPS = 16;
const STEP = /^(?:\.[A-Za-z0-9_-]+|\[[0-9]{1,4}\])/;

/** Gợi ý cú pháp cho ô địa chỉ của Studio. */
export const MQTT_ADDRESS_HINTS = [
  'plant/tank1/level',
  'sensors/+/data|$.temp',
  'pub:plant/cmd/pump1;qos=1',
  'both:plant/sp|$.value;retain',
] as const;

function validFilter(t: string): { ok: boolean; wildcard: boolean } {
  if (t === '' || t.includes('\0')) return { ok: false, wildcard: false };
  const levels = t.split('/');
  let wildcard = false;
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i]!;
    if (l.includes('+')) {
      if (l !== '+') return { ok: false, wildcard };
      wildcard = true;
    }
    if (l.includes('#')) {
      if (l !== '#' || i !== levels.length - 1) return { ok: false, wildcard };
      wildcard = true;
    }
  }
  return { ok: true, wildcard };
}

function validPath(p: string): boolean {
  if (!p.startsWith('$')) return false;
  let rest = p.slice(1);
  let steps = 0;
  while (rest !== '') {
    if (++steps > MAX_STEPS) return false;
    const m = STEP.exec(rest);
    if (!m) return false;
    rest = rest.slice(m[0].length);
  }
  return true;
}

const fail = (error: MqttAddressErrorCode): MqttAddressResult => ({ ok: false, error });

export function parseMqttAddress(address: string): MqttAddressResult {
  let dir: MqttDirection = 'sub';
  let rest = address;
  for (const d of ['sub', 'pub', 'both'] as const)
    if (rest.startsWith(`${d}:`)) {
      dir = d;
      rest = rest.slice(d.length + 1);
      break;
    }
  const semi = rest.indexOf(';');
  const main = semi < 0 ? rest : rest.slice(0, semi);
  let qos: 0 | 1 = 0;
  let seenQos = false;
  let retain = false;
  if (semi >= 0)
    for (const o of rest.slice(semi + 1).split(';')) {
      if (o === 'retain') {
        if (retain || dir === 'sub') return fail('E_ADDR_SYNTAX');
        retain = true;
      } else if (o.startsWith('qos=')) {
        const v = o.slice(4);
        if (seenQos || !/^[0-9]{1,3}$/.test(v)) return fail('E_ADDR_SYNTAX');
        seenQos = true;
        const n = Number(v);
        if (n > 1) return fail('E_ADDR_RANGE');
        qos = n as 0 | 1;
      } else return fail('E_ADDR_SYNTAX');
    }
  const bar = main.indexOf('|');
  const topic = bar < 0 ? main : main.slice(0, bar);
  const path = bar < 0 ? undefined : main.slice(bar + 1);
  if (path !== undefined && !validPath(path)) return fail('E_ADDR_SYNTAX');
  const f = validFilter(topic);
  if (!f.ok) return fail('E_ADDR_SYNTAX');
  if (dir !== 'sub' && (f.wildcard || topic.startsWith('$'))) return fail('E_ADDR_SYNTAX');
  return {
    ok: true,
    dir,
    topic,
    ...(path !== undefined ? { path } : {}),
    qos,
    retain,
    wildcard: f.wildcard,
  };
}

/** MQTT 3.1.1 §4.7: topic (không wildcard) có khớp filter không. Filter bắt đầu bằng wildcard không khớp topic `$...`. */
export function mqttTopicMatches(filter: string, topic: string): boolean {
  if (topic.startsWith('$') && (filter.startsWith('+') || filter.startsWith('#'))) return false;
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
