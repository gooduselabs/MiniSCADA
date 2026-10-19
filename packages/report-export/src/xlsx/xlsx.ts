// Xuất XLSX (một sheet) từ ReportTable: ZIP bằng fflate, XML viết tay (specs/010-history-reports/contracts/
// templates-config.md §5, ADR-033). Ô số là số với numFmt theo decimals và đơn vị; chuỗi nội tuyến. Feature 012 (T050,
// FR-039): hàng tiêu đề cột màu nhấn của chủ đề, tiêu đề báo cáo chữ lớn, độ rộng cột theo nội dung (tiêu đề xuống dòng).
import { zipSync, strToU8 } from 'fflate';
import { formatLocal, type ReportTable } from '@mat/history-math';
import { guardFormula, columnHeader, coverageText } from '../csv/csv.ts';
import { reportPalette, type ReportPalette } from '../theme.ts';
import type { ExportLabels, ExportMeta } from '../types.ts';

/** Bỏ ký tự điều khiển không hợp lệ trong XML 1.0 (giữ tab, xuống dòng) và U+FFFE, U+FFFF. */
function stripControl(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    out += ch;
  }
  return out;
}

const xmlText = (s: string): string =>
  stripControl(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const colName = (i: number): string => {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

/** Chữ số vi-VN của bảng -> số JS (bỏ chấm nghìn, phẩy thành chấm); sai hình dạng hoặc không hữu hạn: NaN. */
const toNumber = (text: string): number => {
  const plain = text.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return Number.NaN;
  const n = Number(plain);
  return Number.isFinite(n) ? n : Number.NaN;
};

// Kiểu ô cố định (cellXfs); kiểu số theo (decimals, đơn vị) nối sau, mỗi định dạng hai kiểu: thường và đậm.
const STYLE_BOLD = 1;
const STYLE_HEADER = 2;
const STYLE_TITLE = 3;
const FIXED_XFS = 4;

const sanitizeSheetName = (s: string | undefined): string => {
  const n = stripControl(s ?? '')
    .replace(/[[\]:*?/\\]/g, '')
    .slice(0, 31)
    .trim();
  return n === '' ? 'Sheet1' : n;
};

/** `#AABBCC` -> `FFAABBCC` (ARGB của SpreadsheetML). */
const argb = (hex: string): string => `FF${hex.replace('#', '').toUpperCase()}`;

/**
 * Mã định dạng số: phân cách nghìn, `decimals` chữ số thập phân, đơn vị là chữ trong nháy kép (nên `%` không nhân 100);
 * nháy kép, gạch ngược và ký tự điều khiển trong đơn vị bị bỏ để chuỗi định dạng luôn hợp lệ.
 */
export function numberFormat(decimals: number, unit: string): string {
  const d = Math.max(0, Math.min(10, Math.floor(decimals)));
  const u = stripControl(unit).replace(/["\\]/g, '').trim();
  return `#,##0${d ? `.${'0'.repeat(d)}` : ''}${u ? `" ${u}"` : ''}`;
}

function stylesXml(formats: string[], p: ReportPalette): string {
  const numFmts = formats
    .map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlText(code)}"/>`)
    .join('');
  const xf = (numFmtId: number, fontId: number) =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="0" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}/>`;
  const xfs = [
    xf(0, 0),
    xf(0, 1),
    `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    xf(0, 3),
    ...formats.flatMap((_, i) => [xf(164 + i, 0), xf(164 + i, 1)]),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (formats.length ? `<numFmts count="${formats.length}">${numFmts}</numFmts>` : '') +
    `<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="${argb(p.accentInk)}"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="14"/><color rgb="${argb(p.accent)}"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="${argb(p.accent)}"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

const MIN_W = 8;
const MAX_W = 40;
const HEADER_LINES = 3;
const LINE_HT = 15;
const clampW = (w: number) => Math.max(MIN_W, Math.min(MAX_W, Math.ceil(w)));
const len = (s: string) => [...s].length;

/** Số dòng khi ngắt chữ theo từ ở độ rộng `width` ký tự (ước). */
function wrapLines(text: string, width: number): number {
  let lines = 1;
  let cur = 0;
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const n = len(w);
    if (cur === 0) cur = n;
    else if (cur + 1 + n <= width) cur += 1 + n;
    else {
      lines++;
      cur = n;
    }
  }
  return lines;
}

export function buildXlsx(t: ReportTable, meta: ExportMeta, labels: ExportLabels): Uint8Array {
  const p = reportPalette(meta.theme);
  const formats: string[] = [];
  const fmtOf = t.columns.map((c) => {
    const code = numberFormat(c.decimals, c.unit);
    let i = formats.indexOf(code);
    if (i < 0) i = formats.push(code) - 1;
    return i;
  });
  const numStyle = (k: number, bold: boolean) => FIXED_XFS + 2 * fmtOf[k]! + (bold ? 1 : 0);

  // Độ rộng: cột nhãn theo nhãn dài nhất; cột số theo số dài nhất kèm đơn vị, tiêu đề cột xuống dòng (≤ 3 dòng) thay vì
  // kéo rộng cột, nhưng không hẹp hơn từ dài nhất của tiêu đề.
  const headers = t.columns.map((c) => guardFormula(columnHeader(c, labels)));
  const widths: number[] = [
    clampW(
      Math.max(
        len(labels.rowHeader),
        len(labels.total),
        ...t.rows.map((r) => len(guardFormula(r.label))),
      ) + 2,
    ),
    ...t.columns.map((c, k) => {
      const texts = [
        ...t.rows.map((r) => r.text[k] ?? ''),
        ...(t.totalsText ? [t.totalsText[k] ?? ''] : []),
      ];
      const num = Math.max(0, ...texts.map(len)) + (c.unit ? len(c.unit) + 1 : 0) + 2;
      const h = headers[k]!;
      const word = Math.max(0, ...h.split(/\s+/).map(len)) + 1;
      return clampW(Math.max(num, word, len(h) / HEADER_LINES + 1));
    }),
  ];
  const headerLines = Math.max(
    wrapLines(labels.rowHeader, widths[0]! - 1),
    ...headers.map((h, k) => wrapLines(h, widths[k + 1]! - 1)),
  );

  const rows: string[] = [];
  let r = 0;
  const str = (text: string, c: number, style: number): string =>
    `<c r="${colName(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlText(guardFormula(text))}</t></is></c>`;
  /** Ô số; ô trống hoặc không đọc được giữ chỗ (có kiểu, không có giá trị) để vị trí cột ổn định. */
  const cell = (text: string, c: number, style: number): string => {
    const n = text === '' ? Number.NaN : toNumber(text);
    if (!Number.isFinite(n)) return `<c r="${colName(c)}${r}" s="${style}"/>`;
    return `<c r="${colName(c)}${r}" s="${style}"><v>${n}</v></c>`;
  };
  const push = (cells: string[], attrs = '') => {
    rows.push(`<row r="${r}"${attrs}>${cells.join('')}</row>`);
  };
  const meta1 = (text: string, style = 0, attrs = '') => {
    r++;
    push([str(text, 0, style)], attrs);
  };

  meta1(t.title, STYLE_TITLE, ' ht="21" customHeight="1"');
  meta1(`${labels.period}: ${t.periodLabel}`);
  meta1(`${labels.exportedBy}: ${meta.exportedBy}`);
  meta1(`${labels.exportedAt}: ${formatLocal(meta.exportedAt, meta.tz, 'sec')}`);

  r++;
  const headerRow = r;
  push(
    [
      str(labels.rowHeader, 0, STYLE_HEADER),
      ...t.columns.map((c, i) => str(columnHeader(c, labels), i + 1, STYLE_HEADER)),
    ],
    ` ht="${headerLines * LINE_HT}" customHeight="1"`,
  );
  for (const row of t.rows) {
    r++;
    push([
      str(row.label, 0, 0),
      ...row.text.map((text, k) => cell(text, k + 1, numStyle(k, false))),
    ]);
  }
  if (t.totalsText) {
    r++;
    push([
      str(labels.total, 0, STYLE_BOLD),
      ...t.totalsText.map((text, k) => cell(text, k + 1, numStyle(k, true))),
    ]);
  }
  meta1(coverageText(t, labels));

  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="${headerRow}" topLeftCell="B${headerRow + 1}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>` +
    `</worksheet>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${xmlText(sanitizeSheetName(meta.sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(stylesXml(formats, p)),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return zipSync(files, { level: 6, mtime: meta.exportedAt });
}
