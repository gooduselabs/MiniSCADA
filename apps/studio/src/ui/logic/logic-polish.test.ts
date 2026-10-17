// Phần còn lại của T144 (feature 011): F8 / Shift+F8 tới lỗi kế / trước của logic.json cả khi focus không ở danh sách lỗi;
// đường thời gian của Thử logic co giãn theo khoảng đã chạy (tín hiệu không dồn ở mép trái) và chiếm hết bề ngang còn lại.
import { afterEach, describe, expect, it } from 'vitest';
import { resolveShortcut } from '../../app/shortcuts.ts';
import { pumpLogic } from '../../model/logic-fixtures.ts';
import { cleanup } from '../test-helpers.ts';
import { newLogicApp } from './logic-test-helpers.ts';
import { kindOf, locatedIssues, selectedId } from './logic-state.ts';
import { timelineWidth, timelineWindow } from './test-panel.ts';

afterEach(cleanup);

const key = (k: string, shift = false) => ({
  key: k,
  ctrlKey: false,
  shiftKey: shift,
  altKey: false,
  metaKey: false,
});

describe('F8 tới lỗi kế (T144)', () => {
  it('F8 / Shift+F8 là logic.nextIssue / logic.prevIssue, cả khi focus trong ô nhập', () => {
    expect(resolveShortcut(key('F8'), { inTextField: false, modal: false })).toEqual({
      command: 'logic.nextIssue',
    });
    expect(resolveShortcut(key('F8', true), { inTextField: true, modal: false })).toEqual({
      command: 'logic.prevIssue',
    });
  });

  it('chạy lần lượt qua các lỗi: chọn đúng nhóm và khối, vòng lại đầu; Shift+F8 đi ngược', async () => {
    const doc = pumpLogic();
    doc.rules![0]!.when = 'TANK9.X > 80';
    doc.timers![0]!.in = 'NOPE.TAG';
    const { app } = await newLogicApp(doc);
    app.openEditor('logic');
    const list = locatedIssues(app).filter((l) => l.target !== null);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(app.enabled('logic.nextIssue')).toBe(true);
    const at = () => `${kindOf(app)}:${selectedId(app)}`;
    const want = list.map((l) => `${l.target!.kind}:${l.target!.id}`);
    await app.run('logic.nextIssue');
    expect(at()).toBe(want[0]);
    await app.run('logic.nextIssue');
    expect(at()).toBe(want[1]);
    for (let i = 2; i < list.length; i++) await app.run('logic.nextIssue');
    await app.run('logic.nextIssue');
    expect(at()).toBe(want[0]);
    await app.run('logic.prevIssue');
    expect(at()).toBe(want[want.length - 1]);
  });

  it('không có lỗi: báo "không có lỗi"; ngoài editor Logic: lệnh khóa', async () => {
    const { app } = await newLogicApp();
    app.openEditor('logic');
    await app.run('logic.nextIssue');
    expect(app.ui.toast?.text).toMatch(/Không có lỗi/);
    app.openEditor('tags');
    expect(app.enabled('logic.nextIssue')).not.toBe(true);
  });
});

describe('đường thời gian Thử logic', () => {
  it('khoảng hiển thị theo thời gian đã chạy (tối thiểu 10 s), tối đa cửa sổ của tốc độ', () => {
    expect(timelineWindow(0, 7_200_000)).toEqual({ t0: 0, t1: 10_000 });
    const w = timelineWindow(150_000, 7_200_000);
    expect(w.t0).toBe(0);
    expect(w.t1).toBeGreaterThanOrEqual(150_000);
    expect(w.t1).toBeLessThanOrEqual(165_000);
    expect(timelineWindow(10_000_000, 7_200_000)).toEqual({ t0: 2_800_000, t1: 10_000_000 });
  });

  it('bề ngang SVG bằng vùng chứa (không ép tối thiểu 560 px khi vùng rộng hơn, không tràn khi hẹp hơn)', () => {
    expect(timelineWidth(1200)).toBe(1200);
    expect(timelineWidth(400)).toBe(400);
    expect(timelineWidth(0)).toBe(900);
    expect(timelineWidth(200)).toBe(320);
  });
});
