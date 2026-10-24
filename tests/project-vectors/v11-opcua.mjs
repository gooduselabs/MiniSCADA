// Ca `v11-opcua-*` (feature 019, specs/019-driver-opcua/contracts/opcua.md §1; README-019.md): kênh `opcua` và NodeId
// của Tag OPC UA trong định dạng 1.1. Được v11.mjs gọi (`opcuaCases`), base là base11(). Kết quả viết tay.
const C = 'connections.json';
const T = 'tags.json';
const PIN = '9c1e5b7a0d3f4826'.repeat(4);

/** Kênh OPC UA không mã hóa, anonymous, một server (timeoutMs 500 < nhóm normal 1000). */
export const opcuaChannel = () => ({
  id: 'ua-1',
  name: 'Server OPC UA',
  kind: 'opcua',
  opcua: { endpointUrl: 'opc.tcp://192.168.0.20:4840' },
  devices: [{ id: 'srv1', name: 'Server', timeoutMs: 500 }],
});

const ext = (id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  source: { device: 'srv1', address, ...(extra.source ?? {}) },
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
});

/** Mỗi kiểu một Tag, mỗi loại NodeId, vài Tag ghi. */
export const opcuaTags = () => [
  ext('UA.BOOL', 'BOOL', 'ns=2;s=Bool'),
  ext('UA.INT16', 'INT16', 'ns=2;s=Int16'),
  ext('UA.UINT16', 'UINT16', 'ns=2;s=UInt16'),
  ext('UA.INT32', 'INT32', 'ns=3;i=1001'),
  ext('UA.UINT32', 'UINT32', 'ns=2;i=1004'),
  ext('UA.INT64', 'INT64', 'ns=2;s=Int64'),
  ext('UA.UINT64', 'UINT64', 'ns=2;s=UInt64'),
  ext('UA.FLOAT', 'FLOAT32', 'ns=2;s=Float'),
  ext('UA.DOUBLE', 'FLOAT64', 'ns=2;s=Tank.Level'),
  ext('UA.STRING', 'STRING', 'ns=2;s=String', { source: { stringLength: 40 } }),
  ext('UA.DATETIME', 'INT64', 'ns=2;s=DateTime'),
  ext('UA.TIME', 'INT64', 'i=2258', { source: { scanGroup: 'slow' } }),
  ext('UA.GUID', 'INT32', 'ns=2;g=09087e75-8e5e-499b-954f-f2a9603db28a'),
  ext('UA.OPAQUE', 'INT32', 'ns=2;b=M/RbKBsRVkePCePcx24oRA=='),
  ext(
    'UA.SIEMENS',
    'FLOAT32',
    'ns=3;s="DB_Process"."Tank_Area_1"."Pump_Station"[12].Motor.SpeedSetpoint',
  ),
  ext('UA.SP', 'FLOAT64', 'ns=2;s=Setpoint', { access: 'RW', limits: { min: 0, max: 100 } }),
  ext('UA.NAME', 'STRING', 'ns=2;s=Name', { access: 'RW', source: { stringLength: 20 } }),
];

/** Thêm kênh OPC UA và các Tag của nó vào project 1.1. */
export function withOpcUa(f, mutate) {
  f[C].channels.push(opcuaChannel());
  f[T].tags.push(...opcuaTags());
  if (mutate) mutate(f[C].channels[f[C].channels.length - 1], f[T].tags, f);
}

const at = (code, path, file) => ({ code, file, path });
const iss = (...issues) => ({ issues });

/** Đặt địa chỉ (và kiểu…) của Tag UA.INT16. */
const setTag = (tags, patch) => {
  const t = tags.find((x) => x.id === 'UA.INT16');
  Object.assign(t, patch.tag ?? {});
  Object.assign(t.source, patch.source ?? {});
};

export function opcuaCases(ok, bad, to10, base) {
  const n = base()[T].tags.length; // Tag OPC UA bắt đầu ở chỉ số n
  const uaAt = (id) => n + opcuaTags().findIndex((t) => t.id === id);
  const secure = (ch) =>
    (ch.opcua = {
      endpointUrl: 'opc.tcp://plc-ua.local:4840/server',
      securityMode: 'SignAndEncrypt',
      securityPolicy: 'Basic256Sha256',
      serverCertSha256: PIN,
      auth: { mode: 'username', username: 'operator', secretId: 'opcua-ua-1' },
    });

  // ---------- hợp lệ ----------
  ok('v11-opcua-valid-channel', (f) => withOpcUa(f));
  ok('v11-opcua-valid-secure-username', (f) => withOpcUa(f, secure));
  ok('v11-opcua-valid-sign', (f) =>
    withOpcUa(f, (ch) => {
      secure(ch);
      ch.opcua.securityMode = 'Sign';
      ch.opcua.auth = { mode: 'anonymous' };
    }),
  );
  ok(
    'v11-opcua-valid-defaults',
    (f) =>
      withOpcUa(f, (ch) => {
        ch.devices = [{ id: 'srv1', name: 'Server' }];
      }),
    ['W_DETECT_SLOW'], // timeoutMs mặc định 2000 > nhóm normal 1000
    iss(at('W_DETECT_SLOW', '/channels/2/devices/0', C)),
  );
  ok('v11-opcua-valid-poll', (f) =>
    withOpcUa(f, (ch) => {
      Object.assign(ch.opcua, {
        readMode: 'poll',
        sessionTimeoutMs: 120000,
        connectTimeoutMs: 3000,
        reconnectMaxS: 30,
        auth: { mode: 'anonymous' },
      });
      ch.devices[0].writeDeadlineMs = 8000;
      ch.enabled = false;
    }),
  );
  ok('v11-opcua-valid-no-device', (f) => {
    f[C].channels.push({ ...opcuaChannel(), devices: [] });
  });
  ok('v11-opcua-valid-detect-slow', (f) => withOpcUa(f, (ch) => (ch.devices[0].timeoutMs = 3000)), [
    'W_DETECT_SLOW',
  ]);
  ok('v11-opcua-valid-long-node-id', (f) =>
    withOpcUa(f, (_, tags) =>
      tags.push(ext('UA.LONG', 'FLOAT64', `ns=4;s=${'"Area".'.repeat(30)}Value`)),
    ),
  );

  // ---------- cảnh báo ----------
  ok(
    'v11-opcua-warn-plain-password',
    (f) =>
      withOpcUa(
        f,
        (ch) => (ch.opcua.auth = { mode: 'username', username: 'op', secretId: 'opcua-ua-1' }),
      ),
    ['W_OPCUA_PLAIN_PASSWORD'],
    iss(at('W_OPCUA_PLAIN_PASSWORD', '/channels/2/opcua/auth', C)),
  );
  ok(
    'v11-opcua-warn-plain-password-explicit-none',
    (f) =>
      withOpcUa(f, (ch) =>
        Object.assign(ch.opcua, {
          securityMode: 'None',
          securityPolicy: 'None',
          auth: { mode: 'username', username: 'op', secretId: 's1' },
        }),
      ),
    ['W_OPCUA_PLAIN_PASSWORD'],
  );
  ok(
    'v11-opcua-warn-cert-not-pinned',
    (f) =>
      withOpcUa(f, (ch) => {
        secure(ch);
        delete ch.opcua.serverCertSha256;
      }),
    ['W_OPCUA_CERT_NOT_PINNED'],
    iss(at('W_OPCUA_CERT_NOT_PINNED', '/channels/2/opcua', C)),
  );
  ok(
    'v11-opcua-warn-cert-not-pinned-sign',
    (f) =>
      withOpcUa(f, (ch) =>
        Object.assign(ch.opcua, { securityMode: 'Sign', securityPolicy: 'Basic256Sha256' }),
      ),
    ['W_OPCUA_CERT_NOT_PINNED'],
  );

  // ---------- phiên bản ----------
  bad(
    'v11-opcua-version-in-1.0',
    (f) => {
      to10(f);
      withOpcUa(f);
      f[C].schemaVersion = f['project.json'].schemaVersion;
      f[T].schemaVersion = f['project.json'].schemaVersion;
    },
    ['E_DRIVER_VERSION'],
    undefined,
    iss(at('E_DRIVER_VERSION', '/channels/2/kind', C)),
  );
  bad(
    'v11-opcua-version-in-1.0-no-tags',
    (f) => {
      to10(f);
      f[C].channels.push({ ...opcuaChannel(), devices: [] });
    },
    ['E_DRIVER_VERSION'],
  );

  // ---------- bảo mật, xác thực ----------
  bad(
    'v11-opcua-security-none-with-policy',
    (f) => withOpcUa(f, (ch) => (ch.opcua.securityPolicy = 'Basic256Sha256')),
    ['E_OPCUA_SECURITY'],
    undefined,
    iss(at('E_OPCUA_SECURITY', '/channels/2/opcua/securityPolicy', C)),
  );
  bad(
    'v11-opcua-security-encrypt-without-policy',
    (f) =>
      withOpcUa(f, (ch) => {
        ch.opcua.securityMode = 'SignAndEncrypt';
        ch.opcua.serverCertSha256 = PIN;
      }),
    ['E_OPCUA_SECURITY'],
  );
  bad(
    'v11-opcua-auth-username-no-secret',
    (f) =>
      withOpcUa(f, (ch) => {
        secure(ch);
        delete ch.opcua.auth.secretId;
      }),
    ['E_OPCUA_AUTH'],
    undefined,
    iss(at('E_OPCUA_AUTH', '/channels/2/opcua/auth', C)),
  );
  bad(
    'v11-opcua-auth-anonymous-with-username',
    (f) => withOpcUa(f, (ch) => (ch.opcua.auth = { mode: 'anonymous', username: 'op' })),
    ['E_OPCUA_AUTH'],
  );

  // ---------- schema ----------
  bad(
    'v11-opcua-schema-two-devices',
    (f) => withOpcUa(f, (ch) => ch.devices.push({ id: 'srv2', name: 'Server 2' })),
    ['E_SCHEMA'],
  );
  bad('v11-opcua-schema-tcp', (f) => withOpcUa(f, (ch) => (ch.tcp = { host: '192.168.0.20' })), [
    'E_SCHEMA',
  ]);
  bad('v11-opcua-schema-unit-id', (f) => withOpcUa(f, (ch) => (ch.devices[0].unitId = 1)), [
    'E_SCHEMA',
  ]);
  bad('v11-opcua-schema-retries', (f) => withOpcUa(f, (ch) => (ch.devices[0].retries = 1)), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-opcua-schema-endpoint-http',
    (f) => withOpcUa(f, (ch) => (ch.opcua.endpointUrl = 'http://192.168.0.20:4840')),
    ['E_SCHEMA'],
  );
  bad('v11-opcua-schema-no-endpoint', (f) => withOpcUa(f, (ch) => delete ch.opcua.endpointUrl), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-opcua-schema-cert-uppercase',
    (f) =>
      withOpcUa(f, (ch) => {
        secure(ch);
        ch.opcua.serverCertSha256 = PIN.toUpperCase();
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v11-opcua-schema-policy-unknown',
    (f) => withOpcUa(f, (ch) => (ch.opcua.securityPolicy = 'Basic128Rsa15')),
    ['E_SCHEMA'],
  );

  // ---------- NodeId ----------
  bad(
    'v11-opcua-addr-syntax-modbus',
    (f) => withOpcUa(f, (_, tags) => setTag(tags, { source: { address: 'HR100' } })),
    ['E_ADDR_SYNTAX'],
    undefined,
    iss(at('E_ADDR_SYNTAX', `/tags/${uaAt('UA.INT16')}/source/address`, T)),
  );
  bad(
    'v11-opcua-addr-syntax-nsu',
    (f) => withOpcUa(f, (_, tags) => setTag(tags, { source: { address: 'nsu=urn:x;s=A' } })),
    ['E_ADDR_SYNTAX'],
  );
  bad(
    'v11-opcua-addr-range-ns',
    (f) => withOpcUa(f, (_, tags) => setTag(tags, { source: { address: 'ns=70000;i=1' } })),
    ['E_ADDR_RANGE'],
    undefined,
    iss(at('E_ADDR_RANGE', `/tags/${uaAt('UA.INT16')}/source/address`, T)),
  );
  bad(
    'v11-opcua-addr-range-numeric',
    (f) => withOpcUa(f, (_, tags) => setTag(tags, { source: { address: 'ns=2;i=4294967296' } })),
    ['E_ADDR_RANGE'],
  );
  bad(
    'v11-opcua-addr-modbus-device-node-id',
    (f) => withOpcUa(f, () => (f[T].tags[0].source.address = 'ns=2;s=Tag1')),
    ['E_ADDR_SYNTAX'],
  );
  bad(
    'v11-opcua-byte-order',
    (f) => withOpcUa(f, (_, tags) => setTag(tags, { source: { byteOrder: 'CDAB' } })),
    ['E_SCHEMA'],
    undefined,
    iss(at('E_SCHEMA', `/tags/${uaAt('UA.INT16')}/source/byteOrder`, T)),
  );
  bad(
    'v11-opcua-string-byte-order',
    (f) =>
      withOpcUa(
        f,
        (_, tags) => (tags.find((t) => t.id === 'UA.STRING').source.stringByteOrder = 'BA'),
      ),
    ['E_SCHEMA'],
  );
  bad(
    'v11-opcua-string-no-length',
    (f) =>
      withOpcUa(f, (_, tags) => delete tags.find((t) => t.id === 'UA.STRING').source.stringLength),
    ['E_SCHEMA'],
  );
}
