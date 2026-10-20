// Đo T045 (feature 012): thời gian vẽ của bộ điều hợp uPlot thật (packages/ui-components/src/chart/line-chart.ts) với
// 50.000 điểm × 4 đường (hoặc 1 đường có/không tô vùng với ?fill=1/0): dựng lần đầu và trung vị 20 lần setData.
// Chạy bằng run.mjs --uplot. So trước/sau T045 (2026-10-19) bằng bản cũ của line-chart.ts chép tạm: như nhau (research R2).
import { loadUPlot } from '../../../packages/ui-components/src/chart/line-chart.ts';

const N = 50_000;
// ?fill=1: một đường có tô vùng (trường hợp line một đường của T045), so với một đường không tô.
const q = new URLSearchParams(location.search);
const K = q.has('fill') ? 1 : 4;
const FILL = q.get('fill') === '1' ? 'rgba(11, 114, 133, 0.12)' : undefined;
const COLORS = ['#0b7285', '#c2410c', '#6f42c1', '#15703a'];

/** uPlot vẽ trong microtask (commit): chờ vài microtask để phép đo gồm cả lần vẽ canvas. */
const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

async function main(): Promise<void> {
  const factory = await loadUPlot();
  const host = document.getElementById('host')!;
  const x = Float64Array.from({ length: N }, (_, i) => 1_700_000_000 + i);
  const ys = Array.from({ length: K }, (_, k) =>
    Float64Array.from({ length: N }, (_, i) => 50 + 30 * Math.sin(i / (300 + 70 * k)) + (i % 7)),
  );
  const t0 = performance.now();
  const plot = factory(
    host,
    {
      width: 1200,
      height: 400,
      series: COLORS.slice(0, K).map((color, i) => ({
        label: `S${i}`,
        color,
        dash: [],
        width: 2,
        show: true,
        ...(FILL ? { fill: FILL } : {}),
      })),
      grid: true,
      xRange: () => [x[0]!, x[N - 1]!],
      yRange: (a, b) => [a ?? 0, b ?? 1],
      onCursor: () => {},
      axisColor: '#56646a',
      gridColor: '#d2d9dc',
    },
    [x, ...ys],
  );
  await flush();
  const tFirst = performance.now() - t0;
  const variants = [0, 1, 2].map((d) => [x, ...ys.map((y) => y.map((v) => v + d))]);
  const times: number[] = [];
  for (let r = 0; r < 20; r++) {
    const s = performance.now();
    plot.setData(variants[r % 3]!);
    await flush();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  (window as unknown as { __bench: unknown }).__bench = {
    firstMs: Math.round(tFirst),
    setDataMedianMs: Math.round(times[10]! * 10) / 10,
    setDataMaxMs: Math.round(times[19]! * 10) / 10,
  };
  document.body.dataset.done = '1';
}
main().catch((e) => {
  console.error(e);
  document.body.dataset.done = 'error';
});
