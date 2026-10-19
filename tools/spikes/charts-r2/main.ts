// Spike R2 (feature 012, T037): 12 widget mẫu (3 cột, 2 tròn, 2 vành khuyên, 3 đồng hồ, 1 bản đồ nhiệt bằng ECharts lite
// nạp lười; 1 xu hướng 10.000 điểm bằng uPlot). Đo thời gian nạp chunk và vẽ lần đầu; `?live=1` cập nhật mọi widget 1 Hz
// để đo CPU (run.mjs mở 10 tab). Kết quả ghi vào window.__r2 và body[data-done].
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const params = new URLSearchParams(location.search);
const renderer = params.get('renderer') === 'canvas' ? 'canvas' : 'svg';
const live = params.get('live') === '1';
const animate = params.get('anim') !== '0';

const PALETTE = [
  '#0090ff',
  '#12a594',
  '#30a46c',
  '#ffc53d',
  '#f76b15',
  '#e5484d',
  '#e93d82',
  '#d6409f',
  '#6e56cf',
  '#3e63dd',
  '#00a2c7',
  '#bdee63',
];

const grid = document.getElementById('grid')!;
function cell(title: string): HTMLDivElement {
  const box = document.createElement('section');
  box.className = 'card';
  const h = document.createElement('h2');
  h.textContent = title;
  const body = document.createElement('div');
  body.className = 'chart';
  box.append(h, body);
  grid.append(box);
  return body;
}

const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const cats = ['Bơm 1', 'Bơm 2', 'Bơm 3', 'Quạt', 'Máy nén', 'Van'];

async function main(): Promise<void> {
  const t0 = performance.now();
  const { echarts } = await import('./echarts-lite.ts');
  const tLoad = performance.now();
  const charts: Array<{ chart: ReturnType<typeof echarts.init>; tick: () => void }> = [];
  const base = {
    animation: animate,
    color: PALETTE,
    textStyle: { fontFamily: 'Inter, system-ui' },
  };

  for (let i = 0; i < 3; i++) {
    const chart = echarts.init(cell(`Cột ${i + 1}`), null, { renderer });
    const data = () => cats.map(() => Math.round(rnd(10, 100)));
    chart.setOption({
      ...base,
      grid: { left: 36, right: 8, top: 16, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: i === 2 ? { type: 'value' } : { type: 'category', data: cats },
      yAxis: i === 2 ? { type: 'category', data: cats } : { type: 'value' },
      series: [{ type: 'bar', data: data(), colorBy: 'data', itemStyle: { borderRadius: 4 } }],
    });
    charts.push({ chart, tick: () => chart.setOption({ series: [{ data: data() }] }) });
  }
  for (let i = 0; i < 4; i++) {
    const donut = i >= 2;
    const chart = echarts.init(cell(donut ? `Vành khuyên ${i - 1}` : `Tròn ${i + 1}`), null, {
      renderer,
    });
    const data = () => cats.slice(0, 5).map((name) => ({ name, value: Math.round(rnd(5, 50)) }));
    chart.setOption({
      ...base,
      tooltip: { trigger: 'item' },
      legend: { orient: 'vertical', right: 0, top: 'middle' },
      series: [
        {
          type: 'pie',
          radius: donut ? ['45%', '70%'] : '70%',
          center: ['35%', '50%'],
          label: { show: false },
          data: data(),
        },
      ],
    });
    charts.push({ chart, tick: () => chart.setOption({ series: [{ data: data() }] }) });
  }
  for (let i = 0; i < 3; i++) {
    const chart = echarts.init(cell(`Đồng hồ ${i + 1}`), null, { renderer });
    chart.setOption({
      ...base,
      series: [
        {
          type: 'gauge',
          min: 0,
          max: 100,
          progress: { show: true, width: 12 },
          axisLine: {
            lineStyle: {
              width: 12,
              color: [
                [0.7, '#30a46c'],
                [0.9, '#ffc53d'],
                [1, '#e5484d'],
              ],
            },
          },
          detail: { valueAnimation: animate, formatter: '{value} %', fontSize: 18 },
          data: [{ value: Math.round(rnd(0, 100)) }],
        },
      ],
    });
    charts.push({
      chart,
      tick: () => chart.setOption({ series: [{ data: [{ value: Math.round(rnd(0, 100)) }] }] }),
    });
  }
  {
    const chart = echarts.init(cell('Bản đồ nhiệt 24 × 7'), null, { renderer });
    const data = () => {
      const out: number[][] = [];
      for (let h = 0; h < 24; h++)
        for (let d = 0; d < 7; d++) out.push([h, d, Math.round(rnd(0, 10))]);
      return out;
    };
    chart.setOption({
      ...base,
      tooltip: {},
      grid: { left: 36, right: 8, top: 8, bottom: 40 },
      xAxis: { type: 'category', data: [...Array(24).keys()].map(String) },
      yAxis: { type: 'category', data: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] },
      visualMap: {
        min: 0,
        max: 10,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 80,
        inRange: { color: ['#e6f4fe', '#0d74ce'] },
      },
      series: [{ type: 'heatmap', data: data() }],
    });
    charts.push({ chart, tick: () => chart.setOption({ series: [{ data: data() }] }) });
  }

  // Xu hướng uPlot 10.000 điểm, 3 chuỗi.
  const N = 10_000;
  const now = Date.now() / 1000;
  const xs = Float64Array.from({ length: N }, (_, i) => now - (N - i));
  const ys = [0, 1, 2].map((k) =>
    Float64Array.from({ length: N }, (_, i) => 50 + 30 * Math.sin(i / (200 + 50 * k)) + rnd(-3, 3)),
  );
  const trendBox = cell('Xu hướng 10.000 điểm (uPlot)');
  const plot = new uPlot(
    {
      width: trendBox.clientWidth || 360,
      height: trendBox.clientHeight || 200,
      series: [
        {},
        ...[0, 1, 2].map((k) => ({ label: `Chuỗi ${k + 1}`, stroke: PALETTE[k], width: 1.5 })),
      ],
      axes: [{ grid: { stroke: '#e8e8ec' } }, { grid: { stroke: '#e8e8ec' } }],
    },
    [xs, ...ys] as unknown as uPlot.AlignedData,
    trendBox,
  );
  const tDraw = performance.now();

  (window as unknown as { __r2: unknown }).__r2 = {
    renderer,
    animate,
    loadMs: Math.round(tLoad - t0),
    drawMs: Math.round(tDraw - tLoad),
    widgets: charts.length + 1,
  };
  document.body.dataset.done = '1';

  if (live) {
    let tail = xs[N - 1]!;
    setInterval(() => {
      for (const c of charts) c.tick();
      tail += 1;
      const data = plot.data as unknown as Float64Array[];
      const nx = Float64Array.from([...data[0]!.subarray(1), tail]);
      const nys = data
        .slice(1)
        .map((s) => Float64Array.from([...s.subarray(1), 50 + rnd(-30, 30)]));
      plot.setData([nx, ...nys] as unknown as uPlot.AlignedData);
    }, 1000);
  }
}

main().catch((e) => {
  document.body.dataset.done = 'error';
  console.error(e);
});
