// Làm sạch SVG trong bước nâng cấp lên 0.4 (feature 008, T106, FR-005): luật 0.4 kiểm nội dung SVG theo allowlist
// (`E_SVG_UNSAFE`), còn SVG của 0.1 đến 0.3 có thể chứa phần ngoài allowlist vô hại (ví dụ `<title>` ở gốc). Nâng cấp chạy
// đúng bộ lọc `sanitizeSvg` của trang vận hành trên từng SVG, GIỮ `id` và `data-mat-uid` (không đổi định danh nên binding
// và sự kiện còn nguyên); file đã sạch giữ từng byte. Báo cáo nêu số lượng và tên phần tử bị loại để hộp thoại liệt kê.
// DOCTYPE và PI ở phần mở đầu (F11 của rà soát 008, T215): bỏ bằng `prescan` của importer (entity Adobe thay bằng URI,
// entity khác thì để nguyên cho bộ kiểm tra báo E_SVG_UNSAFE) rồi ghi lại; DTD không bao giờ đưa cho DOMParser.
import { prescan } from '@mat/svg-import';
import { parseSvg, sanitizeSvg } from '@mat/svg-renderer';
import type { MigrateChange } from '@mat/project-schema';

/** Một file SVG đã làm sạch: phần tử bị loại theo tên, số thuộc tính, mã lý do. */
export interface SvgCleanFile {
  file: string;
  elements: Record<string, number>;
  attributes: number;
  codes: string[];
}

/** Việc làm sạch SVG của lần nâng cấp (hiện trong hộp thoại Nâng cấp). */
export interface SvgCleanChange {
  kind: 'svgClean';
  files: SvgCleanFile[];
  totalElements: number;
  totalAttributes: number;
}

/** Thay đổi của kế hoạch nâng cấp: của thư viện kiểm tra cộng việc làm sạch SVG của Studio. */
export type UpgradeChange = MigrateChange | SvgCleanChange;

/**
 * Làm sạch mọi file `.svg` của `files`. Trả bản đồ file mới (chỉ file có gì bị loại mới đổi) và báo cáo (`null` khi
 * không đổi gì). SVG không phải XML hợp lệ hoặc không có DOMParser: để nguyên (bộ kiểm tra tự báo lỗi).
 */
export function cleanSvgFiles(files: Record<string, string>): {
  files: Record<string, string>;
  change: SvgCleanChange | null;
} {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined')
    return { files, change: null };
  const out: Record<string, string> = { ...files };
  const cleaned: SvgCleanFile[] = [];
  for (const file of Object.keys(files).sort()) {
    if (!file.endsWith('.svg')) continue;
    const original = files[file]!;
    try {
      // prescan bỏ BOM, PI, DOCTYPE; DTD có entity ngoài bảng Adobe thì để nguyên file. Lỗi khác của prescan (khai
      // báo encoding lạ): làm như trước, parseSvg trên bản gốc bỏ BOM.
      const pre = prescan(original, Number.MAX_SAFE_INTEGER);
      if (!pre.ok && pre.code === 'E_IMPORT_DTD') continue;
      const root = parseSvg(
        pre.ok ? pre.text : original.charCodeAt(0) === 0xfeff ? original.slice(1) : original,
      );
      const r = sanitizeSvg(root);
      const codes = [
        ...(pre.ok && pre.dtdRemoved ? ['R_DTD'] : []),
        ...(pre.ok && pre.pis.length > 0 ? ['R_PI'] : []),
        ...Object.keys(r.codes),
      ];
      const elements = Object.keys(r.removedElements);
      if (elements.length === 0 && r.removedAttributes === 0 && codes.length === 0) continue;
      out[file] = new XMLSerializer().serializeToString(root);
      cleaned.push({
        file,
        elements: { ...r.removedElements },
        attributes: r.removedAttributes,
        codes,
      });
    } catch {
      // không phải XML hợp lệ: giữ nguyên
    }
  }
  if (cleaned.length === 0) return { files, change: null };
  return {
    files: out,
    change: {
      kind: 'svgClean',
      files: cleaned,
      totalElements: cleaned.reduce(
        (n, f) => n + Object.values(f.elements).reduce((a, b) => a + b, 0),
        0,
      ),
      totalAttributes: cleaned.reduce((n, f) => n + f.attributes, 0),
    },
  };
}
