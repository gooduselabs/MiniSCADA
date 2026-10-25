// Feature 024: trang Recipe (bảng, so sánh với PLC, xác nhận liệt kê thay đổi, tiến trình, quyền, lỗi 409/400) và mô
// hình thuần (so sánh theo số lẻ, kiểm giá trị).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RecipeApiError,
  changesOf,
  parseInput,
  parseList,
  sameValue,
  valueIssue,
  type Job,
  type RecipeList,
} from './model.ts';
import { RecipePage, type RecipePageDeps } from './recipe-page.ts';

const LIST = (canOperate = true, canEdit = true): RecipeList =>
  parseList({
    rev: 3,
    types: [
      {
        id: 'lo',
        name: 'Lò sấy',
        params: [
          {
            tag: 'SP',
            type: 'FLOAT32',
            label: 'Nhiệt độ',
            unit: '°C',
            min: 10,
            max: 80,
            decimals: 1,
          },
          { tag: 'RUN', type: 'BOOL', label: 'Chạy' },
          { tag: 'N', type: 'UINT16', label: 'Số mẻ' },
        ],
        can: { operate: canOperate, edit: canEdit },
        recipes: [
          { id: 'a', name: 'Mùa hè', values: { SP: 42.5, RUN: true, N: 3 }, origin: 'project' },
          {
            id: 'd-1',
            name: 'Từ PLC',
            values: { SP: 30, RUN: false, N: 3 },
            origin: 'device',
            updatedBy: 'an',
          },
        ],
      },
      { id: 'khac', name: 'Khác', params: [], can: {}, recipes: [] },
    ],
  });

const CUR = {
  SP: { value: 30.04, quality: 'GOOD' },
  RUN: { value: false, quality: 'GOOD' },
  N: { value: 3, quality: 'GOOD' },
};

function job(state: Job['state'], st: Job['results'][number]['status'][]): Job {
  return {
    jobId: 'j1',
    type: 'lo',
    recipe: 'a',
    state,
    results: ['SP', 'RUN', 'N'].map((tag, i) => ({
      tag,
      value: 1,
      status: st[i]!,
      ...(st[i] === 'failed' ? { code: 'DEVICE_EXCEPTION' } : {}),
    })),
  };
}

function api(over: Partial<RecipePageDeps['api']> = {}, list = LIST()) {
  return {
    list: vi.fn(async () => list),
    current: vi.fn(async () => structuredClone(CUR)),
    job: vi.fn(async () => job('done', ['ok', 'ok', 'ok'])),
    download: vi.fn(async () => job('running', ['pending', 'pending', 'pending'])),
    save: vi.fn(async () => ({ rev: 4 })),
    remove: vi.fn(async () => ({ rev: 4 })),
    capture: vi.fn(async () => ({ rev: 4 })),
    ...over,
  };
}

let page: RecipePage | null = null;
async function mount(a = api(), signedIn = true) {
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.append(container);
  // jsdom: <dialog> không có showModal
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  page = new RecipePage({
    container,
    api: a,
    signedIn: () => signedIn,
    onLogin: vi.fn(),
    currentMs: 60_000,
    jobMs: 1,
  });
  await page.show(null);
  return { a, root: page.root };
}
const flush = () => new Promise((r) => setTimeout(r, 20));
const act = (root: HTMLElement, a: string) =>
  root.querySelector<HTMLButtonElement>(`[data-act="${a}"]`);

afterEach(() => {
  page?.hide();
  page = null;
});

describe('mô hình recipe', () => {
  it('so sánh theo số lẻ, kiểu và giới hạn', () => {
    const p = { tag: 'SP', type: 'FLOAT32', decimals: 1, min: 10, max: 80 };
    expect(sameValue(p, 30.04, 30)).toBe(true);
    expect(sameValue(p, 30.06, 30)).toBe(false);
    expect(sameValue({ tag: 'B', type: 'BOOL' }, true, true)).toBe(true);
    expect(valueIssue(p, 90)).toBe('limit');
    expect(valueIssue({ tag: 'N', type: 'UINT16' }, 2.5)).toBe('type');
    expect(valueIssue({ tag: 'N', type: 'UINT16' }, -1)).toBe('type');
    expect(parseInput({ tag: 'B', type: 'BOOL' }, 'Bật')).toBe(true);
    expect(parseInput(p, '12,5')).toBe(12.5);
    const t = LIST().types[0]!;
    const ch = changesOf(t, t.recipes[0]!, CUR);
    expect(ch.map((c) => c.param.tag)).toEqual(['SP', 'RUN']);
  });
});

describe('trang Recipe', () => {
  it('chưa đăng nhập: mời đăng nhập, không gọi API', async () => {
    const a = api();
    const { root } = await mount(a, false);
    expect(root.textContent).toContain('Đăng nhập');
    expect(a.list).not.toHaveBeenCalled();
  });

  it('bảng: hàng tham số, cột hiện tại và từng bản; ô khác PLC của bản chọn được tô', async () => {
    const { root } = await mount();
    const rows = root.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(root.querySelector('td[data-cur="SP"]')!.textContent).toBe('30.0');
    const head = [...root.querySelectorAll('thead .rc-col')].map((b) => b.textContent);
    expect(head).toEqual(['Mùa hèProject', 'Từ PLCThiết bị']);
    const diff = [...root.querySelectorAll('td.rc-diff')].map((td) =>
      td.closest('tr')!.getAttribute('data-tag'),
    );
    expect(diff).toEqual(['SP', 'RUN']);
    expect(root.querySelector('.rc-status')!.textContent).toBe('2 tham số khác PLC');
    // bản thiết bị: SP 30 giống 30.04 theo 1 số lẻ
    root.querySelector<HTMLButtonElement>('[data-recipe="d-1"]')!.click();
    expect(root.querySelectorAll('td.rc-diff')).toHaveLength(0);
  });

  it('quyền: không operate thì không có Tải xuống; không edit thì không Sửa/Xóa/Đọc', async () => {
    const { root } = await mount(api({}, LIST(false, false)));
    expect(act(root, 'download')).toBeNull();
    expect(act(root, 'capture')).toBeNull();
    expect(act(root, 'copy')).toBeNull();
    // bản project: Sửa và Xóa không có kể cả khi có quyền
    const r2 = await mount();
    expect(act(r2.root, 'edit')).toBeNull();
    expect(act(r2.root, 'remove')).toBeNull();
    r2.root.querySelector<HTMLButtonElement>('[data-recipe="d-1"]')!.click();
    expect(act(r2.root, 'edit')).not.toBeNull();
    expect(act(r2.root, 'remove')).not.toBeNull();
  });

  it('Tải xuống: hộp xác nhận liệt kê thay đổi cũ → mới, rồi tiến trình tới kết quả', async () => {
    const a = api({
      job: vi
        .fn()
        .mockResolvedValueOnce(job('running', ['ok', 'pending', 'pending']))
        .mockResolvedValueOnce(job('failed', ['ok', 'failed', 'skipped'])),
    });
    const { root } = await mount(a);
    act(root, 'download')!.click();
    const dlg = root.querySelector('dialog')!;
    const rows = [...dlg.querySelectorAll('.rc-changes tbody tr')].map((tr) =>
      [...tr.children].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ['Nhiệt độ', '30.0', '42.5 °C'],
      ['Chạy', 'Tắt', 'Bật'],
    ]);
    act(dlg as HTMLElement, 'confirm')!.click();
    await flush();
    await flush();
    expect(a.download).toHaveBeenCalledWith('lo', 'a');
    const prog = root.querySelector('dialog.rc-progress')!;
    expect(prog.getAttribute('data-state')).toBe('failed');
    const st = [...prog.querySelectorAll('li')].map((li) => li.getAttribute('data-status'));
    expect(st).toEqual(['ok', 'failed', 'skipped']);
    expect(prog.textContent).toContain('DEVICE_EXCEPTION');
  });

  it('RECIPE_INVALID khi tải: báo lỗi trong hộp và tô ô lỗi', async () => {
    const a = api({
      download: vi.fn(async () => {
        throw new RecipeApiError(400, 'RECIPE_INVALID', {
          issues: [{ tag: 'SP', code: 'E_RECIPE_LIMIT' }],
        });
      }),
    });
    const { root } = await mount(a);
    act(root, 'download')!.click();
    act(root.querySelector('dialog') as HTMLElement, 'confirm')!.click();
    await flush();
    expect(root.querySelector('dialog .rc-error')!.textContent).toContain('không hợp lệ');
    expect(root.querySelector('tr[data-tag="SP"] td.rc-bad')).not.toBeNull();
  });

  it('Sửa: kiểm phía trang trước khi gửi; CONFLICT tải lại và báo', async () => {
    const a = api({
      save: vi.fn(async () => {
        throw new RecipeApiError(409, 'CONFLICT', { rev: 5 });
      }),
    });
    const { root } = await mount(a);
    root.querySelector<HTMLButtonElement>('[data-recipe="d-1"]')!.click();
    act(root, 'edit')!.click();
    const sp = root.querySelector<HTMLInputElement>('input[data-edit="SP"]')!;
    sp.value = '95';
    sp.dispatchEvent(new Event('input'));
    expect(sp.hasAttribute('aria-invalid')).toBe(true);
    root.querySelector<HTMLButtonElement>('.rc-tools .primary')!.click();
    await flush();
    expect(a.save).not.toHaveBeenCalled();
    const sp2 = root.querySelector<HTMLInputElement>('input[data-edit="SP"]')!;
    sp2.value = '55';
    sp2.dispatchEvent(new Event('input'));
    root.querySelector<HTMLButtonElement>('.rc-tools .primary')!.click();
    await flush();
    expect(a.save).toHaveBeenCalledWith({
      type: 'lo',
      id: 'd-1',
      name: 'Từ PLC',
      values: { SP: 55, RUN: false, N: 3 },
      rev: 3,
    });
    expect(a.list).toHaveBeenCalledTimes(2);
    expect(root.querySelector('.rc-status')!.textContent).toContain('người khác');
  });

  it('Đọc từ PLC: hỏi tên rồi capture; RECIPE_BAD_QUALITY liệt kê Tag', async () => {
    const a = api({
      capture: vi.fn(async () => {
        throw new RecipeApiError(409, 'RECIPE_BAD_QUALITY', { tags: ['N'] });
      }),
    });
    const { root } = await mount(a);
    act(root, 'capture')!.click();
    const dlg = root.querySelector('dialog')!;
    const name = dlg.querySelector<HTMLInputElement>('input[data-field="name"]')!;
    name.value = 'Mẻ 7';
    act(dlg as HTMLElement, 'confirm')!.click();
    await flush();
    expect(a.capture).toHaveBeenCalledWith('lo', 'Mẻ 7', 3);
    expect(dlg.querySelector('.rc-error')!.textContent).toContain('N');
  });

  it('Xóa bản thiết bị sau xác nhận', async () => {
    const a = api();
    const { root } = await mount(a);
    root.querySelector<HTMLButtonElement>('[data-recipe="d-1"]')!.click();
    act(root, 'remove')!.click();
    act(root.querySelector('dialog') as HTMLElement, 'confirm')!.click();
    await flush();
    expect(a.remove).toHaveBeenCalledWith('lo', 'd-1', 3);
    expect(root.querySelector('.rc-status')!.textContent).toBe('Đã xóa bản recipe.');
  });
});
