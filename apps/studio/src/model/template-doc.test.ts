// Mô hình template của Studio (feature 011, T169; FR-119 đến FR-122, FR-126; SC-037; contracts/project-format-1.0.md
// §3, §4): tạo từ vùng chọn (phát hiện tham số), thêm bản sao (id `<inst>.<rid>`, Tag thay đúng), "Cập nhật mọi bản sao"
// (giữ vị trí, cỡ, tham số; xóa item thêm tay; một bước hoàn tác), "Bung thành item thường", xóa template còn bản sao
// (chỉ bung rồi xóa), W_TEMPLATE_DRIFT; 20 bản sao sửa một lần cập nhật 20/20; đọc/ghi `templates/<id>.template.json`.
import { resolve } from 'node:path';
import {
  MemorySource,
  validateProject,
  type Issue,
  type Item,
  type ScreenModel,
  type TemplateDoc,
  type WidgetItem,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { createMockPlatform } from '../platform/mock.ts';
import { StudioStore } from '../app/store.ts';
import {
  applyDocEdits,
  filesOf,
  loadDoc,
  outlineOf,
  withEditable,
  writeOrder,
  writtenText,
  type ProjectDoc,
  type ProjectDocs,
  type ProjectEdit,
} from './project-doc.ts';
import { duplicate, setAction } from './screen-doc.ts';
import { readProjectDir, REPO } from './test-fixtures.ts';
import {
  addInstance,
  createTemplate,
  explodeInstance,
  expandInstance,
  findReplacements,
  instancesOf,
  nextInstanceId,
  planCreateTemplate,
  planDeleteTemplate,
  planFaceplate,
  planUpdateAll,
  suggestParams,
  templateFile,
  updateInstances,
} from './template-doc.ts';

const vector = () => {
  const f = readProjectDir(resolve(REPO, 'tests/project-vectors/v10-valid-full'));
  delete f['expected.json'];
  return f;
};

/** Thêm Tag nội bộ PUMPnn.RUN/FLOW/RUN_CMD cho `n` bơm (chưa có). */
function withPumpTags(files: Record<string, string>, n: number): Record<string, string> {
  const tags = JSON.parse(files['tags.json']!) as { tags: Array<Record<string, unknown>> };
  const have = new Set(tags.tags.map((t) => t.id));
  for (let i = 1; i <= n; i++) {
    const p = `PUMP${String(i).padStart(2, '0')}`;
    const add = (id: string, t: Record<string, unknown>) => {
      if (!have.has(id)) tags.tags.push({ id, kind: 'internal', ...t });
    };
    add(`${p}.RUN`, { type: 'BOOL', initial: false });
    add(`${p}.FLOW`, { type: 'FLOAT32', initial: 0 });
    add(`${p}.RUN_CMD`, { type: 'BOOL', access: 'RW', initial: false });
  }
  return { ...files, 'tags.json': JSON.stringify(tags, null, 2) + '\n' };
}

function open(files: Record<string, string>): ProjectDocs {
  const docs: Record<string, ProjectDoc> = {};
  for (const [rel, text] of Object.entries(files))
    docs[rel] = loadDoc(rel, text, `hash:${rel}`, false);
  return withEditable(docs);
}

const textsOf = (docs: ProjectDocs): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const d of Object.values(docs)) if (!d.removed) out[d.rel] = writtenText(d);
  return out;
};

async function check(docs: ProjectDocs): Promise<{ errors: Issue[]; warnings: Issue[] }> {
  const r = await validateProject(new MemorySource(textsOf(docs)));
  return { errors: r.errors, warnings: r.warnings };
}

const screenOf = (docs: ProjectDocs, id: string) =>
  docs[`screens/${id}.screen.json`]!.value as ScreenModel;
const templateOf = (docs: ProjectDocs, id: string) => docs[templateFile(id)]!.value as TemplateDoc;
const widget = (s: ScreenModel, id: string) => s.items.find((i) => i.id === id) as WidgetItem;

/** Màn hình nguồn: ba item của "bơm 1" chưa là template. */
function plainPump(): Item[] {
  return [
    {
      id: 'lamp_1',
      type: 'widget',
      widget: 'lamp',
      x: 100,
      y: 200,
      width: 40,
      height: 40,
      tags: { state: 'PUMP01.RUN' },
    },
    {
      id: 'card_1',
      type: 'widget',
      widget: 'card',
      x: 150,
      y: 200,
      width: 150,
      height: 60,
      props: { label: 'Bơm 1 (lưu lượng)' },
      tags: { value: 'PUMP01.FLOW' },
    },
    {
      id: 'button_1',
      type: 'widget',
      widget: 'button',
      x: 100,
      y: 280,
      width: 120,
      height: 40,
      props: { label: 'Chi tiết' },
      events: {
        click: {
          action: 'popup',
          screen: 'bom-chi-tiet',
          args: { prefix: 'PUMP01', title: 'Bơm 1' },
        },
      },
    } as Item,
  ];
}

describe('template-doc: tạo từ vùng chọn', () => {
  it('phát hiện tham số: tiền tố Tag chung và args của popup', () => {
    expect(suggestParams(plainPump())).toEqual([
      { name: 'prefix', kind: 'tagPrefix', default: 'PUMP01' },
      { name: 'title', kind: 'string', default: 'Bơm 1' },
    ]);
    // không có Tag chung: không có prefix
    expect(
      suggestParams([
        { ...plainPump()[0]!, tags: { state: 'A.RUN' } } as Item,
        { ...plainPump()[1]!, tags: { value: 'B.FLOW' } } as Item,
      ]),
    ).toEqual([]);
  });

  it('chỗ thay: Tag, nhãn nhúng, args; tắt từng chỗ được', () => {
    const items = plainPump();
    const reps = findReplacements(items, suggestParams(items));
    expect(reps.map((r) => [r.item, r.path.join('.'), r.current, r.value])).toEqual([
      ['lamp_1', 'tags.state', 'PUMP01.RUN', '{prefix}.RUN'],
      ['card_1', 'props.label', 'Bơm 1 (lưu lượng)', '{title} (lưu lượng)'],
      ['card_1', 'tags.value', 'PUMP01.FLOW', '{prefix}.FLOW'],
      ['button_1', 'events.click.args.prefix', 'PUMP01', '{prefix}'],
      ['button_1', 'events.click.args.title', 'Bơm 1', '{title}'],
    ]);
  });

  it('createTemplate: vị trí tương đối, cỡ hộp bao, id item tương đối, {param} đúng chỗ', () => {
    const items = plainPump();
    const params = suggestParams(items);
    const r = createTemplate({
      id: 'bom',
      name: 'Bơm có đèn và lưu lượng',
      items,
      params,
      replacements: findReplacements(items, params),
      schemaVersion: '1.0.0',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.template;
    expect(t.schemaVersion).toBe('1.0.0');
    expect(t.size).toEqual({ width: 200, height: 120 });
    expect(r.origin).toEqual({ x: 100, y: 200 });
    expect(t.items.map((i) => [i.id, i.x, i.y])).toEqual([
      ['lamp_1', 0, 0],
      ['card_1', 50, 0],
      ['button_1', 0, 80],
    ]);
    expect((t.items[0] as WidgetItem).tags).toEqual({ state: '{prefix}.RUN' });
    expect((t.items[1] as WidgetItem).props).toEqual({ label: '{title} (lưu lượng)' });
    expect((t.items[2] as WidgetItem).events?.click).toEqual({
      action: 'popup',
      screen: 'bom-chi-tiet',
      args: { prefix: '{prefix}', title: '{title}' },
    });
  });

  it('createTemplate từ chối: rỗng, id sai, item svg, tham số sai, quá 120 item, id đã có', () => {
    const base = { name: 'X', params: [], replacements: [], schemaVersion: '1.0.0' };
    expect(createTemplate({ ...base, id: 'bom', items: [] })).toEqual({
      ok: false,
      reason: 'empty',
    });
    expect(createTemplate({ ...base, id: 'Bom!', items: plainPump() })).toMatchObject({
      reason: 'bad-id',
    });
    expect(
      createTemplate({ ...base, id: 'bom', items: plainPump(), taken: ['bom'] }),
    ).toMatchObject({ reason: 'taken' });
    const svg = { id: 'svg_1', type: 'svg', x: 0, y: 0, width: 10, height: 10 } as unknown as Item;
    expect(createTemplate({ ...base, id: 'bom', items: [svg] })).toMatchObject({
      reason: 'svg-item',
    });
    expect(
      createTemplate({
        ...base,
        id: 'bom',
        items: plainPump(),
        params: [{ name: 'Bad Name', kind: 'string' }],
      }),
    ).toMatchObject({ reason: 'bad-params' });
    const many = Array.from({ length: 121 }, (_, i) => ({ ...plainPump()[0]!, id: `l_${i}` }));
    expect(createTemplate({ ...base, id: 'bom', items: many as Item[] })).toMatchObject({
      reason: 'too-many',
    });
  });

  it('planCreateTemplate: ghi templates/bom.template.json, thêm vào project.json, thay vùng chọn bằng bản sao hợp lệ', async () => {
    const files = vector();
    let docs = open(files);
    const main = screenOf(docs, 'main');
    const src = { ...main, items: [...main.items, ...plainPump()] };
    docs = applyDocEdits(docs, [{ kind: 'screenUpsert', screen: src }]);
    const ids = plainPump().map((i) => i.id);
    const items = plainPump();
    const params = suggestParams(items);
    const plan = planCreateTemplate(src, ids, {
      id: 'bom2',
      name: 'Bơm 2',
      params,
      replacements: findReplacements(items, params),
      schemaVersion: '1.0.0',
      taken: ['bom'],
      replaceSelection: true,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.inst).toBe('bom21');
    docs = applyDocEdits(docs, plan.edits);
    const project = docs['project.json']!.value as { templates: string[] };
    expect(project.templates).toEqual([
      'templates/bom.template.json',
      'templates/bom2.template.json',
    ]);
    expect(templateOf(docs, 'bom2').id).toBe('bom2');
    const after = screenOf(docs, 'main');
    expect(after.items.filter((i) => ids.includes(i.id))).toEqual([]);
    const lamp = widget(after, 'bom21.lamp_1');
    expect(lamp).toMatchObject({ x: 100, y: 200, tags: { state: 'PUMP01.RUN' } });
    expect((lamp as { tpl?: unknown }).tpl).toEqual({
      inst: 'bom21',
      tid: 'bom2',
      rid: 'lamp_1',
      params: { prefix: 'PUMP01', title: 'Bơm 1' },
    });
    expect(widget(after, 'bom21.card_1').props).toEqual({ label: 'Bơm 1 (lưu lượng)' });
    const r = await check(docs);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.code === 'W_TEMPLATE_DRIFT')).toEqual([]);
    // tệp mới được ghi khi lưu, project.json sau cùng
    const order = writeOrder(docs).map((d) => d.rel);
    expect(order).toContain('templates/bom2.template.json');
    expect(order.indexOf('project.json')).toBeGreaterThan(
      order.indexOf('templates/bom2.template.json'),
    );
  });
});

describe('template-doc: bản sao', () => {
  const tpl = () => templateOf(open(vector()), 'bom');

  it('expandInstance: id `<inst>.<rid>`, Tag và nhãn đã thay, args của popup đã thay, tpl đủ params', () => {
    const r = expandInstance(
      tpl(),
      'pump9',
      { prefix: 'PUMP09', title: 'Bơm 9' },
      { x: 500, y: 40 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => [i.id, i.x, i.y])).toEqual([
      ['pump9.lamp', 510, 50],
      ['pump9.flow', 560, 50],
      ['pump9.detail', 510, 130],
    ]);
    expect((r.items[0] as WidgetItem).tags).toEqual({ state: 'PUMP09.RUN' });
    expect((r.items[1] as WidgetItem).props).toEqual({ label: 'Bơm 9 (lưu lượng)' });
    expect((r.items[2] as WidgetItem).events?.click).toMatchObject({
      args: { prefix: 'PUMP09', title: 'Bơm 9' },
    });
    for (const it of r.items)
      expect(it.tpl).toEqual({
        inst: 'pump9',
        tid: 'bom',
        rid: it.id.split('.')[1],
        params: { prefix: 'PUMP09', title: 'Bơm 9' },
      });
  });

  it('expandInstance: default lấp tham số thiếu; giá trị sai kiểu hay id bản sao sai bị từ chối', () => {
    const r = expandInstance(tpl(), 'pump9', { prefix: 'PUMP09' }, { x: 0, y: 0 });
    expect(r.ok && (r.items[1] as WidgetItem).props).toEqual({ label: 'Bơm (lưu lượng)' });
    expect(expandInstance(tpl(), 'pump9', { prefix: '9X' }, { x: 0, y: 0 })).toMatchObject({
      ok: false,
      reason: 'bad-args',
    });
    expect(expandInstance(tpl(), 'Pump 9', { prefix: 'P' }, { x: 0, y: 0 })).toMatchObject({
      ok: false,
      reason: 'bad-inst',
    });
  });

  it('addInstance: id bản sao kế tiếp không trùng, từ chối id đã dùng', () => {
    const docs = open(vector());
    const main = screenOf(docs, 'main');
    expect(nextInstanceId(main, 'bom')).toBe('bom1');
    const a = addInstance(main, tpl(), { params: { prefix: 'PUMP01' }, at: { x: 0, y: 600 } });
    expect(a.ok && a.inst).toBe('bom1');
    if (!a.ok) return;
    expect(nextInstanceId(a.screen, 'bom')).toBe('bom2');
    expect(
      addInstance(a.screen, tpl(), {
        inst: 'pump7',
        params: { prefix: 'PUMP01' },
        at: { x: 0, y: 0 },
      }),
    ).toMatchObject({ ok: false, reason: 'inst-taken' });
  });

  it('instancesOf: bản sao của template trên mọi màn hình, tham số từ item mang params, điểm đặt', () => {
    const docs = open(vector());
    const list = instancesOf([screenOf(docs, 'main')], { bom: tpl() }, 'bom');
    expect(list.map((i) => [i.screen, i.inst, i.params, i.at])).toEqual([
      ['main', 'pump7', { prefix: 'PUMP07', title: 'Bơm 7' }, { x: 1060, y: 20 }],
      ['main', 'pump8', expect.objectContaining({ prefix: 'PUMP08' }), expect.any(Object)],
    ]);
  });

  it('explodeInstance: xóa tpl, giữ item thường', () => {
    const main = screenOf(open(vector()), 'main');
    const s = explodeInstance(main, 'pump7');
    expect(s.items.filter((i) => (i as { tpl?: { inst: string } }).tpl?.inst === 'pump7')).toEqual(
      [],
    );
    expect(widget(s, 'pump7.lamp').tags).toEqual({ state: 'PUMP07.RUN' });
    expect(s.items.length).toBe(main.items.length);
    expect(explodeInstance(main, 'nope')).toBe(main);
  });
});

describe('template-doc: Cập nhật mọi bản sao', () => {
  it('giữ vị trí, cỡ, tham số; thêm item mới của template; xóa item thêm tay; W_TEMPLATE_DRIFT hết', async () => {
    let docs = open(vector());
    const main = screenOf(docs, 'main');
    // bản sao pump7: kéo cả bản sao lệch 5, đổi cỡ flow, sửa nhãn tay (lệch), thêm item tay mang tpl
    const moved: ScreenModel = {
      ...main,
      items: [
        ...main.items.map((it) => {
          const inst = (it as { tpl?: { inst: string } }).tpl?.inst;
          if (inst !== 'pump7') return it;
          const n = { ...it, x: it.x + 5, y: it.y + 5 } as WidgetItem;
          if (it.id === 'pump7.flow') return { ...n, width: 170, props: { label: 'sửa tay' } };
          return n;
        }),
        {
          id: 'pump7.note',
          type: 'widget',
          widget: 'label',
          x: 0,
          y: 0,
          width: 80,
          height: 20,
          props: { text: 'ghi chú' },
          tpl: { inst: 'pump7', tid: 'bom', rid: 'note' },
        } as unknown as Item,
      ],
    };
    docs = applyDocEdits(docs, [{ kind: 'screenUpsert', screen: moved }]);
    const before = await check(docs);
    expect(before.warnings.map((w) => w.code)).toContain('W_TEMPLATE_DRIFT');

    // template đổi: thêm item "status"
    const t0 = templateOf(docs, 'bom');
    const t: TemplateDoc = {
      ...t0,
      items: [
        ...t0.items,
        {
          id: 'status',
          type: 'widget',
          widget: 'label',
          x: 140,
          y: 90,
          width: 70,
          height: 40,
          tags: { value: '{prefix}.RUN' },
        } as Item,
      ],
    };
    const u = updateInstances(moved, t);
    expect(u.instances).toBe(2);
    expect(u.removed).toEqual(['pump7.note']);
    const s = u.screen;
    expect(widget(s, 'pump7.lamp')).toMatchObject({ x: 1075, y: 35 });
    expect(widget(s, 'pump7.flow')).toMatchObject({
      x: 1125,
      y: 35,
      width: 170,
      props: { label: 'Bơm 7 (lưu lượng)' },
    });
    expect(widget(s, 'pump7.status')).toMatchObject({
      x: 1205,
      y: 115,
      tags: { value: 'PUMP07.RUN' },
    });
    expect(s.items.find((i) => i.id === 'pump7.note')).toBeUndefined();
    expect(widget(s, 'pump8.status').tags).toEqual({ value: 'PUMP08.RUN' });

    docs = applyDocEdits(docs, [
      { kind: 'templateUpsert', template: t },
      { kind: 'screenUpsert', screen: s },
    ]);
    const after = await check(docs);
    expect(after.errors).toEqual([]);
    expect(after.warnings.filter((w) => w.code === 'W_TEMPLATE_DRIFT')).toEqual([]);
  });

  it('20 bản sao trên hai màn hình: sửa template một lần, cập nhật 20/20, hợp lệ, không lệch', async () => {
    let docs = open(withPumpTags(vector(), 20));
    const t = templateOf(docs, 'bom');
    let main = screenOf(docs, 'main');
    // bỏ pump7, pump8 sẵn có để đếm gọn
    main = { ...main, items: main.items.filter((i) => !(i as { tpl?: unknown }).tpl) };
    const overview: ScreenModel = { ...main, id: 'tong-quan', name: 'Tổng quan', items: [] };
    let a = main;
    let b = overview;
    for (let i = 1; i <= 20; i++) {
      const p = { prefix: `PUMP${String(i).padStart(2, '0')}`, title: `Bơm ${i}` };
      const at = { x: ((i - 1) % 5) * 240, y: 400 + Math.floor((i - 1) / 5) * 160 };
      const r = addInstance(i <= 18 ? a : b, t, { inst: `pump${i}`, params: p, at });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      if (i <= 18) a = r.screen;
      else b = r.screen;
    }
    docs = applyDocEdits(docs, [
      { kind: 'screenUpsert', screen: a },
      { kind: 'screenUpsert', screen: b },
    ]);
    expect((await check(docs)).errors).toEqual([]);
    expect(instancesOf([a, b], { bom: t }, 'bom')).toHaveLength(20);

    const t2: TemplateDoc = {
      ...t,
      items: t.items.map((it) =>
        it.id === 'flow' ? ({ ...it, props: { label: '{title}: lưu lượng' } } as Item) : it,
      ),
    };
    const plan = planUpdateAll([a, b], t2);
    expect(plan.instances).toBe(20);
    expect(plan.screens).toBe(2);
    docs = applyDocEdits(docs, [{ kind: 'templateUpsert', template: t2 }, ...plan.edits]);
    const labels = [screenOf(docs, 'main'), screenOf(docs, 'tong-quan')]
      .flatMap((s) => s.items)
      .filter((i) => i.id.endsWith('.flow'))
      .map((i) => (i as WidgetItem).props?.label);
    expect(labels).toHaveLength(20);
    expect(labels.every((l, k) => l === `Bơm ${k + 1}: lưu lượng`)).toBe(true);
    const r = await check(docs);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.code === 'W_TEMPLATE_DRIFT')).toEqual([]);
  });

  it('một bước hoàn tác trong store', async () => {
    const platform = createMockPlatform();
    platform.control.useProject(vector());
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(true);
    await store.validateNow();
    const t = store.state.docs[templateFile('bom')]!.value as TemplateDoc;
    const t2: TemplateDoc = {
      ...t,
      items: t.items.map((it) =>
        it.id === 'flow'
          ? ({ ...it, width: 99, props: { label: '{title}: lưu lượng' } } as Item)
          : it,
      ),
    };
    const screens = store.state.outline.screens.map((s) => s.model!).filter(Boolean);
    const plan = planUpdateAll(screens, t2);
    const edits: ProjectEdit[] = [{ kind: 'templateUpsert', template: t2 }, ...plan.edits];
    store.edit(edits);
    expect(store.dirtyFiles().sort()).toEqual([
      'screens/main.screen.json',
      'templates/bom.template.json',
    ]);
    const flow = (store.state.docs['screens/main.screen.json']!.value as ScreenModel).items.find(
      (i) => i.id === 'pump7.flow',
    ) as WidgetItem;
    // nhãn theo template mới; cỡ là của riêng bản sao (FR-121)
    expect(flow).toMatchObject({ width: 150, props: { label: 'Bơm 7: lưu lượng' } });
    expect(store.state.history.past.length).toBe(1);
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
  });
});

describe('template-doc: xóa template còn bản sao', () => {
  it('chỉ "bung thành item thường rồi xóa": màn hình giữ item, project.json bỏ template, tệp bị xóa khi lưu', async () => {
    let docs = open(vector());
    const screens = outlineOf(filesOf(docs)).screens.map((s) => s.model!);
    const plan = planDeleteTemplate(screens, 'bom');
    expect(plan.instances).toBe(2);
    docs = applyDocEdits(docs, plan.edits);
    const project = docs['project.json']!.value as { templates?: string[] };
    expect(project.templates).toBeUndefined();
    expect(docs[templateFile('bom')]!.removed).toBe(true);
    const main = screenOf(docs, 'main');
    expect(main.items.some((i) => (i as { tpl?: unknown }).tpl)).toBe(false);
    expect(widget(main, 'pump7.lamp').tags).toEqual({ state: 'PUMP07.RUN' });
    expect((await check(docs)).errors).toEqual([]);
  });
});

describe('template-doc: faceplate từ màn hình popup', () => {
  it('planFaceplate: tiền tố chung thành {prefix}, params có default (chỗ gọi cũ không cần args)', async () => {
    let docs = open(vector());
    const pump = screenOf(docs, 'pump');
    const r = planFaceplate(pump);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.screen.params).toEqual([{ name: 'prefix', kind: 'tagPrefix', default: 'PUMP01' }]);
    expect(widget(r.screen, 'name_p').tags).toEqual({ value: '{prefix}.NAME' });
    expect(widget(r.screen, 'sw_run').tags).toEqual({ target: '{prefix}.RUN_CMD' });
    docs = applyDocEdits(docs, [{ kind: 'screenUpsert', screen: r.screen }]);
    expect((await check(docs)).errors).toEqual([]);
    expect(planFaceplate(screenOf(docs, 'main'))).toMatchObject({ ok: false, reason: 'not-popup' });
  });
});

describe('project-doc: tệp template', () => {
  it('template là tài liệu sửa được; outline liệt kê template; ghi lại giữ byte khi không sửa', () => {
    const docs = open(vector());
    expect(docs[templateFile('bom')]!.editable).toBe(true);
    const o = outlineOf(filesOf(docs));
    expect(o.templates.map((t) => [t.id, t.file, t.doc?.name])).toEqual([
      ['bom', 'templates/bom.template.json', 'Bơm có đèn và lưu lượng'],
    ]);
    expect(writeOrder(docs)).toEqual([]);
  });

  it('màn hình 1.0 ghi lại giữ tpl, args của popup và params của popup', () => {
    let docs = open(vector());
    const main = screenOf(docs, 'main');
    docs = applyDocEdits(docs, [
      { kind: 'screenUpsert', screen: { ...main, name: 'Main 2' } },
      { kind: 'screenUpsert', screen: { ...screenOf(docs, 'bom-chi-tiet'), name: 'Chi tiết 2' } },
    ]);
    const text = writtenText(docs['screens/main.screen.json']!);
    expect(text).toContain('"tpl":{"inst":"pump7","tid":"bom","rid":"lamp"');
    expect(text).toContain('"args":{"prefix":"PUMP07","title":"Bơm 7"}');
    const popup = JSON.parse(writtenText(docs['screens/bom-chi-tiet.screen.json']!)) as {
      params?: unknown[];
    };
    expect(popup.params).toHaveLength(2);
  });

  it('templateRemove không còn template nào: bỏ khóa templates', () => {
    let docs = open(vector());
    docs = applyDocEdits(docs, [{ kind: 'templateRemove', id: 'bom' }]);
    expect((docs['project.json']!.value as { templates?: unknown }).templates).toBeUndefined();
  });
});

describe('screen-doc với bản sao và args', () => {
  it('nhân bản item của bản sao: bản mới là item thường (không mang tpl)', () => {
    const main = screenOf(open(vector()), 'main');
    const r = duplicate(main, ['pump7.lamp']);
    const added = r.doc.items.find((i) => i.id === r.selection?.[0]);
    expect(added).toBeDefined();
    expect((added as { tpl?: unknown }).tpl).toBeUndefined();
  });

  it('setAction popup giữ args (tên → chuỗi); args sai hình bị từ chối', () => {
    const main = screenOf(open(vector()), 'main');
    const ok = setAction(main, 'pump7.detail', 'click', {
      action: 'popup',
      screen: 'bom-chi-tiet',
      args: { prefix: 'PUMP09', title: 'Bơm 9' },
    } as never);
    expect(widget(ok.doc, 'pump7.detail').events?.click).toEqual({
      action: 'popup',
      screen: 'bom-chi-tiet',
      args: { prefix: 'PUMP09', title: 'Bơm 9' },
    });
    const bad = setAction(main, 'pump7.detail', 'click', {
      action: 'popup',
      screen: 'bom-chi-tiet',
      args: { prefix: 9 },
    } as never);
    expect(bad.rejected).toBe('bad-action');
  });
});
