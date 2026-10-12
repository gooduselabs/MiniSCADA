// Xem trước màn hình (feature 004, T073, FR-030, FR-032, Constitution II): dựng SVG của project bằng
// @mat/svg-renderer, áp giá trị bằng DomApplier của @mat/binding-engine (cùng package với runtime web);
// nguồn giá trị nằm ngoài (mô phỏng hoặc phiên thiết bị duy nhất), Preview không tự mở kết nối nào.
import type { TagUpdate } from '@mat/binding-engine';
import type { BindingSet, Screen } from '@mat/project-schema';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Preview, type ValueSource } from './preview.ts';

const DEMO = resolve(__dirname, '../../../projects/tank-demo');
const read = (rel: string) => readFileSync(resolve(DEMO, rel), 'utf8');
const SVG = read('screens/tank-motor.svg');
const SCREEN = JSON.parse(read('screens/tank-motor.screen.json')) as Screen;
const BINDINGS = JSON.parse(read('screens/tank-motor.bindings.json')) as BindingSet;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

beforeAll(() => {
  if (!('animate' in Element.prototype))
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: () => ({ play() {}, pause() {}, cancel() {} }),
    });
});

/** Nguồn giả: phát `first` khi gắn, giữ hàm đẩy để test phát tiếp; đếm số lần gỡ. */
function fakeSource(first: TagUpdate[]) {
  const state = { push: null as ((c: TagUpdate[]) => void) | null, detached: 0 };
  const source: ValueSource = (push) => {
    state.push = push;
    push(first);
    return () => {
      state.detached++;
      state.push = null;
    };
  };
  return { source, state };
}

function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  const preview = new Preview();
  const missing = preview.mount(host, SVG, SCREEN, BINDINGS.elements, {
    'TANK01.LEVEL': 'FLOAT32',
  });
  const el = (uid: string) => host.shadowRoot?.querySelector(`[data-mat-uid="${uid}"]`) ?? null;
  return { host, preview, missing, el };
}

describe('Preview', () => {
  afterEach(() => document.body.replaceChildren());

  it('dựng màn hình trong shadow root, chưa có nguồn thì như bản vẽ', () => {
    const { preview, missing, el } = setup();
    expect(missing).toEqual([]);
    expect(el('el_txt_level')?.textContent).toBe('--');
    expect(preview.tags).toEqual(
      expect.arrayContaining(['TANK01.LEVEL', 'MOTOR01.RUN', 'MOTOR01.SPEED', 'TANK01.TEMP']),
    );
    expect(preview.elements.get('el_tank_level')).toBe(el('el_tank_level'));
  });

  it('áp giá trị của nguồn ngoài bằng DomApplier', async () => {
    const { preview, el } = setup();
    const { source, state } = fakeSource([{ id: 'TANK01.LEVEL', value: 42, quality: 'GOOD' }]);
    preview.setSource(source);
    await frame();
    expect(el('el_txt_level')?.textContent).toBe('42.0 %');
    state.push?.([{ id: 'MOTOR01.SPEED', value: 1440, quality: 'GOOD' }]);
    await frame();
    expect(el('el_txt_speed')?.textContent).toBe('1440');
  });

  it('đổi nguồn: gỡ nguồn cũ, dựng lại bản vẽ gốc để không trộn giá trị hai nguồn', async () => {
    const { preview, el } = setup();
    const a = fakeSource([
      { id: 'TANK01.LEVEL', value: 42, quality: 'GOOD' },
      { id: 'MOTOR01.SPEED', value: 1440, quality: 'GOOD' },
    ]);
    preview.setSource(a.source);
    await frame();
    const b = fakeSource([{ id: 'TANK01.LEVEL', value: 10, quality: 'GOOD' }]);
    preview.setSource(b.source);
    await frame();
    expect(a.state.detached).toBe(1);
    expect(el('el_txt_level')?.textContent).toBe('10.0 %');
    expect(el('el_txt_speed')?.textContent).toBe('--');
    preview.setSource(null);
    await frame();
    expect(b.state.detached).toBe(1);
    expect(el('el_txt_level')?.textContent).toBe('--');
  });

  it('stop(): gỡ nguồn, bỏ màn hình', async () => {
    const { host, preview } = setup();
    const a = fakeSource([]);
    preview.setSource(a.source);
    preview.stop();
    expect(a.state.detached).toBe(1);
    expect(host.shadowRoot?.querySelector('svg')).toBeNull();
    expect(preview.tags).toEqual([]);
  });

  it('báo uid khai báo mà SVG không có', () => {
    const host = document.createElement('div');
    const preview = new Preview();
    const screen = { ...SCREEN, elements: [...SCREEN.elements, { elementUid: 'el_khong_co' }] };
    expect(preview.mount(host, SVG, screen, BINDINGS.elements)).toEqual(['el_khong_co']);
  });

  // FR-030: Studio chỉ có một phiên thiết bị; xem trước đọc giá trị từ phiên đó, không mở kết nối riêng.
  it('không tự mở kết nối dữ liệu sống', () => {
    const src = readFileSync(resolve(__dirname, 'preview.ts'), 'utf8');
    expect(src).not.toMatch(/@mat\/live-client|LiveConnection|WebSocket/);
  });
});
