// Editor Logic (feature 011, T132/T144; FR-094; mockup studio-logic.html cảnh 1, T007 quyết định 2, 3): nút Logic trên cây
// (bảy nhóm), một tab "Logic" đổi nhóm bằng thanh nhóm, bảng khối có lỗi theo ô, thêm/xóa/đổi id, khung dưới chia Inspector
// (trái) và Thông tin (phải, danh sách lỗi nhấp đúp tới ô), kiểm khi gõ bằng validator TS, project chưa có logic.json.
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogicDoc } from '@mat/project-schema';
import type { StudioApp } from '../../app/app.ts';
import { findNode } from '../../model/tree.ts';
import '../mat-inspector.ts';
import type { MatInspector } from '../mat-inspector.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import { newLogicApp } from './logic-test-helpers.ts';
import './logic-editor.ts';

afterEach(cleanup);

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const logicOf = (app: StudioApp) => app.store.state.outline.logic as LogicDoc;

async function open(app: StudioApp) {
  app.openEditor('logic');
  const host = document.createElement('div');
  document.body.append(host);
  const draw = () => render(renderEditor(app, 'logic'), host);
  draw();
  app.subscribe(draw);
  const insp = await mount<MatInspector>('mat-inspector', app);
  await settled(document.body);
  const ed = host.querySelector<HTMLElement>('mat-logic-editor')!;
  expect(ed, 'editor Logic đã đăng ký').not.toBeNull();
  const again = () => settled(document.body);
  return { ed, insp, again };
}

const rows = (ed: Element) =>
  [...ed.querySelectorAll<HTMLTableRowElement>('table.lg-grid tbody tr[data-id]')].map(
    (r) => r.dataset.id,
  );
const seg = (ed: Element, kind: string) =>
  ed.querySelector<HTMLButtonElement>(`.lg-seg button[data-kind="${kind}"]`)!;
const field = <T extends HTMLElement = HTMLInputElement>(insp: Element, name: string) =>
  insp.querySelector<T>(`[data-field="${name}"]`)!;
const change = (el: HTMLInputElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('cây project: nút Logic', () => {
  it('project 1.0: Logic dưới thiết bị với bảy nhóm, số khối, huy hiệu lỗi', async () => {
    const { app } = await newLogicApp();
    const node = findNode(app.tree(), 'logic')!;
    expect(node.label).toBe('Logic');
    expect(node.editor).toBe('logic');
    expect(node.children?.map((c) => [c.id, c.label, c.count])).toEqual([
      ['logic:rule', 'Luật', 2],
      ['logic:timer', 'Timer', 1],
      ['logic:counter', 'Counter', 1],
      ['logic:totalizer', 'Cộng dồn', 1],
      ['logic:runhours', 'Giờ chạy', 1],
      ['logic:schedule', 'Lịch', 1],
      ['logic:writes', 'Ghi PLC', 1],
    ]);
    // Nhấp một nhóm mở cùng tab Logic và đổi nhóm.
    app.selectNode('logic:timer', true);
    expect(app.store.state.active).toBe('logic');
    const { ed } = await open(app);
    expect(seg(ed, 'timer').getAttribute('aria-pressed')).toBe('true');
    expect(rows(ed)).toEqual(['t_start']);
  });
});

describe('bảng khối', () => {
  it('nhóm Luật: cột theo mockup, đổi nhóm bằng thanh nhóm, đếm khối/giới hạn', async () => {
    const { app } = await newLogicApp();
    const { ed, again } = await open(app);
    expect(rows(ed)).toEqual(['pump_high_level', 'pump_low_level']);
    const heads = [...ed.querySelectorAll('table.lg-grid thead th')].map((th) => text(th));
    expect(heads.slice(0, 6)).toEqual(['#', 'Id', 'Tên', 'Bật', 'Khi when', 'Giữ ms']);
    expect(text(ed.querySelector('.lg-counts'))).toContain('Luật 2/200');
    seg(ed, 'writes').click();
    await again();
    expect(rows(ed)).toEqual(['w_pump_run']);
    expect(text(ed.querySelector('tr[data-id="w_pump_run"]'))).toContain(
      'pump_high_level, pump_low_level',
    );
  });

  it('thêm khối từ menu: id gợi ý, dòng mới được chọn; xóa; hoàn tác', async () => {
    const { app } = await newLogicApp();
    const { ed, insp, again } = await open(app);
    ed.querySelector<HTMLButtonElement>('[data-act="add"]')!.click();
    await again();
    ed.querySelector<HTMLButtonElement>('[role="menu"] [data-add="timer"]')!.click();
    await again();
    expect(logicOf(app).timers?.map((t) => t.id)).toEqual(['t_start', 't_1']);
    expect(seg(ed, 'timer').getAttribute('aria-pressed')).toBe('true');
    expect(ed.querySelector('tr[data-id="t_1"]')?.classList.contains('sel')).toBe(true);
    expect(field(insp, 'id').value).toBe('t_1');
    ed.querySelector<HTMLButtonElement>('[data-act="delete"]')!.click();
    await again();
    expect(logicOf(app).timers?.map((t) => t.id)).toEqual(['t_start']);
    app.store.undo();
    app.store.undo();
    expect(logicOf(app).timers?.map((t) => t.id)).toEqual(['t_start']);
  });

  it('project 1.0 chưa có logic.json: trang trống mời tạo; tạo thì có tệp và khai trong project.json', async () => {
    const { app } = await newLogicApp(null);
    expect(findNode(app.tree(), 'logic')?.count).toBe(0);
    const { ed, again } = await open(app);
    const create = ed.querySelector<HTMLButtonElement>('[data-act="create"]')!;
    expect(create).not.toBeNull();
    create.click();
    await again();
    expect(app.store.state.outline.logicFile).toBe('logic.json');
    expect(app.store.dirtyFiles()).toEqual(expect.arrayContaining(['logic.json', 'project.json']));
  });
});

describe('Inspector (trái) và Thông tin (phải) ở khung dưới', () => {
  it('chọn luật: ba nhóm Chung, Điều kiện, Hành động; sửa hold thì logic.json đổi (một bước hoàn tác)', async () => {
    const { app } = await newLogicApp();
    const { ed, insp, again } = await open(app);
    ed.querySelector<HTMLTableRowElement>('tr[data-id="pump_low_level"]')!.click();
    await again();
    const dock = insp.querySelector('mat-logic-dock')!;
    expect(dock).not.toBeNull();
    expect([...dock.querySelectorAll('.igrp h4')].map((h) => text(h))).toEqual([
      'Chung',
      'Điều kiện',
      expect.stringMatching(/^Hành động 1 \/ 8$/),
    ]);
    expect(dock.querySelector('mat-expression-input[data-field="when"]')).not.toBeNull();
    change(field(insp, 'hold'), '2000');
    await again();
    expect(logicOf(app).rules?.find((r) => r.id === 'pump_low_level')?.hold).toBe(2000);
    app.store.undo();
    expect(logicOf(app).rules?.find((r) => r.id === 'pump_low_level')?.hold).toBe(10000);
  });

  it('đổi id (F2 hoặc ô Id): mọi tham chiếu đổi theo; id trùng thì báo, không đổi', async () => {
    const { app } = await newLogicApp();
    const { ed, insp, again } = await open(app);
    seg(ed, 'writes').click();
    await again();
    change(field(insp, 'id'), 'w_pump');
    await again();
    expect(logicOf(app).writes?.[0]?.id).toBe('w_pump');
    expect(logicOf(app).rules?.every((r) => r.onRise?.[0]?.write === 'w_pump')).toBe(true);
    change(field(insp, 'id'), 't_start');
    await again();
    expect(logicOf(app).writes?.[0]?.id).toBe('w_pump');
    expect(text(insp.querySelector('[data-role="id-msg"]'))).toContain('trùng');
  });

  it('kiểm khi gõ: Tag lạ trong when → ô lỗi trên bảng, dòng E_LOGIC_TAG_REF ở Thông tin; nhấp đúp nhảy tới khối', async () => {
    const { app } = await newLogicApp();
    const { ed, insp, again } = await open(app);
    const edit = (doc: LogicDoc) => app.store.edit([{ kind: 'logicSet', doc }]);
    const doc = structuredClone(logicOf(app));
    doc.rules![1]!.when = 'TANK9.LEVEL < 20';
    edit(doc);
    await again();
    const cell = ed.querySelector('tr[data-id="pump_low_level"] td[data-f="when"]')!;
    expect(cell.classList.contains('cerr')).toBe(true);
    const dock = insp.querySelector('mat-logic-dock')!;
    const issue = dock.querySelector<HTMLElement>('.issue[data-code="E_LOGIC_TAG_REF"]')!;
    expect(issue).not.toBeNull();
    expect(text(issue)).toContain('pump_low_level');
    seg(ed, 'timer').click();
    await again();
    issue.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await again();
    expect(seg(ed, 'rule').getAttribute('aria-pressed')).toBe('true');
    expect(ed.querySelector('tr[data-id="pump_low_level"]')?.classList.contains('sel')).toBe(true);
    // Huy hiệu số lỗi ở tab Thông tin.
    expect(text(dock.querySelector('[data-tab="info"] .badge'))).toBe('1');
  });

  it('nhóm Lịch: khung hằng tuần (ngày, từ, đến) và ngoại lệ; Ghi PLC: Tag thiết bị RW và giá trị cho phép', async () => {
    const { app } = await newLogicApp();
    const { ed, insp, again } = await open(app);
    seg(ed, 'schedule').click();
    await again();
    const dock = insp.querySelector('mat-logic-dock')!;
    expect(dock.querySelectorAll('.week .bar i').length).toBe(6);
    const sat = dock.querySelector<HTMLInputElement>('[data-day="0:6"]')!;
    expect(sat.checked).toBe(true);
    sat.click();
    await again();
    expect(logicOf(app).schedules?.[0]?.weekly[0]?.days).toEqual([1, 2, 3, 4, 5]);
    change(dock.querySelector<HTMLInputElement>('[data-window="0:to"]')!, '17:30');
    await again();
    expect(logicOf(app).schedules?.[0]?.weekly[0]?.to).toBe('17:30');
    expect(
      dock.querySelector<HTMLInputElement>('[data-role="exceptions"] [data-exc="0:date"]')?.value,
    ).toBe('2026-12-25');

    seg(ed, 'writes').click();
    await again();
    expect(field<HTMLSelectElement>(insp, 'tag').value).toBe('PUMP01.RUN_CMD');
    const opts = [...field<HTMLSelectElement>(insp, 'tag').options].map((o) => o.value);
    expect(opts).toContain('VALVE02.SP');
    expect(opts).not.toContain('TANK01.LEVEL'); // chỉ Tag thiết bị RW
    expect(field(insp, 'allowed').value).toBe('true, false');
  });
});
