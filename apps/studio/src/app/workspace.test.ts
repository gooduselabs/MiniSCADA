import { describe, expect, it } from 'vitest';
import {
  DEVICE_KEY,
  WORKSPACE_KEY,
  clampLayout,
  defaultWorkspace,
  loadWorkspace,
  resetLayout,
  saveWorkspace,
  type StorageLike,
} from './workspace.ts';

// Không gian làm việc của Studio (data-model §1): chỉ là tiện ích cục bộ, mất hay hỏng thì về mặc định.
class MemStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

describe('workspace', () => {
  it('mặc định khi chưa lưu gì; task card mở nếu cửa sổ đủ rộng', () => {
    const wide = loadWorkspace(new MemStorage(), 1440);
    expect(wide).toEqual(defaultWorkspace(1440));
    expect(wide).toMatchObject({
      leftWidth: 264,
      detailsHeight: 196,
      inspectorHeight: 218,
      taskCard: 'toolbox',
      taskCardOpen: true,
      theme: 'system',
      showPhases: true,
      deviceAddress: '',
    });
    expect(loadWorkspace(new MemStorage(), 1100).taskCardOpen).toBe(false);
  });

  it('lưu rồi đọc lại; địa chỉ thiết bị dùng khóa của Sprint 1', () => {
    const s = new MemStorage();
    const ws = {
      ...defaultWorkspace(1440),
      leftWidth: 300,
      theme: 'dark' as const,
      deviceAddress: '192.168.1.110',
    };
    saveWorkspace(s, ws);
    expect(s.getItem(DEVICE_KEY)).toBe('192.168.1.110');
    expect(loadWorkspace(s, 1440)).toEqual(ws);
  });

  it('đọc được địa chỉ thiết bị Sprint 1 đã lưu trước đây', () => {
    const s = new MemStorage();
    s.setItem(DEVICE_KEY, '10.8.0.21:8443');
    expect(loadWorkspace(s, 1440).deviceAddress).toBe('10.8.0.21:8443');
  });

  it('dữ liệu hỏng hoặc sai kiểu thì về mặc định từng trường', () => {
    const s = new MemStorage();
    s.setItem(WORKSPACE_KEY, '{không phải json');
    expect(loadWorkspace(s, 1440)).toEqual(defaultWorkspace(1440));
    s.setItem(
      WORKSPACE_KEY,
      JSON.stringify({
        leftWidth: 'rộng',
        theme: 'tím',
        taskCard: 'abc',
        showPhases: false,
        inspectorHeight: 250,
      }),
    );
    const ws = loadWorkspace(s, 1440);
    expect(ws.leftWidth).toBe(264);
    expect(ws.theme).toBe('system');
    expect(ws.taskCard).toBe('toolbox');
    expect(ws.showPhases).toBe(false);
    expect(ws.inspectorHeight).toBe(250);
  });

  it('storage ném lỗi (bị chặn) thì vẫn chạy với mặc định, lưu không ném', () => {
    expect(loadWorkspace(throwing, 1440)).toEqual(defaultWorkspace(1440));
    expect(() => saveWorkspace(throwing, defaultWorkspace(1440))).not.toThrow();
  });

  it('kẹp kích thước theo data-model §1', () => {
    const ws = defaultWorkspace(1440);
    const dims = { leftColumnHeight: 700, centerHeight: 640 };
    expect(clampLayout({ ...ws, leftWidth: 100 }, dims).leftWidth).toBe(180);
    expect(clampLayout({ ...ws, leftWidth: 900 }, dims).leftWidth).toBe(480);
    expect(clampLayout({ ...ws, detailsHeight: 10 }, dims).detailsHeight).toBe(70);
    expect(clampLayout({ ...ws, detailsHeight: 1000 }, dims).detailsHeight).toBe(700 - 120);
    expect(clampLayout({ ...ws, inspectorHeight: 10 }, dims).inspectorHeight).toBe(90);
    expect(clampLayout({ ...ws, inspectorHeight: 1000 }, dims).inspectorHeight).toBe(640 - 150);
  });

  it('chưa biết kích thước vùng (0) thì chỉ kẹp cận dưới', () => {
    const ws = { ...defaultWorkspace(1440), detailsHeight: 5000, inspectorHeight: 20 };
    const out = clampLayout(ws, { leftColumnHeight: 0, centerHeight: 0 });
    expect(out.detailsHeight).toBe(5000);
    expect(out.inspectorHeight).toBe(90);
  });

  it('đặt lại bố cục: bỏ kích thước và task card, giữ theme, địa chỉ thiết bị, nhãn giai đoạn', () => {
    const ws = {
      ...defaultWorkspace(1440),
      leftWidth: 400,
      inspectorHeight: 300,
      taskCard: 'find' as const,
      taskCardOpen: false,
      theme: 'dark' as const,
      deviceAddress: '192.168.1.110',
      showPhases: false,
    };
    expect(resetLayout(ws, 1440)).toEqual({
      ...defaultWorkspace(1440),
      theme: 'dark',
      deviceAddress: '192.168.1.110',
      showPhases: false,
    });
  });

  it('feature 015: khung dưới gập/mở nhớ qua lần mở sau, chiều cao giữ nguyên khi gập', () => {
    const st = new MemStorage();
    const ws = { ...defaultWorkspace(1440), inspectorHeight: 300, inspectorCollapsed: true };
    saveWorkspace(st, ws);
    expect(loadWorkspace(st, 1440)).toMatchObject({
      inspectorHeight: 300,
      inspectorCollapsed: true,
    });
    expect(defaultWorkspace(1440).inspectorCollapsed).toBe(false);
    st.setItem(WORKSPACE_KEY, JSON.stringify({ inspectorCollapsed: 'x' }));
    expect(loadWorkspace(st, 1440).inspectorCollapsed).toBe(false);
  });
});
