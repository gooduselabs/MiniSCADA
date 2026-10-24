// Makes the projects of the OPC UA integration tests (feature 019 T021): small format 1.1 projects
// with one `opcua` channel to the test server tools/opcua-sim (host `sim`, port 4840) and the Tags
// the scenarios read and write (nodes of tools/opcua-sim/sim_server.hpp).
//   node tests/driver-it-opcua/make-projects.mjs                 read-all-types-opcua, bench-500-opcua
//                                                                (committed, in projects/)
//   node tests/driver-it-opcua/make-projects.mjs --secure <sha256> --out <dir>
//                                                                secure-opcua: SignAndEncrypt,
//                                                                Basic256Sha256, user, the server
//                                                                certificate of this run pinned
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const V = '1.1.0';
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const write = (dir, name, obj) => {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(obj, null, 2) + '\n');
};

function project(base, name, tags, opcua) {
  const dir = join(base, name);
  rmSync(dir, { recursive: true, force: true });
  write(dir, 'project.json', {
    format: 'matscada-project',
    schemaVersion: V,
    projectId: `opcua-it-${name}`,
    projectName: `Kiểm thử driver OPC UA: ${name}`,
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
    channels: [
      {
        id: 'ua-1',
        name: 'Giả lập OPC UA',
        kind: 'opcua',
        opcua: {
          endpointUrl: 'opc.tcp://sim:4840',
          connectTimeoutMs: 3000,
          reconnectMaxS: 4,
          ...opcua,
        },
        devices: [{ id: 'srv1', name: 'Server giả lập', timeoutMs: 1000 }],
      },
    ],
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

const ext = (id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
  source: {
    device: 'srv1',
    address,
    ...(type === 'STRING' ? { stringLength: extra.stringLength ?? 64 } : {}),
    ...(extra.scanGroup ? { scanGroup: extra.scanGroup } : {}),
  },
});
const RW = (min, max) => ({ access: 'RW', limits: { min, max } });

// read-all-types-opcua: every type by name and by number, the writable nodes, three bad nodes
const allTypes = [
  ext('UA.BOOL', 'BOOL', 'ns=2;s=Boolean', { access: 'RW' }),
  ext('UA.SBYTE', 'INT16', 'ns=2;s=SByte'),
  ext('UA.BYTE', 'UINT16', 'ns=2;s=Byte', RW(0, 255)),
  ext('UA.INT16', 'INT16', 'ns=2;s=Int16', RW(-30000, 30000)),
  ext('UA.UINT16', 'UINT16', 'ns=2;s=UInt16'),
  ext('UA.INT32', 'INT32', 'ns=2;s=Int32', RW(-1000000, 1000000)),
  ext('UA.UINT32', 'UINT32', 'ns=2;s=UInt32'),
  ext('UA.INT64', 'INT64', 'ns=2;s=Int64'),
  ext('UA.UINT64', 'UINT64', 'ns=2;s=UInt64'),
  ext('UA.FLOAT', 'FLOAT32', 'ns=2;s=Float', RW(-1000, 1000)),
  ext('UA.DOUBLE', 'FLOAT64', 'ns=2;s=Double', RW(-1e6, 1e6)),
  ext('UA.STRING', 'STRING', 'ns=2;s=String', { access: 'RW', stringLength: 32 }),
  ext('UA.DATETIME_MS', 'INT64', 'ns=2;s=DateTime'),
  ext('UA.DATETIME', 'STRING', 'ns=2;s=DateTime', { stringLength: 24 }),
  ext('UA.N_INT16', 'INT16', 'ns=2;i=1004'),
  ext('UA.N_DOUBLE', 'FLOAT64', 'ns=2;i=1011'),
  ext('UA.COUNTER', 'UINT32', 'ns=2;s=Counter', { scanGroup: 'fast' }),
  ext('UA.CURRENT_TIME', 'INT64', 'i=2258', { scanGroup: 'slow' }),
  ext('UA.READONLY', 'FLOAT64', 'ns=2;s=ReadOnly', RW(0, 100)),
  ext('UA.NO_NODE', 'FLOAT64', 'ns=2;s=NoSuchNode'),
  ext('UA.ARRAY', 'INT32', 'ns=2;s=Array'),
  ext('UA.TOO_BIG', 'INT16', 'ns=2;s=Int32'),
];

const out = opt('--out');
const pin = opt('--secure');
if (pin) {
  if (!out) throw new Error('--secure needs --out');
  project(out, 'secure-opcua', allTypes.slice(0, 19), {
    securityMode: 'SignAndEncrypt',
    securityPolicy: 'Basic256Sha256',
    serverCertSha256: pin,
    auth: { mode: 'username', username: 'operator', secretId: 'opcua-ua-1' },
  });
} else {
  const base = join(here, 'projects');
  project(base, 'read-all-types-opcua', allTypes, {});
  // bench-500-opcua: 500 Double nodes Bench.<k> that change every second, normal group (1 s)
  const bench = [];
  for (let k = 0; k < 500; k++) bench.push(ext(`B.D${k}`, 'FLOAT64', `ns=2;s=Bench.${k}`));
  project(base, 'bench-500-opcua', bench, {});
}
