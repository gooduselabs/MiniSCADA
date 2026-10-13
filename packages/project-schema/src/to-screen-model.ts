// Bộ chuyển màn hình cũ sang mô hình 0.3 (contracts/project-format-0.3.md §8, §9; research R6).
// `toScreenModel` dùng ở trang runtime và xem trước Studio; `legacyScreenTo03` dùng chung với `migrate02to03` nên
// kết quả của hai nơi giống từng byte sau `formatScreen03`.
import type { Screen } from './types.ts';
import type { ScreenModel, SvgItem } from './types-03.ts';

type Obj = Record<string, unknown>;

/** Khoảng của `size` (contract §3). */
export const SIZE_MIN = { width: 64, height: 64 } as const;
export const SIZE_MAX = { width: 4096, height: 2304 } as const;

/** Id và tên của item `svg` do nâng cấp sinh ra. */
export const MIGRATED_SVG_ITEM_ID = 'svg1';
export const MIGRATED_SVG_ITEM_NAME = 'Đồ họa';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Kết quả chuyển một màn hình cũ. `clamped`: `viewBox` ngoài khoảng của `size` nên `size` bị kẹp. */
export interface LegacyConversion {
  model: ScreenModel;
  clamped: boolean;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Màn hình 0.1/0.2 (đối tượng JSON đã parse, có thể hỏng) sang mô hình 0.3, hoặc `null` khi không chuyển được
 * (thiếu hoặc sai kiểu `id`, `name`, `svgFile`, `bindingFile`, `viewBox`, `fitMode`, `elements`): nâng cấp mang
 * tệp đó nguyên văn, lỗi vẫn là lỗi của bản gốc.
 */
export function legacyScreenTo03(o: unknown): LegacyConversion | null {
  if (!isObj(o)) return null;
  const { id, name, svgFile, bindingFile, viewBox, fitMode, elements, background } = o;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof svgFile !== 'string' ||
    typeof bindingFile !== 'string' ||
    !Array.isArray(elements)
  )
    return null;
  if (fitMode !== 'contain' && fitMode !== 'cover' && fitMode !== 'stretch') return null;
  if (
    !Array.isArray(viewBox) ||
    viewBox.length !== 4 ||
    !viewBox.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    (viewBox[2] as number) <= 0 ||
    (viewBox[3] as number) <= 0
  )
    return null;
  const vb = viewBox as [number, number, number, number];
  const rawW = Math.ceil(vb[2]);
  const rawH = Math.ceil(vb[3]);
  const width = clamp(rawW, SIZE_MIN.width, SIZE_MAX.width);
  const height = clamp(rawH, SIZE_MIN.height, SIZE_MAX.height);
  const item: SvgItem = {
    id: MIGRATED_SVG_ITEM_ID,
    name: MIGRATED_SVG_ITEM_NAME,
    type: 'svg',
    x: 0,
    y: 0,
    width,
    height,
    svgFile,
    bindingFile,
    viewBox: vb,
    fit: fitMode,
    elements: elements as SvgItem['elements'],
  };
  const model: ScreenModel = {
    schemaVersion: '0.3.0',
    id,
    name,
    kind: 'screen',
    size: { width, height },
    fitMode,
    ...(typeof background === 'string' ? { background } : {}),
    items: [item],
  };
  return { model, clamped: width !== rawW || height !== rawH };
}

/**
 * Mô hình 0.3 của một màn hình đã nạp. Màn hình 0.3 trả nguyên (cùng đối tượng); màn hình 0.1 và 0.2 cho mô hình
 * giống tệp do `migrate02to03` sinh, không ghi file.
 */
export function toScreenModel(screen: Screen | ScreenModel): ScreenModel {
  if ('items' in screen) return screen;
  const c = legacyScreenTo03(screen);
  if (!c) throw new Error(`Màn hình '${screen.id}' không chuyển được sang mô hình 0.3`);
  return c.model;
}
