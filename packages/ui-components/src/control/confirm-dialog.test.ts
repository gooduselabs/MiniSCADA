import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TagInfo } from '../host/types.ts';
import { MatConfirmDialog } from './confirm-dialog.ts';
import type { Draft } from './controller.ts';

const INFO: TagInfo = {
  id: 'PUMP01.SP',
  type: 'FLOAT32',
  access: 'RW',
  kind: 'external',
  unit: 'bar',
  description: 'Áp suất đặt bơm 1',
  deviceName: 'PLC-Bơm',
};

function draft(over: Partial<Draft> = {}, value: number | boolean = 55): Draft {
  return {
    spec: { kind: 'write', tag: INFO.id, value, context: { screen: 's', widget: 'w' } },
    info: INFO,
    current: { value: 10, quality: 'GOOD' },
    confirm: 'always',
    ...over,
  };
}

interface Opts {
  draft?: Draft;
  lock?: { code: string; message: string } | null;
  limits?: { min?: number; max?: number };
  decimals?: number;
  table?: MatConfirmDialog['table'];
}

async function mount(o: Opts = {}) {
  const el = new MatConfirmDialog();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  el.draft = o.draft ?? draft();
  el.account = 'an';
  el.lock = (o.lock as MatConfirmDialog['lock']) ?? null;
  el.limits = o.limits ?? { min: 0, max: 100 };
  if (o.decimals !== undefined) el.decimals = o.decimals;
  if (o.table) el.table = o.table;
  el.onConfirm = onConfirm;
  el.onCancel = onCancel;
  document.body.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  return {
    el,
    root,
    onConfirm,
    onCancel,
    text: () => root.textContent ?? '',
    cancel: () => root.querySelector<HTMLButtonElement>('[data-cancel]')!,
    ok: () => root.querySelector<HTMLButtonElement>('[data-ok]')!,
    key: (target: Element, key: string, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          composed: true,
          cancelable: true,
          ...init,
        }),
      ),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('mat-confirm-dialog: nội dung', () => {
  it('role alertdialog, aria-modal, có tiêu đề và mô tả', async () => {
    const m = await mount();
    const dlg = m.root.querySelector('[role="alertdialog"]')!;
    expect(dlg).not.toBeNull();
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const lab = dlg.getAttribute('aria-labelledby')!;
    expect(m.root.getElementById(lab)?.textContent).toBe('Xác nhận ghi giá trị');
    expect(m.root.getElementById(dlg.getAttribute('aria-describedby')!)).not.toBeNull();
  });

  it('hiện Tag, mô tả, thiết bị trường, hiện tại → mới, đơn vị, giới hạn, tài khoản', async () => {
    const m = await mount();
    const t = m.text();
    expect(t).toContain('PUMP01.SP');
    expect(t).toContain('Áp suất đặt bơm 1');
    expect(t).toContain('PLC-Bơm');
    expect(t).toMatch(/10\s*bar\s*→\s*55\s*bar/);
    expect(t).toContain('0 – 100');
    expect(t).toContain('an');
  });

  it('không hiện dòng mô tả/thiết bị khi không có', async () => {
    const d = draft();
    d.info = { id: 'X', type: 'FLOAT32', access: 'RW', kind: 'internal' };
    const m = await mount({ draft: d, limits: {} });
    expect(m.text()).not.toContain('Mô tả');
    expect(m.text()).not.toContain('Thiết bị trường');
    expect(m.text()).toContain('Giới hạn');
  });

  it('dòng "hiện tại" cập nhật khi draft.current đổi', async () => {
    const m = await mount();
    m.el.draft = draft({ current: { value: 12.5, quality: 'GOOD' } });
    await m.el.updateComplete;
    expect(m.text()).toMatch(/12\.5\s*bar\s*→\s*55\s*bar/);
  });

  it('giá trị theo bảng giá trị', async () => {
    const d = draft(
      {
        info: { id: 'M', type: 'UINT16', access: 'RW', kind: 'external', valueTable: 'T' },
        current: { value: 0, quality: 'GOOD' },
      },
      1,
    );
    const m = await mount({
      draft: d,
      table: {
        entries: [
          { value: 0, text: 'Dừng' },
          { value: 1, text: 'Chạy' },
        ],
      },
    });
    expect(m.text()).toMatch(/Dừng\s*→\s*Chạy/);
  });

  it('BOOL hiện Bật/Tắt; xung hiện thời gian', async () => {
    const d = draft(
      {
        info: { id: 'R', type: 'BOOL', access: 'RW', kind: 'external' },
        current: { value: false, quality: 'GOOD' },
        spec: {
          kind: 'pulse',
          tag: 'R',
          value: true,
          pulseMs: 500,
          context: { screen: 's', widget: 'w' },
        },
      },
      true,
    );
    const m = await mount({ draft: d });
    expect(m.text()).toMatch(/Tắt\s*→\s*Bật/);
    expect(m.text()).toContain('500 ms');
  });

  it('confirmText hiện là đoạn riêng', async () => {
    const m = await mount({ draft: draft({ text: 'Bật bơm 1?' }) });
    expect(m.root.querySelector('[data-text]')?.textContent).toBe('Bật bơm 1?');
  });

  it('UNCERTAIN: có câu cảnh báo', async () => {
    const m = await mount({ draft: draft({ current: { value: 10, quality: 'UNCERTAIN' } }) });
    expect(m.text()).toContain('UNCERTAIN');
  });

  it('XSS: Tag, mô tả, confirmText hiện dạng chữ, không dựng phần tử', async () => {
    const evil = '<img src=x onerror="window.__x=1"><script>window.__x=2</script>';
    const d = draft({ text: evil });
    d.info = { ...INFO, id: evil, description: evil, deviceName: evil };
    const m = await mount({ draft: d });
    expect(m.root.querySelector('img')).toBeNull();
    expect(m.root.querySelector('script')).toBeNull();
    expect(m.text()).toContain(evil);
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });
});

describe('mat-confirm-dialog: bàn phím và focus', () => {
  it('Hủy có focus ban đầu', async () => {
    const m = await mount();
    expect(m.root.activeElement).toBe(m.cancel());
  });

  it('Enter chỉ kích hoạt nút đang có focus', async () => {
    const m = await mount();
    m.key(m.cancel(), 'Enter');
    expect(m.onCancel).toHaveBeenCalledTimes(1);
    expect(m.onConfirm).not.toHaveBeenCalled();
    m.ok().focus();
    m.key(m.ok(), 'Enter');
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
    expect(m.onCancel).toHaveBeenCalledTimes(1);
  });

  it('Enter khi focus không ở nút (nền hộp) không làm gì', async () => {
    const m = await mount();
    const dlg = m.root.querySelector<HTMLElement>('[role="alertdialog"]')!;
    dlg.focus();
    m.key(dlg, 'Enter');
    expect(m.onConfirm).not.toHaveBeenCalled();
    expect(m.onCancel).not.toHaveBeenCalled();
  });

  it('Esc hủy', async () => {
    const m = await mount();
    m.key(m.root.querySelector('[role="alertdialog"]')!, 'Escape');
    expect(m.onCancel).toHaveBeenCalledTimes(1);
  });

  it('bẫy focus: Tab từ nút cuối về nút đầu, Shift+Tab ngược lại', async () => {
    const m = await mount();
    m.ok().focus();
    const e1 = m.key(m.ok(), 'Tab');
    expect(e1).toBe(false); // đã preventDefault
    expect(m.root.activeElement).toBe(m.cancel());
    m.key(m.cancel(), 'Tab', { shiftKey: true });
    expect(m.root.activeElement).toBe(m.ok());
  });

  it('khóa giữa chừng: tắt nút Xác nhận, hiện lý do, Enter/nhấp không gửi', async () => {
    const m = await mount();
    m.el.lock = { code: 'QUALITY_BAD', message: 'Quality BAD' } as never;
    await m.el.updateComplete;
    expect(m.ok().disabled).toBe(true);
    expect(m.root.querySelector('[role="alert"]')?.textContent).toContain('Quality BAD');
    m.ok().click();
    m.key(m.cancel(), 'Tab');
    expect(m.onConfirm).not.toHaveBeenCalled();
    // Bẫy focus còn lại một nút: không thoát ra ngoài.
    expect(m.root.activeElement).toBe(m.cancel());
  });

  it('khóa gỡ thì Xác nhận bật lại', async () => {
    const m = await mount({ lock: { code: 'LIVE_LOST', message: 'Mất kết nối dữ liệu' } });
    expect(m.ok().disabled).toBe(true);
    m.el.lock = null;
    await m.el.updateComplete;
    expect(m.ok().disabled).toBe(false);
    m.ok().click();
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('nhấp Hủy gọi onCancel', async () => {
    const m = await mount();
    m.cancel().click();
    expect(m.onCancel).toHaveBeenCalledTimes(1);
  });
});

// T041 (FR-026, D32): nhấp đúp vào widget mở hộp rồi nhấp thứ hai rơi vào nút Xác nhận; bỏ nhấp chuột 400 ms đầu.
describe('mat-confirm-dialog: bỏ nhấp chuột 400 ms đầu', () => {
  const mouse = (b: Element) =>
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, detail: 1 }));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('nhấp chuột vào Xác nhận trong 400 ms đầu bị bỏ; sau 400 ms thì nhận', async () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const m = await mount();
    t = 1399;
    mouse(m.ok());
    expect(m.onConfirm).not.toHaveBeenCalled();
    t = 1400;
    mouse(m.ok());
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('Hủy cũng bỏ nhấp chuột 400 ms đầu; Esc luôn hủy', async () => {
    let t = 50;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const m = await mount();
    t = 100;
    mouse(m.cancel());
    expect(m.onCancel).not.toHaveBeenCalled();
    m.key(m.cancel(), 'Escape');
    expect(m.onCancel).toHaveBeenCalledTimes(1);
  });

  it('bấm phím (Enter trên nút có focus, detail 0) không bị chặn', async () => {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const m = await mount();
    m.ok().focus();
    t = 10;
    m.key(m.ok(), 'Enter');
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('bản nháp mới trên cùng phần tử: đếm lại 400 ms', async () => {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const m = await mount();
    t = 5000;
    m.el.draft = draft({}, 77);
    await m.el.updateComplete;
    t = 5100;
    mouse(m.ok());
    expect(m.onConfirm).not.toHaveBeenCalled();
    t = 5400;
    mouse(m.ok());
    expect(m.onConfirm).toHaveBeenCalledTimes(1);
  });
});
