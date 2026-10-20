// Kiểu `?raw` của Vite: sim-history.ts chỉ import KIỂU từ @mat/ui-components, nhưng bộ kiểm kiểu của gói này đọc cả nguồn của nó
// (có import `*.css?raw`). Không có mã chạy.
declare module '*?raw' {
  const content: string;
  export default content;
}

// `?url` của Vite (feature 012): tokens.ts của @mat/ui-components nhập URL tệp phông Inter.
declare module '*?url' {
  const url: string;
  export default url;
}
