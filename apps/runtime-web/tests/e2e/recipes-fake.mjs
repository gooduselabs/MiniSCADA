// API recipe giả của runtime e2e (feature 024; hình dạng theo core/recipe/recipe_service.cpp): GET /api/v1/recipes,
// /current, /jobs/{id}; POST save, delete, capture, download. Có trạng thái: rev, bản thiết bị, giá trị PLC (download
// đổi giá trị hiện tại từng tham số theo nhịp), job chạy theo thời gian thực. `failTag`: Tag ghi lỗi DEVICE_EXCEPTION.
const RANK = { viewer: 0, operator: 1, engineer: 2, administrator: 3 };

export function makeRecipes(opts, h) {
  const types = [
    {
      id: 'lo-say',
      name: 'Lò sấy',
      description: 'Thông số mẻ sấy',
      security: { view: 'viewer', operate: 'operator', edit: 'operator' },
      params: [
        {
          tag: 'OVEN.TEMP_SP',
          type: 'FLOAT32',
          label: 'Nhiệt độ đặt',
          unit: '°C',
          min: 120,
          max: 250,
          decimals: 1,
        },
        {
          tag: 'OVEN.TIME_SP',
          type: 'UINT16',
          label: 'Thời gian sấy',
          unit: 'phút',
          min: 5,
          max: 240,
        },
        {
          tag: 'OVEN.FAN_SP',
          type: 'FLOAT32',
          label: 'Tốc độ quạt',
          unit: '%',
          min: 0,
          max: 100,
          decimals: 0,
        },
        { tag: 'OVEN.STEAM', type: 'BOOL', label: 'Phun hơi' },
        { tag: 'OVEN.NOTE', type: 'STRING', label: 'Mã sản phẩm' },
      ],
      recipes: [
        {
          id: 'banh-mi',
          name: 'Bánh mì',
          values: {
            'OVEN.TEMP_SP': 210,
            'OVEN.TIME_SP': 25,
            'OVEN.FAN_SP': 60,
            'OVEN.STEAM': true,
            'OVEN.NOTE': 'BM-01',
          },
        },
        {
          id: 'banh-quy',
          name: 'Bánh quy',
          values: {
            'OVEN.TEMP_SP': 180,
            'OVEN.TIME_SP': 14,
            'OVEN.FAN_SP': 40,
            'OVEN.STEAM': false,
            'OVEN.NOTE': 'BQ-02',
          },
        },
        {
          id: 'say-hat',
          name: 'Sấy hạt',
          values: {
            'OVEN.TEMP_SP': 130,
            'OVEN.TIME_SP': 180,
            'OVEN.FAN_SP': 85,
            'OVEN.STEAM': false,
            'OVEN.NOTE': 'SH-07',
          },
        },
      ],
    },
    {
      id: 'tron',
      name: 'Bồn trộn',
      security: { view: 'viewer', operate: 'engineer', edit: 'engineer' },
      params: [
        { tag: 'MIX.SPEED_SP', type: 'UINT16', label: 'Tốc độ', unit: 'rpm', min: 0, max: 1500 },
      ],
      recipes: [{ id: 'cham', name: 'Chậm', values: { 'MIX.SPEED_SP': 300 } }],
    },
  ];
  const plc = new Map([
    ['OVEN.TEMP_SP', 180],
    ['OVEN.TIME_SP', 14],
    ['OVEN.FAN_SP', 40],
    ['OVEN.STEAM', false],
    ['OVEN.NOTE', 'BQ-02'],
    ['MIX.SPEED_SP', 0],
  ]);
  const state = {
    rev: 0,
    device: new Map(),
    jobs: new Map(),
    seq: 0,
    failTag: opts.failTag ?? null,
    log: [],
  };
  for (const t of types) state.device.set(t.id, []);
  const can = (s, need) => RANK[s.role] >= RANK[need];
  const find = (id) => types.find((t) => t.id === id);
  const all = (t) => [
    ...t.recipes.map((r) => ({ ...r, origin: 'project' })),
    ...state.device.get(t.id),
  ];
  const check = (t, values) => {
    const issues = [];
    for (const p of t.params) {
      const v = values?.[p.tag];
      const ok =
        p.type === 'BOOL'
          ? typeof v === 'boolean'
          : p.type === 'STRING'
            ? typeof v === 'string'
            : typeof v === 'number';
      if (!ok) issues.push({ tag: p.tag, code: 'E_RECIPE_VALUE' });
      else if (
        typeof v === 'number' &&
        ((p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max))
      )
        issues.push({ tag: p.tag, code: 'E_RECIPE_LIMIT' });
    }
    return issues;
  };
  const newId = () => `d-${(++state.seq).toString(16).padStart(8, '0')}`;

  async function handle(req, res, s, path, url) {
    const m = req.method;
    if (m === 'GET' && path === '/api/v1/recipes')
      return h.json(res, 200, {
        rev: state.rev,
        types: types
          .filter((t) => can(s, t.security.view))
          .map((t) => ({
            id: t.id,
            name: t.name,
            ...(t.description ? { description: t.description } : {}),
            params: t.params,
            can: { operate: can(s, t.security.operate), edit: can(s, t.security.edit) },
            recipes: all(t),
          })),
      });
    if (m === 'GET' && path === '/api/v1/recipes/current') {
      const t = find(url.searchParams.get('type'));
      if (!t) return h.err(res, 404, 'RECIPE_NOT_FOUND');
      return h.json(res, 200, {
        type: t.id,
        values: Object.fromEntries(
          t.params.map((p) => [p.tag, { value: plc.get(p.tag) ?? null, quality: 'GOOD' }]),
        ),
      });
    }
    if (m === 'GET' && path.startsWith('/api/v1/recipes/jobs/')) {
      const j = state.jobs.get(decodeURIComponent(path.slice('/api/v1/recipes/jobs/'.length)));
      return j ? h.json(res, 200, j) : h.err(res, 404, 'RECIPE_NOT_FOUND');
    }
    if (m !== 'POST') return h.err(res, 404, 'NOT_FOUND');
    let b;
    try {
      b = JSON.parse(await h.readBody(req));
    } catch {
      return h.err(res, 400, 'BAD_REQUEST');
    }
    const t = find(b.type);
    if (!t) return h.err(res, 404, 'RECIPE_NOT_FOUND');
    state.log.push({ path, body: b, user: s.user });
    if (path === '/api/v1/recipes/download') {
      if (!can(s, t.security.operate)) return h.err(res, 403, 'FORBIDDEN');
      const r = all(t).find((x) => x.id === b.recipe);
      if (!r) return h.err(res, 404, 'RECIPE_NOT_FOUND');
      const issues = check(t, r.values);
      if (issues.length) return h.err(res, 400, 'RECIPE_INVALID', { issues });
      if ([...state.jobs.values()].some((j) => j.state === 'running'))
        return h.err(res, 409, 'RECIPE_BUSY');
      const j = {
        jobId: `j${state.jobs.size + 1}`,
        type: t.id,
        recipe: r.id,
        state: 'running',
        results: t.params.map((p) => ({ tag: p.tag, value: r.values[p.tag], status: 'pending' })),
      };
      state.jobs.set(j.jobId, j);
      let i = 0;
      const step = () => {
        const x = j.results[i];
        if (state.failTag && x.tag === state.failTag) {
          x.status = 'failed';
          x.code = 'DEVICE_EXCEPTION';
          for (const y of j.results.slice(i + 1)) y.status = 'skipped';
          j.state = 'failed';
          return;
        }
        plc.set(x.tag, x.value);
        x.status = 'ok';
        x.code = 'CONFIRMED';
        if (++i >= j.results.length) j.state = 'done';
        else setTimeout(step, 150);
      };
      setTimeout(step, 150);
      return h.json(res, 202, j);
    }
    if (!can(s, t.security.edit)) return h.err(res, 403, 'FORBIDDEN');
    if (b.rev !== state.rev) return h.err(res, 409, 'CONFLICT', { rev: state.rev });
    const list = state.device.get(t.id);
    if (path === '/api/v1/recipes/delete') {
      if (t.recipes.some((r) => r.id === b.id)) return h.err(res, 409, 'RECIPE_READONLY');
      const k = list.findIndex((r) => r.id === b.id);
      if (k < 0) return h.err(res, 404, 'RECIPE_NOT_FOUND');
      list.splice(k, 1);
      state.rev++;
      return h.json(res, 200, { rev: state.rev });
    }
    let values = b.values;
    if (path === '/api/v1/recipes/capture')
      values = Object.fromEntries(t.params.map((p) => [p.tag, plc.get(p.tag)]));
    else if (path !== '/api/v1/recipes/save') return h.err(res, 404, 'NOT_FOUND');
    const issues = check(t, values);
    if (issues.length) return h.err(res, 400, 'RECIPE_INVALID', { issues });
    if (b.id && t.recipes.some((r) => r.id === b.id)) return h.err(res, 409, 'RECIPE_READONLY');
    const rec = {
      id: b.id || newId(),
      name: b.name,
      values,
      origin: 'device',
      updatedAt: new Date().toISOString(),
      updatedBy: s.user,
    };
    const k = list.findIndex((r) => r.id === rec.id);
    if (k >= 0) list[k] = rec;
    else list.push(rec);
    state.rev++;
    return h.json(res, 200, { rev: state.rev, recipe: rec });
  }

  return {
    handle,
    state,
    plc,
    /** Đổi rev ngoài trang (giả một người khác vừa sửa): lần lưu sau của trang nhận CONFLICT. */
    bump() {
      state.rev++;
    },
  };
}
