// Bộ chuyển màn hình cũ (T017; contracts/project-format-0.3.md §8-§9, research R6): màn hình 0.3 trả nguyên, màn hình
// 0.1 và 0.2 cho đúng mô hình như kết quả nâng cấp; `viewBox` ngoài khoảng của `size` thì kẹp.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatScreen03,
  legacyScreenTo03,
  migrate02to03,
  toScreenModel,
  type Screen,
  type ScreenModel,
} from './index.ts';

const ROOT = resolve(__dirname, '../../..');
const text = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const legacy = (over: Partial<Screen> = {}): Screen => ({
  schemaVersion: '0.2.0',
  id: 'main',
  name: 'Main',
  svgFile: 'screens/main.svg',
  viewBox: [0, 0, 100, 100],
  fitMode: 'contain',
  bindingFile: 'screens/main.bindings.json',
  elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }],
  ...over,
});

describe('toScreenModel', () => {
  it('màn hình 0.3 trả nguyên (cùng đối tượng)', () => {
    const m = JSON.parse(
      text('tests/project-vectors/v03-valid-full/screens/main.screen.json'),
    ) as ScreenModel;
    expect(toScreenModel(m)).toBe(m);
  });

  it('0.2: một item svg ở (0, 0), cỡ bằng viewBox, size bằng viewBox, kind screen', () => {
    expect(toScreenModel(legacy())).toEqual({
      schemaVersion: '0.3.0',
      id: 'main',
      name: 'Main',
      kind: 'screen',
      size: { width: 100, height: 100 },
      fitMode: 'contain',
      items: [
        {
          id: 'svg1',
          name: 'Đồ họa',
          type: 'svg',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          svgFile: 'screens/main.svg',
          bindingFile: 'screens/main.bindings.json',
          viewBox: [0, 0, 100, 100],
          fit: 'contain',
          elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }],
        },
      ],
    });
  });

  it('0.1 cho cùng mô hình như 0.2 (chỉ khác schemaVersion đầu vào)', () => {
    expect(toScreenModel(legacy({ schemaVersion: '0.1.0' }))).toEqual(toScreenModel(legacy()));
  });

  it('viewBox khác 0 và không nguyên: size làm tròn lên, viewBox giữ nguyên', () => {
    const m = toScreenModel(legacy({ viewBox: [50, -20, 200.2, 120.7] }));
    expect(m.size).toEqual({ width: 201, height: 121 });
    expect(m.items[0]).toMatchObject({
      width: 201,
      height: 121,
      viewBox: [50, -20, 200.2, 120.7],
    });
  });

  it('viewBox ngoài khoảng của size thì kẹp 64-4096 x 64-2304, item svg cỡ bằng size', () => {
    const big = toScreenModel(legacy({ viewBox: [0, 0, 10000, 5000] }));
    expect(big.size).toEqual({ width: 4096, height: 2304 });
    expect(big.items[0]).toMatchObject({ width: 4096, height: 2304, viewBox: [0, 0, 10000, 5000] });
    const tiny = toScreenModel(legacy({ viewBox: [0, 0, 10, 0.5] }));
    expect(tiny.size).toEqual({ width: 64, height: 64 });
  });

  it('fitMode và background giữ nguyên; item svg dùng fit bằng fitMode', () => {
    const m = toScreenModel(legacy({ fitMode: 'cover', background: '#0F172A' }));
    expect(m.fitMode).toBe('cover');
    expect(m.background).toBe('#0F172A');
    expect(m.items[0]).toMatchObject({ fit: 'cover' });
    expect(toScreenModel(legacy({ fitMode: 'stretch' })).items[0]).toMatchObject({
      fit: 'stretch',
    });
  });

  it('cho cùng đầu vào cùng kết quả (không đổi đầu vào)', () => {
    const s = legacy();
    const copy = JSON.parse(JSON.stringify(s));
    expect(toScreenModel(s)).toEqual(toScreenModel(s));
    expect(s).toEqual(copy);
  });
});

describe('legacyScreenTo03', () => {
  it('trả null khi tệp hỏng (thiếu viewBox, id, svgFile...) để nâng cấp mang nguyên văn', () => {
    expect(legacyScreenTo03({})).toBeNull();
    expect(legacyScreenTo03({ ...legacy(), viewBox: [0, 0, 0, 5] })).toBeNull();
    expect(legacyScreenTo03({ ...legacy(), viewBox: 'x' })).toBeNull();
    expect(legacyScreenTo03({ ...legacy(), svgFile: 5 })).toBeNull();
  });
  it('báo screen bị kẹp', () => {
    expect(legacyScreenTo03({ ...legacy() })?.clamped).toBe(false);
    expect(legacyScreenTo03({ ...legacy(), viewBox: [0, 0, 5000, 100] })?.clamped).toBe(true);
  });
});

describe('khớp với migrate02to03', () => {
  it('toScreenModel(0.2) ghi ra đúng từng byte màn hình trong file 0.3 do migrate02to03 sinh (modbus-demo)', async () => {
    const files: Record<string, string> = {};
    for (const f of [
      'project.json',
      'tags.json',
      'connections.json',
      'value-tables/TrangThaiBom.json',
      'watch-tables/van-hanh.json',
      'screens/main.screen.json',
      'screens/main.bindings.json',
      'screens/main.svg',
    ])
      files[f] = text(`projects/modbus-demo/${f}`);
    const r = await migrate02to03(files);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const old = JSON.parse(files['screens/main.screen.json']!) as Screen;
    expect(formatScreen03(toScreenModel(old))).toBe(r.files['screens/main.screen.json']);
    // và đọc lại tệp 0.3 do nâng cấp sinh thì trả nguyên
    const parsed = JSON.parse(r.files['screens/main.screen.json']!) as ScreenModel;
    expect(toScreenModel(parsed)).toBe(parsed);
  });
});
