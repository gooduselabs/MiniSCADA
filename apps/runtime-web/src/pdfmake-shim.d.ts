// @mat/report-export nạp pdfmake lười; gói đó khai báo tệp build ở src/pdfmake.d.ts nhưng tsc của ứng dụng không
// đọc d.ts không được tham chiếu, nên khai lại ở đây để typecheck sạch.
declare module 'pdfmake/build/pdfmake.min.js';
