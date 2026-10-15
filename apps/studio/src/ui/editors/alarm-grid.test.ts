// Editor Danh sách alarm và Lớp alarm (T070, FR-074 đến FR-079): cột và chữ ô, sửa tại ô một bước hoàn tác, lỗi theo ô từ
// bộ kiểm tra, bảng Khu vực, chi tiết dòng (Xem trước nội dung, gợi ý thẻ), bộ lọc nhanh, editor Lớp (xem trước, xóa lớp
// đang dùng, khóa Xác nhận khi hết), trang nâng cấp cho project cũ.
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { full05, full05WithAlarms } from '../../model/alarm-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './alarm-grid.ts';
import './alarm-classes.ts';
import './alarm-upgrade.ts';
import type { AlarmGridEditor } from './alarm-grid.ts';
import type { AlarmClassesEditor } from './alarm-classes.ts';

afterEach(cleanup);

const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
interface AlarmRec {
  id: string;
  name: string;
  tag: string;
  type: string;
  onDelayMs?: number;
  limits: { H: { value: number; class: string } };
}
interface ClassRec {
  id: string;
  color: string;
}
const alarms = (app: StudioApp) =>
  (app.store.state.outline.alarms?.alarms ?? []) as unknown as AlarmRec[];
const classes = (app: StudioApp) =>
  (app.store.state.outline.alarmClasses?.classes ?? []) as unknown as ClassRec[];

async function open05(files?: Record<string, string>) {
  const env = await newApp02({ files: files ?? (await full05WithAlarms()) });
  return env;
}

async function openGrid(files?: Record<string, string>) {
  const env = await open05(files);
  env.app.openEditor('alarms');
  const el = await mount<AlarmGridEditor>('mat-alarm-grid', env.app);
  await settled(el);
  return { ...env, el };
}

async function click(el: Element, r: number, c: string) {
  cell(el, r, c)!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await settled(el);
}
const key = async (target: Element, k: string, init: KeyboardEventInit = {}) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
  await settled(target);
};
async function typeCell(el: Element, r: number, c: string, value: string) {
  await click(el, r, c);
  ta(el).value = value;
  ta(el).dispatchEvent(new InputEvent('input', { data: value, bubbles: true }));
  await settled(el);
  await key(ta(el), 'Enter');
}

describe('mat-alarm-grid: bố cục (§3.1)', () => {
  it('tiêu đề, đường dẫn, 16 cột và mỗi alarm một dòng; chữ ô theo loại', async () => {
    const { el, app } = await openGrid();
    expect(text(el.querySelector('h2'))).toBe('Danh sách alarm');
    expect(el.querySelector('.path')?.textContent).toBe('alarms.json');
    const heads = [...el.querySelectorAll('[role="columnheader"]')].map(text);
    expect(heads).toHaveLength(16);
    expect(heads.slice(0, 5)).toEqual(['Id', 'Tên', 'Loại', 'Tag / Thiết bị', 'Điều kiện']);
    expect(el.querySelectorAll('[role="row"][data-r]')).toHaveLength(3);
    expect(text(cell(el, 0, 'type'))).toBe('Ngưỡng');
    expect(text(cell(el, 0, 'H'))).toBe('80');
    expect(text(cell(el, 0, 'class'))).toBe('HH: Khẩn cấp, H: Nhỏ');
    expect(text(cell(el, 0, 'area'))).toBe('Bồn nước');
    expect(text(cell(el, 1, 'cond'))).toBe('Khi bật');
    expect(cell(el, 1, 'HH')!.getAttribute('aria-readonly')).toBe('true');
    expect(text(el.querySelector('[data-role="statusbar"]'))).toContain('4 instance / 500');
    void app;
  });

  it('project 0.3 (chưa nâng cấp): trang "Nâng cấp lên 0.5.0" thay lưới, không nhãn giai đoạn', async () => {
    const env = await newApp02();
    const el = await mount<AlarmGridEditor>('mat-alarm-grid', env.app);
    await settled(el);
    expect(el.querySelector('mat-alarm-upgrade')).not.toBeNull();
    expect(text(el)).toContain('Nâng cấp lên 0.5.0');
    expect(text(el)).not.toContain('GĐ 4');
  });
});

describe('mat-alarm-grid: sửa tại ô', () => {
  it('gõ rồi Enter ghi alarms.json; một bước hoàn tác; file chưa lưu', async () => {
    const { app, el } = await openGrid();
    await typeCell(el, 0, 'H', '85');
    expect(alarms(app)[0]!.limits.H.value).toBe(85);
    expect(app.store.dirtyFiles()).toContain('alarms.json');
    await app.run('edit.undo');
    await settled(el);
    expect(alarms(app)[0]!.limits.H.value).toBe(80);
  });

  it('trễ nhập bằng giây lưu mili-giây; tên có dấu tiếng Việt giữ nguyên', async () => {
    const { app, el } = await openGrid();
    await typeCell(el, 1, 'onDelay', '2,5');
    expect(alarms(app)[1]!.onDelayMs).toBe(2500);
    await typeCell(el, 1, 'name', 'Bơm số 1 hỏng');
    expect(alarms(app)[1]!.name).toBe('Bơm số 1 hỏng');
  });

  it('ngưỡng sai thứ tự: bộ kiểm tra báo lỗi tại ô H, ô có viền lỗi; sửa lại thì hết', async () => {
    const { app, el } = await openGrid();
    await typeCell(el, 0, 'H', '95');
    await app.store.validateNow();
    await settled(el);
    expect(cell(el, 0, 'H')!.classList.contains('mg-err')).toBe(true);
    expect(cell(el, 0, 'H')!.getAttribute('title')).toContain('LL < L < H < HH');
    expect(text(el.querySelector('[data-role="statusbar"]'))).toContain('1 lỗi');
    await typeCell(el, 0, 'H', '85');
    await app.store.validateNow();
    await settled(el);
    expect(cell(el, 0, 'H')!.classList.contains('mg-err')).toBe(false);
  });

  it('Tag không có: ô Tag viền lỗi nhưng giữ giá trị', async () => {
    const { app, el } = await openGrid();
    await typeCell(el, 1, 'tag', 'KHONG.CO');
    await app.store.validateNow();
    await settled(el);
    expect(alarms(app)[1]!.tag).toBe('KHONG.CO');
    expect(cell(el, 1, 'tag')!.classList.contains('mg-err')).toBe(true);
  });

  it('đổi loại: alarm ngưỡng thành Số xóa các ô ngưỡng', async () => {
    const { app, el } = await openGrid();
    await typeCell(el, 0, 'type', 'Số');
    expect(alarms(app)[0]).toMatchObject({ type: 'digital' });
    expect(alarms(app)[0]).not.toHaveProperty('limits');
  });

  it('thêm dòng bằng lệnh alarm.new: id gợi ý theo số dòng, một bước hoàn tác', async () => {
    const { app, el } = await openGrid();
    app.openEditor('alarms');
    await app.run('alarm.new');
    await settled(el);
    expect(alarms(app)).toHaveLength(4);
    expect(alarms(app)[3]!.id).toBe('ALARM_004');
    await app.run('edit.undo');
    expect(alarms(app)).toHaveLength(3);
  });

  it('project chưa có alarm: lưới trống có gợi ý; thêm alarm đầu tiên tạo cả hai file với bốn lớp', async () => {
    const { app, el } = await openGrid(await full05());
    expect(el.querySelector('[data-role="empty"]')).not.toBeNull();
    await app.run('alarm.new');
    await settled(el);
    expect(alarms(app)).toHaveLength(1);
    expect(classes(app)).toHaveLength(4);
    expect(app.store.dirtyFiles()).toEqual(
      expect.arrayContaining(['alarms.json', 'alarm-classes.json', 'project.json']),
    );
  });
});

describe('mat-alarm-grid: lọc, khu vực, chi tiết', () => {
  it('lọc nhanh theo loại và tìm không dấu', async () => {
    const { el } = await openGrid();
    const sel = el.querySelector<HTMLSelectElement>('[data-role="f-type"]')!;
    sel.value = 'Số';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(el.querySelectorAll('[role="row"][data-r]')).toHaveLength(1);
    sel.value = '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const f = el.querySelector<HTMLInputElement>('[data-role="filter"]')!;
    f.value = 'bom';
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    expect(el.querySelectorAll('[role="row"][data-r]')).toHaveLength(1);
    expect(cell(el, 1, 'id')).not.toBeNull();
  });

  it('thêm khu vực: id gợi ý bỏ dấu; xóa khu vực đang dùng hỏi trước, alarm về Chung', async () => {
    const { app, el } = await openGrid();
    await app.run('alarm.areas.add');
    await settled(el);
    const input = el.querySelector<HTMLInputElement>('input[name="area"]')!;
    input.value = 'Trạm bơm 1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await key(input, 'Enter');
    expect(app.store.state.outline.alarms?.areas?.map((a) => a.id)).toEqual(['bon', 'tram-bom-1']);
    el.querySelector<HTMLButtonElement>(
      '[data-area="bon"] ~ [data-act="area-remove"], li:has([data-area="bon"]) [data-act="area-remove"]',
    )!.click();
    await settled(el);
    expect(el.querySelector('[data-role="area-confirm"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('[data-act="area-confirm"]')!.click();
    await settled(el);
    expect(app.store.state.outline.alarms?.areas?.map((a) => a.id)).toEqual(['tram-bom-1']);
    expect(alarms(app)[0]).not.toHaveProperty('area');
  });

  it('chi tiết dòng ngưỡng: lớp theo ngưỡng, Xem trước nội dung, thẻ lạ báo lỗi, gợi ý thẻ khi gõ {', async () => {
    const { app, el } = await openGrid();
    await click(el, 0, 'id');
    const sel = el.querySelector<HTMLSelectElement>('select[data-th="H"]')!;
    sel.value = 'major';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(alarms(app)[0]!.limits.H.class).toBe('major');
    const inp = el.querySelector<HTMLInputElement>('input[name="text"]')!;
    inp.value = '{name} cao: {value:1} {unit} (ngưỡng {limit})';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(text(el.querySelector('[data-role="text-preview"]'))).toContain(
      'Mức bồn 1 cao: 84.0 % (ngưỡng 80)',
    );
    inp.value = '{lạ}';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(inp.getAttribute('aria-invalid')).toBe('true');
    inp.value = 'Mức {va';
    inp.setSelectionRange(7, 7);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await settled(el);
    expect(
      [...el.querySelectorAll('[data-role="suggest"] button')].map(
        (b) => (b as HTMLElement).dataset.token,
      ),
    ).toEqual(['value', 'value:1']);
  });
});

describe('mat-alarm-classes', () => {
  async function openClasses(files?: Record<string, string>) {
    const env = await open05(files);
    env.app.openEditor('alarmClasses');
    const el = await mount<AlarmClassesEditor>('mat-alarm-classes', env.app);
    await settled(el);
    return { ...env, el };
  }

  it('bốn lớp, cột theo §4, số alarm đang dùng', async () => {
    const { el } = await openClasses();
    const heads = [...el.querySelectorAll('[role="columnheader"]')].map(text);
    expect(heads).toEqual([
      'Id',
      'Tên',
      'Ưu tiên',
      'Màu',
      'Nhấp nháy',
      'Cần xác nhận',
      'Xác nhận khi hết',
      'Âm thanh',
      'Chập chờn (lần/60 s)',
      'Đang dùng',
    ]);
    expect(el.querySelectorAll('[role="row"][data-r]')).toHaveLength(4);
    expect(text(cell(el, 0, 'color'))).toBe('Đỏ');
    expect(text(cell(el, 0, 'inUse'))).toBe('1');
    expect(text(cell(el, 3, 'requiresAck'))).toBe('Tắt');
  });

  it('chọn lớp: panel xem trước có ba hàng mẫu ở hai theme và đúng màu chọn', async () => {
    const { app, el } = await openClasses();
    await click(el, 0, 'id');
    expect(el.querySelectorAll('mat-alarm-table')).toHaveLength(2);
    const swatch = el.querySelector<HTMLButtonElement>('.al-swatch[data-color="purple"]')!;
    swatch.click();
    await settled(el);
    expect(classes(app)[0]!.color).toBe('purple');
  });

  it('Xác nhận khi hết khóa khi lớp không cần xác nhận', async () => {
    const { el } = await openClasses();
    expect(cell(el, 3, 'ackReturn')!.getAttribute('aria-readonly')).toBe('true');
    expect(cell(el, 0, 'ackReturn')!.getAttribute('aria-readonly')).toBeNull();
  });

  it('xóa lớp đang dùng liệt kê chỗ dùng và hỏi; xác nhận thì chỗ dùng thành E_ALARM_CLASS_REF; hoàn tác một bước', async () => {
    const { app, el } = await openClasses();
    await click(el, 0, 'id');
    el.querySelector<HTMLButtonElement>('[data-act="delete"]')!.click();
    await settled(el);
    expect(el.querySelector('[data-role="class-confirm"]')).not.toBeNull();
    expect(classes(app)).toHaveLength(4);
    el.querySelector<HTMLButtonElement>('[data-act="class-confirm"]')!.click();
    await settled(el);
    expect(classes(app).map((c) => c.id)).toEqual(['major', 'minor', 'advisory']);
    await app.store.validateNow();
    expect(app.store.state.issues.some((i) => i.code === 'E_ALARM_CLASS_REF')).toBe(true);
    await app.run('edit.undo');
    expect(classes(app)).toHaveLength(4);
  });

  it('lớp chưa dùng xóa ngay không hỏi', async () => {
    const { app, el } = await openClasses();
    await click(el, 2, 'id');
    await click(el, 3, 'id');
    el.querySelector<HTMLButtonElement>('[data-act="delete"]')!.click();
    await settled(el);
    // lớp advisory không dùng ở alarm nào
    expect(classes(app).map((c) => c.id)).not.toContain('advisory');
  });
});
