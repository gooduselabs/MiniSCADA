// Đo và hiệu chỉnh ngưỡng đối chiếu nhập lại (T100; SC-009; ADR-023 mục 7).
// Chạy từ gốc repo:  node tests/fixtures/svg-import/reimport/measure.mjs [--write]
// Với mỗi bộ ngưỡng: chạy mọi cặp, đếm khớp đúng / gán sai / cần chọn / mới / mồ côi, và phân bố D của
// khớp đúng và gán sai theo bước. `--write` ghi mục `reimport` vào docs/reports/008-fixtures.json.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const HERE = dirname(fileURLToPath(import.meta.url));
const { importSvg, makeSeededUid, MATCH_THRESHOLDS } = await import('../../../../packages/svg-import/src/index.ts');

const pairs = readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((name) => ({
    name,
    v1: readFileSync(join(HERE, name, 'v1.svg'), 'utf8'),
    v2: readFileSync(join(HERE, name, 'v2.svg')),
    ans: JSON.parse(readFileSync(join(HERE, name, 'answer.json'), 'utf8')),
  }));

const BUCKETS = [0, 0.0005, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, Infinity];
const bucket = (d) => BUCKETS.findIndex((b, i) => d >= b && d < BUCKETS[i + 1]);

function run(th) {
  const tot = { elements: 0, withOld: 0, correct: 0, wrong: 0, ambiguous: 0, ambiguousHadTruth: 0, added: 0, orphans: 0 };
  const hist = { correct: {}, wrong: {} };
  const wrongList = [];
  const perPair = [];
  for (const p of pairs) {
    const r = importSvg(p.v2, { uid: makeSeededUid('m'), previous: { svg: p.v1, thresholds: th } });
    if (!r.ok) throw new Error(p.name + ': ' + r.error.message);
    const truth = new Map(p.ans.answers.map((a) => [a.new, a]));
    const row = { pair: p.name, elements: p.ans.answers.length, withOld: 0, correct: 0, wrong: 0, ambiguous: r.match.ambiguous.length, added: r.match.added.length, orphans: r.match.orphans.length };
    for (const a of p.ans.answers) if (a.old !== null) row.withOld++;
    for (const m of r.match.pairs) {
      const t = truth.get(m.newPath);
      const key = `${m.step}:${bucket(m.d)}`;
      if (t && t.old === m.oldUid) {
        row.correct++;
        hist.correct[key] = (hist.correct[key] ?? 0) + 1;
      } else {
        row.wrong++;
        hist.wrong[key] = (hist.wrong[key] ?? 0) + 1;
        wrongList.push(`${p.name} ${m.newPath} bước ${m.step} D=${m.d.toFixed(4)}`);
      }
    }
    for (const a of r.match.ambiguous) if (truth.get(a.newPath)?.old) tot.ambiguousHadTruth++;
    for (const k of ['elements', 'withOld', 'correct', 'wrong', 'ambiguous', 'added', 'orphans']) tot[k] += row[k];
    perPair.push(row);
  }
  return { tot, hist, wrongList, perPair };
}

const label = (th) => JSON.stringify(th);
const sweeps = [
  ['mặc định', {}],
  ['literal §7 (margin 0, idAuto 0,25)', { margin: 0, idAuto: 0.25 }],
  ['chỉ idAuto 0,25', { idAuto: 0.25 }],
  ['chỉ margin 0', { margin: 0 }],
  ['structure 0,02', { structure: 0.02 }],
  ['structure 0,1', { structure: 0.1 }],
  ['structure 0,25', { structure: 0.25 }],
  ['geometry 0,002', { geometry: 0.002 }],
  ['geometry 0,01', { geometry: 0.01 }],
  ['geometry 0,02', { geometry: 0.02 }],
  ['margin 0,005', { margin: 0.005 }],
  ['idAuto 0,02', { idAuto: 0.02 }],
  ['idAuto 0,1', { idAuto: 0.1 }],
  ['id 0,05 (idAuto 0,05)', { id: 0.05 }],
  ['uid 0,1', { uid: 0.1 }],
];
const results = sweeps.map(([name, th]) => ({ name, th, ...run(th) }));
for (const r of results) {
  const t = r.tot;
  console.log(`${r.name.padEnd(36)} đúng ${t.correct}/${t.withOld} (${((100 * t.correct) / t.withOld).toFixed(1)} %)  sai ${t.wrong}  cần chọn ${t.ambiguous} (có đáp án ${t.ambiguousHadTruth})  mới ${t.added}  mồ côi ${t.orphans}`);
  if (r.wrongList.length && r.name !== 'mặc định') console.log('    sai:', r.wrongList.slice(0, 4).join(' | '));
}
const base = results[0];
console.log('\nPhân bố D theo "bước:ngăn" (ngăn: ' + BUCKETS.slice(0, -1).map((b, i) => `${i}=[${b},${BUCKETS[i + 1]})`).join(' ') + ')');
console.log(' đúng:', JSON.stringify(base.hist.correct));
console.log(' sai :', JSON.stringify(base.hist.wrong));
console.table(base.perPair);

if (process.argv.includes('--write')) {
  const out = resolve(HERE, '../../../../docs/reports/008-fixtures.json');
  const j = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  j.reimport = {
    task: 'T100',
    thresholds: { ...MATCH_THRESHOLDS },
    note: 'Cặp 1-2 do Inkscape 1.4.3 thật; cặp 3 là kịch bản biến đổi mô phỏng LibreOffice (không có soffice); cặp 4-7 kịch bản biến đổi.',
    totals: base.tot,
    perPair: base.perPair,
    histogramBuckets: BUCKETS.slice(0, -1),
    histogram: base.hist,
    sweeps: results.map((r) => ({ name: r.name, thresholds: r.th, ...r.tot })),
  };
  writeFileSync(out, JSON.stringify(j, null, 2) + '\n');
  console.log('đã ghi', out);
}
