// Worker nhập SVG (feature 008, T056/T057): giao thức tin nhắn của bộ xử lý và bộ chạy có dự phòng (Worker thật không có
// DOMParser nên báo `unsupported`, bộ chạy rơi về luồng chính).
import { describe, expect, it } from 'vitest';
import { makeSeededUid } from '@mat/svg-import';
import { createRunner, type RunnerWorker } from '../model/import-runner.ts';
import { createHandler, type FromWorker, type ToWorker } from './import.worker.ts';

const NS = 'http://www.w3.org/2000/svg';
const BYTES = new TextEncoder().encode(
  `<svg xmlns="${NS}" width="10" height="10" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>`,
);

describe('createHandler', () => {
  it('nhận import: báo tiến độ rồi kết quả cùng id', () => {
    const out: FromWorker[] = [];
    const h = createHandler((m) => out.push(m), { hasDom: true, uid: makeSeededUid('w') });
    h({ type: 'import', id: 7, bytes: BYTES, fileName: 'a.svg', optimize: false });
    expect(out.map((m) => m.type)).toEqual(['progress', 'result']);
    expect(out.every((m) => m.id === 7)).toBe(true);
    const res = out[1] as Extract<FromWorker, { type: 'result' }>;
    expect(res.result.ok).toBe(true);
  });

  it('không có DOMParser trong worker: unsupported, không ném', () => {
    const out: FromWorker[] = [];
    const h = createHandler((m) => out.push(m), { hasDom: false });
    h({ type: 'import', id: 1, bytes: BYTES, fileName: 'a.svg', optimize: false });
    expect(out).toEqual([{ type: 'unsupported', id: 1 }]);
  });

  it('importSvg ném: báo error thay vì làm worker chết', () => {
    const out: FromWorker[] = [];
    const h = createHandler((m) => out.push(m), {
      hasDom: true,
      importer: () => {
        throw new Error('hỏng');
      },
    });
    h({ type: 'import', id: 2, bytes: BYTES, fileName: 'a.svg', optimize: false });
    expect(out.at(-1)).toMatchObject({ type: 'error', id: 2 });
  });
});

describe('createRunner', () => {
  const fake = (reply: (m: ToWorker, post: (r: FromWorker) => void) => void): RunnerWorker => {
    const w: RunnerWorker = {
      onmessage: null,
      onerror: null,
      terminate: () => undefined,
      postMessage(m) {
        queueMicrotask(() => reply(m, (r) => w.onmessage?.({ data: r })));
      },
    };
    return w;
  };

  it('Worker trả kết quả: dùng kết quả đó và chuyển tiến độ', async () => {
    const progress: number[] = [];
    const run = createRunner({
      createWorker: () =>
        fake((m, post) => {
          if (m.type !== 'import') return;
          post({ type: 'progress', id: m.id, fraction: 0.4 });
          const h = createHandler(post, { hasDom: true, uid: makeSeededUid('w') });
          h(m);
        }),
      uid: makeSeededUid('main'),
    });
    const r = await run(BYTES, { fileName: 'a.svg', optimize: false }, (f) => progress.push(f));
    expect(r.ok).toBe(true);
    expect(progress).toContain(0.4);
  });

  it('Worker báo unsupported: chạy trên luồng chính và nhớ để lần sau khỏi hỏi Worker', async () => {
    let created = 0;
    const run = createRunner({
      createWorker: () => {
        created++;
        return fake((m, post) => post({ type: 'unsupported', id: (m as { id: number }).id }));
      },
      uid: makeSeededUid('main'),
    });
    expect((await run(BYTES, { fileName: 'a.svg', optimize: false })).ok).toBe(true);
    expect((await run(BYTES, { fileName: 'b.svg', optimize: false })).ok).toBe(true);
    expect(created).toBe(1);
  });

  it('Worker lỗi (onerror): rơi về luồng chính, không treo', async () => {
    const run = createRunner({
      createWorker: () => {
        const w = fake(() => undefined);
        queueMicrotask(() => w.onerror?.({ message: 'chết' }));
        return w;
      },
      uid: makeSeededUid('main'),
    });
    expect((await run(BYTES, { fileName: 'a.svg', optimize: false })).ok).toBe(true);
  });

  it('không có Worker: chạy trên luồng chính', async () => {
    const run = createRunner({ uid: makeSeededUid('main') });
    expect((await run(BYTES, { fileName: 'a.svg', optimize: true })).ok).toBe(true);
  });
});
