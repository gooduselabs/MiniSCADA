// Sinh vector gói tìm thiết bị dùng chung C++ (core/discovery, thiết bị) và Rust (Studio):
// specs/005-device-online/contracts/discovery.md §6. Mỗi vector một file JSON, gói viết bằng hex.
//
//   node tests/discovery-vectors/generate.mjs
//
// Loại vector (`kind`):
// - "query": thiết bị nhận gói hỏi `packet` từ `source` ({ ip, port }) trên card có các địa chỉ IPv4
//   `iface` ([{ ip, prefix }]); bộ giới hạn tần suất còn đầy.
//   expect: { "reply": true } hoặc { "reply": false, "reason": "format" | "subnet" | "port" }. Lý do là tên
//   bộ đếm gói bị bỏ (T056); nguồn 0.0.0.0, broadcast, multicast, loopback tính là "subnet".
// - "rate": các gói hỏi hợp lệ trên card `iface`, nguồn `ip`/`port`, ở thời điểm `ms` (đồng hồ giả, bắt đầu
//   từ bộ giới hạn mới). expect: mỗi gói có được trả lời không.
// - "build": thiết bị dựng gói trả lời cho gói hỏi có `nonce`, từ `info` (JSON đầy đủ, trước khi cắt).
//   expect: { "flags", "json" }: so header 24 byte, cờ và nội dung JSON (không so byte: thứ tự khóa tùy bản
//   cài đặt). Độ dài JSON tính trên dạng gọn (không khoảng trắng, UTF-8 nguyên văn, không thoát `/`), như
//   nlohmann::json::dump() và serde_json. `packet`: một gói đúng, khóa theo thứ tự của contract §3.
// - "reply": Studio nhận `packet` từ `source` trong lượt quét có `nonce`.
//   expect: { "accept": false } hoặc { "accept": true, "truncated", "device" }; `device` theo data-model §1
//   (`ip` lấy từ địa chỉ nguồn UDP; khóa tùy chọn không có trong JSON thì null; khóa lạ bỏ qua).
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const QUERY_SIZE = 1024;
const HEADER = 24;
const MAX_JSON = 1000;
const NONCE = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const OTHER_NONCE = Buffer.from('ffeeddccbbaa99887766554433221100', 'hex');
const LAN = [{ ip: '192.168.1.110', prefix: 24 }];
const CLIENT = { ip: '192.168.1.20', port: 50000 };
const DEVICE = { ip: '192.168.1.110', port: 8446 };

const hex = (b) => b.toString('hex');
const jsonBytes = (o) => Buffer.from(JSON.stringify(o), 'utf8');

/** Phần đầu 24 byte: MATD, version, type, cờ (big-endian), nonce. */
function header({ magic = 'MATD', version = 1, type, flags = 0, nonce = NONCE }) {
  const b = Buffer.alloc(HEADER);
  Buffer.from(magic, 'latin1').copy(b, 0);
  b[4] = version;
  b[5] = type;
  b.writeUInt16BE(flags, 6);
  nonce.copy(b, 8);
  return b;
}

/** Gói hỏi đúng 1024 byte (contract §2), sửa được từng trường. */
function query(opt = {}) {
  const b = Buffer.concat([header({ type: 1, ...opt }), Buffer.alloc(QUERY_SIZE - HEADER)]);
  if (opt.edit) opt.edit(b);
  return b;
}

/** Gói trả lời: phần đầu (type 2) + JSON UTF-8 gọn. */
const replyPacket = (obj, opt = {}) =>
  Buffer.concat([header({ type: 2, ...opt }), Buffer.isBuffer(obj) ? obj : jsonBytes(obj)]);

/**
 * Cách dựng của thiết bị (contract §3): JSON vượt 1000 byte thì bỏ `project.name`; còn vượt thì cắt `name`
 * theo ranh giới ký tự (giữ phần đầu dài nhất còn vừa); cả hai bật cờ `truncated` (bit 0).
 */
function build(info) {
  const obj = structuredClone(info);
  let flags = 0;
  const fits = (o) => jsonBytes(o).length <= MAX_JSON;
  if (!fits(obj) && obj.project && 'name' in obj.project) {
    delete obj.project.name;
    flags |= 1;
  }
  if (!fits(obj)) {
    const chars = [...obj.name];
    while (chars.length > 0 && !fits({ ...obj, name: chars.join('') })) chars.pop();
    obj.name = chars.join('');
    flags |= 1;
  }
  if (!fits(obj)) throw new Error('vector dựng sai: cắt name vẫn không vừa');
  return { obj, flags, packet: replyPacket(obj, { flags }) };
}

/** DiscoveredDevice (data-model §1) mà Studio phải đọc ra; bỏ `iface`, `receivedAt`. */
function deviceOf(obj, source) {
  let project = null;
  if (obj.project) {
    project = { id: obj.project.id };
    if ('name' in obj.project) project.name = obj.project.name;
    project.version = obj.project.version;
    project.digest = obj.project.digest;
  }
  return {
    deviceId: obj.id,
    ip: source.ip,
    name: obj.name,
    model: obj.model ?? null,
    mac: obj.mac ?? null,
    prefix: obj.prefix ?? null,
    runtime: obj.runtime,
    api: obj.api ?? null,
    status: obj.status,
    project,
    httpsPort: obj.https,
    httpPort: obj.http ?? null,
    fingerprint: obj.fp ?? null,
  };
}

/** Thiết bị đang chạy tank-demo (ví dụ của contract §3). */
const INFO = () => ({
  v: 1,
  id: '4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10',
  name: 'BL335-01',
  model: 'BL335',
  mac: 'C2:D9:CC:52:33:70',
  ip: '192.168.1.110',
  prefix: 24,
  runtime: '0.4.0',
  api: '1.0.0',
  status: 'running',
  project: {
    id: 'tank-demo',
    name: 'Trạm bơm nước (demo Sprint 1)',
    version: '0.1.0',
    digest: 'sha256:9f2c8e6d0a4b1c3e5f7a9b0d2c4e6f8a1b3d5e7f9a0c2e4f6a8b0d1c3e5f7a9b',
  },
  https: 8443,
  http: 8080,
  fp: '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b',
});

/**
 * Trường hợp xấu nhất với dữ liệu thật (research R2): tên project 64 ký tự tiếng Việt, mỗi ký tự 3 byte
 * (khối U+1EA0–U+1EF9); tên thiết bị 32 byte; mã project 48 ký tự; phiên bản project 60 ký tự; trạng thái
 * dài nhất; cổng 5 chữ số; IP 15 ký tự.
 */
function worstInfo() {
  const letters = 'ẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸ';
  const projectName = [...letters.repeat(2)].slice(0, 64).join('');
  if (Buffer.byteLength(projectName) !== 64 * 3)
    throw new Error('tên project phải là 64 ký tự 3 byte');
  const name = 'Trạm bơm Bến Lữ số 1234'.normalize('NFC');
  const id = 'he-thong-xu-ly-nuoc-thai-tap-trung-khu-cong-nghe';
  if (Buffer.byteLength(name) !== 32 || id.length !== 48) throw new Error('độ dài sai');
  return {
    ...INFO(),
    name,
    ip: '192.168.100.110',
    status: 'project-error',
    project: {
      id,
      name: projectName,
      version: '12.345.6789-rc.1.build.20261011.a1b2c3d4e5f6a7b8c9d0e1f2a3b4',
      digest: 'sha256:' + 'ab'.repeat(32),
    },
    https: 65535,
    http: 65534,
  };
}

/**
 * `runtime` dài bất thường (hàm dựng là hàm thuần, nhận mọi chuỗi) để JSON không có `project.name` dài đúng
 * `target` byte: cách duy nhất buộc phải cắt, vì với dữ liệu thật JSON không bao giờ vượt 1000 byte.
 */
function withRuntimeLength(info, target) {
  const probe = structuredClone(info);
  delete probe.project.name;
  probe.runtime = '0.4.0-';
  const n = target - jsonBytes(probe).length;
  if (n < 0) throw new Error('target quá nhỏ');
  return { ...structuredClone(info), runtime: '0.4.0-' + 'x'.repeat(n) };
}

const V = {};
const vector = (name, v) => {
  if (V[name]) throw new Error(`trùng ${name}`);
  V[name] = v;
};

// ---- Thiết bị: gói hỏi (contract §2) ----

const q = (packet, expect, source = CLIENT, iface = LAN) => ({
  kind: 'query',
  packet: hex(packet),
  source,
  iface,
  expect,
});
const REPLY = { reply: true };
const drop = (reason) => ({ reply: false, reason });

vector('query-valid', q(query(), REPLY));
vector('query-length-1023', q(query().subarray(0, 1023), drop('format')));
vector('query-length-1025', q(Buffer.concat([query(), Buffer.alloc(1)]), drop('format')));
vector('query-bad-magic', q(query({ magic: 'MATX' }), drop('format')));
vector('query-bad-version', q(query({ version: 2 }), drop('format')));
vector('query-bad-type', q(query({ type: 2 }), drop('format'))); // gói trả lời không được gây trả lời
vector('query-flags-nonzero', q(query({ flags: 0x0001 }), drop('format')));
vector('query-padding-nonzero', q(query({ edit: (b) => (b[1023] = 0x01) }), drop('format')));
vector(
  'query-source-other-subnet',
  q(query(), drop('subnet'), { ip: '192.168.2.20', port: 50000 }),
);
vector('query-source-broadcast', q(query(), drop('subnet'), { ip: '192.168.1.255', port: 50000 }));
vector(
  'query-source-limited-broadcast',
  q(query(), drop('subnet'), { ip: '255.255.255.255', port: 50000 }),
);
vector('query-source-zero', q(query(), drop('subnet'), { ip: '0.0.0.0', port: 50000 }));
vector('query-source-multicast', q(query(), drop('subnet'), { ip: '224.0.0.251', port: 50000 }));
vector(
  'query-source-loopback', // cùng subnet với card lo nhưng là loopback: vẫn bỏ (contract §2)
  q(query(), drop('subnet'), { ip: '127.0.0.1', port: 50000 }, [{ ip: '127.0.0.1', prefix: 8 }]),
);
vector(
  'query-source-second-address', // card có hai địa chỉ: nguồn thuộc subnet của địa chỉ thứ hai
  q(query(), REPLY, { ip: '10.10.3.7', port: 50000 }, [...LAN, { ip: '10.10.0.5', prefix: 16 }]),
);
vector('query-source-port-53', q(query(), drop('port'), { ip: CLIENT.ip, port: 53 }));
vector('query-source-port-1023', q(query(), drop('port'), { ip: CLIENT.ip, port: 1023 }));
vector('query-source-port-1024', q(query(), REPLY, { ip: CLIENT.ip, port: 1024 }));

// ---- Thiết bị: giới hạn tần suất (contract §4: mỗi nguồn 1 trả lời/s, dồn tối đa 3) ----

const rate = (events) => ({
  kind: 'rate',
  iface: LAN,
  events: events.map(([ms, ip]) => ({ ms, ip, port: 50000 })),
  expect: events.map(([, , replied]) => replied),
});
const A = '192.168.1.20';
const B = '192.168.1.21';
vector(
  'rate-one-source', // 5 gói từ một nguồn trong 1 s → 3 trả lời
  rate([
    [0, A, true],
    [200, A, true],
    [400, A, true],
    [600, A, false],
    [800, A, false],
  ]),
);
vector(
  'rate-refill', // hết lượt rồi chờ hơn 1 s: có lại một trả lời
  rate([
    [0, A, true],
    [100, A, true],
    [200, A, true],
    [300, A, false],
    [1300, A, true],
  ]),
);
vector(
  'rate-two-sources', // mỗi nguồn một bucket
  rate([
    [0, A, true],
    [100, A, true],
    [200, A, true],
    [300, A, false],
    [400, B, true],
  ]),
);

// ---- Thiết bị: dựng gói trả lời (contract §3) ----

const buildVector = (info) => {
  const r = build(info);
  return {
    kind: 'build',
    nonce: hex(NONCE),
    info,
    expect: { flags: r.flags, json: r.obj },
    packet: hex(r.packet),
  };
};
const worst = worstInfo();
vector('build-running', buildVector(INFO()));
vector(
  'build-no-project',
  buildVector({ ...INFO(), status: 'no-project', project: null, https: 0, fp: null }),
);
vector('build-project-name-64-vi', buildVector(worst)); // khoảng 750 byte, không cắt
vector('build-truncated-project-name', buildVector(withRuntimeLength(worst, MAX_JSON))); // bỏ project.name, vừa đúng 1000 byte
vector(
  // còn thừa 2 byte sau khi bỏ project.name: cắt cả ký tự cuối "ữ" (3 byte), không cắt giữa ký tự
  'build-truncated-name',
  buildVector(
    withRuntimeLength({ ...worst, name: 'Trạm bơm Bến Lữ'.normalize('NFC') }, MAX_JSON + 2),
  ),
);
if (V['build-project-name-64-vi'].expect.flags !== 0) throw new Error('64 ký tự phải vừa');
if (V['build-truncated-name'].expect.json.name !== 'Trạm bơm Bến L'.normalize('NFC'))
  throw new Error('cắt name sai');

// ---- Studio: nhận gói trả lời (contract §3, phía Studio) ----

const reply = (packet, expect, { nonce = NONCE, source = DEVICE } = {}) => ({
  kind: 'reply',
  nonce: hex(nonce),
  source,
  packet: hex(packet),
  expect,
});
const accept = (obj, flags = 0, source = DEVICE) => ({
  accept: true,
  truncated: (flags & 1) === 1,
  device: deviceOf(obj, source),
});
const REJECT = { accept: false };
const valid = build(INFO());

vector('reply-valid', reply(valid.packet, accept(valid.obj)));
vector(
  'reply-ip-from-source', // IP lấy theo địa chỉ nguồn UDP, không theo khóa "ip" của JSON
  reply(valid.packet, accept(valid.obj, 0, { ip: '192.168.1.111', port: 8446 }), {
    source: { ip: '192.168.1.111', port: 8446 },
  }),
);
{
  const t = build(withRuntimeLength(worst, MAX_JSON));
  vector('reply-truncated', reply(t.packet, accept(t.obj, t.flags)));
}
{
  const o = { ...INFO(), future: { a: [1, 2] }, zz: 'x' };
  o.project = { ...o.project, extra: true };
  vector('reply-unknown-keys', reply(replyPacket(o), accept(INFO())));
}
{
  const o = {
    v: 1,
    id: INFO().id,
    name: 'BL335-01',
    runtime: '0.4.0',
    status: 'no-project',
    https: 8443,
  };
  vector('reply-optional-missing', reply(replyPacket(o), accept(o)));
}
vector('reply-too-short', reply(valid.packet.subarray(0, HEADER - 1), REJECT));
{
  const json = jsonBytes(INFO());
  const padded = Buffer.concat([json, Buffer.alloc(QUERY_SIZE + 1 - HEADER - json.length, 0x20)]);
  vector('reply-too-long', reply(replyPacket(padded), REJECT)); // 1025 byte, JSON vẫn đúng
}
vector('reply-bad-magic', reply(replyPacket(INFO(), { magic: 'MATX' }), REJECT));
vector('reply-bad-version', reply(replyPacket(INFO(), { version: 2 }), REJECT));
vector('reply-bad-type', reply(replyPacket(INFO(), { type: 1 }), REJECT));
vector('reply-nonce-mismatch', reply(valid.packet, REJECT, { nonce: OTHER_NONCE }));
vector('reply-json-invalid', reply(replyPacket(jsonBytes(INFO()).subarray(0, 40)), REJECT));
for (const key of ['v', 'id', 'name', 'runtime', 'status', 'https']) {
  const o = INFO();
  delete o[key];
  vector(`reply-missing-${key}`, reply(replyPacket(o), REJECT));
}
vector('reply-wrong-type', reply(replyPacket({ ...INFO(), https: '8443' }), REJECT));

// ---- Ghi ----

for (const f of readdirSync(here))
  if (/^(query|rate|build|reply)-.*\.json$/.test(f)) rmSync(join(here, f));
mkdirSync(here, { recursive: true });
for (const [name, v] of Object.entries(V)) {
  if (v.kind !== 'rate' && v.kind !== 'build' && v.packet.length / 2 > QUERY_SIZE + 1)
    throw new Error(`${name}: gói quá dài`);
  writeFileSync(join(here, `${name}.json`), JSON.stringify(v, null, 2) + '\n');
}
console.log(`${Object.keys(V).length} vector trong ${here}`);
