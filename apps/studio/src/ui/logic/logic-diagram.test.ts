// Sơ đồ khối của editor Logic (feature 015, T007, T010–T012; specs/015-logic-ui): khung nhìn mặc định, nút khối, toán hạng
// Tag, cổng suy ra, dây; chọn khối mở Inspector cũ; bàn phím (mũi tên gộp một bước hoàn tác, Ctrl+D, Delete bỏ cả vị trí);
// thả khối/cổng/Tag từ task card; Thử logic hiện giá trị trên dây và cổng; Online hiện trạng thái khối; lỗi của validator tô
// đỏ cổng và khối, nhấp đúp dòng lỗi chọn khối trên sơ đồ.
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogicDoc } from '@mat/project-schema';
import type { StudioApp } from '../../app/app.ts';
import { pumpLogic } from '../../model/logic-fixtures.ts';
import '../mat-inspector.ts';
import type { MatInspector } from '../mat-inspector.ts';
import { pinnedDevice } from '../online-test-helpers.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import { LOGIC_BLOCK_MIME, LOGIC_GATE_MIME } from './logic-card.ts';
import type { LogicDiagram } from './logic-diagram.ts';
import { logicSim, logicUi, setDockTab, simChanged } from './logic-state.ts';
import { newLogicApp, newLogicOnlineApp } from './logic-test-helpers.ts';
import './logic-editor.ts';

const apps: StudioApp[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) a.session.disconnect();
  cleanup();
});

const logicOf = (app: StudioApp) => app.store.state.outline.logic as LogicDoc;
const layoutOf = (app: StudioApp) => app.store.state.outline.logicLayout.nodes;

async function open(app: StudioApp) {
  app.openEditor('logic');
  const host = document.createElement('div');
  document.body.append(host);
  const draw = () => render(renderEditor(app, 'logic'), host);
  draw();
  app.subscribe(draw);
  const insp = await mount<MatInspector>('mat-inspector', app);
  await settled(document.body);
  const dia = host.querySelector<LogicDiagram>('mat-logic-diagram')!;
  const again = () => settled(document.body);
  const node = (key: string) => dia.querySelector<SVGGElement>(`g[data-node="${CSS.escape(key)}"]`);
  const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    );
    await again();
  };
  return { host, insp, dia, again, node, key };
}

function dropEvent(type: string, data: Record<string, string>, x = 300, y = 200): DragEvent {
  const store = new Map(Object.entries(data));
  const dt = {
    types: [...store.keys()],
    getData: (k: string) => store.get(k) ?? '',
    setData: (k: string, v: string) => void store.set(k, v),
    dropEffect: 'none',
  };
  const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperties(e, {
    dataTransfer: { value: dt },
    clientX: { value: x },
    clientY: { value: y },
  });
  return e;
}

describe('khung nhìn Sơ đồ', () => {
  it('mặc định là Sơ đồ: khối, toán hạng Tag, cổng suy ra, dây; nút Bảng về bảng cũ', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { host, dia, node, again } = await open(app);
    expect(dia).not.toBeNull();
    expect(host.querySelector('table.lg-grid')).toBeNull();
    expect(host.querySelector('[data-view="diagram"]')?.getAttribute('aria-pressed')).toBe('true');
    expect([...dia.querySelectorAll<SVGGElement>('g.blk')].map((g) => g.dataset.node)).toEqual([
      'pump_high_level',
      'pump_low_level',
      't_start',
      'c_starts',
      'z_flow',
      'h_pump',
      's_day',
      'w_pump_run',
    ]);
    expect(dia.querySelectorAll('g.opn[data-tag="TANK01.LEVEL"]')).toHaveLength(2);
    expect([...dia.querySelectorAll('g.gate .gt-title')].map((t) => t.textContent)).toEqual(
      expect.arrayContaining(['> 80', 'AND', '< 20']),
    );
    expect(dia.querySelectorAll('g.wr').length).toBeGreaterThanOrEqual(10);
    // khối là nút bấm có nhãn đầy đủ, nằm trong vùng role=application
    const t = node('t_start')!;
    expect(t.getAttribute('role')).toBe('button');
    expect(t.getAttribute('tabindex')).toBe('0');
    expect(t.getAttribute('aria-label')).toContain('Timer t_start');
    expect(t.getAttribute('aria-label')).toContain('in = PUMP01.RUN_CMD');
    expect(dia.querySelector('.lgd-view')?.getAttribute('role')).toBe('application');
    host.querySelector<HTMLButtonElement>('[data-view="table"]')!.click();
    await again();
    expect(host.querySelector('table.lg-grid')).not.toBeNull();
    expect(host.querySelector('mat-logic-diagram')).toBeNull();
  });

  it('focus khối: Inspector hiện khối đó; Enter đưa focus ô Id', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { insp, node, key, again } = await open(app);
    node('c_starts')!.dispatchEvent(new FocusEvent('focus'));
    await again();
    expect(insp.querySelector<HTMLInputElement>('[data-field="id"]')?.value).toBe('c_starts');
    expect(node('c_starts')!.classList.contains('sel')).toBe(true);
    await key(node('c_starts')!, 'Enter');
    await again();
    expect(logicUi(app).focus).toBeNull(); // dock đã dùng yêu cầu focus
    expect((document.activeElement as HTMLInputElement | null)?.dataset.field).toBe('id');
  });
});

describe('sửa trên sơ đồ', () => {
  it('mũi tên dịch 16 px (Shift 64), các lần dịch liên tiếp gộp một bước hoàn tác; logic.json không đổi', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { node, key } = await open(app);
    const before = JSON.stringify(logicOf(app));
    const g = node('t_start')!;
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform')!)!;
    const x0 = Number(m[1]);
    const y0 = Number(m[2]);
    await key(g, 'ArrowRight');
    await key(node('t_start')!, 'ArrowRight');
    await key(node('t_start')!, 'ArrowDown', { shiftKey: true });
    expect(layoutOf(app).t_start).toEqual({ x: x0 + 32, y: y0 + 64 });
    expect(JSON.stringify(logicOf(app))).toBe(before);
    expect(app.store.dirtyFiles()).toEqual(['logic.layout.json']);
    app.store.undo();
    expect(layoutOf(app).t_start).toBeUndefined();
  });

  it('Ctrl+D nhân bản (đầu ra theo id mới, cạnh khối gốc); Delete xóa khối và vị trí của nó, một bước', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { node, key } = await open(app);
    await key(node('c_starts')!, 'd', { ctrlKey: true });
    expect(logicOf(app).counters?.map((c) => c.id)).toEqual(['c_starts', 'c_starts_2']);
    expect(logicOf(app).counters?.[1]?.value).toBe('LOGIC.C_STARTS_2.VALUE');
    const p = layoutOf(app);
    expect(p.c_starts_2).toEqual({ x: p.c_starts!.x + 32, y: p.c_starts!.y + 32 });
    await key(node('c_starts_2')!, 'Delete');
    expect(logicOf(app).counters?.map((c) => c.id)).toEqual(['c_starts']);
    expect(layoutOf(app).c_starts_2).toBeUndefined();
    app.store.undo();
    expect(logicOf(app).counters?.map((c) => c.id)).toEqual(['c_starts', 'c_starts_2']);
    expect(layoutOf(app).c_starts_2).toBeDefined();
  });

  it('đổi id ở Inspector: vị trí trên sơ đồ đi theo id mới (cùng một bước hoàn tác)', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { insp, node, key, again } = await open(app);
    await key(node('t_start')!, 'ArrowDown');
    const p = layoutOf(app).t_start!;
    const id = insp.querySelector<HTMLInputElement>('[data-field="id"]')!;
    expect(id.value).toBe('t_start');
    id.value = 't_main';
    id.dispatchEvent(new Event('change', { bubbles: true }));
    await again();
    expect(logicOf(app).timers?.[0]?.id).toBe('t_main');
    expect(layoutOf(app).t_main).toEqual(p);
    expect(layoutOf(app).t_start).toBeUndefined();
    app.store.undo();
    expect(layoutOf(app).t_start).toEqual(p);
  });

  it('thả khối từ task card: thêm ở chỗ thả (căn lưới), chọn khối mới; một bước hoàn tác', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { dia, again } = await open(app);
    const view = dia.querySelector('.lgd-view')!;
    view.dispatchEvent(dropEvent('dragover', { [LOGIC_BLOCK_MIME]: 'timer' }));
    view.dispatchEvent(dropEvent('drop', { [LOGIC_BLOCK_MIME]: 'timer' }, 500, 300));
    await again();
    expect(logicOf(app).timers?.map((t) => t.id)).toEqual(['t_start', 't_1']);
    const p = layoutOf(app).t_1!;
    expect(p.x % 16).toBe(0);
    expect(p.y % 16).toBe(0);
    expect(dia.querySelector('g[data-node="t_1"]')?.classList.contains('sel')).toBe(true);
    app.store.undo();
    expect(logicOf(app).timers).toHaveLength(1);
    expect(layoutOf(app).t_1).toBeUndefined();
  });

  it('thả cổng NOT vào cổng in của timer: bọc biểu thức; thả Tag vào chân: nối Tag', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { dia, again } = await open(app);
    const pin = () => dia.querySelector('g[data-node="t_start"] [data-pin="in"] .pt-dot')!;
    pin().dispatchEvent(dropEvent('drop', { [LOGIC_GATE_MIME]: 'not' }));
    await again();
    expect(logicOf(app).timers?.[0]?.in).toBe('!PUMP01.RUN_CMD');
    const notPin = dia.querySelector('g.gate.g-not [data-pin="p0"] .pt-dot')!;
    notPin.dispatchEvent(dropEvent('drop', { 'text/plain': 'PUMP01.RUN' }));
    await again();
    expect(logicOf(app).timers?.[0]?.in).toBe('!PUMP01.RUN');
  });

  it('Tự sắp xếp: ghi vị trí mọi khối (một bước); không đổi thì không thêm bước', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { dia, again } = await open(app);
    const arrange = () => dia.querySelector<HTMLButtonElement>('[data-act="arrange"]')!.click();
    arrange();
    await again();
    expect(Object.keys(layoutOf(app)).sort()).toEqual([
      'c_starts',
      'h_pump',
      'pump_high_level',
      'pump_low_level',
      's_day',
      't_start',
      'w_pump_run',
      'z_flow',
    ]);
    const past = app.store.state.history.past.length;
    arrange();
    await again();
    expect(app.store.state.history.past.length).toBe(past);
  });
});

describe('giá trị sống và lỗi', () => {
  it('Thử logic: Tag mức 85 → cổng "> 80" xanh, dây ra xanh, chip trạng thái trên khối, Ghi PLC hiện giá trị', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { dia, again } = await open(app);
    setDockTab(app, 'test');
    const sim = logicSim(app)!;
    sim.step();
    sim.setManual('TANK01.LEVEL', { value: 85, quality: 'GOOD' });
    sim.run(80);
    simChanged(app);
    dia.requestUpdate();
    await again();
    const gt = [...dia.querySelectorAll<SVGGElement>('g.gate')].find((g) =>
      /> 80/.test(g.textContent ?? ''),
    )!;
    expect(gt.classList.contains('on')).toBe(true);
    expect(dia.querySelector(`g.wr.on`)).not.toBeNull();
    expect(dia.querySelector('g.opn[data-tag="TANK01.LEVEL"] .pv')?.textContent).toBe('85');
    expect(dia.querySelector('g[data-node="pump_high_level"] .nd-live')?.textContent).toContain(
      'OK',
    );
    expect(dia.querySelector('g[data-node="w_pump_run"] .nd-extra')?.textContent).toBe('= false');
    expect(dia.querySelector('[data-role="live"]')?.textContent).toContain('Thử logic');
  });

  it('lỗi của validator: cổng vào và viền khối đỏ; nhấp đúp lỗi chọn khối trên sơ đồ', async () => {
    const { app } = await newLogicApp(pumpLogic(), 'diagram');
    const { dia, insp, again } = await open(app);
    const doc = structuredClone(logicOf(app));
    doc.timers![0]!.in = 'FLOW01';
    app.store.edit([{ kind: 'logicSet', doc }]);
    await again();
    const t = dia.querySelector('g[data-node="t_start"]')!;
    expect(t.classList.contains('err')).toBe(true);
    expect(t.querySelector('[data-pin="in"]')?.classList.contains('err')).toBe(true);
    expect(t.getAttribute('aria-label')).toContain('có lỗi');
    const issue = insp.querySelector<HTMLElement>(
      'mat-logic-dock .issue[data-code="E_LOGIC_TYPE"]',
    )!;
    expect(issue).not.toBeNull();
    issue.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await again();
    expect(dia.querySelector('g[data-node="t_start"]')?.classList.contains('sel')).toBe(true);
  });

  it('Online: chip trạng thái của thiết bị trên khối luật (THROTTLED, số lần bắn)', async () => {
    vi.useFakeTimers();
    const env = await newLogicOnlineApp('on', 'diagram');
    apps.push(env.app);
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await vi.advanceTimersByTimeAsync(50);
    await env.app.login('admin', env.pw('admin'));
    await vi.advanceTimersByTimeAsync(400);
    env.app.openEditor('logic');
    const host = document.createElement('div');
    document.body.append(host);
    const draw = () => render(renderEditor(env.app, 'logic'), host);
    draw();
    env.app.subscribe(draw);
    await vi.advanceTimersByTimeAsync(700);
    await settled(document.body);
    const dia = host.querySelector<LogicDiagram>('mat-logic-diagram')!;
    dia.requestUpdate();
    await settled(document.body);
    const hi = dia.querySelector('g[data-node="pump_high_level"]')!;
    expect(hi.classList.contains('st-THROTTLED')).toBe(true);
    expect(hi.querySelector('.nd-live')?.textContent).toContain('15 lần');
    expect(hi.querySelector('.nd-live')?.textContent).toContain('THROTTLED');
    expect(dia.querySelector('[data-role="live"]')?.textContent).toContain('Online');
  });
});
