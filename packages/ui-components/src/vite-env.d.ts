// Nhập chuỗi thô của file CSS (Vite `?raw`): token và CSS của uPlot.
declare module '*.css?raw' {
  const text: string;
  export default text;
}
