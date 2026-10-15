// Thả ký hiệu SVG vào màn hình (feature 008, T090; FR-057; contract symbol-library §5, §6). Hàm thuần: nhận ký hiệu, điểm thả
// và ngữ cảnh, trả kế hoạch thay đổi cho `store.applyChange` (MỘT bước hoàn tác: item, file binding riêng rỗng, tệp SVG sao vào
// `graphics/symbols/` nếu project chưa có; nhiều thể hiện dùng chung một tệp). Dính lưới, đường gióng và điểm gắn dùng `snap.ts`.
import type { Item, ScreenModel, SvgItem } from '@mat/project-schema';
import { LIMITS_03 } from '@mat/project-schema';
import {
  SYMBOLS,
  getSymbolSvg,
  symbolFiles,
  type PortRef,
  type PortSnapResult,
  type SymbolFile,
} from '@mat/symbols';
import { nextItemId } from './screen-edit/clipboard.ts';
import { snapBoxWithPorts, type SnapOptions } from './screen-edit/snap.ts';
import { svgItemLimit, type StoreChange } from './import-flow.ts';
import { emptyBindingSet } from './svg-binding-doc.ts';

/** Thư mục tệp ký hiệu trong project. */
export const SYMBOL_DIR = 'graphics/symbols/';
const ID_MAX = 32;

export type SymbolRejection = 'unknown-symbol' | 'max-svg-items' | 'max-items';

export interface SymbolDropTarget {
  screen: ScreenModel;
  /** Đường dẫn file đang có trong project. */
  graphicsFiles: Iterable<string>;
  /** `schemaVersion` của project (quyết định trần item `svg` và phiên bản file binding mới). */
  schemaVersion: string;
  /** Bước lưới (0 = không có). */
  grid: number;
  snap: boolean;
  alt: boolean;
  zoom: number;
}

export type SymbolPlan =
  | {
      ok: true;
      item: SvgItem;
      svgFile: string;
      bindingFile: string;
      change: StoreChange;
      /** Cặp điểm gắn đã dính (thắng dính lưới); vắng khi không dính điểm gắn. */
      portSnap?: PortSnapResult;
    }
  | { ok: false; reason: SymbolRejection };

const baseOf = (file: string): string => file.replace(/^.*\//, '');

/** Khóa của một tệp ký hiệu trong Toolbox và khi kéo thả: tên tệp bỏ đuôi (`pump-centrifugal`, `pipe-elbow-ws`). */
export const symbolKey = (f: SymbolFile): string => baseOf(f.file).replace(/\.svg$/, '');

/** Mọi tệp ký hiệu (biến thể là một mục riêng), theo thứ tự thư viện. */
export const ALL_SYMBOL_FILES: readonly SymbolFile[] = SYMBOLS.flatMap((s) => symbolFiles(s));

export function symbolFileByKey(key: string): SymbolFile | undefined {
  return ALL_SYMBOL_FILES.find((f) => symbolKey(f) === key);
}

/** Tệp ký hiệu mà item dùng: `svgFile` nằm đúng trong `graphics/symbols/` và trùng tên tệp của thư viện. */
export function symbolFileOf(item: Item): SymbolFile | undefined {
  if (item.type !== 'svg' || !item.svgFile.startsWith(SYMBOL_DIR)) return undefined;
  const name = item.svgFile.slice(SYMBOL_DIR.length);
  return ALL_SYMBOL_FILES.find((f) => baseOf(f.file) === name);
}

/** Điểm gắn của các item ký hiệu có sẵn, đổi sang đơn vị thiết kế theo vị trí và cỡ item. */
export function fixedPortsOf(items: readonly Item[]): PortRef[] {
  const out: PortRef[] = [];
  for (const it of items) {
    const f = symbolFileOf(it);
    if (f === undefined) continue;
    for (const p of f.ports)
      out.push({
        itemId: it.id,
        portId: p.id,
        x: it.x + p.x * it.width,
        y: it.y + p.y * it.height,
        dir: p.dir,
        kind: p.kind,
      });
  }
  return out;
}

/** Dựng `SymbolDropTarget` từ màn hình đang mở và thiết lập lưới. */
export function symbolTarget(
  screen: ScreenModel,
  graphicsFiles: Iterable<string>,
  schemaVersion: string,
  view: { grid: number; snap: boolean; alt: boolean; zoom: number },
): SymbolDropTarget {
  return { screen, graphicsFiles, schemaVersion, ...view };
}

const idBase = (key: string): string => key.replace(/-/g, '_').slice(0, ID_MAX - 3);

/**
 * Kế hoạch thả ký hiệu `key` với tâm ở `at` (đơn vị thiết kế). Cỡ là `defaultSize`; vị trí dính lưới và đường gióng rồi dính
 * điểm gắn nếu có cặp tương thích trong ngưỡng 10 điểm ảnh (điểm gắn thắng). Thuần; không đổi `target`.
 */
export function planSymbolDrop(
  key: string,
  at: { x: number; y: number },
  target: SymbolDropTarget,
): SymbolPlan {
  const f = symbolFileByKey(key);
  const svg = f === undefined ? null : getSymbolSvg(f.file);
  if (f === undefined || svg === null) return { ok: false, reason: 'unknown-symbol' };
  const screen = target.screen;
  if (screen.items.filter((i) => i.type === 'svg').length >= svgItemLimit(target.schemaVersion))
    return { ok: false, reason: 'max-svg-items' };
  if (screen.items.length >= LIMITS_03.items) return { ok: false, reason: 'max-items' };

  const [width, height] = f.symbol.defaultSize;
  const used = new Set(screen.items.map((i) => i.id));
  const id = nextItemId(idBase(key), used);
  const opts: SnapOptions = {
    grid: target.grid,
    zoom: target.zoom,
    snap: target.snap,
    alt: target.alt,
    others: screen.items
      .filter((i) => i.hidden !== true)
      .map((i) => ({
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      })),
    screen: screen.size,
  };
  const moving: PortRef[] = f.ports.map((p) => ({
    itemId: id,
    portId: p.id,
    x: p.x * width,
    y: p.y * height,
    dir: p.dir,
    kind: p.kind,
  }));
  const s = snapBoxWithPorts({ x: at.x - width / 2, y: at.y - height / 2, width, height }, opts, {
    moving,
    fixed: fixedPortsOf(screen.items),
  });

  const svgFile = `${SYMBOL_DIR}${baseOf(f.file)}`;
  const have = new Set<string>();
  for (const p of target.graphicsFiles) have.add(p);
  const bindingFile = `screens/${screen.id}.${id}.bindings.json`;
  const item: SvgItem = {
    id,
    name: f.symbol.name,
    type: 'svg',
    x: s.x,
    y: s.y,
    width,
    height,
    svgFile,
    bindingFile,
    viewBox: [...f.symbol.viewBox],
    fit: 'contain',
    elements: f.symbol.parts.map((p) => ({ elementUid: p.uid, name: p.label })),
  };
  const change: StoreChange = {
    edits: [
      { kind: 'screenUpsert', screen: { ...screen, items: [...screen.items, item] } },
      {
        kind: 'svgBindings',
        file: bindingFile,
        set: emptyBindingSet(screen.id, id, target.schemaVersion),
      },
    ],
    ...(have.has(svgFile) ? {} : { replace: { [svgFile]: svg } }),
  };
  return {
    ok: true,
    item,
    svgFile,
    bindingFile,
    change,
    ...(s.port !== undefined ? { portSnap: s.port } : {}),
  };
}
