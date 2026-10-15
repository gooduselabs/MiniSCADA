// Kiểu `?raw` của Vite: sim-history.ts chỉ import KIỂU từ @mat/ui-components, nhưng bộ kiểm kiểu của gói này đọc cả nguồn của nó
// (có import `*.css?raw`). Không có mã chạy.
declare module '*?raw' {
  const content: string;
  export default content;
}
