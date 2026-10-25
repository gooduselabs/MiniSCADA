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

// Kiểu ô cố định (cellXfs); kiểu số theo (decimals, đơn vị) nối sau, mỗi định dạng ba kiểu: thường, sọc, dòng tổng.
const STYLE_BOLD = 1;
const STYLE_HEADER = 2;
const STYLE_TITLE = 3;
const STYLE_ZEBRA = 4;
const STYLE_TOTAL = 5;
const STYLE_SECTION = 6;
const STYLE_MUTED = 7;
const FIXED_XFS = 8;
const PER_FMT = 3;

// ---- logo (feature 024) --------------------------------------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Khung của logo trong XLSX, px; ảnh nhỏ hơn giữ nguyên cỡ. */
const LOGO_BOX = { width: 160, height: 48 } as const;
const EMU_PER_PX = 9525;

/** Kích thước của ảnh PNG theo IHDR; null khi không phải PNG. */
export function pngSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 24 || PNG_SIG.some((x, i) => b[i] !== x)) return null;
  if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== 'IHDR') return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** drawing1.xml: một ảnh neo ở ô (`col`, hàng 0), cỡ `w` x `h` px. */
function drawingXml(col: number, w: number, h: number): string {
  const cx = w * EMU_PER_PX;
  const cy = h * EMU_PER_PX;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
    `<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
    `</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`
  );
}

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

// fonts: 0 thường, 1 đậm, 2 đậm chữ trên nền nhấn, 3 tiêu đề lớn màu nhấn, 4 tiêu đề mục màu nhấn, 5 chữ nhạt nghiêng
// fills: 0 none, 1 gray125 (bắt buộc), 2 nhấn (đầu bảng), 3 sọc, 4 dòng tổng
// borders: 0 không, 1 gạch dưới mảnh, 2 gạch trên đậm màu nhấn (dòng tổng)
function stylesXml(formats: string[], p: ReportPalette): string {
  const numFmts = formats
    .map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xmlText(code)}"/>`)
    .join('');
  const xf = (numFmtId: number, fontId: number, fillId = 0, borderId = 0) =>
    `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
    `${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}` +
    `${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}/>`;
  const xfs = [
    xf(0, 0),
    xf(0, 1),
    `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`,
    xf(0, 3),
    xf(0, 0, 3),
    xf(0, 1, 4, 2),
    xf(0, 4),
    xf(0, 5),
    ...formats.flatMap((_, i) => [xf(164 + i, 0), xf(164 + i, 0, 3), xf(164 + i, 1, 4, 2)]),
  ];
  const solid = (hex: string) =>
    `<fill><patternFill patternType="solid"><fgColor rgb="${argb(hex)}"/><bgColor indexed="64"/></patternFill></fill>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (formats.length ? `<numFmts count="${formats.length}">${numFmts}</numFmts>` : '') +
    `<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="${argb(p.accentInk)}"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="14"/><color rgb="${argb(p.accent)}"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="12"/><color rgb="${argb(p.accent)}"/><name val="Calibri"/></font>` +
    `<font><i/><sz val="10"/><color rgb="${argb(p.muted)}"/><name val="Calibri"/></font></fonts>` +
    `<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    solid(p.accent) +
    solid(p.zebra) +
    solid(p.chartSoft[0]!) +
    `</fills>` +
    `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>` +
    `<border><left/><right/><top style="medium"><color rgb="${argb(p.accent)}"/></top><bottom/><diagonal/></border></borders>` +
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
  const fmtIndex = (code: string) => {
    let i = formats.indexOf(code);
    if (i < 0) i = formats.push(code) - 1;
    return i;
  };
  const fmtOf = t.columns.map((c) => fmtIndex(numberFormat(c.decimals, c.unit)));
  /** Kiểu ô số của cột `k`: 0 thường, 1 sọc, 2 dòng tổng. */
  const numStyle = (k: number, kind: 0 | 1 | 2) => FIXED_XFS + PER_FMT * fmtOf[k]! + kind;
  const tiles = t.tiles ?? [];
  const tileFmt = tiles.map((x) => fmtIndex(numberFormat(decimalsOf(x.text), x.unit)));
  const sections = t.sections ?? [];
  const intFmt = fmtIndex(numberFormat(0, ''));
  const oneFmt = fmtIndex(numberFormat(1, ''));
  const rowHeader = t.rowHeader ?? labels.rowHeader;

  // Độ rộng: cột nhãn theo nhãn dài nhất; cột số theo số dài nhất kèm đơn vị, tiêu đề cột xuống dòng (≤ 3 dòng) thay vì
  // kéo rộng cột, nhưng không hẹp hơn từ dài nhất của tiêu đề. Bảng phụ nới cột theo ô của chúng.
  const headers = t.columns.map((c) => guardFormula(columnHeader(c, labels)));
  const widths: number[] = [
    clampW(
      Math.max(
        len(rowHeader),
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
  for (const s of sections)
    s.columns.forEach((col, k) => {
      const w = clampW(Math.max(len(col.label), ...s.rows.map((r) => len(r[k] ?? ''))) + 2);
      widths[k] = Math.max(widths[k] ?? MIN_W, w);
    });
  const headerLines = Math.max(
    wrapLines(rowHeader, widths[0]! - 1),
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
  if (t.org) meta1(t.org, STYLE_BOLD);
  meta1(`${labels.period}: ${t.periodLabel}`);
  meta1(`${labels.exportedBy}: ${meta.exportedBy}`);
  meta1(`${labels.exportedAt}: ${formatLocal(meta.exportedAt, meta.tz, 'sec')}`);
  // thẻ tổng hợp: nhãn | giá trị (số có đơn vị)
  tiles.forEach((x, i) => {
    r++;
    const style = FIXED_XFS + PER_FMT * tileFmt[i]!;
    push([str(x.label, 0, STYLE_BOLD), cell(x.text === '–' ? '' : x.text, 1, style)]);
  });

  r++;
  const headerRow = r;
  push(
    [
      str(rowHeader, 0, STYLE_HEADER),
      ...t.columns.map((c, i) => str(columnHeader(c, labels), i + 1, STYLE_HEADER)),
    ],
    ` ht="${headerLines * LINE_HT}" customHeight="1"`,
  );
  t.rows.forEach((row, i) => {
    r++;
    const zebra = i % 2 === 1;
    push([
      str(row.label, 0, zebra ? STYLE_ZEBRA : 0),
      ...row.text.map((text, k) => cell(text, k + 1, numStyle(k, zebra ? 1 : 0))),
    ]);
  });
  if (t.totalsText) {
    r++;
    push([
      str(labels.total, 0, STYLE_TOTAL),
      ...t.totalsText.map((text, k) => cell(text, k + 1, numStyle(k, 2))),
    ]);
  }
  if (t.showCoverage !== false) meta1(coverageText(t, labels), STYLE_MUTED);
  for (const n of t.notes ?? []) meta1(n, STYLE_MUTED);

  // bảng phụ: dòng trống, tiêu đề mục, đầu bảng, các hàng (ô số là số)
  for (const s of sections) {
    r++;
    meta1(s.title, STYLE_SECTION, ' ht="18" customHeight="1"');
    r++;
    push(s.columns.map((c, k) => str(c.label, k, STYLE_HEADER)));
    s.rows.forEach((row, i) => {
      r++;
      const zebra = i % 2 === 1;
      push(
        row.map((text, k) => {
          const v = s.values?.[i]?.[k] ?? null;
          if (s.columns[k]?.numeric && v !== null && Number.isFinite(v)) {
            const f = Number.isInteger(v) ? intFmt : oneFmt;
            return `<c r="${colName(k)}${r}" s="${FIXED_XFS + PER_FMT * f + (zebra ? 1 : 0)}"><v>${v}</v></c>`;
          }
          return str(text, k, zebra ? STYLE_ZEBRA : 0);
        }),
      );
    });
  }
  const cols = widths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  // feature 024: logo PNG ở góc trên bên phải (cột ngay sau cột cuối của bảng chính), giữ tỉ lệ trong khung
  const logoSize = meta.logoPng ? pngSize(meta.logoPng) : null;
  const logoScale = logoSize
    ? Math.min(1, LOGO_BOX.width / logoSize.width, LOGO_BOX.height / logoSize.height)
    : 1;
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="${headerRow}" topLeftCell="B${headerRow + 1}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData>` +
    (logoSize ? `<drawing r:id="rId1"/>` : '') +
    `</worksheet>`;
  const rels = (body: string) =>
    strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`,
    );
  const logoFiles: Record<string, Uint8Array> =
    logoSize && meta.logoPng
      ? {
          'xl/media/image1.png': meta.logoPng,
          'xl/drawings/drawing1.xml': strToU8(
            drawingXml(
              t.columns.length + 1,
              Math.max(1, Math.round(logoSize.width * logoScale)),
              Math.max(1, Math.round(logoSize.height * logoScale)),
            ),
          ),
          'xl/drawings/_rels/drawing1.xml.rels': rels(
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`,
          ),
          'xl/worksheets/_rels/sheet1.xml.rels': rels(
            `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>`,
          ),
        }
      : {};

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        (logoSize
          ? `<Default Extension="png" ContentType="image/png"/>` +
            `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
          : '') +
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
    ...logoFiles,
  };
  return zipSync(files, { level: 6, mtime: meta.exportedAt });
}

/** Số chữ số thập phân của chữ số vi-VN đã định dạng ('12,50' -> 2). */
function decimalsOf(text: string): number {
  const i = text.indexOf(',');
  return i < 0 ? 0 : text.length - i - 1;
}
