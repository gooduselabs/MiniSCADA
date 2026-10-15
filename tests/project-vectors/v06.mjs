// Ca `v06-*` của bộ vector project (feature 010: logging.json chế độ trigger/tổng hợp/ước tính ghi,
// reports.json, navigation[].report). Được generate.mjs nạp; mô tả ở tests/project-vectors/README-010.md.
//
// Mỗi ca: [tên, hàm sửa base06, mã lỗi (tập), cảnh báo (tập), thêm { issues, estimate }].
// `issues`: [{ code, file, path }] phải có mặt (chứa); `estimate`: số mong đợi của ước tính ghi
// (contracts/logging-config-0.2.md §5), GHI THẲNG số cố định, không tính bằng công thức.
import { base03 } from './v03.mjs';

export const V06 = '0.6.0';
const PJ = 'project.json';
const TAGS = 'tags.json';
const L = 'logging.json';
const R = 'reports.json';
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Project 0.6 hợp lệ = base 0.3 với mọi `schemaVersion` 0.6.0 và `minRuntimeVersion` 0.9.0. */
export function base06() {
  const f = base03();
  for (const v of Object.values(f))
    if (v !== null && typeof v === 'object' && v.schemaVersion !== undefined) v.schemaVersion = V06;
  f[PJ].projectId = 'vector06';
  f[PJ].projectName = 'Vector 0.6';
  f[PJ].minRuntimeVersion = '0.9.0';
  return f;
}

const at = (code, path, file = L) => ({ code, file, path });
const iss = (...issues) => ({ issues });

/** logging.json 0.6 hợp lệ: một nhóm `onChange` (Tag số, BOOL, chuỗi) và một nhóm `trigger`. */
const LOG = () => ({
  schemaVersion: V06,
  timeZone: '+07:00',
  groups: [
    {
      id: 'ap-suat',
      name: 'Áp suất',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 30,
      tags: [{ tagId: 'TANK01.LEVEL', deadband: 0.2 }, { tagId: 'PUMP01.RUN_CMD' }],
    },
  ],
});
/** Nhóm trigger hợp lệ, Tag kích hoạt BOOL; `edge` đổi được. */
const TRIG = (edge = 'rising', extra = {}) => ({
  id: 'me-tron',
  name: 'Mẻ trộn',
  mode: 'trigger',
  minIntervalMs: 5000,
  retentionDays: 365,
  trigger: { tagId: 'PUMP01.FAULT', edge },
  tags: [{ tagId: 'TANK01.LEVEL' }, { tagId: 'PUMP01.NAME', maxLength: 32 }],
  ...extra,
});
const withLog = (f, groups, extra = {}) => {
  f[PJ].loggingFile = L;
  f[L] = { ...LOG(), groups, ...extra };
  return f[L].groups;
};

/** n Tag FLOAT32 nội bộ `E.Tnnnn` thêm vào tags.json; trả về danh sách mục `{tagId}`. */
function floatTags(f, n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const id = `E.T${String(i).padStart(4, '0')}`;
    f[TAGS].tags.push({ id, kind: 'internal', type: 'FLOAT32', initial: 0 });
    out.push({ tagId: id });
  }
  return out;
}

/** Mục `groups[]` của ước tính một nhóm 200 Tag FLOAT32 (rowBytes 1.824). */
const eg = (rowsPerDay, basis, rawWrite, aggWrite, rawStorage, aggStorage, aggTags) => ({
  rowsPerDay,
  basis,
  rowBytes: 1824,
  rawWrite,
  aggWrite,
  rawStorage,
  aggStorage,
  aggTags,
});
const est = (
  writeBytesPerDay,
  raw,
  agg,
  storageBytes,
  dailyGrowthBytes,
  daysToFillCap,
  groups,
) => ({
  writeBytesPerDay,
  rawWriteBytesPerDay: raw,
  aggWriteBytesPerDay: agg,
  storageBytes,
  dailyGrowthBytes,
  daysToFillCap,
  groups,
});

export function cases06() {
  const C = [];
  const ok = (name, mutate, warnings = [], extra) => C.push([name, mutate, [], warnings, extra]);
  const bad = (name, mutate, errors, warnings, extra) =>
    C.push([name, mutate, errors, warnings, extra]);

  // ================= logging.json: hợp lệ =================
  for (const edge of ['rising', 'falling', 'both'])
    ok(`v06-logging-010-valid-trigger-${edge}`, (f) => withLog(f, [TRIG(edge)]));
  ok('v06-logging-010-valid-trigger-active', (f) =>
    withLog(f, [TRIG('active', { periodMs: 10000 })]),
  );
  ok('v06-logging-010-valid-trigger-numeric', (f) =>
    withLog(f, [
      TRIG('rising', { trigger: { tagId: 'TANK01.LEVEL', edge: 'rising', threshold: 50 } }),
    ]),
  );
  ok('v06-logging-010-valid-trigger-outside-tags', (f) =>
    // Tag kích hoạt không nằm trong danh sách Tag của nhóm
    withLog(f, [TRIG('both', { tags: [{ tagId: 'METER1.P' }] })]),
  );
  ok('v06-logging-010-valid-hybrid', (f) =>
    withLog(f, [{ ...LOG().groups[0], maxIntervalMs: 60000 }]),
  );
  ok('v06-logging-010-valid-aggregates', (f) =>
    withLog(f, [
      {
        ...LOG().groups[0],
        aggregates: { minuteRetentionDays: 31, hourRetentionDays: 730 },
        expectedRowsPerDay: 20000,
      },
    ]),
  );
  ok('v06-logging-010-valid-aggregates-defaults', (f) =>
    withLog(f, [{ ...LOG().groups[0], aggregates: {} }]),
  );
  ok('v06-logging-010-valid-aggregate-false', (f) =>
    withLog(f, [
      {
        ...LOG().groups[0],
        aggregates: {},
        tags: [{ tagId: 'TANK01.LEVEL', aggregate: false }, { tagId: 'METER1.P' }],
      },
    ]),
  );
  ok('v06-logging-010-valid-aggregate-string-false', (f) =>
    // Tag chuỗi với aggregate:false tường minh: hợp lệ (chỉ true mới là lỗi)
    withLog(f, [
      {
        ...LOG().groups[0],
        aggregates: {},
        tags: [{ tagId: 'TANK01.LEVEL' }, { tagId: 'PUMP01.NAME', aggregate: false }],
      },
    ]),
  );
  ok('v06-logging-010-valid-expected', (f) =>
    withLog(f, [{ ...LOG().groups[0], expectedRowsPerDay: 20000 }]),
  );
  ok('v06-logging-010-valid-trigger-expected-aggregates', (f) =>
    withLog(f, [TRIG('rising', { expectedRowsPerDay: 500, aggregates: {} })]),
  );
  ok('v06-logging-010-valid-retention-limits', (f) =>
    withLog(f, [
      { ...LOG().groups[0], aggregates: { minuteRetentionDays: 365, hourRetentionDays: 3650 } },
    ]),
  );
  ok('v06-logging-010-valid-retention-equal', (f) =>
    withLog(f, [
      { ...LOG().groups[0], aggregates: { minuteRetentionDays: 40, hourRetentionDays: 40 } },
    ]),
  );

  // ================= logging.json: không hợp lệ =================
  bad(
    'v06-logging-010-invalid-trigger-string',
    (f) => withLog(f, [TRIG('rising', { trigger: { tagId: 'PUMP01.NAME', edge: 'rising' } })]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/trigger/tagId')),
  );
  bad(
    'v06-logging-010-invalid-trigger-missing',
    (f) => {
      const g = TRIG();
      delete g.trigger;
      withLog(f, [g]);
    },
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0')),
  );
  bad(
    'v06-logging-010-invalid-trigger-on-cyclic',
    (f) =>
      withLog(f, [
        {
          id: 'chu-ky',
          name: 'Chu kỳ',
          mode: 'cyclic',
          periodMs: 1000,
          retentionDays: 7,
          trigger: { tagId: 'PUMP01.FAULT', edge: 'rising' },
          tags: [{ tagId: 'TANK01.LEVEL' }],
        },
      ]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/trigger')),
  );
  bad(
    'v06-logging-010-invalid-trigger-on-onchange',
    (f) => withLog(f, [{ ...LOG().groups[0], trigger: { tagId: 'PUMP01.FAULT', edge: 'rising' } }]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/trigger')),
  );
  bad(
    'v06-logging-010-invalid-trigger-active-no-period',
    (f) => withLog(f, [TRIG('active')]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0')),
  );
  bad(
    'v06-logging-010-invalid-trigger-period-with-rising',
    (f) => withLog(f, [TRIG('rising', { periodMs: 10000 })]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/periodMs')),
  );
  bad(
    'v06-logging-010-invalid-trigger-threshold-bool',
    (f) =>
      withLog(f, [
        TRIG('rising', { trigger: { tagId: 'PUMP01.FAULT', edge: 'rising', threshold: 1 } }),
      ]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/trigger/threshold')),
  );
  bad(
    'v06-logging-010-invalid-trigger-max-interval',
    (f) => withLog(f, [TRIG('rising', { maxIntervalMs: 60000 })]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/maxIntervalMs')),
  );
  bad(
    'v06-logging-010-invalid-trigger-ref-tag',
    (f) => withLog(f, [TRIG('rising', { trigger: { tagId: 'NO.SUCH.TAG', edge: 'rising' } })]),
    ['E_LOG_REF_TAG'],
    [],
    iss(at('E_LOG_REF_TAG', '/groups/0/trigger/tagId')),
  );
  bad(
    'v06-logging-010-invalid-expected-cyclic',
    (f) =>
      withLog(f, [
        {
          id: 'chu-ky',
          name: 'Chu kỳ',
          mode: 'cyclic',
          periodMs: 1000,
          retentionDays: 7,
          expectedRowsPerDay: 1000,
          tags: [{ tagId: 'TANK01.LEVEL' }],
        },
      ]),
    ['E_LOG_TRIGGER'],
    [],
    iss(at('E_LOG_TRIGGER', '/groups/0/expectedRowsPerDay')),
  );
  bad(
    'v06-logging-010-invalid-agg-no-numeric',
    (f) =>
      withLog(f, [
        { ...LOG().groups[0], aggregates: {}, tags: [{ tagId: 'PUMP01.NAME', maxLength: 16 }] },
      ]),
    ['E_LOG_AGG'],
    [],
    iss(at('E_LOG_AGG', '/groups/0/aggregates')),
  );
  bad(
    'v06-logging-010-invalid-agg-all-excluded',
    (f) =>
      withLog(f, [
        {
          ...LOG().groups[0],
          aggregates: {},
          tags: [{ tagId: 'TANK01.LEVEL', aggregate: false }, { tagId: 'PUMP01.NAME' }],
        },
      ]),
    ['E_LOG_AGG'],
    [],
    iss(at('E_LOG_AGG', '/groups/0/aggregates')),
  );
  bad(
    'v06-logging-010-invalid-agg-string-tag',
    (f) =>
      withLog(f, [
        {
          ...LOG().groups[0],
          aggregates: {},
          tags: [{ tagId: 'TANK01.LEVEL' }, { tagId: 'PUMP01.NAME', aggregate: true }],
        },
      ]),
    ['E_LOG_AGG'],
    [],
    iss(at('E_LOG_AGG', '/groups/0/tags/1/aggregate')),
  );
  bad(
    'v06-logging-010-invalid-agg-retention',
    (f) =>
      withLog(f, [
        { ...LOG().groups[0], aggregates: { minuteRetentionDays: 60, hourRetentionDays: 30 } },
      ]),
    ['E_LOG_AGG'],
    [],
    iss(at('E_LOG_AGG', '/groups/0/aggregates')),
  );
  bad('v06-logging-010-invalid-schema-edge', (f) => withLog(f, [TRIG('sometimes')]), ['E_SCHEMA']);
  bad(
    'v06-logging-010-invalid-schema-retention-range',
    (f) => withLog(f, [{ ...LOG().groups[0], aggregates: { minuteRetentionDays: 400 } }]),
    ['E_SCHEMA'],
  );
  bad(
    'v06-logging-010-invalid-schema-expected-range',
    (f) => withLog(f, [{ ...LOG().groups[0], expectedRowsPerDay: 0 }]),
    ['E_SCHEMA'],
  );
  bad(
    'v06-logging-010-invalid-schema-aggregate-not-bool',
    (f) =>
      withLog(f, [
        { ...LOG().groups[0], aggregates: {}, tags: [{ tagId: 'TANK01.LEVEL', aggregate: 'yes' }] },
      ]),
    ['E_SCHEMA'],
  );
  bad(
    'v06-logging-010-invalid-schema-aggregates-key',
    (f) => withLog(f, [{ ...LOG().groups[0], aggregates: { dayRetentionDays: 5 } }]),
    ['E_SCHEMA'],
  );
  bad(
    'v06-logging-010-invalid-schema-trigger-no-edge',
    (f) => withLog(f, [TRIG('rising', { trigger: { tagId: 'PUMP01.FAULT' } })]),
    ['E_SCHEMA'],
  );
  bad(
    'v06-logging-010-invalid-version',
    (f) => withLog(f, [TRIG()], { schemaVersion: '0.3.0' }),
    ['E_SCHEMA_VERSION'],
    [],
    iss(at('E_SCHEMA_VERSION', '/schemaVersion')),
  );

  // ================= Ước tính ghi =================
  const grpBig = (f, id, extra) => ({
    id,
    name: id,
    mode: 'cyclic',
    periodMs: 1000,
    retentionDays: 1,
    tags: f._est200,
    ...extra,
  });
  const with200 = (f) => {
    f._est200 = floatTags(f, 200);
  };
  const strip = (f) => delete f._est200;
  const big = (mutate) => (f) => {
    with200(f);
    mutate(f);
    strip(f);
  };
  const mk = (id, extra) => (f) => ({ ...grpBig(f, id, extra) });

  ok(
    'v06-logging-010-estimate-onchange-agg',
    big((f) =>
      withLog(f, [
        mk('g1', {
          mode: 'onChange',
          periodMs: undefined,
          minIntervalMs: 1000,
          retentionDays: 3,
          aggregates: {},
        })(f),
      ]),
    ),
    [],
    {
      estimate: est(796078080, 739860480, 56217600, 1268428800, 176332800, 12, [
        eg(86400, 'upper', 739860480, 56217600, 472780800, 795648000, 200),
      ]),
    },
  );
  ok(
    'v06-logging-010-estimate-expected-agg',
    big((f) =>
      withLog(f, [
        mk('g1', {
          mode: 'onChange',
          periodMs: undefined,
          minIntervalMs: 1000,
          retentionDays: 3,
          expectedRowsPerDay: 20000,
          aggregates: {},
        })(f),
      ]),
    ),
    [],
    {
      estimate: est(553850880, 497633280, 56217600, 905088000, 55219200, 38, [
        eg(20000, 'expected', 497633280, 56217600, 109440000, 795648000, 200),
      ]),
    },
  );
  ok(
    'v06-logging-010-estimate-4x200-cyclic-agg',
    big((f) =>
      withLog(
        f,
        ['g1', 'g2', 'g3', 'g4'].map((id) =>
          mk(id, { aggregates: { minuteRetentionDays: 1, hourRetentionDays: 1 } })(f),
        ),
      ),
    ),
    ['W_LOG_WRITE_BUDGET'],
    {
      estimate: est(
        3184312320,
        2959441920,
        224870400,
        705331200,
        705331200,
        3,
        Array.from({ length: 4 }, () =>
          eg(86400, 'exact', 739860480, 56217600, 157593600, 18739200, 200),
        ),
      ),
    },
  );
  ok(
    'v06-logging-010-estimate-size-cap-raw',
    big((f) => withLog(f, [mk('g1', { retentionDays: 30 })(f)])),
    ['W_LOG_SIZE_CAP'],
    {
      estimate: est(739860480, 739860480, 0, 4727808000, 157593600, 13, [
        eg(86400, 'exact', 739860480, 0, 4727808000, 0, 0),
      ]),
    },
  );
  ok(
    'v06-logging-010-estimate-100ms',
    big((f) => withLog(f, [mk('g1', { periodMs: 100, retentionDays: 7 })(f)])),
    ['W_LOG_WRITE_BUDGET', 'W_LOG_SIZE_CAP'],
    {
      estimate: est(3576545280, 3576545280, 0, 11031552000, 1575936000, 1, [
        eg(864000, 'exact', 3576545280, 0, 11031552000, 0, 0),
      ]),
    },
  );
  ok(
    'v06-logging-010-estimate-4x200-100ms',
    big((f) =>
      withLog(
        f,
        ['g1', 'g2', 'g3', 'g4'].map((id) => mk(id, { periodMs: 100, retentionDays: 7 })(f)),
      ),
    ),
    ['W_LOG_WRITE_BUDGET', 'W_LOG_WRITE_EXTREME', 'W_LOG_SIZE_CAP'],
    {
      estimate: est(
        14306181120,
        14306181120,
        0,
        44126208000,
        6303744000,
        0,
        Array.from({ length: 4 }, () => eg(864000, 'exact', 3576545280, 0, 11031552000, 0, 0)),
      ),
    },
  );
  // Cảnh báo theo tên của contract §6 (cùng cấu hình với ước tính tương ứng, kèm số)
  ok(
    'v06-logging-010-warn-budget-4x200',
    big((f) =>
      withLog(
        f,
        ['g1', 'g2', 'g3', 'g4'].map((id) =>
          mk(id, { aggregates: { minuteRetentionDays: 1, hourRetentionDays: 1 } })(f),
        ),
      ),
    ),
    ['W_LOG_WRITE_BUDGET'],
  );
  ok(
    'v06-logging-010-warn-extreme',
    big((f) =>
      withLog(
        f,
        ['g1', 'g2', 'g3', 'g4'].map((id) => mk(id, { periodMs: 100, retentionDays: 7 })(f)),
      ),
    ),
    ['W_LOG_WRITE_BUDGET', 'W_LOG_WRITE_EXTREME', 'W_LOG_SIZE_CAP'],
  );
  ok(
    'v06-logging-010-warn-size-cap-agg',
    (f) => {
      const tags = floatTags(f, 60);
      withLog(f, [
        {
          id: 'luu-dai',
          name: 'Lưu dài',
          mode: 'cyclic',
          periodMs: 60000,
          retentionDays: 1,
          aggregates: { minuteRetentionDays: 365, hourRetentionDays: 3650 },
          tags,
        },
      ]);
    },
    ['W_LOG_SIZE_CAP'],
    {
      // 60 Tag: rowBytes 564, 1.440 dòng/ngày; tổng hợp 60 x (1.440x365 + 24x3.650) x 64
      estimate: est(53879040, 37013760, 16865280, 2355500160, 6433920, 333, [
        {
          rowsPerDay: 1440,
          basis: 'exact',
          rowBytes: 564,
          rawWrite: 37013760,
          aggWrite: 16865280,
          rawStorage: 812160,
          aggStorage: 2354688000,
          aggTags: 60,
        },
      ]),
    },
  );
  // 0.1 và các nhóm cũ: một nhóm cyclic nhỏ không có cảnh báo
  ok('v06-logging-010-estimate-small-no-warning', (f) => withLog(f, [LOG().groups[0]]));

  // ================= reports.json =================
  const logWithAgg = () => ({
    schemaVersion: V06,
    timeZone: '+07:00',
    groups: [
      {
        id: 'dien',
        name: 'Điện',
        mode: 'cyclic',
        periodMs: 60000,
        retentionDays: 30,
        aggregates: {},
        tags: [
          { tagId: 'METER1.P' },
          { tagId: 'TANK01.LEVEL' },
          { tagId: 'PUMP01.RUN_CMD' },
          { tagId: 'PUMP01.NAME', maxLength: 16 },
          { tagId: 'TANK01.SP', aggregate: false },
        ],
      },
      {
        id: 'thuong',
        name: 'Thường',
        mode: 'cyclic',
        periodMs: 60000,
        retentionDays: 30,
        tags: [{ tagId: 'METER1.P' }],
      },
    ],
  });
  const REPORTS = () => ({
    schemaVersion: V06,
    reports: [
      {
        id: 'dien-ca',
        name: 'Điện năng theo ca',
        group: 'dien',
        period: 'shift',
        shifts: { count: 3, start: '06:00' },
        title: 'BÁO CÁO ĐIỆN NĂNG THEO CA',
        footer: 'Phòng Kỹ thuật',
        paper: { size: 'A4', orientation: 'landscape' },
        totals: true,
        columns: [
          {
            tagId: 'METER1.P',
            label: 'Công suất',
            unit: 'kW',
            decimals: 1,
            functions: ['avg', 'max', 'sum'],
          },
          {
            tagId: 'PUMP01.RUN_CMD',
            label: 'Bơm chạy',
            unit: 'giờ',
            decimals: 2,
            functions: ['sum'],
          },
        ],
      },
    ],
  });
  const withReports = (f, mutate) => {
    f[PJ].loggingFile = L;
    f[L] = logWithAgg();
    f[PJ].reportsFile = R;
    f[R] = REPORTS();
    if (mutate) mutate(f[R].reports[0], f[R], f);
  };
  const rptAt = (code, path) => at(code, path, R);

  ok('v06-report-valid-shift', (f) => withReports(f));
  ok('v06-report-valid-day', (f) =>
    withReports(f, (r) => {
      r.id = 'dien-ngay';
      r.period = 'day';
      r.rowMinutes = 30;
      delete r.shifts;
    }),
  );
  ok('v06-report-valid-month', (f) =>
    withReports(f, (r) => {
      r.id = 'dien-thang';
      r.period = 'month';
      delete r.shifts;
      delete r.paper;
    }),
  );
  ok('v06-report-valid-minimal', (f) =>
    withReports(f, (r, doc) => {
      doc.reports[0] = {
        id: 'toi-thieu',
        name: 'Tối thiểu',
        group: 'dien',
        period: 'day',
        columns: [{ tagId: 'METER1.P', functions: ['avg'] }],
      };
    }),
  );
  ok('v06-report-valid-count-24-columns', (f) =>
    withReports(f, (r) => {
      r.columns = Array.from({ length: 8 }, () => ({
        tagId: 'METER1.P',
        functions: ['min', 'max', 'avg'],
      }));
    }),
  );
  ok('v06-report-valid-16-reports', (f) =>
    withReports(f, (r, doc) => {
      doc.reports = Array.from({ length: 16 }, (_, i) => ({ ...clone(r), id: `mau-${i + 1}` }));
    }),
  );
  ok('v06-report-valid-nav-report', (f) => {
    withReports(f);
    f[PJ].navigation.items.push({ label: 'Báo cáo điện năng', report: 'dien-ca', icon: 'doc' });
  });
  ok('v06-report-valid-no-navigation', (f) => {
    withReports(f);
    delete f[PJ].navigation;
  });
  ok('v06-report-valid-nav-group-report', (f) => {
    withReports(f);
    f[PJ].navigation.items.push({
      label: 'Báo cáo',
      icon: 'list',
      items: [{ label: 'Điện năng', report: 'dien-ca' }],
    });
  });

  bad(
    'v06-report-invalid-dup-id',
    (f) =>
      withReports(f, (r, doc) => {
        doc.reports.push(clone(r));
      }),
    ['E_RPT_DUP_ID'],
    [],
    iss(rptAt('E_RPT_DUP_ID', '/reports/1/id')),
  );
  bad(
    'v06-report-invalid-ref-group',
    (f) =>
      withReports(f, (r) => {
        r.group = 'khong-co';
      }),
    ['E_RPT_REF_GROUP'],
    [],
    iss(rptAt('E_RPT_REF_GROUP', '/reports/0/group')),
  );
  bad(
    'v06-report-invalid-ref-group-no-logging-file',
    (f) => {
      withReports(f);
      delete f[PJ].loggingFile;
      delete f[L];
    },
    ['E_RPT_REF_GROUP'],
    [],
    iss(rptAt('E_RPT_REF_GROUP', '/reports/0/group')),
  );
  bad(
    'v06-report-invalid-ref-tag',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].tagId = 'METER1.KHONG_CO';
      }),
    ['E_RPT_REF_TAG'],
    [],
    iss(rptAt('E_RPT_REF_TAG', '/reports/0/columns/0/tagId')),
  );
  bad(
    'v06-report-invalid-ref-tag-not-in-group',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].tagId = 'PUMP01.STATE'; // có trong tags.json nhưng không thuộc nhóm
      }),
    ['E_RPT_REF_TAG'],
    [],
    iss(rptAt('E_RPT_REF_TAG', '/reports/0/columns/0/tagId')),
  );
  bad(
    'v06-report-invalid-no-agg-group',
    (f) =>
      withReports(f, (r) => {
        r.group = 'thuong';
      }),
    ['E_RPT_NO_AGG'],
    [],
    iss(rptAt('E_RPT_NO_AGG', '/reports/0/group')),
  );
  bad(
    'v06-report-invalid-no-agg-tag-false',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].tagId = 'TANK01.SP';
      }),
    ['E_RPT_NO_AGG'],
    [],
    iss(rptAt('E_RPT_NO_AGG', '/reports/0/columns/0/tagId')),
  );
  bad(
    'v06-report-invalid-no-agg-tag-string',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].tagId = 'PUMP01.NAME';
      }),
    ['E_RPT_NO_AGG'],
    [],
    iss(rptAt('E_RPT_NO_AGG', '/reports/0/columns/0/tagId')),
  );
  bad(
    'v06-report-invalid-period-shifts-on-day',
    (f) =>
      withReports(f, (r) => {
        r.period = 'day';
      }),
    ['E_RPT_PERIOD'],
    [],
    iss(rptAt('E_RPT_PERIOD', '/reports/0')),
  );
  bad(
    'v06-report-invalid-period-shift-no-shifts',
    (f) =>
      withReports(f, (r) => {
        delete r.shifts;
      }),
    ['E_RPT_PERIOD'],
    [],
    iss(rptAt('E_RPT_PERIOD', '/reports/0')),
  );
  bad(
    'v06-report-invalid-period-rowminutes-on-month',
    (f) =>
      withReports(f, (r) => {
        r.period = 'month';
        delete r.shifts;
        r.rowMinutes = 60;
      }),
    ['E_RPT_PERIOD'],
    [],
    iss(rptAt('E_RPT_PERIOD', '/reports/0')),
  );
  bad(
    'v06-report-invalid-shift-count',
    (f) =>
      withReports(f, (r) => {
        r.shifts.count = 5;
      }),
    ['E_RPT_SHIFT'],
    [],
    iss(rptAt('E_RPT_SHIFT', '/reports/0/shifts')),
  );
  bad(
    'v06-report-invalid-shift-start',
    (f) =>
      withReports(f, (r) => {
        r.shifts.start = '25:00';
      }),
    ['E_RPT_SHIFT'],
    [],
    iss(rptAt('E_RPT_SHIFT', '/reports/0/shifts')),
  );
  bad(
    'v06-report-invalid-fn-dup',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].functions = ['avg', 'max', 'avg'];
      }),
    ['E_RPT_FN'],
    [],
    iss(rptAt('E_RPT_FN', '/reports/0/columns/0/functions/2')),
  );
  bad(
    'v06-report-invalid-limit-columns',
    (f) =>
      withReports(f, (r) => {
        r.columns = Array.from({ length: 9 }, () => ({
          tagId: 'METER1.P',
          functions: ['min', 'max', 'avg'],
        })); // 27 cột (Tag x hàm)
      }),
    ['E_RPT_LIMIT'],
    [],
    iss(rptAt('E_RPT_LIMIT', '/reports/0/columns')),
  );
  bad(
    'v06-report-invalid-nav-report',
    (f) => {
      withReports(f);
      f[PJ].navigation.items.push({ label: 'Báo cáo', report: 'khong-co' });
    },
    ['E_NAV_REPORT'],
    [],
    { issues: [at('E_NAV_REPORT', '/navigation/items/1/report', PJ)] },
  );
  bad(
    'v06-report-invalid-nav-report-no-file',
    (f) => {
      f[PJ].navigation.items.push({ label: 'Báo cáo', report: 'dien-ca' });
    },
    ['E_NAV_REPORT'],
    [],
    { issues: [at('E_NAV_REPORT', '/navigation/items/1/report', PJ)] },
  );
  bad(
    'v06-report-invalid-nav-both',
    (f) => {
      withReports(f);
      f[PJ].navigation.items.push({ label: 'Cả hai', screen: 'main', report: 'dien-ca' });
    },
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-nav-leaf-neither',
    (f) => {
      withReports(f);
      f[PJ].navigation.items.push({ label: 'Trống', icon: 'home' });
    },
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-path',
    (f) => {
      withReports(f);
      f[PJ].reportsFile = '../reports.json';
    },
    ['E_PATH'],
    [],
    { issues: [at('E_PATH', '/reportsFile', PJ)] },
  );
  bad(
    'v06-report-invalid-file-missing',
    (f) => {
      withReports(f);
      delete f[R];
    },
    ['E_FILE_MISSING'],
    [],
  );
  bad(
    'v06-report-invalid-schema-column-no-functions',
    (f) =>
      withReports(f, (r) => {
        delete r.columns[0].functions;
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-function-name',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].functions = ['median'];
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-period',
    (f) =>
      withReports(f, (r) => {
        r.period = 'week';
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-decimals',
    (f) =>
      withReports(f, (r) => {
        r.columns[0].decimals = 7;
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-id',
    (f) =>
      withReports(f, (r) => {
        r.id = 'Dien Ca';
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-17-reports',
    (f) =>
      withReports(f, (r, doc) => {
        doc.reports = Array.from({ length: 17 }, (_, i) => ({ ...clone(r), id: `mau-${i + 1}` }));
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-key',
    (f) =>
      withReports(f, (r) => {
        r.khong_co = 1;
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-schema-paper',
    (f) =>
      withReports(f, (r) => {
        r.paper = { size: 'A5', orientation: 'landscape' };
      }),
    ['E_SCHEMA'],
  );
  bad(
    'v06-report-invalid-version',
    (f) => {
      withReports(f);
      f[R].schemaVersion = '0.3.0';
    },
    ['E_SCHEMA_VERSION'],
    [],
    { issues: [at('E_SCHEMA_VERSION', '/schemaVersion', R)] },
  );
  bad(
    'v06-report-invalid-json',
    (f) => {
      withReports(f);
      f[R] = '{ "schemaVersion": ';
    },
    ['E_JSON'],
  );

  // ================= Định dạng 0.6 chung =================
  ok('v06-valid-full', () => {});
  bad(
    'v06-invalid-runtime-too-old',
    (f) => (f[PJ].minRuntimeVersion = '0.10.0'),
    ['E_RUNTIME_TOO_OLD'],
    [],
    { issues: [at('E_RUNTIME_TOO_OLD', '/minRuntimeVersion', PJ)] },
  );
  bad(
    'v06-invalid-min-runtime',
    (f) => (f[PJ].minRuntimeVersion = '0.8.0'),
    ['E_MIN_RUNTIME'],
    [],
    { issues: [at('E_MIN_RUNTIME', '/minRuntimeVersion', PJ)] },
  );
  bad('v06-invalid-version-tags-mixed', (f) => (f[TAGS].schemaVersion = '0.3.0'), [
    'E_SCHEMA_VERSION',
  ]);
  return C;
}

/** Ca 0.1 (base() của generate.mjs): logging 0.1 giữ kết luận, trường mới của 010 bị từ chối. */
export function cases01(LOG01, withLogging) {
  return [
    ['logging-010-valid-v01-unchanged', (f) => withLogging(f), [], []],
    [
      'logging-010-invalid-v01-new-field',
      (f) => {
        const cfg = withLogging(f, LOG01());
        cfg.groups[0].trigger = { tagId: 'T.RUN', edge: 'rising' };
      },
      ['E_SCHEMA'],
    ],
  ];
}
