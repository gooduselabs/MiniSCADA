// Kiểu nhập `?raw`, `?url` của Vite mà @mat/ui-components dùng (gói này chỉ nhập kiểu của nó cho PreviewHost).
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*?url' {
  const url: string;
  export default url;
}
