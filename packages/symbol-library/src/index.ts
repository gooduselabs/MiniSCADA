// @mat/symbols: thư viện ký hiệu SVG (FR-055…FR-058). Chỉ nạp ở Studio, không vào gói trang runtime.
import { MANIFEST_DATA, SVG_DATA } from './symbols-data.ts';
import type {
  PortDir,
  SymbolCategory,
  SymbolDef,
  SymbolManifest,
  SymbolPortDef,
} from './manifest.ts';

export * from './manifest.ts';
export * from './ports.ts';

export const SYMBOL_MANIFEST: SymbolManifest = MANIFEST_DATA as unknown as SymbolManifest;
export const SYMBOLS: readonly SymbolDef[] = SYMBOL_MANIFEST.symbols;
export const SYMBOL_CATEGORIES: readonly SymbolCategory[] = SYMBOL_MANIFEST.categories;

export function getSymbol(id: string): SymbolDef | undefined {
  return SYMBOLS.find((s) => s.id === id);
}

export function symbolsByCategory(category: string): SymbolDef[] {
  return SYMBOLS.filter((s) => s.category === category);
}

/** Nội dung SVG của tệp (đường dẫn trong package, ví dụ `svg/fan.svg`); null nếu không có. */
export function getSymbolSvg(file: string): string | null {
  return Object.prototype.hasOwnProperty.call(SVG_DATA, file) ? SVG_DATA[file] : null;
}

/** Tìm theo tên, id, từ khóa (không phân biệt hoa thường); chuỗi rỗng trả tất cả. */
export function searchSymbols(query: string): SymbolDef[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...SYMBOLS];
  return SYMBOLS.filter(
    (s) =>
      s.id.includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}

export interface SymbolFile {
  symbol: SymbolDef;
  /** Mã biến thể; undefined cho tệp chính của ký hiệu không có biến thể. */
  variant?: string;
  file: string;
  ports: SymbolPortDef[];
}

/** Mọi tệp SVG của ký hiệu: biến thể (nếu có) hoặc tệp chính. */
export function symbolFiles(symbol: SymbolDef): SymbolFile[] {
  if (symbol.variants && symbol.variants.length > 0)
    return symbol.variants.map((v) => ({ symbol, variant: v.id, file: v.file, ports: v.ports }));
  return [{ symbol, file: symbol.file, ports: symbol.ports }];
}

export type { PortDir };
