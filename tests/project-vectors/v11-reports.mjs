// Ca `v11-report-*` (feature 015, specs/015-reports/plan.md mục Hợp đồng; README-015.md): khóa mới của reports.json
// định dạng 1.1 (org, kind, week/range, tiles, chart, onTime/starts) và luật E_RPT_KIND. Kết quả viết tay.
const PJ = 'project.json';
const L = 'logging.json';
const R = 'reports.json';

/** logging.json có một nhóm tổng hợp: số (METER1.P), BOOL (PUMP01.RUN_CMD, PUMP01.FAULT), chuỗi. */
const LOG = (v) => ({
  schemaVersion: v,
  timeZone: '+07:00',
  groups: [
    {
      id: 'dien',
      name: 'Điện năng',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 30,
      aggregates: {},
      tags: [
        { tagId: 'METER1.P' },
        { tagId: 'PUMP01.RUN_CMD' },
        { tagId: 'PUMP01.FAULT' },
        { tagId: 'PUMP01.NAME', maxLength: 16 },
      ],
    },
  ],
});

const TABLE = () => ({
  id: 'dien-ngay',
  name: 'Điện năng theo ngày',
  group: 'dien',
  period: 'day',
  rowMinutes: 60,
  totals: true,
  columns: [
    { tagId: 'METER1.P', label: 'Công suất', unit: 'kW', decimals: 1, functions: ['avg', 'max'] },
  ],
});

/** Thêm logging.json và reports.json (một mẫu bảng kiểu 010) theo phiên bản của project. */
export function withReports(f, mutate) {
  const v = f[PJ].schemaVersion;
  f[PJ].loggingFile = L;
  f[L] = LOG(v);
  f[PJ].reportsFile = R;
  f[R] = { schemaVersion: v, reports: [TABLE()] };
  if (mutate) mutate(f[R].reports[0], f[R], f);
}

const at = (code, path, file = R) => ({ code, file, path });
const iss = (...issues) => ({ issues });

/**
 * `to10`: hạ project về 1.0 (như ca v11-version-*). Ca được thêm vào `cases11` (generate.mjs) nên base là base11().
 */
export function reportCases(ok, bad, to10) {
  // ---------- hợp lệ ----------
  ok('v11-report-valid-old-template', (f) => withReports(f));
  ok('v11-report-valid-kinds', (f) =>
    withReports(f, (r, doc) => {
      doc.org = 'Nhà máy nước Bình An';
      r.tiles = false;
      r.chart = 'bar';
      r.columns.push({
        tagId: 'PUMP01.RUN_CMD',
        label: 'Bơm chạy',
        unit: 'giờ',
        functions: ['onTime'],
      });
      doc.reports.push(
        {
          id: 'van-hanh-bom',
          name: 'Vận hành bơm',
          kind: 'equipment',
          group: 'dien',
          period: 'shift',
          shifts: { count: 3, start: '06:00' },
          columns: [
            { tagId: 'PUMP01.RUN_CMD', label: 'Bơm 1', functions: ['onTime', 'starts'] },
            { tagId: 'PUMP01.FAULT', functions: ['starts'] },
          ],
        },
        {
          id: 'alarm-ca',
          name: 'Alarm theo ca',
          kind: 'alarm',
          period: 'shift',
          shifts: { count: 2, start: '07:00' },
        },
        { id: 'logic-tuan', name: 'Logic theo tuần', kind: 'logic', period: 'week', chart: 'none' },
      );
    }),
  );
  ok('v11-report-valid-range-week', (f) =>
    withReports(f, (r, doc) => {
      r.period = 'range';
      delete r.rowMinutes;
      r.kind = 'table';
      doc.reports.push({ ...TABLE(), id: 'dien-tuan', period: 'week', rowMinutes: undefined });
      delete doc.reports[1].rowMinutes;
    }),
  );

  // ---------- khóa 1.1 ở project 1.0 ----------
  bad(
    'v11-report-version-kind-in-1.0',
    (f) => {
      to10(f);
      withReports(f, (r) => (r.kind = 'table'));
    },
    ['E_RPT_KIND'],
    undefined,
    { ...iss(at('E_RPT_KIND', '/reports/0/kind')), runtimeVersion: '1.0.0' },
  );
  bad(
    'v11-report-version-org-in-1.0',
    (f) => {
      to10(f);
      withReports(f, (_, doc) => (doc.org = 'Nhà máy'));
    },
    ['E_RPT_KIND'],
    undefined,
    { ...iss(at('E_RPT_KIND', '/org')), runtimeVersion: '1.0.0' },
  );
  bad(
    'v11-report-version-week-tiles-chart-in-1.0',
    (f) => {
      to10(f);
      withReports(f, (r) => {
        r.period = 'week';
        delete r.rowMinutes;
        r.tiles = true;
        r.chart = 'line';
      });
    },
    ['E_RPT_KIND'],
    undefined,
    {
      ...iss(
        at('E_RPT_KIND', '/reports/0/period'),
        at('E_RPT_KIND', '/reports/0/tiles'),
        at('E_RPT_KIND', '/reports/0/chart'),
      ),
      runtimeVersion: '1.0.0',
    },
  );
  bad(
    'v11-report-version-ontime-in-1.0',
    (f) => {
      to10(f);
      withReports(f, (r) =>
        r.columns.push({ tagId: 'PUMP01.RUN_CMD', functions: ['sum', 'onTime'] }),
      );
    },
    ['E_RPT_KIND'],
    undefined,
    { ...iss(at('E_RPT_KIND', '/reports/0/columns/1/functions/1')), runtimeVersion: '1.0.0' },
  );

  // ---------- loại báo cáo ----------
  bad(
    'v11-report-alarm-with-group-columns',
    (f) =>
      withReports(f, (r) => {
        r.kind = 'alarm';
      }),
    ['E_RPT_KIND'],
    undefined,
    iss(at('E_RPT_KIND', '/reports/0/group'), at('E_RPT_KIND', '/reports/0/columns')),
  );
  bad(
    'v11-report-logic-with-group',
    (f) =>
      withReports(f, (r) => {
        r.kind = 'logic';
        delete r.columns;
      }),
    ['E_RPT_KIND'],
    undefined,
    iss(at('E_RPT_KIND', '/reports/0/group')),
  );
  bad(
    'v11-report-equipment-numeric-tag',
    (f) =>
      withReports(f, (r) => {
        r.kind = 'equipment';
        r.columns = [
          { tagId: 'METER1.P', functions: ['onTime'] },
          { tagId: 'PUMP01.RUN_CMD', functions: ['starts', 'avg'] },
        ];
      }),
    ['E_RPT_KIND'],
    undefined,
    iss(
      at('E_RPT_KIND', '/reports/0/columns/0/tagId'),
      at('E_RPT_KIND', '/reports/0/columns/1/functions/1'),
    ),
  );
  bad(
    'v11-report-table-starts',
    (f) =>
      withReports(f, (r) =>
        r.columns.push({ tagId: 'PUMP01.RUN_CMD', functions: ['onTime', 'starts'] }),
      ),
    ['E_RPT_KIND'],
    undefined,
    iss(at('E_RPT_KIND', '/reports/0/columns/1/functions/1')),
  );
  bad(
    'v11-report-table-ontime-numeric',
    (f) => withReports(f, (r) => (r.columns[0].functions = ['avg', 'onTime'])),
    ['E_RPT_FN'],
    undefined,
    iss(at('E_RPT_FN', '/reports/0/columns/0/functions/1')),
  );
  bad(
    'v11-report-alarm-shifts-on-day',
    (f) =>
      withReports(f, (r, doc) => {
        doc.reports[0] = {
          id: 'alarm-ngay',
          name: 'Alarm',
          kind: 'alarm',
          period: 'day',
          shifts: { count: 3, start: '06:00' },
        };
      }),
    ['E_RPT_PERIOD'],
    undefined,
    iss(at('E_RPT_PERIOD', '/reports/0')),
  );

  // ---------- schema ----------
  bad('v11-report-schema-kind-unknown', (f) => withReports(f, (r) => (r.kind = 'chart')), [
    'E_SCHEMA',
  ]);
  bad('v11-report-schema-chart-unknown', (f) => withReports(f, (r) => (r.chart = 'pie')), [
    'E_SCHEMA',
  ]);
  bad('v11-report-schema-org-empty', (f) => withReports(f, (_, doc) => (doc.org = '')), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-report-schema-table-no-columns',
    (f) =>
      withReports(f, (r) => {
        r.kind = 'equipment';
        delete r.columns;
      }),
    ['E_SCHEMA'],
  );
  bad('v11-report-schema-no-group-no-kind', (f) => withReports(f, (r) => delete r.group), [
    'E_SCHEMA',
  ]);
}
