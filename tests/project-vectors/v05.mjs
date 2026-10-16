// Ca `v05-*` của bộ vector project (feature 009, contracts/project-format-0.5.md §5, §11).
// Được generate.mjs nạp: `cases05()` trả các ca (commit). Mỗi ca ghi `runtimeVersion` "0.8.0" vào expected.json
// (bộ chạy TS và C++ truyền vào validator: runtime của repo chưa nâng 0.8.0 cho tới T125).
//
// Mỗi ca: [tên, hàm sửa base, mã lỗi (tập), mã cảnh báo (tập), thêm { issues }]. `issues`: {code, file, path}
// phải có mặt đúng vị trí. Lỗi E_SCHEMA, E_JSON, E_FILE_MISSING không ghi `path` (như 0.3).
import { base03 } from './v03.mjs';

const V = '0.5.0';
const AL = 'alarms.json';
const CL = 'alarm-classes.json';
const PJ = 'project.json';

const clone = (v) => JSON.parse(JSON.stringify(v));
const retag = (v) => {
  if (Array.isArray(v)) v.forEach(retag);
  else if (v !== null && typeof v === 'object') {
    if (v.schemaVersion !== undefined) v.schemaVersion = V;
    Object.values(v).forEach(retag);
  }
};

export const RUNTIME_05 = '0.8.0';

/** Project 0.5 hợp lệ: nền 0.3 cùng hai file alarm (7 instance, 4 lớp, 3 khu vực); không cảnh báo. */
export function base05() {
  const f = base03();
  for (const v of Object.values(f)) retag(v);
  f[PJ].projectId = 'vector05';
  f[PJ].projectName = 'Vector 0.5';
  f[PJ].minRuntimeVersion = RUNTIME_05;
  // khóa mới đứng sau connectionFile (thứ tự do generate.mjs giữ nguyên theo đối tượng)
  const p = {};
  for (const [k, v] of Object.entries(f[PJ])) {
    p[k] = v;
    if (k === 'connectionFile') {
      p.alarmFile = AL;
      p.alarmClassFile = CL;
    }
  }
  f[PJ] = p;
  f[AL] = {
    schemaVersion: V,
    areas: [
      { id: 'bon', name: 'Bồn' },
      { id: 'bom', name: 'Bơm' },
      { id: 'ket-noi', name: 'Kết nối' },
    ],
    alarms: [
      {
        id: 'TANK_B1_LEVEL',
        type: 'limit',
        name: 'Mức bồn B1',
        area: 'bon',
        tag: 'TANK01.LEVEL',
        limits: {
          LL: { value: 5, class: 'major' },
          L: { value: 15, class: 'minor' },
          H: { value: 80, class: 'minor' },
          HH: {
            value: 90,
            class: 'critical',
            text: '{name} rất cao: {value:1} {unit} (> {limit})',
          },
        },
        deadband: 2,
        onDelayMs: 3000,
        offDelayMs: 3000,
      },
      {
        id: 'PUMP1_FAULT',
        type: 'digital',
        name: 'Bơm 1 lỗi',
        area: 'bom',
        tag: 'PUMP01.FAULT',
        trigger: true,
        class: 'critical',
        text: 'Bơm 1 báo lỗi ({tag})',
        onDelayMs: 500,
      },
      {
        id: 'PLC1_LINK',
        type: 'quality',
        name: 'Mất kết nối PLC1',
        area: 'ket-noi',
        device: 'plc1',
        class: 'major',
        text: '{name}: mất tín hiệu ({reason})',
        onDelayMs: 5000,
      },
      {
        id: 'METER1_P_SIGNAL',
        type: 'quality',
        name: 'Mất tín hiệu đồng hồ 1',
        area: 'ket-noi',
        tag: 'METER1.P',
        on: 'notGood',
        class: 'minor',
      },
    ],
  };
  f[CL] = {
    schemaVersion: V,
    classes: [
      {
        id: 'critical',
        name: 'Khẩn cấp',
        priority: 'critical',
        color: 'red',
        blink: true,
        sound: 'siren',
      },
      {
        id: 'major',
        name: 'Quan trọng',
        priority: 'major',
        color: 'orange',
        blink: true,
        sound: 'double',
      },
      { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', sound: 'beep' },
      { id: 'advisory', name: 'Lưu ý', priority: 'advisory', color: 'blue', requiresAck: false },
    ],
  };
  return f;
}

const at = (code, path, file = AL) => ({ code, file, path });
const alarms = (f) => f[AL].alarms;
const LIM = (f) => alarms(f)[0];
const DIG = (f) => alarms(f)[1];
const QDEV = (f) => alarms(f)[2];
const QTAG = (f) => alarms(f)[3];
const classes = (f) => f[CL].classes;
const pad = (i, w = 4) => String(i).padStart(w, '0');
/** n alarm `digital` (một instance mỗi cái) thay toàn bộ danh sách. */
const nDigital = (f, n, extra = {}) => {
  f[AL].alarms = [];
  for (let i = 1; i <= n; i++)
    f[AL].alarms.push({
      id: `D${pad(i)}`,
      type: 'digital',
      name: `Số ${i}`,
      tag: 'PUMP01.FAULT',
      trigger: true,
      class: 'minor',
      ...extra,
    });
};
const textOf = (f, text) => (DIG(f).text = text);
const noAlarmFiles = (f) => {
  delete f[PJ].alarmFile;
  delete f[PJ].alarmClassFile;
  delete f[AL];
  delete f[CL];
};
const retagFiles = (f, version) => {
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      if (v.schemaVersion !== undefined) v.schemaVersion = version;
      Object.values(v).forEach(walk);
    }
  };
  for (const v of Object.values(f)) walk(v);
};

/** [tên, hàm sửa base, mã lỗi, mã cảnh báo (tùy chọn), thêm (tùy chọn)] */
export function cases05() {
  const C = [];
  const ok = (name, mutate, warnings = [], extra) => C.push([name, mutate, [], warnings, extra]);
  const bad = (name, mutate, errors, warnings = [], extra) =>
    C.push([name, mutate, errors, warnings, extra]);

  // ---- Khung và phiên bản ----
  ok('v05-ok-base-full', () => {});
  ok('v05-ok-empty-no-alarm-files', noAlarmFiles);
  ok('v05-ok-alarm-only-no-classes-no-alarms', (f) => {
    delete f[PJ].alarmClassFile;
    delete f[CL];
    f[AL].alarms = [];
    delete f[AL].areas;
  });
  ok('v05-ok-classes-only-no-alarm-file', (f) => {
    delete f[PJ].alarmFile;
    delete f[AL];
  });
  bad('v05-bad-version-mixed', (f) => (f[AL].schemaVersion = '0.4.0'), ['E_SCHEMA_VERSION'], [], {
    issues: [at('E_SCHEMA_VERSION', '/schemaVersion')],
  });
  bad(
    'v05-bad-version-mixed-classes',
    (f) => (f[CL].schemaVersion = '0.4.0'),
    ['E_SCHEMA_VERSION'],
    [],
    {
      issues: [at('E_SCHEMA_VERSION', '/schemaVersion', CL)],
    },
  );
  // 0.7 không phải bộ schema nào mà runtime hiện hành biết (0.6 là của feature 010, đã gộp): bị từ chối cả gói, rơi vào bộ 0.1
  // đóng băng (như mọi `schemaVersion` lạ) nên báo E_SCHEMA ở project.json.
  bad('v05-bad-version-0.7', (f) => retagFiles(f, '0.7.0'), ['E_SCHEMA']);
  bad(
    'v05-bad-min-runtime-0.7.0',
    (f) => (f[PJ].minRuntimeVersion = '0.7.0'),
    ['E_MIN_RUNTIME'],
    [],
    {
      issues: [at('E_MIN_RUNTIME', '/minRuntimeVersion', PJ)],
    },
  );
  ok('v05-ok-min-runtime-0.8.0', (f) => (f[PJ].minRuntimeVersion = '0.8.0'));
  bad('v05-bad-runtime-too-old', (f) => (f[PJ].minRuntimeVersion = '0.9.0'), ['E_RUNTIME_TOO_OLD']);
  bad('v05-bad-alarmfile-missing', (f) => delete f[AL], ['E_FILE_MISSING']);
  bad('v05-bad-classfile-missing', (f) => delete f[CL], ['E_FILE_MISSING']);
  bad('v05-bad-alarmfile-path', (f) => (f[PJ].alarmFile = '../alarms.json'), ['E_PATH'], [], {
    issues: [at('E_PATH', '/alarmFile', PJ)],
  });
  bad('v05-bad-alarmfile-extension', (f) => (f[PJ].alarmFile = 'alarms.txt'), ['E_SCHEMA']);
  bad('v05-bad-extra-key-project', (f) => (f[PJ].alarmsFile = 'alarms.json'), ['E_SCHEMA']);
  bad('v05-bad-alarms-json-invalid', (f) => (f[AL] = '{ "schemaVersion": "0.5.0", "alarms": [ '), [
    'E_JSON',
  ]);
  bad('v05-bad-alarms-no-alarms-key', (f) => delete f[AL].alarms, ['E_SCHEMA']);
  bad('v05-bad-alarms-not-object', (f) => (f[AL] = []), ['E_SCHEMA']);
  bad('v05-bad-classes-no-classes-key', (f) => delete f[CL].classes, ['E_SCHEMA']);

  // ---- digital ----
  ok('v05-ok-digital-bool', () => {});
  ok('v05-ok-digital-int-trigger-false', (f) => {
    DIG(f).tag = 'PUMP01.STATE';
    DIG(f).trigger = false;
  });
  ok('v05-ok-digital-calculated-bool', (f) => (DIG(f).tag = 'TANK01.HIGH'));
  bad('v05-bad-digital-float-tag', (f) => (DIG(f).tag = 'TANK01.LEVEL'), ['E_ALARM_TAG_TYPE'], [], {
    issues: [at('E_ALARM_TAG_TYPE', '/alarms/1/tag')],
  });
  bad('v05-bad-digital-string-tag', (f) => (DIG(f).tag = 'PUMP01.NAME'), ['E_ALARM_TAG_TYPE']);
  bad('v05-bad-digital-trigger-missing', (f) => delete DIG(f).trigger, ['E_ALARM_TRIGGER'], [], {
    issues: [at('E_ALARM_TRIGGER', '/alarms/1/trigger')],
  });
  bad('v05-bad-digital-trigger-string', (f) => (DIG(f).trigger = 'on'), ['E_ALARM_TRIGGER']);
  bad('v05-bad-digital-tag-ref', (f) => (DIG(f).tag = 'PUMP99.FAULT'), ['E_ALARM_TAG_REF'], [], {
    issues: [at('E_ALARM_TAG_REF', '/alarms/1/tag')],
  });
  bad('v05-bad-digital-tag-missing', (f) => delete DIG(f).tag, ['E_ALARM_TAG_REF']);
  bad(
    'v05-bad-digital-extra-limits',
    (f) => (DIG(f).limits = { H: { value: 1, class: 'minor' } }),
    ['E_ALARM_FIELD'],
    [],
    {
      issues: [at('E_ALARM_FIELD', '/alarms/1/limits')],
    },
  );
  bad('v05-bad-digital-class-missing', (f) => delete DIG(f).class, ['E_ALARM_CLASS_REF'], [], {
    issues: [at('E_ALARM_CLASS_REF', '/alarms/1/class')],
  });
  bad('v05-bad-digital-class-ref', (f) => (DIG(f).class = 'khancap'), ['E_ALARM_CLASS_REF']);

  // ---- limit ----
  ok('v05-ok-limit-4-thresholds', () => {});
  ok('v05-ok-limit-only-H', (f) => (LIM(f).limits = { H: { value: 80, class: 'minor' } }));
  ok('v05-ok-limit-only-LL', (f) => (LIM(f).limits = { LL: { value: 5, class: 'major' } }));
  ok('v05-ok-limit-int-tag', (f) => (LIM(f).tag = 'PUMP01.STATE'));
  ok('v05-ok-limit-calculated-tag', (f) => (LIM(f).tag = 'TANK01.VOLUME'));
  bad('v05-bad-limit-none', (f) => delete LIM(f).limits, ['E_ALARM_LIMIT_NONE'], [], {
    issues: [at('E_ALARM_LIMIT_NONE', '/alarms/0/limits')],
  });
  bad('v05-bad-limit-empty', (f) => (LIM(f).limits = {}), ['E_ALARM_LIMIT_NONE']);
  bad(
    'v05-bad-limit-unknown-key',
    (f) => (LIM(f).limits.X = { value: 1, class: 'minor' }),
    ['E_ALARM_LIMIT_NONE'],
    [],
    {
      issues: [at('E_ALARM_LIMIT_NONE', '/alarms/0/limits')],
    },
  );
  bad(
    'v05-bad-limit-order-H-gt-HH',
    (f) => {
      LIM(f).limits.H.value = 95;
    },
    ['E_ALARM_LIMIT_ORDER'],
    [],
    { issues: [at('E_ALARM_LIMIT_ORDER', '/alarms/0/limits/H/value')] },
  );
  bad('v05-bad-limit-order-equal', (f) => (LIM(f).limits.H.value = 90), ['E_ALARM_LIMIT_ORDER']);
  bad('v05-bad-limit-order-LL-ge-L', (f) => (LIM(f).limits.LL.value = 20), ['E_ALARM_LIMIT_ORDER']);
  bad(
    'v05-bad-limit-nan-value',
    (f) => (LIM(f).limits.H.value = 'abc'),
    ['E_ALARM_LIMIT_ORDER'],
    [],
    {
      issues: [at('E_ALARM_LIMIT_ORDER', '/alarms/0/limits/H/value')],
    },
  );
  bad('v05-bad-limit-value-missing', (f) => delete LIM(f).limits.H.value, ['E_ALARM_LIMIT_ORDER']);
  bad('v05-bad-limit-bool-tag', (f) => (LIM(f).tag = 'PUMP01.FAULT'), ['E_ALARM_TAG_TYPE']);
  bad('v05-bad-limit-string-tag', (f) => (LIM(f).tag = 'PUMP01.NAME'), ['E_ALARM_TAG_TYPE']);
  bad('v05-bad-limit-tag-ref', (f) => (LIM(f).tag = 'TANK99.LEVEL'), ['E_ALARM_TAG_REF'], [], {
    issues: [at('E_ALARM_TAG_REF', '/alarms/0/tag')],
  });
  bad('v05-bad-limit-deadband-negative', (f) => (LIM(f).deadband = -1), ['E_ALARM_DEADBAND'], [], {
    issues: [at('E_ALARM_DEADBAND', '/alarms/0/deadband')],
  });
  bad('v05-bad-limit-deadband-string', (f) => (LIM(f).deadband = 'x'), ['E_ALARM_DEADBAND']);
  bad(
    'v05-bad-limit-deadband-eq-gap',
    (f) => {
      LIM(f).limits = { H: { value: 80, class: 'minor' }, HH: { value: 82, class: 'critical' } };
      LIM(f).deadband = 2;
    },
    ['E_ALARM_DEADBAND'],
  );
  bad(
    'v05-bad-limit-deadband-gt-gap-3',
    (f) => {
      LIM(f).limits = { H: { value: 80, class: 'minor' }, HH: { value: 82, class: 'critical' } };
      LIM(f).deadband = 3;
    },
    ['E_ALARM_DEADBAND'],
  );
  ok('v05-ok-limit-deadband-just-below-gap', (f) => {
    LIM(f).limits = { H: { value: 80, class: 'minor' }, HH: { value: 82, class: 'critical' } };
    LIM(f).deadband = 1.9;
  });
  ok('v05-ok-limit-deadband-single-threshold-large', (f) => {
    LIM(f).limits = { H: { value: 80, class: 'minor' } };
    LIM(f).deadband = 1000;
  });
  bad(
    'v05-bad-limit-class-missing-on-threshold',
    (f) => delete LIM(f).limits.H.class,
    ['E_ALARM_CLASS_REF'],
    [],
    {
      issues: [at('E_ALARM_CLASS_REF', '/alarms/0/limits/H/class')],
    },
  );
  bad(
    'v05-bad-limit-class-ref-on-threshold',
    (f) => (LIM(f).limits.HH.class = 'khancap'),
    ['E_ALARM_CLASS_REF'],
    [],
    {
      issues: [at('E_ALARM_CLASS_REF', '/alarms/0/limits/HH/class')],
    },
  );
  bad('v05-bad-limit-alarm-level-class', (f) => (LIM(f).class = 'minor'), ['E_ALARM_FIELD'], [], {
    issues: [at('E_ALARM_FIELD', '/alarms/0/class')],
  });
  bad(
    'v05-bad-limit-threshold-extra-key',
    (f) => (LIM(f).limits.H.color = 'red'),
    ['E_ALARM_FIELD'],
    [],
    {
      issues: [at('E_ALARM_FIELD', '/alarms/0/limits/H/color')],
    },
  );
  bad('v05-bad-limit-with-trigger', (f) => (LIM(f).trigger = true), ['E_ALARM_FIELD']);
  ok(
    'v05-warn-limit-chatter-risk',
    (f) => {
      delete LIM(f).deadband;
      delete LIM(f).onDelayMs;
      delete LIM(f).offDelayMs;
    },
    ['W_ALARM_CHATTER_RISK'],
    { issues: [at('W_ALARM_CHATTER_RISK', '/alarms/0')] },
  );
  ok('v05-ok-limit-delay-only-no-chatter-warn', (f) => {
    delete LIM(f).deadband;
    delete LIM(f).offDelayMs;
  });

  // ---- quality ----
  ok('v05-ok-quality-tag', () => {});
  ok('v05-ok-quality-device', () => {});
  ok('v05-ok-quality-notGood', (f) => (QTAG(f).on = 'notGood'));
  ok('v05-ok-quality-bad-explicit', (f) => (QTAG(f).on = 'bad'));
  ok('v05-ok-quality-string-tag', (f) => (QTAG(f).tag = 'PUMP01.NAME'));
  bad(
    'v05-bad-quality-both-tag-device',
    (f) => (QDEV(f).tag = 'METER1.P'),
    ['E_ALARM_DEVICE_REF'],
    [],
    {
      issues: [at('E_ALARM_DEVICE_REF', '/alarms/2/device')],
    },
  );
  bad('v05-bad-quality-neither', (f) => delete QDEV(f).device, ['E_ALARM_DEVICE_REF'], [], {
    issues: [at('E_ALARM_DEVICE_REF', '/alarms/2/device')],
  });
  bad('v05-bad-quality-device-ref', (f) => (QDEV(f).device = 'plc9'), ['E_ALARM_DEVICE_REF'], [], {
    issues: [at('E_ALARM_DEVICE_REF', '/alarms/2/device')],
  });
  bad('v05-bad-quality-tag-ref', (f) => (QTAG(f).tag = 'METER9.P'), ['E_ALARM_TAG_REF'], [], {
    issues: [at('E_ALARM_TAG_REF', '/alarms/3/tag')],
  });
  bad('v05-bad-quality-on-unknown', (f) => (QTAG(f).on = 'uncertain'), ['E_ALARM_ON'], [], {
    issues: [at('E_ALARM_ON', '/alarms/3/on')],
  });
  bad(
    'v05-bad-quality-device-without-connections',
    (f) => {
      delete f[PJ].connectionFile;
      delete f['connections.json'];
    },
    ['E_ALARM_DEVICE_REF', 'E_REF_DEVICE'],
  );
  ok(
    'v05-warn-quality-device-empty',
    (f) => (QDEV(f).device = 'meter2'),
    ['W_ALARM_DEVICE_EMPTY'],
    { issues: [at('W_ALARM_DEVICE_EMPTY', '/alarms/2/device')] },
  );

  // ---- id và đếm ----
  bad('v05-bad-id-dup', (f) => alarms(f).push({ ...clone(DIG(f)) }), ['E_ALARM_ID_DUP'], [], {
    issues: [at('E_ALARM_ID_DUP', '/alarms/4/id')],
  });
  ok('v05-ok-id-case-differs', (f) => alarms(f).push({ ...clone(DIG(f)), id: 'pump1_fault' }));
  bad('v05-bad-id-format-digit-first', (f) => (DIG(f).id = '1PUMP'), ['E_ALARM_ID_FORMAT'], [], {
    issues: [at('E_ALARM_ID_FORMAT', '/alarms/1/id')],
  });
  bad('v05-bad-id-format-dot', (f) => (DIG(f).id = 'TANK.H'), ['E_ALARM_ID_FORMAT']);
  bad('v05-bad-id-format-one-char', (f) => (DIG(f).id = 'A'), ['E_ALARM_ID_FORMAT']);
  bad('v05-bad-id-format-space', (f) => (DIG(f).id = 'A B'), ['E_ALARM_ID_FORMAT']);
  bad('v05-bad-id-missing', (f) => delete DIG(f).id, ['E_ALARM_ID_FORMAT']);
  ok('v05-ok-id-len-48', (f) => (DIG(f).id = 'A' + 'b'.repeat(47)));
  bad('v05-bad-id-len-49', (f) => (DIG(f).id = 'A' + 'b'.repeat(48)), ['E_ALARM_ID_FORMAT']);
  ok('v05-ok-count-200-no-warning', (f) => nDigital(f, 200));
  ok('v05-warn-count-201', (f) => nDigital(f, 201), ['W_ALARM_COUNT_HIGH'], {
    issues: [at('W_ALARM_COUNT_HIGH', '/alarms')],
  });
  ok('v05-ok-count-500-instances', (f) => nDigital(f, 500), ['W_ALARM_COUNT_HIGH']);
  bad(
    'v05-bad-count-501-instances',
    (f) => nDigital(f, 501),
    ['E_ALARM_COUNT'],
    ['W_ALARM_COUNT_HIGH'],
    {
      issues: [at('E_ALARM_COUNT', '/alarms')],
    },
  );
  bad(
    'v05-bad-count-limit-thresholds',
    (f) => {
      f[AL].alarms = [];
      for (let i = 1; i <= 126; i++)
        f[AL].alarms.push({
          id: `L${pad(i)}`,
          type: 'limit',
          name: `Ngưỡng ${i}`,
          tag: 'TANK01.LEVEL',
          limits: {
            LL: { value: 1, class: 'minor' },
            L: { value: 2, class: 'minor' },
            H: { value: 3, class: 'minor' },
            HH: { value: 4, class: 'minor' },
          },
          deadband: 0.5,
        });
    },
    ['E_ALARM_COUNT'],
    ['W_ALARM_COUNT_HIGH'],
  );
  ok(
    'v05-ok-enabled-false-not-counted',
    (f) => {
      nDigital(f, 500);
      for (let i = 1; i <= 10; i++)
        f[AL].alarms.push({
          id: `X${pad(i)}`,
          type: 'digital',
          name: `Tắt ${i}`,
          tag: 'PUMP01.FAULT',
          trigger: true,
          class: 'minor',
          enabled: false,
        });
    },
    ['W_ALARM_COUNT_HIGH'],
  );
  bad(
    'v05-bad-enabled-false-still-validated',
    (f) => {
      DIG(f).enabled = false;
      DIG(f).tag = 'PUMP99.FAULT';
    },
    ['E_ALARM_TAG_REF'],
  );
  bad('v05-bad-enabled-string', (f) => (DIG(f).enabled = 'no'), ['E_ALARM_FIELD']);

  // ---- kích thước tệp (đệm khoảng trắng, hợp lệ về JSON) ----
  const padded = (f, bytes) => {
    const head = JSON.stringify(f[AL]);
    const n = Buffer.byteLength(head, 'utf8');
    f[AL] = head + ' '.repeat(bytes - n - 1) + '\n';
  };
  ok('v05-ok-alarms-file-512KiB', (f) => padded(f, 512 * 1024));
  bad('v05-bad-alarms-file-over-512KiB', (f) => padded(f, 512 * 1024 + 1), ['E_ALARM_COUNT'], [], {
    issues: [at('E_ALARM_COUNT', '/alarms')],
  });

  // ---- text ----
  ok('v05-ok-text-all-tokens', (f) =>
    textOf(f, '{name} {tag} {value} {value:2} {unit} {limit} {limitName} {area} {reason}'),
  );
  ok('v05-ok-text-value-0', (f) => textOf(f, '{value:0}'));
  ok('v05-ok-text-value-6', (f) => textOf(f, '{value:6}'));
  bad('v05-bad-text-value-7', (f) => textOf(f, '{value:7}'), ['E_ALARM_TEXT_TOKEN'], [], {
    issues: [at('E_ALARM_TEXT_TOKEN', '/alarms/1/text')],
  });
  bad('v05-bad-text-unknown-token', (f) => textOf(f, 'Bơm {abc}'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-unbalanced-brace', (f) => textOf(f, 'Bơm {name'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-unbalanced-close', (f) => textOf(f, 'Bơm name}'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-empty-fmt', (f) => textOf(f, '{value:}'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-empty-token', (f) => textOf(f, '{}'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-nested-brace', (f) => textOf(f, '{na{me}}'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-value-two-digits', (f) => textOf(f, '{value:10}'), ['E_ALARM_TEXT_TOKEN']);
  bad('v05-bad-text-case-sensitive', (f) => textOf(f, '{Name}'), ['E_ALARM_TEXT_TOKEN']);
  ok('v05-ok-text-200-chars', (f) => textOf(f, 'a'.repeat(200)));
  bad('v05-bad-text-201-chars', (f) => textOf(f, 'a'.repeat(201)), ['E_ALARM_TEXT_LEN'], [], {
    issues: [at('E_ALARM_TEXT_LEN', '/alarms/1/text')],
  });
  ok('v05-ok-text-200-multibyte', (f) => textOf(f, 'ệ'.repeat(200)));
  bad('v05-bad-text-201-multibyte', (f) => textOf(f, 'ệ'.repeat(201)), ['E_ALARM_TEXT_LEN']);
  ok('v05-ok-text-200-astral', (f) => textOf(f, '\u{1F600}'.repeat(200)));
  bad('v05-bad-text-201-astral', (f) => textOf(f, '\u{1F600}'.repeat(201)), ['E_ALARM_TEXT_LEN']);
  ok('v05-ok-text-vietnamese-combining', (f) => textOf(f, 'ệ '.repeat(48) + '{name}'));
  bad(
    'v05-bad-text-threshold-token',
    (f) => (LIM(f).limits.HH.text = '{limitName'),
    ['E_ALARM_TEXT_TOKEN'],
    [],
    {
      issues: [at('E_ALARM_TEXT_TOKEN', '/alarms/0/limits/HH/text')],
    },
  );
  bad(
    'v05-bad-text-threshold-len',
    (f) => (LIM(f).limits.H.text = 'a'.repeat(201)),
    ['E_ALARM_TEXT_LEN'],
    [],
    {
      issues: [at('E_ALARM_TEXT_LEN', '/alarms/0/limits/H/text')],
    },
  );
  bad('v05-bad-text-not-string', (f) => textOf(f, 5), ['E_ALARM_FIELD']);

  // ---- trễ ----
  ok('v05-ok-delay-0', (f) => {
    DIG(f).onDelayMs = 0;
    DIG(f).offDelayMs = 0;
  });
  ok('v05-ok-delay-max-86400000', (f) => {
    DIG(f).onDelayMs = 86400000;
    DIG(f).offDelayMs = 86400000;
  });
  bad('v05-bad-delay-over-max', (f) => (DIG(f).onDelayMs = 86400001), ['E_ALARM_DELAY_RANGE'], [], {
    issues: [at('E_ALARM_DELAY_RANGE', '/alarms/1/onDelayMs')],
  });
  bad(
    'v05-bad-delay-off-over-max',
    (f) => (DIG(f).offDelayMs = 86400001),
    ['E_ALARM_DELAY_RANGE'],
    [],
    {
      issues: [at('E_ALARM_DELAY_RANGE', '/alarms/1/offDelayMs')],
    },
  );
  bad('v05-bad-delay-negative', (f) => (DIG(f).onDelayMs = -1), ['E_ALARM_DELAY_RANGE']);
  bad('v05-bad-delay-fraction', (f) => (DIG(f).onDelayMs = 1.5), ['E_ALARM_DELAY_RANGE']);
  bad('v05-bad-delay-string', (f) => (DIG(f).onDelayMs = '5'), ['E_ALARM_DELAY_RANGE']);

  // ---- lớp ----
  ok('v05-ok-classes-default-four', () => {});
  ok('v05-ok-class-user-defined', (f) =>
    classes(f).push({
      id: 'an_toan_nuoc',
      name: 'An toàn nước',
      priority: 'major',
      color: 'purple',
      ackReturn: true,
      sound: 'double',
    }),
  );
  ok('v05-ok-class-chatter-0', (f) => (classes(f)[0].chatterLimit = 0));
  ok('v05-ok-class-chatter-100', (f) => (classes(f)[0].chatterLimit = 100));
  bad(
    'v05-bad-class-chatter-101',
    (f) => (classes(f)[0].chatterLimit = 101),
    ['E_ALARM_FIELD'],
    [],
    {
      issues: [at('E_ALARM_FIELD', '/classes/0/chatterLimit', CL)],
    },
  );
  bad('v05-bad-class-chatter-fraction', (f) => (classes(f)[0].chatterLimit = 2.5), [
    'E_ALARM_FIELD',
  ]);
  bad(
    'v05-bad-class-dup',
    (f) => classes(f).push({ ...clone(classes(f)[0]) }),
    ['E_ALARM_CLASS_DUP'],
    [],
    {
      issues: [at('E_ALARM_CLASS_DUP', '/classes/4/id', CL)],
    },
  );
  bad(
    'v05-bad-class-id-format',
    (f) => classes(f).push({ id: 'Khan-Cap', name: 'X', priority: 'minor', color: 'gray' }),
    ['E_ALARM_CLASS_FIELD'],
    [],
    {
      issues: [at('E_ALARM_CLASS_FIELD', '/classes/4/id', CL)],
    },
  );
  bad('v05-bad-class-color', (f) => (classes(f)[0].color = 'pink'), ['E_ALARM_CLASS_FIELD'], [], {
    issues: [at('E_ALARM_CLASS_FIELD', '/classes/0/color', CL)],
  });
  bad('v05-bad-class-sound', (f) => (classes(f)[0].sound = 'horn'), ['E_ALARM_CLASS_FIELD']);
  bad('v05-bad-class-priority', (f) => (classes(f)[0].priority = 'urgent'), [
    'E_ALARM_CLASS_FIELD',
  ]);
  bad('v05-bad-class-bool-type', (f) => (classes(f)[0].blink = 'yes'), ['E_ALARM_CLASS_FIELD']);
  bad('v05-bad-class-name-empty', (f) => (classes(f)[0].name = ''), ['E_ALARM_CLASS_FIELD']);
  bad('v05-bad-class-name-41', (f) => (classes(f)[0].name = 'x'.repeat(41)), [
    'E_ALARM_CLASS_FIELD',
  ]);
  bad('v05-bad-class-extra-key', (f) => (classes(f)[0].icon = 'bell'), ['E_ALARM_CLASS_FIELD']);
  bad('v05-bad-class-top-extra-key', (f) => (f[CL].extra = 1), ['E_ALARM_CLASS_FIELD']);
  ok('v05-ok-classes-16', (f) => {
    for (let i = 1; i <= 12; i++)
      classes(f).push({ id: `c${pad(i, 2)}`, name: `Lớp ${i}`, priority: 'minor', color: 'gray' });
  });
  bad(
    'v05-bad-classes-17',
    (f) => {
      for (let i = 1; i <= 13; i++)
        classes(f).push({
          id: `c${pad(i, 2)}`,
          name: `Lớp ${i}`,
          priority: 'minor',
          color: 'gray',
        });
    },
    ['E_ALARM_CLASS_COUNT'],
    [],
    { issues: [at('E_ALARM_CLASS_COUNT', '/classes', CL)] },
  );
  ok(
    'v05-warn-critical-no-ack',
    (f) => (classes(f)[0].requiresAck = false),
    ['W_ALARM_NO_ACK_CRITICAL'],
    {
      issues: [at('W_ALARM_NO_ACK_CRITICAL', '/classes/0/requiresAck', CL)],
    },
  );

  // ---- khu vực ----
  ok('v05-ok-areas-64', (f) => {
    f[AL].areas = [];
    for (let i = 1; i <= 64; i++) f[AL].areas.push({ id: `a${pad(i, 2)}`, name: `Khu ${i}` });
    for (const a of alarms(f)) delete a.area;
  });
  bad(
    'v05-bad-areas-65',
    (f) => {
      f[AL].areas = [];
      for (let i = 1; i <= 65; i++) f[AL].areas.push({ id: `a${pad(i, 2)}`, name: `Khu ${i}` });
      for (const a of alarms(f)) delete a.area;
    },
    ['E_ALARM_AREA_COUNT'],
    [],
    { issues: [at('E_ALARM_AREA_COUNT', '/areas')] },
  );
  bad(
    'v05-bad-area-dup',
    (f) => f[AL].areas.push({ id: 'bon', name: 'Bồn 2' }),
    ['E_ALARM_AREA_DUP'],
    [],
    {
      issues: [at('E_ALARM_AREA_DUP', '/areas/3/id')],
    },
  );
  bad(
    'v05-bad-area-id-format',
    (f) => f[AL].areas.push({ id: 'Kho', name: 'Kho' }),
    ['E_ALARM_FIELD'],
    [],
    {
      issues: [at('E_ALARM_FIELD', '/areas/3/id')],
    },
  );
  bad('v05-bad-area-name-empty', (f) => (f[AL].areas[0].name = ''), ['E_ALARM_FIELD']);
  bad('v05-bad-area-extra-key', (f) => (f[AL].areas[0].color = 'red'), ['E_ALARM_FIELD']);
  bad('v05-bad-area-ref', (f) => (DIG(f).area = 'kho'), ['E_ALARM_AREA_REF'], [], {
    issues: [at('E_ALARM_AREA_REF', '/alarms/1/area')],
  });
  ok('v05-ok-area-absent-general', (f) => delete DIG(f).area);
  ok('v05-ok-no-areas-key', (f) => {
    delete f[AL].areas;
    for (const a of alarms(f)) delete a.area;
  });

  // ---- trường lạ và kiểu ----
  bad('v05-bad-field-unknown-alarm', (f) => (DIG(f).color = 'red'), ['E_ALARM_FIELD'], [], {
    issues: [at('E_ALARM_FIELD', '/alarms/1/color')],
  });
  bad('v05-bad-field-unknown-top', (f) => (f[AL].extra = 1), ['E_ALARM_FIELD'], [], {
    issues: [at('E_ALARM_FIELD', '/extra')],
  });
  bad('v05-bad-field-name-81', (f) => (DIG(f).name = 'x'.repeat(81)), ['E_ALARM_FIELD']);
  ok('v05-ok-field-name-80', (f) => (DIG(f).name = 'x'.repeat(80)));
  bad('v05-bad-field-name-empty', (f) => (DIG(f).name = ''), ['E_ALARM_FIELD']);
  bad('v05-bad-field-name-missing', (f) => delete DIG(f).name, ['E_ALARM_FIELD']);
  bad('v05-bad-field-type-number-name', (f) => (DIG(f).name = 42), ['E_ALARM_FIELD'], [], {
    issues: [at('E_ALARM_FIELD', '/alarms/1/name')],
  });
  bad('v05-bad-field-alarm-not-object', (f) => alarms(f).push('x'), ['E_ALARM_FIELD'], [], {
    issues: [at('E_ALARM_FIELD', '/alarms/4')],
  });
  bad('v05-bad-type-analog', (f) => (DIG(f).type = 'analog'), ['E_ALARM_TYPE'], [], {
    issues: [at('E_ALARM_TYPE', '/alarms/1/type')],
  });
  bad('v05-bad-type-missing', (f) => delete DIG(f).type, ['E_ALARM_TYPE']);
  bad(
    'v05-bad-class-ref-without-class-file',
    (f) => {
      delete f[PJ].alarmClassFile;
      delete f[CL];
    },
    ['E_ALARM_CLASS_REF'],
    [],
    {
      issues: [
        at('E_ALARM_CLASS_REF', '/alarms/0/limits/LL/class'),
        at('E_ALARM_CLASS_REF', '/alarms/1/class'),
      ],
    },
  );

  // ---- widget alarm trên màn hình (danh mục 0.4.0) ----
  const SC = 'screens/main.screen.json';
  const alarmWidget = (f, widget, props, w = 640, h = 260) =>
    f[SC].items.push({
      id: 'alw1',
      type: 'widget',
      widget,
      x: 0,
      y: 400,
      width: w,
      height: h,
      props,
    });
  ok('v05-ok-screen-widget-alarm-list', (f) =>
    alarmWidget(f, 'alarm-list', { areas: ['bon', '-'], classes: ['critical', 'major'] }),
  );
  ok(
    'v05-ok-screen-widget-alarm-list-ref-unknown',
    (f) => alarmWidget(f, 'alarm-list', { areas: ['khong-co'], classes: ['zz'] }),
    ['W_WIDGET_ALARM_REF'],
  );
  bad(
    'v05-bad-screen-widget-alarm-count-target-popup',
    (f) =>
      alarmWidget(f, 'alarm-count', { target: { kind: 'screen', screen: 'khong-co' } }, 120, 48),
    ['E_ACTION_TARGET'],
  );

  // ---- giữ tương thích ----
  ok('v05-ok-screen-0.4-features-in-0.5', () => {});
  ok('v05-ok-navigation-alarms-false', (f) => (f[PJ].navigation.alarms = false));
  ok('v05-ok-navigation-alarms-true', (f) => (f[PJ].navigation.alarms = true));
  ok('v05-ok-no-navigation-with-alarms', (f) => delete f[PJ].navigation);
  bad('v05-bad-navigation-alarms-string', (f) => (f[PJ].navigation.alarms = 'yes'), ['E_SCHEMA']);
  bad('v05-bad-navigation-extra-key', (f) => (f[PJ].navigation.sound = true), ['E_SCHEMA']);

  return C;
}
