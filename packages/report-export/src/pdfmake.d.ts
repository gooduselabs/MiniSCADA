// pdfmake không có kiểu: khai báo tệp build dùng ở pdf/pdf.ts (đối tượng được ép kiểu tại nơi dùng).
declare module 'pdfmake/build/pdfmake.min.js';
// Phông Inter của báo cáo PDF nhúng bằng `?inline` của Vite (data URL base64), pdf/pdf-fonts.ts.
declare module '*.ttf?inline' {
  const dataUrl: string;
  export default dataUrl;
}
