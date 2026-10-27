// Task card bên phải theo editor đang mở (feature 011, T144; mockup studio-logic.html cảnh 1 "Khối / Tag"): editor Logic
// thấy khối (kéo vào bảng, nhấp đúp thêm) và Tag (lọc, kéo vào ô biểu thức), không thấy widget của editor Màn hình.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import { readProjectDir, REPO } from '../model/test-fixtures.ts';
import { newLogicApp } from './logic/logic-test-helpers.ts';
import './mat-taskcards.ts';
import type { MatTaskcards } from './mat-taskcards.ts';
import { cleanup, mount, newApp02, settled } from './test-helpers.ts';

afterEach(cleanup);

const openToolbox = (app: StudioApp) => {
  if (!(app.workspace.taskCard === 'toolbox' && app.workspace.taskCardOpen))
    app.setTaskCard('toolbox');
};

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('task card khi editor Logic mở', () => {
  async function setup() {
    const { app } = await newLogicApp();
    app.openEditor('logic');
    openToolbox(app);
    const card = await mount<MatTaskcards>('mat-taskcards', app);
    return { app, card };
  }

  it('tiêu đề "Khối / Tag", bảy khối kèm số dùng / giới hạn, không có widget', async () => {
    const { card } = await setup();
    expect(text(card.querySelector('.tc-panel .pane-h'))).toContain('Khối / Tag');
    expect(text(card.querySelector('#tc-tab-toolbox'))).toContain('Khối / Tag');
    expect(card.querySelector('[data-widget]')).toBeNull();
    const blocks = [...card.querySelectorAll<HTMLElement>('.tc-logic [data-block]')];
    expect(blocks.map((b) => b.dataset.block)).toEqual([
      'rule',
      'timer',
      'counter',
      'totalizer',
      'runhours',
      'schedule',
      'writes',
    ]);
    expect(text(blocks[0])).toMatch(/Luật.*2\/200/);
    expect(blocks.every((b) => b.getAttribute('draggable') === 'true')).toBe(true);
  });

  it('nhấp đúp (hoặc Enter) một khối: thêm khối vào logic.json và chọn nhóm đó', async () => {
    const { app, card } = await setup();
    const before = app.store.state.outline.logic!.timers!.length;
    card
      .querySelector<HTMLElement>('.tc-logic [data-block="timer"]')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settled(card);
    expect(app.store.state.outline.logic!.timers!.length).toBe(before + 1);
    expect(app.logicKind).toBe('timer');
    card
      .querySelector<HTMLElement>('.tc-logic [data-block="counter"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(app.store.state.outline.logic!.counters!.length).toBe(2);
  });

  it('Tag: lọc theo id, mỗi dòng kéo được (text/plain là id Tag)', async () => {
    const { card } = await setup();
    const all = card.querySelectorAll('.tc-logic [data-tag]').length;
    expect(all).toBeGreaterThan(5);
    const input = card.querySelector<HTMLInputElement>('.tc-logic input.tc-tag-filter')!;
    input.value = 'tank01';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(card);
    const ids = [...card.querySelectorAll<HTMLElement>('.tc-logic [data-tag]')].map(
      (r) => r.dataset.tag,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThan(all);
    expect(ids.every((id) => /TANK01/.test(id!))).toBe(true);
    const row = card.querySelector<HTMLElement>('.tc-logic [data-tag]')!;
    expect(row.getAttribute('draggable')).toBe('true');
    const data = new Map<string, string>();
    const ev = new Event('dragstart', { bubbles: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', {
      value: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: '' },
    });
    row.dispatchEvent(ev);
    expect(data.get('text/plain')).toBe(row.dataset.tag);
  });
});

describe('task card khi editor Màn hình mở (không đổi)', () => {
  it('vẫn là Toolbox widget', async () => {
    const env = await newApp02({ files: readProjectDir(resolve(REPO, 'projects/svg-demo')) });
    openToolbox(env.app);
    const card = await mount<MatTaskcards>('mat-taskcards', env.app);
    expect(text(card.querySelector('.tc-panel .pane-h'))).toContain('Toolbox');
    expect(card.querySelector('[data-widget]')).not.toBeNull();
  });
});
