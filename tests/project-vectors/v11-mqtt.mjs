// Ca `v11-mqtt-*` (feature 022, specs/022-driver-mqtt/spec.md FR-006; README-022.md): kênh `mqtt`, địa chỉ Tag
// MQTT và nhóm publish trong định dạng 1.1. Được v11.mjs gọi (`mqttCases`), base là base11(). Kết quả viết tay.
const C = 'connections.json';
const T = 'tags.json';
const PIN = '5d2f7a91c3e8b0461f'.repeat(4).slice(0, 64);
const CA = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIUQ2E=\n-----END CERTIFICATE-----\n';

/** Kênh MQTT không TLS, một broker (thiết bị 0). */
export const mqttChannel = () => ({
  id: 'mq-1',
  name: 'Broker MQTT',
  kind: 'mqtt',
  mqtt: { host: '192.0.2.30' },
  devices: [{ id: 'broker1', name: 'Broker' }],
});

const ext = (id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  source: { device: 'broker1', address, ...(extra.source ?? {}) },
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
});

/** Mỗi hướng, wildcard, đường dẫn JSON, QoS, retain. */
export const mqttTags = () => [
  ext('MQ.LEVEL', 'FLOAT64', 'plant/tank1/level'),
  ext('MQ.TEMP', 'FLOAT32', 'sensors/+/data|$.temp;qos=1'),
  ext('MQ.ANY', 'STRING', 'plant/events/#', { source: { stringLength: 64 } }),
  ext('MQ.RUN', 'BOOL', 'plant/pump1/run'),
  ext('MQ.ARR', 'INT32', 'sensors/t9|$.values[2].v'),
  ext('MQ.SP', 'FLOAT64', 'pub:plant/cmd/sp|$.data.sp;qos=1;retain', {
    access: 'RW',
    limits: { min: 0, max: 100 },
  }),
  ext('MQ.MODE', 'INT16', 'both:plant/mode', { access: 'RW', limits: { min: 0, max: 3 } }),
];

/** Thêm kênh MQTT và các Tag của nó vào project 1.1. */
export function withMqtt(f, mutate) {
  f[C].channels.push(mqttChannel());
  f[T].tags.push(...mqttTags());
  if (mutate) mutate(f[C].channels[f[C].channels.length - 1], f[T].tags, f);
}

const at = (code, path, file) => ({ code, file, path });
const iss = (...issues) => ({ issues });

export function mqttCases(ok, bad, to10, base) {
  const n = base()[T].tags.length; // Tag MQTT bắt đầu ở chỉ số n
  const mqAt = (id) => n + mqttTags().findIndex((t) => t.id === id);
  const setTag = (tags, id, patch) => {
    const t = tags.find((x) => x.id === id);
    Object.assign(t, patch.tag ?? {});
    Object.assign(t.source, patch.source ?? {});
  };

  // ---------- hợp lệ ----------
  ok('v11-mqtt-valid-channel', (f) => withMqtt(f));
  ok('v11-mqtt-valid-full', (f) =>
    withMqtt(f, (ch) => {
      ch.mqtt = {
        host: 'broker.plant.local',
        port: 8883,
        clientId: 'mat-site-7',
        keepAliveS: 60,
        cleanSession: false,
        tls: { enabled: true, serverCertSha256: PIN, serverName: 'broker.plant.local' },
        auth: { username: 'site7', secretId: 'mqtt-mq-1' },
        will: { topic: 'mat/site7/status', payload: 'offline', qos: 1, retain: true },
        maxPublishPerS: 50,
        publishGroups: [
          { topic: 'mat/site7/state', tags: ['MQ.LEVEL', 'MQ.RUN'], intervalMs: 5000, qos: 1 },
          { topic: 'mat/site7/changes', tags: ['MQ.TEMP'], onChange: true, retain: true },
        ],
        connectTimeoutMs: 3000,
        reconnectMaxS: 30,
      };
      ch.devices[0] = {
        id: 'broker1',
        name: 'Broker',
        timeoutMs: 3000,
        writeDeadlineMs: 8000,
        staleAfterMs: 60000,
      };
    }),
  );
  ok('v11-mqtt-valid-ca', (f) =>
    withMqtt(f, (ch) => (ch.mqtt.tls = { enabled: true, caCertPem: CA })),
  );
  ok('v11-mqtt-valid-tls-off-empty', (f) =>
    withMqtt(f, (ch) => (ch.mqtt.tls = { enabled: false })),
  );
  ok('v11-mqtt-valid-no-device', (f) => {
    f[C].channels.push({ ...mqttChannel(), devices: [], enabled: false });
  });
  ok('v11-mqtt-valid-group-other-channel-tag', (f) =>
    withMqtt(f, (ch, tags) => {
      // một nhóm có thể đẩy Tag của kênh khác (Modbus), không cần Tag MQTT
      ch.mqtt.publishGroups = [{ topic: 'mat/plc', tags: [tags[0].id], intervalMs: 1000 }];
    }),
  );

  // feature 025: mẫu tên Tag và timestamp từng Tag trong nhóm publish
  ok('v11-mqtt-valid-group-patterns', (f) =>
    withMqtt(f, (ch) => {
      ch.mqtt.publishGroups = [
        { topic: 'mat/all', tagPatterns: ['MQ.*', 'MQ.?EMP'], intervalMs: 1000, timestamps: true },
        { topic: 'mat/mix', tags: ['MQ.RUN'], tagPatterns: ['MQ.L*'], onChange: true },
      ];
    }),
  );

  // ---------- cảnh báo ----------
  ok(
    'v11-mqtt-warn-plain-password',
    (f) => withMqtt(f, (ch) => (ch.mqtt.auth = { username: 'op', secretId: 'mqtt-mq-1' })),
    ['W_MQTT_PLAIN_PASSWORD'],
    iss(at('W_MQTT_PLAIN_PASSWORD', '/channels/2/mqtt/auth', C)),
  );
  ok(
    'v11-mqtt-warn-tls-not-pinned',
    (f) => withMqtt(f, (ch) => (ch.mqtt.tls = { enabled: true })),
    ['W_MQTT_TLS_NOT_PINNED'],
    iss(at('W_MQTT_TLS_NOT_PINNED', '/channels/2/mqtt/tls', C)),
  );

  // ---------- phiên bản ----------
  bad(
    'v11-mqtt-version-in-1.0',
    (f) => {
      to10(f);
      withMqtt(f);
      f[C].schemaVersion = f['project.json'].schemaVersion;
      f[T].schemaVersion = f['project.json'].schemaVersion;
    },
    ['E_DRIVER_VERSION'],
    undefined,
    iss(at('E_DRIVER_VERSION', '/channels/2/kind', C)),
  );

  // ---------- kênh ----------
  bad(
    'v11-mqtt-tls-fields-when-off',
    (f) => withMqtt(f, (ch) => (ch.mqtt.tls = { enabled: false, serverCertSha256: PIN })),
    ['E_MQTT_TLS'],
    undefined,
    iss(at('E_MQTT_TLS', '/channels/2/mqtt/tls', C)),
  );
  bad(
    'v11-mqtt-group-unknown-tag',
    (f) =>
      withMqtt(
        f,
        (ch) =>
          (ch.mqtt.publishGroups = [
            { topic: 'mat/state', tags: ['MQ.LEVEL', 'Khong.Co'], intervalMs: 1000 },
          ]),
      ),
    ['E_MQTT_GROUP_TAG'],
    undefined,
    iss(at('E_MQTT_GROUP_TAG', '/channels/2/mqtt/publishGroups/0/tags/1', C)),
  );

  bad(
    'v11-mqtt-group-pattern-no-match',
    (f) =>
      withMqtt(
        f,
        (ch) =>
          (ch.mqtt.publishGroups = [
            { topic: 'mat/state', tagPatterns: ['MQ.*', 'Khong.*'], intervalMs: 1000 },
          ]),
      ),
    ['E_MQTT_GROUP_PATTERN'],
    undefined,
    iss(at('E_MQTT_GROUP_PATTERN', '/channels/2/mqtt/publishGroups/0/tagPatterns/1', C)),
  );

  // ---------- Tag ----------
  bad(
    'v11-mqtt-direction-sub-rw',
    (f) =>
      withMqtt(f, (_, tags) =>
        setTag(tags, 'MQ.LEVEL', { tag: { access: 'RW', limits: { min: 0, max: 10 } } }),
      ),
    ['E_MQTT_DIRECTION'],
    undefined,
    iss(at('E_MQTT_DIRECTION', `/tags/${mqAt('MQ.LEVEL')}/source/address`, T)),
  );
  bad(
    'v11-mqtt-direction-pub-read-only',
    (f) =>
      withMqtt(f, (_, tags) => {
        const t = tags.find((x) => x.id === 'MQ.SP');
        delete t.access;
        delete t.limits;
      }),
    ['E_MQTT_DIRECTION'],
    undefined,
    iss(at('E_MQTT_DIRECTION', `/tags/${mqAt('MQ.SP')}/source/address`, T)),
  );
  bad(
    'v11-mqtt-addr-pub-wildcard',
    (f) =>
      withMqtt(f, (_, tags) => setTag(tags, 'MQ.SP', { source: { address: 'pub:plant/+/sp' } })),
    ['E_ADDR_SYNTAX'],
    undefined,
    iss(at('E_ADDR_SYNTAX', `/tags/${mqAt('MQ.SP')}/source/address`, T)),
  );
  bad(
    'v11-mqtt-addr-bad-path',
    (f) =>
      withMqtt(f, (_, tags) =>
        setTag(tags, 'MQ.TEMP', { source: { address: 'sensors/t1|data.temp' } }),
      ),
    ['E_ADDR_SYNTAX'],
  );
  bad(
    'v11-mqtt-addr-qos2',
    (f) => withMqtt(f, (_, tags) => setTag(tags, 'MQ.LEVEL', { source: { address: 'a/b;qos=2' } })),
    ['E_ADDR_RANGE'],
    undefined,
    iss(at('E_ADDR_RANGE', `/tags/${mqAt('MQ.LEVEL')}/source/address`, T)),
  );
  bad(
    'v11-mqtt-byte-order',
    (f) => withMqtt(f, (_, tags) => setTag(tags, 'MQ.LEVEL', { source: { byteOrder: 'CDAB' } })),
    ['E_SCHEMA'],
    undefined,
    iss(at('E_SCHEMA', `/tags/${mqAt('MQ.LEVEL')}/source/byteOrder`, T)),
  );
  bad(
    'v11-mqtt-string-no-length',
    (f) =>
      withMqtt(f, (_, tags) => {
        delete tags.find((x) => x.id === 'MQ.ANY').source.stringLength;
      }),
    ['E_SCHEMA'],
  );

  // ---------- schema ----------
  bad('v11-mqtt-schema-no-host', (f) => withMqtt(f, (ch) => delete ch.mqtt.host), ['E_SCHEMA']);
  bad(
    'v11-mqtt-schema-two-devices',
    (f) => withMqtt(f, (ch) => ch.devices.push({ id: 'broker2', name: 'Broker 2' })),
    ['E_SCHEMA'],
  );
  bad('v11-mqtt-schema-device-retries', (f) => withMqtt(f, (ch) => (ch.devices[0].retries = 1)), [
    'E_SCHEMA',
  ]);
  bad('v11-mqtt-schema-tcp', (f) => withMqtt(f, (ch) => (ch.tcp = { host: '192.0.2.30' })), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-mqtt-schema-group-no-trigger',
    (f) =>
      withMqtt(f, (ch) => (ch.mqtt.publishGroups = [{ topic: 'mat/state', tags: ['MQ.LEVEL'] }])),
    ['E_SCHEMA'],
  );
  bad(
    'v11-mqtt-schema-group-no-tags',
    (f) =>
      withMqtt(f, (ch) => (ch.mqtt.publishGroups = [{ topic: 'mat/state', intervalMs: 1000 }])),
    ['E_SCHEMA'],
  );
  bad(
    'v11-mqtt-schema-group-wildcard-topic',
    (f) =>
      withMqtt(
        f,
        (ch) =>
          (ch.mqtt.publishGroups = [
            { topic: 'mat/+/state', tags: ['MQ.LEVEL'], intervalMs: 1000 },
          ]),
      ),
    ['E_SCHEMA'],
  );
  bad(
    'v11-mqtt-schema-will-qos2',
    (f) => withMqtt(f, (ch) => (ch.mqtt.will = { topic: 'mat/status', qos: 2 })),
    ['E_SCHEMA'],
  );
  bad(
    'v11-mqtt-schema-auth-no-secret',
    (f) => withMqtt(f, (ch) => (ch.mqtt.auth = { username: 'op' })),
    ['E_SCHEMA'],
  );
  bad('v11-mqtt-schema-client-id', (f) => withMqtt(f, (ch) => (ch.mqtt.clientId = 'có dấu cách')), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-mqtt-schema-cert-uppercase',
    (f) =>
      withMqtt(f, (ch) => (ch.mqtt.tls = { enabled: true, serverCertSha256: PIN.toUpperCase() })),
    ['E_SCHEMA'],
  );
}
