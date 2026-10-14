// Xuất XLSX (một sheet) từ ReportTable: ZIP bằng fflate, XML viết tay (specs/010-history-reports/contracts/
// templates-config.md §5, ADR-033). Ô số là số với numFmt theo decimals; chuỗi nội tuyến.
import { zipSync, strToU8 } from 'fflate';
import { formatLocal, type ReportTable } from '@mat/history-math';
import { guardFormula, columnHeader, coverageText } from '../csv/csv.ts';
import type { ExportLabels, ExportMeta } from '../types.ts';

/** Bỏ ký tự không hợp lệ trong XML 1.0, thoát & < > " '. */
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

/** Chữ số vi-VN của bảng -> số JS (bỏ chấm nghìn, phẩy thành chấm). */
const toNumber = (text: string): number => Number(text.replace(/\./g, '').replace(',', '.'));

const STYLE_BOLD = 1;
const STYLE_HEADER = 2;
const STYLE_NUM = 3; // + decimals (0-6)
const STYLE_NUM_BOLD = 10; // + decimals

const sanitizeSheetName = (s: string | undefined): string => {
  const n = stripControl(s ?? '')
    .replace(/[[\]:*?/\\]/g, '')
    .slice(0, 31)
    .trim();
  return n === '' ? 'Sheet1' : n;
};

function stylesXml(): string {
  const fmt = (d: number) => (d === 0 ? '0' : `0.${'0'.repeat(d)}`);
  const numFmts = Array.from(
    { length: 7 },
    (_, d) => `<numFmt numFmtId="${164 + d}" formatCode="${fmt(d)}"/>`,
  ).join('');
  const xf = (numFmtId: number, fontId: number, extra = '') =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="0" borderId="0" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${extra}/>`;
  const xfs = [
    xf(0, 0),
    xf(0, 1),
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    ...Array.from({ length: 7 }, (_, d) => xf(164 + d, 0)),
    ...Array.from({ length: 7 }, (_, d) => xf(164 + d, 1)),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="7">${numFmts}</numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}

export function buildXlsx(t: ReportTable, meta: ExportMeta, labels: ExportLabels): Uint8Array {
  const rows: string[] = [];
  const widths: number[] = Array.from({ length: t.columns.length + 1 }, () => 8);
  let r = 0;
  const str = (text: string, c: number, style: number, measure = true): string => {
    const s = guardFormula(text);
    if (measure) widths[c] = Math.max(widths[c] ?? 8, Math.min(40, [...s].length + 2));
    return `<c r="${colName(c)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlText(s)}</t></is></c>`;
  };
  const num = (text: string, c: number, style: number): string => {
    widths[c] = Math.max(widths[c] ?? 8, Math.min(40, text.length + 2));
    return `<c r="${colName(c)}${r}" s="${style}"><v>${toNumber(text)}</v></c>`;
  };
  /** Ô số; ô trống giữ chỗ (có kiểu, không có giá trị) để vị trí cột ổn định. */
  const cell = (text: string, c: number, style: number): string =>
    text === '' ? `<c r="${colName(c)}${r}" s="${style}"/>` : num(text, c, style);
  const push = (cells: string[]) => {
    rows.push(`<row r="${r}">${cells.join('')}</row>`);
  };
  const meta1 = (text: string, style = 0) => {
    r++;
    push([str(text, 0, style, false)]);
  };

  meta1(t.title, STYLE_BOLD);
  meta1(`${labels.period}: ${t.periodLabel}`);
  meta1(`${labels.exportedBy}: ${meta.exportedBy}`);
  meta1(`${labels.exportedAt}: ${formatLocal(meta.exportedAt, meta.tz, 'sec')}`);

  r++;
  const headerRow = r;
  push([
    str(labels.rowHeader, 0, STYLE_HEADER),
    ...t.columns.map((c, i) => str(columnHeader(c, labels), i + 1, STYLE_HEADER)),
  ]);
  for (const row of t.rows) {
    r++;
    push([
      str(row.label, 0, 0),
      ...row.text.map((text, k) => cell(text, k + 1, STYLE_NUM + t.columns[k]!.decimals)),
    ]);
  }
  if (t.totalsText) {
    r++;
    push([
      str(labels.total, 0, STYLE_BOLD),
      ...t.totalsText.map((text, k) => cell(text, k + 1, STYLE_NUM_BOLD + t.columns[k]!.decimals)),
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
    'xl/styles.xml': strToU8(stylesXml()),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  };
  return zipSync(files, { level: 6, mtime: meta.exportedAt });
}
