// Ca `history-*` (và `valid-history-*`) của bộ vector danh mục widget (feature 010, T076; contracts/widget-catalog-010.md).
// Khác các ca 0.3: project 0.6.0 có `loggingFile`, nên mỗi ca có thêm `project.json` và `logging.json` (README.md).
// Được generate.mjs nạp: `historyCases()` trả các ca, generate.mjs ghi ra đĩa.

const pad = (i) => String(i).padStart(3, '0');
const W = (id, widget, extra = {}) => ({
  id,
  type: 'widget',
  widget,
  x: 10,
  y: 10,
  width: 640,
  height: 320,
  ...extra,
});
const E = (code, path) => ({ code, path });
const e0 = (code, sub = '') => E(code, `/items/0${sub}`);
const mt = (n) => Array.from({ length: n }, (_, i) => `M.T${pad(i + 1)}`);

/** logging.json 0.6 chuẩn của các ca: ap-suat (onChange, tổng hợp, có Tag chuỗi và Tag aggregate:false), lon, raw. */
export const loggingFor = (version) => ({
  schemaVersion: version,
  timeZone: '+07:00',
  groups: [
    {
      id: 'ap-suat',
      name: 'Áp suất',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 30,
      aggregates: {},
      tags: [
        { tagId: 'L.LEVEL' },
        { tagId: 'L.FLAG' },
        { tagId: 'L.NAME', maxLength: 16 },
        { tagId: 'L.SP', aggregate: false },
        { tagId: 'L.INT' },
      ],
    },
    {
      id: 'lon',
      name: 'Nhóm lớn',
      mode: 'cyclic',
      periodMs: 60000,
      retentionDays: 30,
      aggregates: {},
      tags: [...mt(40).map((tagId) => ({ tagId })), { tagId: 'L.NAME', maxLength: 16 }],
    },
    {
      id: 'raw',
      name: 'Chỉ dòng thô',
      mode: 'cyclic',
      periodMs: 1000,
      retentionDays: 7,
      tags: [{ tagId: 'L.LEVEL' }, { tagId: 'L.FLAG' }, { tagId: 'L.NAME', maxLength: 16 }],
    },
  ],
});

export function historyCases() {
  const C = [];
  const add = (name, items, expect, o = {}) => C.push({ name, items, expect, ...o });
  const tr = (extra = {}, id = 't1') => W(id, 'history-trend', extra);
  const tb = (extra = {}, id = 'tb1') => W(id, 'history-table', extra);
  const br = (extra = {}, id = 'b1') => W(id, 'history-bar', { width: 480, height: 280, ...extra });
  const pi = (extra = {}, id = 'p1') => W(id, 'history-pie', { width: 320, height: 320, ...extra });
  const G = (group, rest = {}) => ({ group, ...rest });

  // ================= Hợp lệ: cận dưới / cận trên của từng widget =================
  add(
    'valid-history-trend-lower',
    [tr({ props: G('ap-suat'), tags: { series: ['L.LEVEL'] } })],
    [],
  );
  add(
    'valid-history-trend-upper',
    [
      tr({
        x: 0,
        y: 0,
        width: 1200,
        height: 700,
        props: G('lon', {
          range: '30d',
          follow: false,
          controls: false,
          legend: false,
          grid: false,
          showBand: false,
          step: 'off',
          labels: Array.from({ length: 8 }, () => 'ằ'.repeat(40)),
          axes: Array.from({ length: 8 }, (_, i) => (i % 2 ? 'right' : 'left')),
          yMin: -1000,
          yMax: 1000,
        }),
        tags: { series: mt(8) },
      }),
    ],
    [],
  );
  add(
    'valid-history-table-lower',
    [tb({ props: G('ap-suat', { pageSize: 10 }), tags: { columns: ['L.LEVEL'] } })],
    [],
  );
  add(
    'valid-history-table-upper',
    [
      tb({
        x: 0,
        y: 0,
        width: 1200,
        height: 700,
        props: G('lon', {
          range: 'yesterday',
          pageSize: 500,
          order: 'asc',
          controls: false,
          labels: Array.from({ length: 32 }, () => 'ằ'.repeat(40)),
        }),
        tags: { columns: mt(32) },
      }),
    ],
    [],
  );
  add(
    'valid-history-bar-lower',
    [
      br({
        props: G('ap-suat', {
          fn: 'sum',
          bucket: 'hour',
          period: 'last24h',
          shiftCount: 2,
          shiftStart: '00:00',
          decimals: 0,
          showValues: false,
          refreshSec: 30,
        }),
        tags: { series: ['L.LEVEL'] },
      }),
    ],
    [],
  );
  add(
    'valid-history-bar-upper',
    [
      br({
        x: 0,
        y: 0,
        width: 1200,
        height: 700,
        props: G('lon', {
          fn: 'count',
          bucket: 'day',
          period: 'lastMonth',
          shiftCount: 12,
          shiftStart: '23:59',
          decimals: 6,
          showValues: true,
          labels: Array.from({ length: 4 }, () => 'ằ'.repeat(40)),
          refreshSec: 3600,
        }),
        tags: { series: mt(4) },
      }),
    ],
    [],
  );
  add(
    'valid-history-pie-lower',
    [
      pi({
        props: G('ap-suat', {
          fn: 'sum',
          period: 'today',
          shiftCount: 2,
          shiftStart: '00:00',
          donut: false,
          decimals: 0,
          showPercent: false,
          showTotal: false,
          refreshSec: 30,
        }),
        tags: { series: ['L.LEVEL'] },
      }),
    ],
    [],
  );
  add(
    'valid-history-pie-upper',
    [
      pi({
        x: 0,
        y: 0,
        width: 700,
        height: 700,
        props: G('lon', {
          fn: 'avg',
          period: 'lastMonth',
          shiftCount: 12,
          shiftStart: '23:59',
          donut: true,
          decimals: 6,
          showPercent: true,
          showTotal: true,
          labels: Array.from({ length: 8 }, () => 'ằ'.repeat(40)),
          refreshSec: 3600,
        }),
        tags: { series: mt(8) },
      }),
    ],
    [],
  );

  // ================= Hợp lệ khác =================
  add(
    'history-valid-trend-group-no-aggregates',
    [tr({ props: G('raw'), tags: { series: ['L.LEVEL', 'L.FLAG'] } })],
    [],
  );
  add(
    'history-valid-trend-bool-series',
    [tr({ props: G('ap-suat'), tags: { series: ['L.FLAG'] } })],
    [],
  );
  add(
    'history-valid-trend-yminmax',
    [tr({ props: G('ap-suat', { yMin: 0, yMax: 100 }), tags: { series: ['L.LEVEL', 'L.INT'] } })],
    [],
  );
  add(
    'history-valid-trend-tag-aggregate-false',
    // chỉ biểu đồ: Tag aggregate:false vẫn có dòng thô, nên hợp lệ
    [tr({ props: G('ap-suat'), tags: { series: ['L.SP'] } })],
    [],
  );
  add(
    'history-valid-table-string-tag',
    [tb({ props: G('ap-suat'), tags: { columns: ['L.NAME', 'L.LEVEL', 'L.FLAG'] } })],
    [],
  );
  add(
    'history-valid-table-group-no-aggregates',
    [tb({ props: G('raw'), tags: { columns: ['L.LEVEL', 'L.NAME'] } })],
    [],
  );
  add(
    'history-valid-bar-defaults',
    [br({ props: G('ap-suat'), tags: { series: ['L.LEVEL'] } })],
    [],
  );
  add(
    'history-valid-pie-defaults',
    [pi({ props: G('ap-suat'), tags: { series: ['L.LEVEL', 'L.FLAG'] } })],
    [],
  );
  const barOk = (name, props) =>
    add(
      `history-valid-bar-${name}`,
      [br({ props: G('ap-suat', props), tags: { series: ['L.LEVEL'] } })],
      [],
    );
  barOk('hour-today', { bucket: 'hour', period: 'today' });
  barOk('hour-yesterday', { bucket: 'hour', period: 'yesterday' });
  barOk('day-last7d', { bucket: 'day', period: 'last7d' });
  barOk('day-last30d', { bucket: 'day', period: 'last30d' });
  barOk('day-thismonth', { bucket: 'day', period: 'thisMonth' });
  barOk('shift-thisshift', { bucket: 'shift', period: 'thisShift' });
  barOk('shift-lastshift', { bucket: 'shift', period: 'lastShift' });
  barOk('shift-last24h', { bucket: 'shift', period: 'last24h' });
  barOk('shift-yesterday-12', { bucket: 'shift', period: 'yesterday', shiftCount: 12 });
  barOk('shift-last7d-6', { bucket: 'shift', period: 'last7d', shiftCount: 6 }); // 6 x 7 = 42 <= 48
  barOk('shift-last7d-4-start-2200', {
    bucket: 'shift',
    period: 'last7d',
    shiftCount: 4,
    shiftStart: '22:00',
  });
  barOk('fn-each', { fn: 'avg' });
  add(
    'history-valid-bar-bool-series',
    [
      br({
        props: G('ap-suat', { fn: 'sum', bucket: 'hour', period: 'today' }),
        tags: { series: ['L.FLAG'] },
      }),
    ],
    [],
  );
  for (const period of [
    'last24h',
    'last7d',
    'last30d',
    'today',
    'yesterday',
    'thisShift',
    'lastShift',
    'thisMonth',
    'lastMonth',
  ])
    add(
      `history-valid-pie-period-${period}`,
      [pi({ props: G('ap-suat', { period }), tags: { series: ['L.LEVEL'] } })],
      [],
    );
  add(
    'history-valid-four-widgets',
    [
      tr({ props: G('ap-suat'), tags: { series: ['L.LEVEL', 'L.FLAG'] } }, 't1'),
      tb({ y: 340, props: G('raw'), tags: { columns: ['L.LEVEL'] } }, 'tb1'),
      br({ x: 700, y: 10, props: G('lon'), tags: { series: mt(2) } }, 'b1'),
      pi({ x: 700, y: 320, props: G('lon'), tags: { series: mt(3) } }, 'p1'),
    ],
    [],
  );

  // ================= E_WIDGET_HISTORY_GROUP =================
  add(
    'history-invalid-group-unknown',
    [tr({ props: G('khong-co'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props/group')],
  );
  add(
    'history-invalid-group-missing',
    [tr({ tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props')],
  );
  add(
    'history-invalid-group-case',
    [tb({ props: G('Ap-Suat'), tags: { columns: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props/group')],
  );
  add(
    'history-invalid-group-unknown-bar',
    [br({ props: G('khong-co'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props/group')],
  );
  add(
    'history-invalid-group-unknown-pie',
    [pi({ props: G('khong-co'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props/group')],
  );
  add(
    'history-invalid-group-no-logging-file',
    [tr({ props: G('ap-suat'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props/group')],
    { noLogging: true },
  );
  add(
    'history-invalid-group-not-string',
    [tr({ props: G(5), tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_PROP', '/props/group')],
  );
  add(
    'history-invalid-group-unknown-skips-tag-checks',
    // nhóm không tra được: chỉ báo nhóm, không báo Tag
    [tr({ props: G('khong-co'), tags: { series: ['L.SIM', 'L.CALC'] } })],
    [e0('E_WIDGET_HISTORY_GROUP', '/props/group')],
  );

  // ================= E_WIDGET_HISTORY_TAG =================
  add(
    'history-invalid-tag-not-in-group',
    [tr({ props: G('ap-suat'), tags: { series: ['L.SIM'] } })],
    [e0('E_WIDGET_HISTORY_TAG', '/tags/series/0')],
  );
  add(
    'history-invalid-tag-mixed',
    [tr({ props: G('ap-suat'), tags: { series: ['L.LEVEL', 'M.T001', 'L.FLAG'] } })],
    [e0('E_WIDGET_HISTORY_TAG', '/tags/series/1')],
  );
  add(
    'history-invalid-tag-table-other-group',
    [tb({ props: G('ap-suat'), tags: { columns: ['L.LEVEL', 'M.T002', 'M.T003'] } })],
    [e0('E_WIDGET_HISTORY_TAG', '/tags/columns/1'), e0('E_WIDGET_HISTORY_TAG', '/tags/columns/2')],
  );
  add(
    'history-invalid-tag-bar-not-in-group',
    // Tag ngoài nhóm: chỉ báo thành viên nhóm, không báo thêm AGG (nhóm raw cũng không có tổng hợp)
    [br({ props: G('raw'), tags: { series: ['L.SIM'] } })],
    [e0('E_WIDGET_HISTORY_TAG', '/tags/series/0')],
  );

  // ================= E_WIDGET_HISTORY_AGG =================
  add(
    'history-invalid-agg-group-no-aggregates-bar',
    [br({ props: G('raw'), tags: { series: ['L.LEVEL', 'L.FLAG'] } })],
    [e0('E_WIDGET_HISTORY_AGG', '/tags/series/0'), e0('E_WIDGET_HISTORY_AGG', '/tags/series/1')],
  );
  add(
    'history-invalid-agg-group-no-aggregates-pie',
    [pi({ props: G('raw'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_WIDGET_HISTORY_AGG', '/tags/series/0')],
  );
  add(
    'history-invalid-agg-tag-false-pie',
    [pi({ props: G('ap-suat'), tags: { series: ['L.LEVEL', 'L.SP'] } })],
    [e0('E_WIDGET_HISTORY_AGG', '/tags/series/1')],
  );
  add(
    'history-invalid-agg-tag-false-bar',
    [br({ props: G('ap-suat'), tags: { series: ['L.SP'] } })],
    [e0('E_WIDGET_HISTORY_AGG', '/tags/series/0')],
  );

  // ================= Kiểu Tag, tham chiếu, khe =================
  add(
    'history-invalid-trend-string-tag',
    [tr({ props: G('ap-suat'), tags: { series: ['L.NAME'] } })],
    [e0('E_WIDGET_TAG_TYPE', '/tags/series/0')],
  );
  add(
    'history-invalid-bar-string-tag',
    // chỉ báo kiểu; không báo thêm E_WIDGET_HISTORY_AGG cho cùng Tag
    [br({ props: G('ap-suat'), tags: { series: ['L.NAME'] } })],
    [e0('E_WIDGET_TAG_TYPE', '/tags/series/0')],
  );
  add(
    'history-invalid-pie-string-tag',
    [pi({ props: G('ap-suat'), tags: { series: ['L.LEVEL', 'L.NAME'] } })],
    [e0('E_WIDGET_TAG_TYPE', '/tags/series/1')],
  );
  add(
    'history-invalid-ref-tag',
    // Tag không có trong tags.json: chỉ E_REF_TAG, không báo thêm nhóm
    [tr({ props: G('ap-suat'), tags: { series: ['KHONG.CO'] } })],
    [e0('E_REF_TAG', '/tags/series/0')],
  );
  add(
    'history-invalid-slot-missing',
    [tr({ props: G('ap-suat') })],
    [e0('E_WIDGET_SLOT', '/tags')],
  );
  add(
    'history-invalid-slot-empty',
    [tb({ props: G('ap-suat'), tags: { columns: [] } })],
    [e0('E_WIDGET_SLOT', '/tags/columns')],
  );
  add(
    'history-invalid-slot-dup',
    [tr({ props: G('ap-suat'), tags: { series: ['L.LEVEL', 'L.FLAG', 'L.LEVEL'] } })],
    [e0('E_WIDGET_SLOT', '/tags/series/2')],
  );
  add(
    'history-invalid-slot-string',
    [tr({ props: G('ap-suat'), tags: { series: 'L.LEVEL' } })],
    [e0('E_WIDGET_SLOT', '/tags/series')],
  );
  add(
    'history-invalid-slot-unknown',
    [tr({ props: G('ap-suat'), tags: { series: ['L.LEVEL'], target: 'L.CMD' } })],
    [e0('E_WIDGET_SLOT', '/tags/target')],
  );
  const lim = (name, widget, slot, n, group) =>
    add(
      `history-invalid-limit-${name}`,
      [widget({ props: G(group), tags: { [slot]: mt(n) } })],
      [e0('E_LIMIT', `/tags/${slot}`)],
    );
  lim('trend-9', tr, 'series', 9, 'lon');
  lim('table-33', tb, 'columns', 33, 'lon');
  lim('bar-5', br, 'series', 5, 'lon');
  lim('pie-9', pi, 'series', 9, 'lon');

  // ================= E_WIDGET_PROP: thuộc tính =================
  const prop = (name, widget, props, tagSlot, path, tagList = ['L.LEVEL'], group = 'ap-suat') =>
    add(
      `history-invalid-prop-${name}`,
      [widget({ props: G(group, props), tags: { [tagSlot]: tagList } })],
      [e0('E_WIDGET_PROP', `/props/${path}`)],
    );
  prop('range-enum', tr, { range: '2h' }, 'series', 'range');
  prop('range-enum-table', tb, { range: 'last24h' }, 'columns', 'range');
  prop('step-enum', tr, { step: 'maybe' }, 'series', 'step');
  prop('follow-not-bool', tr, { follow: 'yes' }, 'series', 'follow');
  prop('legend-not-bool', tr, { legend: 1 }, 'series', 'legend');
  prop('axes-value', tr, { axes: ['top'] }, 'series', 'axes');
  prop('axes-too-many', tr, { axes: Array.from({ length: 9 }, () => 'left') }, 'series', 'axes');
  prop(
    'labels-too-many-trend',
    tr,
    { labels: Array.from({ length: 9 }, () => 'a') },
    'series',
    'labels',
  );
  prop('labels-too-long', tr, { labels: ['a'.repeat(41)] }, 'series', 'labels');
  prop('ymin-alone', tr, { yMin: 0 }, 'series', 'yMin');
  prop('ymax-alone', tr, { yMax: 10 }, 'series', 'yMax');
  prop('ymin-ge-ymax', tr, { yMin: 5, yMax: 5 }, 'series', 'yMax');
  prop('ymin-not-number', tr, { yMin: 'a', yMax: 5 }, 'series', 'yMin');
  prop('unknown', tr, { colour: 'red' }, 'series', 'colour');
  prop('pagesize-9', tb, { pageSize: 9 }, 'columns', 'pageSize');
  prop('pagesize-501', tb, { pageSize: 501 }, 'columns', 'pageSize');
  prop('pagesize-fraction', tb, { pageSize: 10.5 }, 'columns', 'pageSize');
  prop('order-enum', tb, { order: 'random' }, 'columns', 'order');
  prop(
    'labels-too-many-table',
    tb,
    { labels: Array.from({ length: 33 }, () => 'a') },
    'columns',
    'labels',
    ['M.T001'],
    'lon',
  );
  prop('fn-enum-bar', br, { fn: 'median' }, 'series', 'fn');
  prop('fn-pie-min', pi, { fn: 'min' }, 'series', 'fn');
  prop('fn-pie-count', pi, { fn: 'count' }, 'series', 'fn');
  prop('bucket-enum', br, { bucket: 'week' }, 'series', 'bucket');
  prop('period-enum-bar', br, { period: 'lastWeek' }, 'series', 'period');
  prop('period-enum-pie', pi, { period: 'lastWeek' }, 'series', 'period');
  prop('shiftcount-5', br, { shiftCount: 5 }, 'series', 'shiftCount');
  prop('shiftcount-13', pi, { shiftCount: 13 }, 'series', 'shiftCount');
  prop('shiftcount-fraction', pi, { shiftCount: 3.5 }, 'series', 'shiftCount');
  prop('shiftstart-25', br, { shiftStart: '25:00' }, 'series', 'shiftStart');
  prop('shiftstart-format', pi, { shiftStart: '6:00' }, 'series', 'shiftStart');
  prop('shiftstart-minute', br, { shiftStart: '06:60' }, 'series', 'shiftStart');
  prop('decimals-7', br, { decimals: 7 }, 'series', 'decimals');
  prop('decimals-negative', pi, { decimals: -1 }, 'series', 'decimals');
  prop('refreshsec-29', br, { refreshSec: 29 }, 'series', 'refreshSec');
  prop('refreshsec-3601', pi, { refreshSec: 3601 }, 'series', 'refreshSec');
  prop('labels-too-many-bar', br, { labels: ['a', 'b', 'c', 'd', 'e'] }, 'series', 'labels');
  prop(
    'labels-too-many-pie',
    pi,
    { labels: Array.from({ length: 9 }, () => 'a') },
    'series',
    'labels',
  );
  prop('donut-not-bool', pi, { donut: 'yes' }, 'series', 'donut');
  prop('showvalues-not-bool', br, { showValues: 1 }, 'series', 'showValues');

  // ================= E_WIDGET_PROP: tổ hợp bucket / period (§2.1) =================
  const combo = (name, props) =>
    add(
      `history-invalid-combo-${name}`,
      [br({ props: G('ap-suat', props), tags: { series: ['L.LEVEL'] } })],
      [e0('E_WIDGET_PROP', '/props/period')],
    );
  combo('hour-last7d', { bucket: 'hour', period: 'last7d' });
  combo('hour-last30d', { bucket: 'hour', period: 'last30d' });
  combo('hour-thisshift', { bucket: 'hour', period: 'thisShift' });
  combo('hour-lastshift', { bucket: 'hour', period: 'lastShift' });
  combo('hour-thismonth', { bucket: 'hour', period: 'thisMonth' });
  combo('day-last24h', { bucket: 'day', period: 'last24h' });
  combo('day-today', { bucket: 'day', period: 'today' });
  combo('day-yesterday', { bucket: 'day', period: 'yesterday' });
  combo('day-thisshift', { bucket: 'day', period: 'thisShift' });
  combo('day-lastshift', { bucket: 'day', period: 'lastShift' });
  combo('shift-last30d', { bucket: 'shift', period: 'last30d' });
  combo('shift-thismonth', { bucket: 'shift', period: 'thisMonth' });
  combo('shift-lastmonth', { bucket: 'shift', period: 'lastMonth' });
  combo('shift-12-last7d-84', { bucket: 'shift', period: 'last7d', shiftCount: 12 });
  combo('shift-8-last7d-56', { bucket: 'shift', period: 'last7d', shiftCount: 8 });
  combo('default-bucket-last30d', { period: 'last30d' }); // bucket mặc định shift

  // ================= Sự kiện, vai trò: widget lịch sử không có =================
  add(
    'history-invalid-events',
    [
      tr({
        props: G('ap-suat'),
        tags: { series: ['L.LEVEL'] },
        events: { click: { action: 'closePopup' } },
      }),
    ],
    [e0('E_WIDGET_PROP', '/events')],
  );
  add(
    'history-invalid-security',
    [
      tb({
        props: G('ap-suat'),
        tags: { columns: ['L.LEVEL'] },
        security: { minRole: 'operator' },
      }),
    ],
    [e0('E_WIDGET_PROP', '/security')],
  );
  add(
    'history-invalid-size-below-min',
    [tr({ width: 279, props: G('ap-suat'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_ITEM_SIZE', '/width')],
  );
  add(
    'history-invalid-size-pie-below-min',
    [pi({ width: 140, height: 139, props: G('ap-suat'), tags: { series: ['L.LEVEL'] } })],
    [e0('E_ITEM_SIZE', '/height')],
  );
  add(
    'history-valid-size-min',
    [
      tr({ width: 280, height: 160, props: G('ap-suat'), tags: { series: ['L.LEVEL'] } }, 't1'),
      pi(
        { x: 400, width: 140, height: 140, props: G('ap-suat'), tags: { series: ['L.LEVEL'] } },
        'p1',
      ),
      br(
        { x: 600, width: 200, height: 140, props: G('ap-suat'), tags: { series: ['L.LEVEL'] } },
        'b1',
      ),
    ],
    [],
  );
  return C;
}
