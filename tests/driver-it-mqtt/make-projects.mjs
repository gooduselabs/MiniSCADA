// Makes the projects of the MQTT integration tests (feature 022) at run time: small format 1.1 projects with `mqtt`
// channels to the broker of tools/mqtt-sim (host `sim`: 1883 plain, 8883 TLS). The TLS channels pin the certificate
// that broker made when it started, so tools/driver-it-mqtt.ps1 writes the projects after the broker is up, into the
// build folder (never committed):
//   node tests/driver-it-mqtt/make-projects.mjs <outDir> <brokerCertSha256>
// mqtt-it: the scenarios read, write, reconnect, stale, tls. bench-500-mqtt: 500 Tags for the load scenario.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [outDir, pin] = process.argv.slice(2);
if (!outDir || !/^[0-9a-f]{64}$/.test(pin ?? '')) {
  console.error('usage: make-projects.mjs <outDir> <sha256 of the broker certificate>');
  process.exit(2);
}
const V = '1.1.0';
const write = (dir, name, obj) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');
};

function project(name, channels, tags) {
  const dir = join(outDir, name);
  rmSync(dir, { recursive: true, force: true });
  write(dir, 'project.json', {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: `mqtt-it-${name}`,
    projectName: `Kiểm thử driver MQTT: ${name}`,
    projectVersion: '0.1.0',
    minRuntimeVersion: V,
    entryScreen: 'main',
    screens: ['main'],
    tagFile: 'tags.json',
    connectionFile: 'connections.json',
    maxClients: 10,
  });
  write(dir, 'connections.json', {
    schemaVersion: V,
    scanGroups: { fast: 250, normal: 1000, slow: 5000 },
    channels,
  });
  write(dir, 'tags.json', { schemaVersion: V, tags });
  write(dir, 'screens/main.screen.json', {
    schemaVersion: V,
    id: 'main',
    name: 'Main',
    kind: 'screen',
    size: { width: 1280, height: 720 },
    fitMode: 'contain',
    items: [
      {
        id: 'card1',
        type: 'widget',
        widget: 'card',
        x: 20,
        y: 20,
        width: 240,
        height: 110,
        props: { label: tags[0].id },
        tags: { value: tags[0].id },
      },
    ],
  });
}

const ext = (device, id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
  source: { device, address, ...(extra.stringLength ? { stringLength: extra.stringLength } : {}) },
});

const channel = (id, device, mqtt, dev = {}) => ({
  id,
  name: `Broker ${id}`,
  kind: 'mqtt',
  mqtt: { host: 'sim', reconnectMaxS: 3, keepAliveS: 10, ...mqtt },
  devices: [{ id: device, name: `Broker ${id}`, ...dev }],
});

project(
  'mqtt-it',
  [
    channel(
      'mq',
      'broker',
      {
        clientId: 'mat-rt-it',
        auth: { username: 'site7', secretId: 'mqtt-mq' },
        will: { topic: 'mat/rt/status', payload: 'offline', qos: 1, retain: true },
        maxPublishPerS: 50,
        publishGroups: [
          {
            topic: 'mat/rt/state',
            tags: ['MQ.LEVEL', 'MQ.RUN', 'MQ.SP'],
            intervalMs: 1000,
            onChange: true,
          },
        ],
      },
      { staleAfterMs: 3000, timeoutMs: 2000 },
    ),
    channel('mqtls', 'broker-tls', {
      port: 8883,
      clientId: 'mat-rt-tls',
      tls: { enabled: true, serverCertSha256: pin },
      auth: { username: 'site7', secretId: 'mqtt-mq' },
    }),
    channel('mqbad', 'broker-bad', {
      port: 8883,
      clientId: 'mat-rt-bad',
      tls: { enabled: true, serverCertSha256: 'ab'.repeat(32) },
      auth: { username: 'site7', secretId: 'mqtt-mq' },
    }),
  ],
  [
    ext('broker', 'MQ.LEVEL', 'FLOAT64', 'plant/tank1/level'),
    ext('broker', 'MQ.TEMP', 'FLOAT32', 'sensors/+/data|$.temp;qos=1'),
    ext('broker', 'MQ.ARR', 'INT32', 'sensors/t9|$.values[2].v'),
    ext('broker', 'MQ.RUN', 'BOOL', 'plant/pump1/run'),
    ext('broker', 'MQ.NAME', 'STRING', 'plant/name', { stringLength: 32 }),
    ext('broker', 'MQ.EVENTS', 'STRING', 'events/#', { stringLength: 64 }),
    ext('broker', 'MQ.DENIED', 'FLOAT64', 'secret/v'),
    ext('broker', 'MQ.STALE', 'FLOAT64', 'plant/stale'),
    ext('broker', 'MQ.SP', 'FLOAT64', 'pub:plant/cmd/sp|$.data.sp;qos=1;retain', {
      access: 'RW',
      limits: { min: 0, max: 100 },
    }),
    ext('broker', 'MQ.MODE', 'INT16', 'both:plant/mode;qos=1', {
      access: 'RW',
      limits: { min: 0, max: 3 },
    }),
    ext('broker-tls', 'TLS.V', 'FLOAT64', 'tls/v'),
    ext('broker-bad', 'BAD.V', 'FLOAT64', 'tls/v'),
  ],
);

const bench = [];
for (let i = 0; i < 500; i++)
  bench.push(
    i % 2
      ? ext('broker', `B.J${i}`, 'FLOAT64', `bench/j/${i}|$.v`)
      : ext('broker', `B.R${i}`, 'FLOAT64', `bench/r/${i}`),
  );
project(
  'bench-500-mqtt',
  [
    channel('mq', 'broker', {
      clientId: 'mat-rt-bench',
      auth: { username: 'site7', secretId: 'mqtt-mq' },
    }),
  ],
  bench,
);
console.log(`projects in ${outDir}`);
