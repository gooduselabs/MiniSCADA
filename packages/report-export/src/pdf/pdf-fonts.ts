// Phông Inter 4.1 tĩnh (OFL-1.1, fonts/LICENSE-Inter.txt) cho pdfmake (feature 012, T049, research R4/R6): Regular,
// SemiBold (in đậm), Italic, đã cắt còn Latin, Latin mở rộng, tiếng Việt, dấu câu và ký hiệu đơn vị bằng
// tools/fonts/subset-inter-pdf.mjs. Vite nhúng dạng data URL base64 (`?inline`) vào chunk này; chỉ pdf.ts nạp nó
// bằng import() khi bấm xuất (ADR-033).
import regular from './fonts/Inter-Regular.ttf?inline';
import semiBold from './fonts/Inter-SemiBold.ttf?inline';
import italic from './fonts/Inter-Italic.ttf?inline';

const base64 = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1);

export const PDF_FONT = 'Inter';

export const INTER_VFS: Record<string, string> = {
  'Inter-Regular.ttf': base64(regular),
  'Inter-SemiBold.ttf': base64(semiBold),
  'Inter-Italic.ttf': base64(italic),
};

export const INTER_FONTS = {
  [PDF_FONT]: {
    normal: 'Inter-Regular.ttf',
    bold: 'Inter-SemiBold.ttf',
    italics: 'Inter-Italic.ttf',
    bolditalics: 'Inter-SemiBold.ttf',
  },
};
