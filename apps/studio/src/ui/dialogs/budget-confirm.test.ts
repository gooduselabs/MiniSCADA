// T117 (feature 010, FR-048, contracts/studio-010.md §1.3): chặn mềm khi nạp xuống một cấu hình lưu trữ vượt ngân sách ghi.
// Hộp thoại có nút mặc định Hủy; "Tôi hiểu, vẫn nạp" mới đi tiếp; W_LOG_WRITE_EXTREME phải gõ lại tên project; xác nhận nhớ cho
// đúng băm của ước tính và mất khi số đổi; ghi nhật ký thao tác; lưu và xem trước không bị chặn; Hủy không đổi gì.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { estimateView } from '../../model/estimate-view.ts';
import { tagTypesOf } from '../../model/logging-doc.ts';
import { newHistoryApp, overBudget } from '../history-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import './budget-confirm.ts';

afterEach(cleanup);

const BIG = 20; // ms: mọi nhóm của history-demo ghi 20 ms: vượt 2 GB nhưng chưa tới 8 GB
const HUGE = 1; // ms: cực lớn (> 8 GB mỗi ngày)

const dlg = () => document.querySelector('mat-budget-confirm-dialog')!;
const role = <T extends HTMLElement>(r: string) => dlg().querySelector<T>(`[data-role="${r}"]`);
const warningsOf = (app: StudioApp) => {
  const v = estimateView(app.store.state.outline.logging, tagTypesOf(app.store.state.outline.tags));
  return v.state === 'ok' ? v.warnings : [];
};

async function setup(rows?: number) {
  const env = await newHistoryApp();
  if (rows !== undefined) overBudget(env.app, rows);
  await mount('mat-budget-confirm-dialog', env.app);
  return env;
}

describe('chặn mềm khi nạp xuống (FR-048)', () => {
  it('trong ngân sách: đi tiếp ngay, không hộp thoại', async () => {
    const { app } = await setup();
    const proceed = vi.fn();
    await app.gateDeploy(proceed);
    expect(proceed).toHaveBeenCalledOnce();
    expect(app.ui.dialog).toBeNull();
  });

  it('vượt ngân sách: hộp thoại mở, focus ở Hủy, chưa nạp; nội dung nêu số, nhóm lớn nhất, gợi ý', async () => {
    const { app } = await setup(BIG);
    expect(warningsOf(app)).toContain('W_LOG_WRITE_BUDGET');
    const proceed = vi.fn();
    void app.gateDeploy(proceed);
    await settled();
    expect(app.ui.dialog?.kind).toBe('budgetConfirm');
    expect(proceed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(role('cancel'));
    const text = dlg().textContent ?? '';
    expect(text).toContain('vượt ngân sách ghi');
    expect(text).toContain('GB');
    expect(text).toContain('mòn');
    expect(dlg().querySelector('[data-role="type-name"]')).toBeNull();
    expect(role<HTMLButtonElement>('confirm')!.textContent).toContain('Tôi hiểu, vẫn nạp');
    expect(role<HTMLButtonElement>('confirm')!.disabled).toBe(false);
  });

  it('Hủy (nút hay Esc): không nạp, không nhớ xác nhận, project không đổi', async () => {
    const { app } = await setup(BIG);
    const before = app.store.dirtyFiles();
    const proceed = vi.fn();
    void app.gateDeploy(proceed);
    await settled();
    role<HTMLButtonElement>('cancel')!.click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
    expect(app.budget.confirmedHash).toBeNull();
    expect(app.store.dirtyFiles()).toEqual(before);
    void app.gateDeploy(proceed);
    await settled();
    press(role('cancel')!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
  });

  it('Tôi hiểu, vẫn nạp: đi tiếp một lần, nhớ cho đúng băm, ghi nhật ký thao tác', async () => {
    const { app } = await setup(BIG);
    const proceed = vi.fn();
    void app.gateDeploy(proceed);
    await settled();
    role<HTMLButtonElement>('confirm')!.click();
    await settled();
    expect(proceed).toHaveBeenCalledOnce();
    expect(app.ui.dialog).toBeNull();
    expect(app.budget.confirmedHash).not.toBeNull();
    expect(app.budget.log).toHaveLength(1);
    expect(app.budget.log[0]).toMatchObject({
      hash: app.budget.confirmedHash,
      level: 'soft',
      project: 'Demo lịch sử và báo cáo',
    });
    // Lần nạp kế tiếp với cùng số ước tính: không hỏi lại.
    const again = vi.fn();
    await app.gateDeploy(again);
    expect(again).toHaveBeenCalledOnce();
    expect(app.ui.dialog).toBeNull();
  });

  it('xác nhận mất khi số ước tính đổi (sửa cấu hình rồi nạp lại phải xác nhận lại)', async () => {
    const { app } = await setup(BIG);
    void app.gateDeploy(vi.fn());
    await settled();
    role<HTMLButtonElement>('confirm')!.click();
    await settled();
    overBudget(app, BIG + 5);
    const proceed = vi.fn();
    void app.gateDeploy(proceed);
    await settled();
    expect(app.ui.dialog?.kind).toBe('budgetConfirm');
    expect(proceed).not.toHaveBeenCalled();
    // Đưa về dưới ngân sách: đi tiếp mà không hỏi.
    role<HTMLButtonElement>('cancel')!.click();
    await settled();
    overBudget(app, 60_000);
    expect(warningsOf(app)).toEqual([]);
    const ok = vi.fn();
    await app.gateDeploy(ok);
    expect(ok).toHaveBeenCalledOnce();
  });

  it('cực lớn: phải gõ lại tên project mới mở nút tiếp tục (so khớp chính xác)', async () => {
    const { app } = await setup(HUGE);
    expect(warningsOf(app)).toContain('W_LOG_WRITE_EXTREME');
    const proceed = vi.fn();
    void app.gateDeploy(proceed);
    await settled();
    const input = role<HTMLInputElement>('type-name')!;
    expect(input).not.toBeNull();
    expect(role<HTMLButtonElement>('confirm')!.disabled).toBe(true);
    input.value = 'demo lịch sử và báo cáo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();
    expect(role<HTMLButtonElement>('confirm')!.disabled).toBe(true);
    input.value = 'Demo lịch sử và báo cáo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();
    expect(role<HTMLButtonElement>('confirm')!.disabled).toBe(false);
    role<HTMLButtonElement>('confirm')!.click();
    await settled();
    expect(proceed).toHaveBeenCalledOnce();
    expect(app.budget.log[0]).toMatchObject({ level: 'extreme' });
  });

  it('lưu và xem trước không bị chặn', async () => {
    const { app } = await setup(HUGE);
    const r = await app.save();
    expect(r.status).toBe('saved');
    expect(app.ui.dialog).toBeNull();
    app.openEditor('logging');
    expect(app.ui.dialog).toBeNull();
  });
});
