// Công cụ một lần (T033): dựng schemas/*.schema.json 0.2.0 từ bản đóng băng schemas/0.1. Không chạy trong CI.
// Giữ trong repo để thấy 0.2 khác 0.1 ở đâu; chạy lại thì ghi đè schemas/{project,tag,screen,binding,logging,
// connections,value-table,watch-table}.schema.json (rồi chạy `npx prettier --write schemas`).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const write = (p, v) => writeFileSync(join(root, p), JSON.stringify(v, null, 2) + '\n');
const ID = (name) => `https://schemas.atpro.com.vn/mat/${name}/0.2.json`;
const SEMVER = {
  type: 'string',
  maxLength: 64,
  pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?$',
};
const TAG_TYPES = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];
const NUM_TYPES = TAG_TYPES.filter((t) => t !== 'BOOL' && t !== 'STRING');
const TAG_ID = '^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)*$';
const TABLE_NAME = '^[A-Za-z][A-Za-z0-9_]{0,63}$';
const DEVICE_ID = '^[a-z0-9][a-z0-9-]{0,31}$';

// ---- project, screen, logging: đổi $id, tiêu đề; project thêm ba khóa ----
for (const [file, name, title] of [
  ['project.schema.json', 'project', 'mAT SCADA project manifest (schema 0.2)'],
  ['screen.schema.json', 'screen', 'mAT SCADA screen (schema 0.2)'],
  ['logging.schema.json', 'logging', 'mAT SCADA tag logging (schema 0.2)'],
  ['binding.schema.json', 'binding', 'mAT SCADA screen bindings (schema 0.2)'],
]) {
  const s = read(`0.1/${file}`);
  s.$id = ID(name);
  s.title = title;
  if (name === 'project') {
    const props = s.properties;
    props.connectionFile = structuredClone(props.loggingFile);
    props.valueTables = {
      type: 'array',
      maxItems: 4096,
      items: { type: 'string', pattern: TABLE_NAME },
    };
    props.watchTables = {
      type: 'array',
      maxItems: 4096,
      items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,47}$' },
    };
  }
  if (name === 'binding') {
    s.definitions.valueTable = {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'output'],
      properties: {
        kind: { const: 'valueTable' },
        table: { type: 'string', pattern: TABLE_NAME },
        output: { enum: ['text', 'color'] },
      },
    };
    s.definitions.binding.properties.transform.oneOf.splice(3, 0, {
      $ref: '#/definitions/valueTable',
    });
  }
  write(file, s);
}

// ---- tag: Tag v1 ----
const num = { type: 'number' };
const scanGroup = { enum: ['fast', 'normal', 'slow'] };
const simSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: {
    kind: { enum: ['const', 'ramp', 'sine', 'random', 'square', 'manual', 'legacy'] },
    value: { type: ['boolean', 'number', 'string'] },
    from: num,
    to: num,
    center: num,
    amplitude: num,
    periodMs: { type: 'integer', minimum: 100, maximum: 86400000 },
    phase: { type: 'number', minimum: 0, maximum: 1 },
    min: num,
    max: num,
    seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
    duty: { type: 'number', minimum: 0, maximum: 1 },
    initial: { type: ['boolean', 'number', 'string'] },
    signal: { type: 'string', pattern: '^[a-z][a-z0-9_.]{0,63}$' },
  },
};
const common = {
  id: { type: 'string', maxLength: 64, pattern: TAG_ID },
  type: { enum: TAG_TYPES },
  description: { type: 'string', maxLength: 200 },
  unit: { type: 'string', maxLength: 16 },
  min: num,
  max: num,
  access: { enum: ['R', 'RW'] },
  limits: {
    type: 'object',
    additionalProperties: false,
    properties: { min: num, max: num, maxLength: { type: 'integer' } },
  },
  valueTable: { type: 'string', pattern: TABLE_NAME },
  deadband: num,
};
const kindProps = (kind, extra) => ({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'type', ...(extra.required ?? [])],
  properties: { ...common, kind: { const: kind }, ...extra.properties },
});
write('tag.schema.json', {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: ID('tag'),
  title: 'mAT SCADA tag list (schema 0.2)',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'tags'],
  properties: {
    schemaVersion: SEMVER,
    tags: { type: 'array', maxItems: 20000, items: { $ref: '#/definitions/tag' } },
  },
  definitions: {
    tag: {
      oneOf: [
        { $ref: '#/definitions/external' },
        { $ref: '#/definitions/internal' },
        { $ref: '#/definitions/calculated' },
        { $ref: '#/definitions/simulation' },
      ],
    },
    external: kindProps('external', {
      required: ['source'],
      properties: {
        retain: { type: 'boolean' },
        source: {
          type: 'object',
          additionalProperties: false,
          required: ['device', 'address'],
          properties: {
            device: { type: 'string', pattern: DEVICE_ID },
            address: { type: 'string', maxLength: 16 },
            scanGroup,
            rawType: { enum: TAG_TYPES },
            byteOrder: { enum: ['ABCD', 'CDAB', 'BADC', 'DCBA'] },
            stringLength: { type: 'integer', minimum: 1, maximum: 250 },
            stringByteOrder: { enum: ['AB', 'BA'] },
            readback: { type: 'boolean' },
          },
        },
        scaling: {
          type: 'object',
          additionalProperties: false,
          required: ['rawMin', 'rawMax', 'engMin', 'engMax'],
          properties: {
            rawMin: num,
            rawMax: num,
            engMin: num,
            engMax: num,
            clamp: { type: 'boolean' },
          },
        },
      },
    }),
    internal: kindProps('internal', {
      properties: {
        initial: { type: ['boolean', 'number', 'string'] },
        retain: { type: 'boolean' },
      },
    }),
    calculated: kindProps('calculated', {
      required: ['expression'],
      // Không có maxLength/pattern: giới hạn 1.000 ký tự và 4.096 byte báo bằng E_EXPR_LIMIT (R17); không chạy regex.
      properties: { expression: { type: 'string' }, retain: { type: 'boolean' }, sim: simSchema },
    }),
    simulation: kindProps('simulation', {
      required: ['sim'],
      properties: { sim: simSchema, retain: { type: 'boolean' } },
    }),
  },
});
void NUM_TYPES;

// ---- connections ----
const intRange = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const deviceCommon = {
  id: { type: 'string', pattern: DEVICE_ID },
  name: { type: 'string', maxLength: 64 },
  enabled: { type: 'boolean' },
  addressBase: { enum: [0, 1] },
  maxReadRegisters: intRange(1, 125),
  maxReadBits: intRange(1, 2000),
  maxGapRegisters: intRange(0, 125),
  maxGapBits: intRange(0, 2000),
  byteOrder: { enum: ['ABCD', 'CDAB', 'BADC', 'DCBA'] },
  timeoutMs: intRange(100, 10000),
  retries: intRange(0, 5),
  writeDeadlineMs: intRange(1000, 60000),
  write: {
    type: 'object',
    additionalProperties: false,
    properties: {
      singleRegister: { enum: ['fc06', 'fc16'] },
      singleCoil: { enum: ['fc05', 'fc15'] },
      registerBit: { enum: ['none', 'mask', 'rmw'] },
    },
  },
};
const channelCommon = {
  id: { type: 'string', pattern: DEVICE_ID },
  name: { type: 'string', maxLength: 64 },
  enabled: { type: 'boolean' },
  requestGapMs: intRange(0, 1000),
};
write('connections.schema.json', {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: ID('connections'),
  title: 'mAT SCADA connections: channels and field devices (schema 0.2)',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'channels'],
  properties: {
    schemaVersion: SEMVER,
    scanGroups: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fast: intRange(100, 60000),
        normal: intRange(100, 60000),
        slow: intRange(100, 60000),
      },
    },
    channels: { type: 'array', maxItems: 1024, items: { $ref: '#/definitions/channel' } },
  },
  definitions: {
    channel: {
      oneOf: [{ $ref: '#/definitions/tcpChannel' }, { $ref: '#/definitions/rtuChannel' }],
    },
    tcpChannel: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'kind', 'tcp', 'devices'],
      properties: {
        ...channelCommon,
        kind: { const: 'modbus-tcp' },
        tcp: {
          type: 'object',
          additionalProperties: false,
          required: ['host'],
          properties: {
            host: { type: 'string', minLength: 1, maxLength: 253 },
            port: intRange(1, 65535),
            connectTimeoutMs: intRange(500, 30000),
            reconnectMaxS: intRange(1, 60),
          },
        },
        devices: { type: 'array', maxItems: 1024, items: { $ref: '#/definitions/tcpDevice' } },
      },
    },
    rtuChannel: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'kind', 'serial', 'devices'],
      properties: {
        ...channelCommon,
        kind: { const: 'modbus-rtu' },
        serial: {
          type: 'object',
          additionalProperties: false,
          required: ['port'],
          properties: {
            // Mẫu tên cổng kiểm bằng luật E_SERIAL_PORT (không bằng regex ở schema): luật ghép nhiều dạng.
            port: { type: 'string', minLength: 1, maxLength: 220 },
            baud: { enum: [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] },
            dataBits: { enum: [7, 8] },
            parity: { enum: ['none', 'even', 'odd'] },
            stopBits: { enum: [1, 2] },
            rs485: { type: 'boolean' },
            dropEcho: { type: 'boolean' },
            silenceMs: { type: 'number', minimum: 0, maximum: 1000 },
          },
        },
        devices: { type: 'array', maxItems: 1024, items: { $ref: '#/definitions/rtuDevice' } },
      },
    },
    tcpDevice: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: { ...deviceCommon, unitId: intRange(0, 255) },
    },
    rtuDevice: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name'],
      properties: { ...deviceCommon, slave: intRange(1, 247) },
    },
  },
});

// ---- value-table ----
const color = { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' };
write('value-table.schema.json', {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: ID('value-table'),
  title: 'mAT SCADA value table (schema 0.2)',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'name', 'entries'],
  properties: {
    schemaVersion: SEMVER,
    name: { type: 'string', pattern: TABLE_NAME },
    description: { type: 'string', maxLength: 200 },
    entries: { type: 'array', maxItems: 4096, items: { $ref: '#/definitions/entry' } },
    default: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string' }, color },
    },
  },
  definitions: {
    // `text` không có maxLength: giới hạn 64 ký tự Unicode báo bằng E_VT_TEXT.
    entry: { oneOf: [{ $ref: '#/definitions/pointEntry' }, { $ref: '#/definitions/rangeEntry' }] },
    pointEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['value', 'text'],
      properties: { value: { type: ['boolean', 'number'] }, text: { type: 'string' }, color },
    },
    rangeEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      anyOf: [{ required: ['from'] }, { required: ['to'] }],
      properties: { from: num, to: num, text: { type: 'string' }, color },
    },
  },
});

// ---- watch-table ----
write('watch-table.schema.json', {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: ID('watch-table'),
  title: 'mAT SCADA watch table (schema 0.2)',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'id', 'name', 'rows'],
  properties: {
    schemaVersion: SEMVER,
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,47}$' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    rows: {
      type: 'array',
      maxItems: 4096,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tag'],
        properties: {
          tag: { type: 'string', maxLength: 64, pattern: TAG_ID },
          format: { enum: ['auto', 'dec', 'hex', 'bin', 'bool'] },
          decimals: intRange(0, 9),
          writeValue: { type: 'string', maxLength: 64 },
        },
      },
    },
  },
});
