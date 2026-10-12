// Hộp thoại Xác nhận ghi và phần ghi của Bảng theo dõi (feature 006, T151, US2, FR-050, FR-040, mockup d-wr): liệt kê từng Tag với
// thiết bị trường, giá trị hiện tại, giá trị mới, đơn vị, giới hạn — theo định nghĩa trên BL335 — kèm cảnh báo khác bản trên máy;
// chỉ ghi khi bấm Ghi (Enter ở nơi khác không ghi, Esc hủy); mỗi dòng hiện kết quả và thời điểm; bàn phím, ARIA.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { newWriteEnv, textOf } from '../online-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import '../editors/watch-table-editor.ts';
import type { WatchTableEditor } from '../editors/watch-table-editor.ts';
import './login-dialog.ts';
import './write-confirm-dialog.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const rows = (app: StudioApp) => app.store.state.outline.watchTables[0].doc!.rows;

async function setup(role: Parameters<typeof newWriteEnv>[1] = 'kysu1') {
  const env = await newWriteEnv(vi, role);
  env.app.openEditor('watch:van-hanh');
  const el = await mount<WatchTableEditor>('mat-watch-table-editor', env.app);
  el.tableId = 'van-hanh';
  await mount('mat-write-confirm-dialog', env.app);
  await mount('mat-login-dialog', env.app);
  await env.advance(20);
  await settled(el);
  return { ...env, el, dlg: () => document.querySelector('mat-write-confirm-dialog')! };
}

async function selectRow(el: Element, r: number) {
  cell(el, r, 'tag')!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await settled(el);
}
const btn = (el: Element, act: string) =>
  el.querySelector<HTMLButtonElement>(`.ed-tools [data-act="${act}"]`)!;
async function setWriteValue(app: StudioApp, row: number, value: string) {
  const doc = app.store.state.outline.watchTables[0].doc!;
  const next = doc.rows.map((r, i) => (i === row ? { ...r, writeValue: value } : r));
  app.store.edit([{ kind: 'watchTableUpsert', table: { ...doc, rows: next } }]);
  await settled();
}

describe('khóa lệnh Ghi kèm lý do', () => {
  it('Offline (chưa đăng nhập): nút Ghi khóa, tooltip nói cần Online; bấm chỉ báo lý do, không mở hộp thoại', async () => {
    const { el, app } = await setup(null);
    await selectRow(el, 0);
    const b = btn(el, 'write');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.title).toContain('Online');
    b.click();
    expect(app.ui.dialog).toBeNull();
    expect(app.ui.toast?.text).toContain('Online');
  });

  it('viewer: khóa vì cần operator; không có yêu cầu nào tới thiết bị', async () => {
    const { el, app, dev } = await setup('xem1');
    await selectRow(el, 0);
    expect(btn(el, 'write').title).toContain('operator');
    btn(el, 'write').click();
    expect(app.ui.dialog).toBeNull();
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
  });

  it('chưa chọn dòng: Ghi dòng đã chọn khóa kèm lý do; Ghi tất cả hoạt động', async () => {
    const { el } = await setup();
    expect(btn(el, 'write').getAttribute('aria-disabled')).toBe('true');
    expect(btn(el, 'write').title).toContain('Chọn một hoặc nhiều dòng');
    expect(btn(el, 'writeAll').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('mat-write-confirm-dialog', () => {
  it('liệt kê từng Tag: thiết bị trường, hiện tại, giá trị mới, giới hạn theo BL335; focus ở Hủy; chưa gửi gì', async () => {
    const { el, app, dev, dlg } = await setup();
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    expect(app.ui.dialog).toEqual({ kind: 'writeConfirm' });
    const d = dlg();
    expect(d.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    const row = d.querySelector('tr[data-tag="TANK01.SP"]')!;
    expect(textOf(row)).toContain('plc1 · HR200 · FLOAT32 · CDAB');
    expect(textOf(row)).toContain('75');
    expect(textOf(row)).toContain('%');
    expect(textOf(row)).toContain('0 đến 90');
    expect(textOf(row)).toContain('Sẽ ghi');
    expect(document.activeElement).toBe(d.querySelector('[data-role="cancel"]'));
    expect(textOf(d.querySelector('[data-role="confirm"]'))).toBe('Ghi 1 lệnh');
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
  });

  it('Enter ở nơi khác không ghi; Esc hủy; nút Hủy cũng vậy: 0 lệnh tới thiết bị', async () => {
    const { el, app, dev, dlg } = await setup();
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    press(dlg().querySelector('[data-role="cancel"]')!, 'Enter');
    press(dlg().querySelector('.wc-table')!, 'Enter');
    await vi.advanceTimersByTimeAsync(300);
    expect(app.ui.dialog).toEqual({ kind: 'writeConfirm' });
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
    press(dlg().querySelector('[role="dialog"]')!.parentElement!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.writes.draft).toBeNull();
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
  });

  it('bấm Ghi: gửi đúng một lệnh với giá trị đã hiểu; dòng hiện đang gửi rồi đã xác nhận kèm đọc lại và thời điểm', async () => {
    const { el, app, dev, dlg } = await setup();
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.click();
    await vi.advanceTimersByTimeAsync(20);
    await settled(el);
    expect(app.ui.dialog).toBeNull();
    expect(dev.control.writeLog('BL335-01')).toMatchObject([{ tag: 'TANK01.SP', value: 75 }]);
    expect(textOf(cell(el, 0, 'result'))).toMatch(/Đã nhận|Đang gửi|đang gửi/);
    await vi.advanceTimersByTimeAsync(600);
    await settled(el);
    const result = textOf(cell(el, 0, 'result'));
    expect(result).toContain('Đã xác nhận');
    expect(result).toContain('thiết bị trường đã ghi và đọc lại đúng');
    expect(result).toContain('đọc lại 75');
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}$/);
    expect(app.ui.toast?.text).toContain('Đã gửi 1 lệnh ghi');
  });

  it('95 ngoài giới hạn 0–90: dòng bị khóa kèm khoảng, nút Ghi khóa, không gửi', async () => {
    const { el, app, dev, dlg } = await setup();
    await setWriteValue(app, 0, '95');
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    const row = dlg().querySelector('tr[data-tag="TANK01.SP"]')!;
    expect(textOf(row)).toContain('Không gửi');
    expect(textOf(row)).toContain('Ngoài giới hạn ghi của Tag (0 đến 90)');
    expect(dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.disabled).toBe(true);
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
  });

  it('"12,5": lỗi kèm gợi ý "12.5"; Tag chỉ đọc (PUMP01.STATE): khóa vì chỉ đọc', async () => {
    const { el, app, dlg } = await setup();
    await setWriteValue(app, 0, '12,5');
    await setWriteValue(app, 1, '3');
    await selectRow(el, 0);
    btn(el, 'writeAll').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    expect(textOf(dlg().querySelector('tr[data-tag="TANK01.SP"]'))).toContain(
      'Dùng dấu chấm thập phân, ví dụ 12.5',
    );
    expect(textOf(dlg().querySelector('tr[data-tag="PUMP01.STATE"]'))).toContain('Tag chỉ đọc');
  });

  it('Ghi tất cả: mọi dòng có giá trị ghi; mỗi dòng có kết quả riêng, NO_READBACK ghi "không đọc lại"', async () => {
    const { el, app, dev, dlg } = await setup();
    dev.control.setWriteBehavior('BL335-01', (req) =>
      req.tag === 'PUMP01.RUN_CMD'
        ? { status: 'CONFIRMED', code: 'NO_READBACK', delayMs: 100 }
        : { status: 'CONFIRMED', code: 'CONFIRMED', delayMs: 100 },
    );
    btn(el, 'writeAll').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    const tags = [...dlg().querySelectorAll('tr[data-tag]')].map(
      (r) => (r as HTMLElement).dataset.tag,
    );
    expect(tags).toEqual(['TANK01.SP', 'PUMP01.RUN_CMD']);
    expect(textOf(dlg().querySelector('[data-role="confirm"]'))).toBe('Ghi 2 lệnh');
    dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.click();
    await vi.advanceTimersByTimeAsync(800);
    await settled(el);
    expect(dev.control.writeLog('BL335-01').map((x) => x.tag)).toEqual([
      'TANK01.SP',
      'PUMP01.RUN_CMD',
    ]);
    expect(textOf(cell(el, 2, 'result'))).toContain('thiết bị xác nhận, không đọc lại');
    expect(app.writes.flow.row('van-hanh:0:TANK01.SP')?.state).toBe('confirmed');
  });

  it('TIMEOUT ghi "không chắc đã ghi"; FAILED kèm exception và nghĩa', async () => {
    const { el, dev, dlg } = await setup();
    dev.control.setWriteBehavior('BL335-01', {
      status: 'TIMEOUT',
      code: 'WRITE_TIMEOUT',
      delayMs: 100,
    });
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.click();
    await vi.advanceTimersByTimeAsync(800);
    await settled(el);
    expect(textOf(cell(el, 0, 'result'))).toContain('không chắc đã ghi');
    dev.control.setWriteBehavior('BL335-01', {
      status: 'FAILED',
      code: 'DEVICE_EXCEPTION',
      exception: { code: '02', meaning: 'địa chỉ không hợp lệ' },
      delayMs: 100,
    });
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.click();
    await vi.advanceTimersByTimeAsync(800);
    await settled(el);
    const r = textOf(cell(el, 0, 'result'));
    expect(r).toContain('Ghi lỗi');
    expect(r).toContain('02: địa chỉ không hợp lệ');
  });

  it('định nghĩa trên BL335 khác bản trên máy: cảnh báo nêu từng trường', async () => {
    const { el, app, dev, files, dlg } = await setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tags = (JSON.parse(files['tags.json']) as { tags: Array<Record<string, any>> }).tags;
    tags[1].source.address = 'HR201';
    dev.control.setActiveOverride('BL335-01', { tags });
    await app.writes.loadDefs();
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    const diff = dlg().querySelector('[data-role="diff"]')!;
    expect(textOf(diff)).toContain('khác bản trên máy');
    expect(textOf(diff)).toContain('source.address: HR200 ≠ HR201');
  });

  it('phiên hết hạn: hỏi đăng nhập lại, dòng chờ xác nhận lại, KHÔNG tự gửi lại sau khi đăng nhập', async () => {
    const { el, app, dev, dlg, pw } = await setup();
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    dev.control.endSession('BL335-01');
    dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.click();
    await vi.advanceTimersByTimeAsync(300);
    await settled(el);
    expect(app.writes.flow.row('van-hanh:0:TANK01.SP')?.state).toBe('relogin');
    expect(textOf(cell(el, 0, 'result'))).toContain('đăng nhập lại');
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
    expect(app.ui.dialog?.kind).toBe('login');
    await app.login('kysu1', pw('kysu1'));
    await vi.advanceTimersByTimeAsync(500);
    await settled(el);
    expect(dev.control.writeLog('BL335-01')).toEqual([]);
    expect(app.writes.flow.row('van-hanh:0:TANK01.SP')).toBeUndefined();
    expect(textOf(cell(el, 0, 'result'))).toBe('');
  });
});

describe('mất mạng sau khi gửi (US2-10)', () => {
  it('dòng chưa rõ kết quả: hiện giải thích, nút Hỏi lại kết quả hỏi theo mã; thiết bị chỉ nhận MỘT lệnh', async () => {
    const { el, app, dev, dlg } = await setup();
    dev.control.loseNextWriteReply('BL335-01');
    await selectRow(el, 0);
    btn(el, 'write').click();
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    dlg().querySelector<HTMLButtonElement>('[data-role="confirm"]')!.click();
    await vi.advanceTimersByTimeAsync(300);
    await settled(el);
    expect(app.writes.flow.row('van-hanh:0:TANK01.SP')?.state).toBe('unknown');
    expect(textOf(cell(el, 0, 'result'))).toContain('chưa rõ');
    expect(textOf(cell(el, 0, 'result'))).toContain('không gửi lại');
    expect(dev.control.writeLog('BL335-01')).toHaveLength(1);
    expect(btn(el, 'recheck')).toBeTruthy();
    btn(el, 'recheck').click();
    await vi.advanceTimersByTimeAsync(400);
    await settled(el);
    expect(textOf(cell(el, 0, 'result'))).toContain('Đã xác nhận');
    expect(dev.control.writeLog('BL335-01')).toHaveLength(1);
    expect(el.querySelector('[data-act="recheck"]')).toBeNull();
  });
});

describe('phím tắt Ghi', () => {
  it('Ctrl+Shift+Enter chạy lệnh Ghi dòng đã chọn qua hộp xác nhận', async () => {
    const { el, app } = await setup();
    await selectRow(el, 0);
    await app.run('watch.write');
    await vi.advanceTimersByTimeAsync(50);
    await settled();
    expect(app.ui.dialog).toEqual({ kind: 'writeConfirm' });
    expect(rows(app)).toHaveLength(3);
  });
});
