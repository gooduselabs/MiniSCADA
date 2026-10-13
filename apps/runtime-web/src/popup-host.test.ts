// PopupHost (feature 007, FR-016, FR-023): nối trạng thái popup của Router với `<mat-screen>.popup`; tải mô hình theo yêu cầu;
// lỗi tải chỉ làm popup đó hỏng; bỏ kết quả tải đến muộn khi popup đã đóng.
import type { ScreenModel } from '@mat/project-schema';
import { describe, expect, it, vi } from 'vitest';
import { PopupHost } from './popup-host.ts';

const model = (id: string): ScreenModel => ({
  schemaVersion: '0.3.0',
  id,
  name: id,
  kind: 'popup',
  size: { width: 400, height: 300 },
  items: [],
});

function make(load: (id: string) => Promise<ScreenModel>) {
  const el: { popup: ScreenModel | null } = { popup: null };
  const onError = vi.fn();
  const onFail = vi.fn();
  const host = new PopupHost({ load, target: el, onError, onFail });
  return { el, host, onError, onFail };
}

describe('PopupHost', () => {
  it('mở: tải rồi gán popup; đóng: gán null', async () => {
    const { el, host } = make(async (id) => model(id));
    await host.sync('p1');
    expect(el.popup?.id).toBe('p1');
    await host.sync(null);
    expect(el.popup).toBeNull();
  });

  it('đóng trước khi tải xong: kết quả đến muộn bị bỏ', async () => {
    let resolve!: (m: ScreenModel) => void;
    const { el, host } = make(() => new Promise<ScreenModel>((r) => (resolve = r)));
    const open = host.sync('p1');
    await host.sync(null);
    resolve(model('p1'));
    await open;
    expect(el.popup).toBeNull();
  });

  it('mở popup khác trong lúc tải: chỉ popup mới nhất được gán', async () => {
    const resolvers: Record<string, (m: ScreenModel) => void> = {};
    const { el, host } = make((id) => new Promise<ScreenModel>((r) => (resolvers[id] = r)));
    const a = host.sync('a');
    const b = host.sync('b');
    resolvers.b(model('b'));
    await b;
    resolvers.a(model('a'));
    await a;
    expect(el.popup?.id).toBe('b');
  });

  it('lỗi tải: báo lỗi kèm id, gọi onFail (đóng popup ở router), không gán', async () => {
    const { el, host, onError, onFail } = make(async () => {
      throw new Error('hỏng');
    });
    await host.sync('p1');
    expect(el.popup).toBeNull();
    expect(onError).toHaveBeenCalledWith('p1', 'hỏng');
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('đóng khi chưa mở không làm gì', async () => {
    const load = vi.fn();
    const { host, el } = make(load);
    await host.sync(null);
    expect(load).not.toHaveBeenCalled();
    expect(el.popup).toBeNull();
  });
});
