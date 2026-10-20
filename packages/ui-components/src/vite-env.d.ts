// Nhập chuỗi thô của file CSS (Vite `?raw`): token và CSS của uPlot.
declare module '*.css?raw' {
  const text: string;
  export default text;
}

// URL tệp phông do Vite cấp (`?url`, feature 012): @font-face của installTokens().
declare module '*.woff2?url' {
  const url: string;
  export default url;
}
