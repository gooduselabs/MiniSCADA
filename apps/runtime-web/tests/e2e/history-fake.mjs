// Phần lịch sử của runtime giả (feature 010, T090): project mẫu có màn hình biểu đồ lịch sử và API
// /api/v1/history/{catalog,series,aggregate,rows,export.csv} sinh dữ liệu tất định từ công thức (không DB).
// Chỉ đủ để kiểm giao diện (hàng đợi, trạng thái, con trỏ khớp dữ liệu); kiểm số với runtime thật ở tools/web-it.
import { TAGS as BASE_TAGS } from './fixture-project.mjs';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const TZ = 7 * HOUR;

const tag = (id, type, extra = {}) => ({ id, type, kind: 'external', access: 'R', ...extra });
export const HIST_TAGS = [
  tag('LINE1.PRESS', 'FLOAT32', { description: 'Áp suất đường 1', unit: 'bar' }),
  tag('LINE1.TEMP', 'FLOAT32', { description: 'Nhiệt độ đường 1', unit: '°C' }),
  tag('PUMP1.RUN', 'BOOL', { description: 'Bơm 1 chạy' }),
  tag('METER1.KW', 'FLOAT32', { description: 'Công suất', unit: 'kW' }),
  tag('METER1.KWH', 'FLOAT64', { description: 'Điện năng tích lũy', unit: 'kWh' }),
];
const ALL_TAGS = [...BASE_TAGS, ...HIST_TAGS];

/** Giá trị tất định của Tag tại thời điểm t (ms). */
export function valueAt(tagId, t) {
  switch (tagId) {
    case 'LINE1.PRESS':
      return (
        Math.round(
          (4 + 0.8 * Math.sin((t / HOUR) * (Math.PI / 3)) + 0.1 * Math.sin(t / MIN / 7)) * 100,
        ) / 100
      );
    case 'LINE1.TEMP':
      return Math.round((60 + 5 * Math.sin((t / HOUR) * (Math.PI / 6))) * 10) / 10;
    case 'PUMP1.RUN':
      return Math.floor(t / (2 * HOUR)) % 2 === 0 ? 1 : 0;
    case 'METER1.KW':
      return Math.round((50 + 10 * Math.sin((t / HOUR) * (Math.PI / 12))) * 10) / 10;
    case 'METER1.KWH': {
      // Bộ đếm tăng đơn điệu theo phút (T105, T113): 0,8 kWh/phút cộng dao động nhỏ, làm tròn 3 chữ số.
      const k = Math.floor(t / MIN) - 29_453_760; // phút kể từ 2026-01-01 (số vừa phải, như bộ đếm thật)
      return Math.round((12000 + k * 0.8 + 0.05 * Math.sin(k / 50)) * 1000) / 1000;
    }
    default:
      return null;
  }
}

const GROUPS = [
  {
    id: 'ap-suat',
    name: 'Áp suất',
    mode: 'onChange',
    tags: ['LINE1.PRESS', 'LINE1.TEMP', 'PUMP1.RUN'],
  },
  { id: 'dien', name: 'Điện năng', mode: 'cyclic', tags: ['METER1.KW', 'METER1.KWH'] },
];

const SCREEN_AP_SUAT = {
  schemaVersion: '0.3.0',
  id: 'ap-suat',
  name: 'Áp suất lịch sử',
  kind: 'screen',
  size: { width: 1100, height: 700 },
  items: [
    {
      type: 'widget',
      id: 'trend',
      widget: 'history-trend',
      x: 10,
      y: 10,
      width: 1080,
      height: 380,
      tags: { series: ['LINE1.PRESS', 'LINE1.TEMP', 'PUMP1.RUN'] },
      props: { group: 'ap-suat', range: '24h', follow: false },
    },
    {
      type: 'widget',
      id: 'table',
      widget: 'history-table',
      x: 10,
      y: 400,
      width: 1080,
      height: 290,
      tags: { columns: ['LINE1.PRESS', 'LINE1.TEMP', 'PUMP1.RUN'] },
      props: { group: 'ap-suat', range: '24h', pageSize: 50 },
    },
  ],
};

/** Project 0.3 như `GET /api/v1/projects/active` (tóm tắt) cho kịch bản lịch sử. */
export function historyProject() {
  const files = new Map();
  const file = 'screens/ap-suat.screen.json';
  files.set(file, { json: SCREEN_AP_SUAT });
  const navigation = {
    position: 'left',
    items: [{ label: 'Áp suất', screen: 'ap-suat', icon: 'chart' }],
  };
  return {
    active: {
      project: {
        format: 'matscada-project',
        schemaVersion: '0.3.0',
        projectId: 'history-e2e',
        projectName: 'Lịch sử e2e',
        projectVersion: '1.0.0',
        entryScreen: 'ap-suat',
        navigation,
      },
      tags: { schemaVersion: '0.3.0', tags: ALL_TAGS },
      valueTables: {},
      connections: [],
      navigation,
      screens: [{ id: 'ap-suat', name: SCREEN_AP_SUAT.name, kind: 'screen', file }],
      digest: 'sha256:e2e-history',
    },
    files,
  };
}

/** Bộ điều khiển dữ liệu lịch sử giả; `cfg` đổi được trong lúc chạy kịch bản. */
export function makeHistory(cfg = {}) {
  const state = {
    /** Số lần gọi từng endpoint. */
    calls: { catalog: 0, series: 0, aggregate: 0, rows: 0, export: 0 },
    /** Số yêu cầu đang chạy đồng thời lớn nhất đã thấy. */
    inflight: 0,
    maxInflight: 0,
    /** 429 BUSY cho N yêu cầu kế tiếp. */
    busyNext: 0,
    /** Độ trễ giả (ms) của series. */
    delayMs: 0,
    /** Khoảng runtime không chạy: [from, to) theo ms. */
    gaps: cfg.gaps ?? (() => []),
    /** Nhật ký truy vấn series (để đối chiếu). */
    seriesLog: [],
    ...cfg.state,
  };
  const now = () => Date.now();
  const gapsNow = () => state.gaps(now());
  const inGap = (t, gaps) => gaps.some(([a, b]) => t >= a && t < b);
  const group = (id) => GROUPS.find((g) => g.id === id);

  const bad = (res, error = 'BAD_REQUEST', status = 400, message = 'Tham số không hợp lệ') =>
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }) ||
    res.end(JSON.stringify({ error, message }));
  const ok = (res, body) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function catalogBody() {
    const n = now();
    return {
      apiVersion: '1.4.0',
      enabled: cfg.enabled !== false,
      state: 'running',
      limits: {
        maxTags: 16,
        maxRowsTags: 32,
        maxPoints: 5000,
        defaultMaxPoints: 1000,
        maxBuckets: 5000,
        maxRows: 500,
        maxExportRows: 500000,
        maxRangeDays: 3650,
        maxConcurrent: 2,
        timeoutMs: 10000,
        maxScanMiB: 64,
      },
      groups: GROUPS.map((g) => ({
        id: g.id,
        name: g.name,
        mode: g.mode,
        timeZone: '+07:00',
        periodMs: g.mode === 'cyclic' ? MIN : null,
        minIntervalMs: 1000,
        maxIntervalMs: g.mode === 'onChange' ? 60000 : null,
        raw: { from: n - 7 * DAY, to: n },
        aggregates: { minute: { from: n - 7 * DAY, to: n }, hour: { from: n - 7 * DAY, to: n } },
        tags: g.tags.map((id) => {
          const t = ALL_TAGS.find((x) => x.id === id);
          return {
            tagId: id,
            column: id.replace('.', '_'),
            type: t.type,
            unit: t.unit,
            aggregated: true,
            orphan: false,
          };
        }),
      })),
    };
  }

  /** Mẫu thô mỗi phút (bỏ khoảng đứt) trong [from, to). */
  function samples(from, to, gaps) {
    const out = [];
    for (let t = Math.ceil(from / MIN) * MIN; t < to; t += MIN) if (!inGap(t, gaps)) out.push(t);
    return out;
  }

  function parse(url, need) {
    const p = url.searchParams;
    const num = (k) => (/^-?\d{1,15}$/.test(p.get(k) ?? '') ? Number(p.get(k)) : null);
    const g = group(p.get('group') ?? '');
    const tags = (p.get('tags') ?? '').split(',').filter(Boolean);
    const from = num('from');
    const to = num('to');
    if (!g || from === null || to === null || from >= to) return null;
    if (need.tags && (tags.length < 1 || tags.length > 16 || tags.some((t) => !g.tags.includes(t))))
      return null;
    return { g, tags: tags.length ? tags : g.tags, from, to, p, num };
  }

  async function handle(req, res, path, url) {
    state.inflight++;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    try {
      if (cfg.enabled === false && path !== '/api/v1/history/catalog')
        return bad(res, 'NO_HISTORY', 404, 'Chưa bật lưu trữ');
      if (path !== '/api/v1/history/catalog' && state.busyNext > 0) {
        state.busyNext--;
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
        return res.end(JSON.stringify({ error: 'BUSY', message: 'Máy chủ đang bận' }));
      }
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      if (path === '/api/v1/history/catalog') {
        state.calls.catalog++;
        return ok(res, catalogBody());
      }
      if (path === '/api/v1/history/series') return series(res, url);
      if (path === '/api/v1/history/aggregate') return aggregate(res, url);
      if (path === '/api/v1/history/rows') return rows(res, url);
      if (path === '/api/v1/history/export.csv') return exportCsv(res, url);
      return bad(res, 'NOT_FOUND', 404, 'Không có');
    } finally {
      state.inflight--;
    }
  }

  function series(res, url) {
    state.calls.series++;
    const q = parse(url, { tags: true });
    if (!q) return bad(res);
    const maxPoints = Math.max(10, Math.min(5000, q.num('maxPoints') ?? 1000));
    state.seriesLog.push({ from: q.from, to: q.to, tags: q.tags, maxPoints });
    const gaps = gapsNow().filter(([a, b]) => b > q.from && a < q.to);
    const span = q.to - q.from;
    const aggregated = span > 6 * HOUR;
    const step = Math.max(MIN, Math.ceil(span / Math.floor(maxPoints / 2) / MIN) * MIN);
    const ts = [];
    for (let t = Math.ceil(q.from / step) * step; t < q.to; t += step) {
      if (!inGap(t, gaps)) ts.push(t);
    }
    return ok(res, {
      apiVersion: '1.4.0',
      group: q.g.id,
      timeZone: '+07:00',
      from: q.from,
      to: q.to,
      res: aggregated ? '1m' : 'raw',
      reduce: aggregated ? 'merge' : 'minmax',
      approximate: false,
      maxPoints,
      coverage: { from: q.from, to: Math.min(q.to, now()) },
      gaps,
      series: q.tags.map((id) => {
        const v = ts.map((t) => valueAt(id, t));
        return aggregated
          ? { tagId: id, t: ts, v, min: v.map((x) => x - 0.2), max: v.map((x) => x + 0.2) }
          : { tagId: id, t: ts, v };
      }),
      stats: { source: 'fake', rowsRead: ts.length, elapsedMs: 1 },
    });
  }

  function aggregate(res, url) {
    state.calls.aggregate++;
    const q = parse(url, { tags: true });
    const bucketMs = q?.num('bucketMs');
    if (!q || !bucketMs || bucketMs % MIN !== 0) return bad(res);
    const off = q.num('offsetMs') ?? 0;
    const A = Math.floor((q.from - off) / bucketMs) * bucketMs + off;
    const count = Math.ceil((q.to - A) / bucketMs);
    if (count > 5000) return bad(res, 'RANGE_TOO_LARGE', 422, 'Quá nhiều cửa sổ');
    const gaps = gapsNow();
    const n = now();
    const series = q.tags.map((id) => {
      const cols = {
        n: [],
        min: [],
        max: [],
        first: [],
        last: [],
        sumw: [],
        wms: [],
        avg: [],
        sum: [],
      };
      for (let k = 0; k < count; k++) {
        const a = A + k * bucketMs;
        const b = a + bucketMs;
        const ts = samples(Math.max(a, q.from), Math.min(b, q.to, n), gaps);
        if (ts.length === 0) {
          for (const c of Object.keys(cols)) cols[c].push(c === 'n' || c === 'wms' ? 0 : null);
          continue;
        }
        const vs = ts.map((t) => valueAt(id, t));
        const wms = ts.length * MIN;
        const sumw = vs.reduce((s, v) => s + v * MIN, 0);
        cols.n.push(ts.length);
        cols.min.push(Math.min(...vs));
        cols.max.push(Math.max(...vs));
        // `first` = tín hiệu đang giữ ngay trước đầu cửa sổ (history-db.md §6: bộ đếm chênh lệch nối liền giữa các cửa sổ).
        const carry = ts[0] === a && !inGap(a - MIN, gaps);
        cols.first.push(carry ? valueAt(id, a - MIN) : vs[0]);
        cols.last.push(vs[vs.length - 1]);
        cols.sumw.push(sumw);
        cols.wms.push(wms);
        cols.avg.push(sumw / wms);
        cols.sum.push(sumw / HOUR);
      }
      return { tagId: id, ...cols };
    });
    return ok(res, {
      apiVersion: '1.4.0',
      group: q.g.id,
      timeZone: '+07:00',
      from: q.from,
      to: q.to,
      bucketMs,
      offsetMs: off,
      start: A,
      count,
      source: bucketMs % HOUR === 0 && off % HOUR === 0 ? 'hour' : 'minute',
      series,
      stats: { source: 'fake', rowsRead: count, elapsedMs: 1 },
    });
  }

  function rows(res, url) {
    state.calls.rows++;
    const q = parse(url, { tags: false });
    if (!q) return bad(res);
    const limit = Math.max(1, Math.min(500, q.num('limit') ?? 100));
    const order = q.p.get('order') === 'asc' ? 'asc' : 'desc';
    const after = q.num('after');
    const gaps = gapsNow();
    const all = samples(q.from, Math.min(q.to, now()), gaps).map((t) => [t / MIN, t]);
    if (order === 'desc') all.reverse();
    let start = 0;
    if (after !== null) start = all.findIndex(([seq]) => seq === after) + 1;
    const page = all.slice(start, start + limit);
    const more = start + limit < all.length;
    return ok(res, {
      group: q.g.id,
      timeZone: '+07:00',
      order,
      columns: q.tags.map((tagId) => ({ tagId })),
      rows: page.map(([seq, t]) => [seq, t, ...q.tags.map((id) => valueAt(id, t))]),
      next: more ? page[page.length - 1][0] : null,
    });
  }

  function exportCsv(res, url) {
    state.calls.export++;
    const q = parse(url, { tags: false });
    if (!q) return bad(res);
    const ts = samples(q.from, Math.min(q.to, now()), gapsNow());
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${q.g.id}.csv"`,
      'cache-control': 'no-store',
    });
    const lines = ['﻿time,' + q.tags.join(',')];
    for (const t of ts.slice(0, 5000))
      lines.push(
        [
          new Date(t + TZ).toISOString().slice(0, 19).replace('T', ' '),
          ...q.tags.map((id) => valueAt(id, t)),
        ].join(','),
      );
    res.end(lines.join('\r\n') + '\r\n');
  }

  return { state, handle, valueAt, catalogBody };
}
