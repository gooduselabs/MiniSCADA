// PopupHost (feature 007, FR-016, FR-023): nối trạng thái popup của Router với `<mat-screen>.popup`; tải mô hình theo yêu cầu;
// lỗi tải chỉ làm popup đó hỏng; bỏ kết quả tải đến muộn khi popup đã đóng.
import type { ScreenModel, ScreenModel10, WidgetItem } from '@mat/project-schema';
import { missingTagsOf } from '@mat/ui-components';
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

// ---- Faceplate (feature 011, T170; FR-125; contracts/project-format-1.0.md §5) ------------------------------------

const faceplate = (): ScreenModel10 => ({
  schemaVersion: '1.0.0',
  id: 'bom-chi-tiet',
  name: 'Chi tiết bơm',
  kind: 'popup',
  size: { width: 640, height: 420 },
  params: [
    { name: 'prefix', kind: 'tagPrefix' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
  items: [
    {
      type: 'widget',
      id: 'flow',
      widget: 'card',
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      tags: { value: '{prefix}.FLOW' },
      props: { label: '{title}' },
    },
  ],
});

function makeFp(known: readonly string[] = ['PUMP07.FLOW', 'PUMP08.FLOW']) {
  const cached = faceplate();
  const el: { popup: ScreenModel | null } = { popup: null };
  const onError = vi.fn();
  const onFail = vi.fn();
  const host = new PopupHost({
    load: async () => cached as ScreenModel,
    target: el,
    onError,
    onFail,
    knownTag: (id) => known.includes(id),
  });
  return { el, host, onError, onFail, cached };
}

const first = (m: ScreenModel | null) => m?.items[0] as WidgetItem | undefined;

describe('PopupHost: faceplate có tham số', () => {
  it('mở với args: popup đã thay {param} (substituteParams); mô hình trong cache không đổi', async () => {
    const { el, host, cached, onError } = makeFp();
    await host.sync('bom-chi-tiet', { prefix: 'PUMP07', title: 'Bơm 7' });
    expect(first(el.popup)?.tags).toEqual({ value: 'PUMP07.FLOW' });
    expect(first(el.popup)?.props).toEqual({ label: 'Bơm 7' });
    expect((cached.items[0] as WidgetItem).tags).toEqual({ value: '{prefix}.FLOW' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('mở lại với args khác: thay popup hiện tại bằng bản mới', async () => {
    const { el, host } = makeFp();
    await host.sync('bom-chi-tiet', { prefix: 'PUMP07' });
    const a = el.popup;
    await host.sync('bom-chi-tiet', { prefix: 'PUMP08' });
    expect(el.popup).not.toBe(a);
    expect(first(el.popup)?.tags).toEqual({ value: 'PUMP08.FLOW' });
    expect(first(el.popup)?.props).toEqual({ label: 'Bơm' });
  });

  it.each([
    ['thiếu tham số bắt buộc', undefined],
    ['khóa lạ', { prefix: 'PUMP07', foo: 'x' }],
    ['sai kiểu', { prefix: 'PUMP 07' }],
  ])('args sai (%s): không mở, báo lỗi kèm id, đóng ở router', async (_n, args) => {
    const { el, host, onError, onFail } = makeFp();
    await host.sync('bom-chi-tiet', args);
    expect(el.popup).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe('bom-chi-tiet');
    expect(String(onError.mock.calls[0]![1])).toMatch(/tham số/);
    expect(onFail).toHaveBeenCalledTimes(1);
  });

  it('args sai khi đang mở popup khác: popup cũ bị gỡ', async () => {
    const { el, host } = makeFp();
    await host.sync('bom-chi-tiet', { prefix: 'PUMP07' });
    await host.sync('bom-chi-tiet', { prefix: '' });
    expect(el.popup).toBeNull();
  });

  it('Tag đã thay không có trong tập công bố: item bị đánh dấu, không có khe tags', async () => {
    const { el, host, onError } = makeFp();
    await host.sync('bom-chi-tiet', { prefix: 'PUMP99' });
    const it0 = el.popup!.items[0]!;
    expect(missingTagsOf(it0)).toEqual(['PUMP99.FLOW']);
    expect((it0 as WidgetItem).tags).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});
