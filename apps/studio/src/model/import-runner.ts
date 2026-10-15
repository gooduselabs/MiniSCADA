// Bộ chạy importSvg của Studio (feature 008, T057): thử Web Worker trước (không chặn giao diện), rơi về luồng chính khi
// Worker không có DOMParser (`unsupported`), lỗi hoặc không có Worker. Đã biết Worker không dùng được thì các lần sau
// chạy thẳng trên luồng chính. Luôn nhường một nhịp trước khi chạy trên luồng chính để giao diện vẽ trạng thái đang nhập.
import { importSvg, type ImportResult } from '@mat/svg-import';
import type { FromWorker, ToWorker } from '../workers/import.worker.ts';

export interface RunnerWorker {
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  postMessage(m: ToWorker): void;
  terminate(): void;
}

export interface RunOptions {
  fileName: string;
  optimize: boolean;
}

/** Chạy nhập một file; `onProgress` nhận 0..1. Không ném lỗi nhập (trả `ok: false`); chỉ ném khi cả hai đường đều hỏng. */
export type ImportRunner = (
  bytes: Uint8Array,
  options: RunOptions,
  onProgress?: (fraction: number) => void,
) => Promise<ImportResult>;

export interface RunnerDeps {
  createWorker?: () => RunnerWorker;
  /** Bộ sinh UID cho đường luồng chính (test dùng bản tất định). */
  uid?: () => string;
}

export function createRunner(deps: RunnerDeps = {}): ImportRunner {
  let worker: RunnerWorker | null = null;
  let seq = 0;
  let unusable = deps.createWorker === undefined;
  const waiting = new Map<
    number,
    { resolve: (r: ImportResult | null) => void; progress?: (f: number) => void }
  >();

  const dropWorker = (): void => {
    unusable = true;
    worker?.terminate();
    worker = null;
    for (const w of waiting.values()) w.resolve(null);
    waiting.clear();
  };

  const ensure = (): RunnerWorker | null => {
    if (unusable) return null;
    if (worker) return worker;
    try {
      const w = deps.createWorker!();
      w.onmessage = (e) => {
        const m = e.data;
        const slot = waiting.get(m.id);
        if (!slot) return;
        if (m.type === 'progress') slot.progress?.(m.fraction);
        else if (m.type === 'result') {
          waiting.delete(m.id);
          slot.resolve(m.result);
        } else {
          // `unsupported` (không có DOMParser) hoặc `error`: các lần sau khỏi hỏi Worker.
          if (m.type === 'unsupported') dropWorker();
          else {
            waiting.delete(m.id);
            slot.resolve(null);
          }
        }
      };
      w.onerror = () => dropWorker();
      worker = w;
      return w;
    } catch {
      unusable = true;
      return null;
    }
  };

  const viaWorker = (
    bytes: Uint8Array,
    o: RunOptions,
    progress?: (f: number) => void,
  ): Promise<ImportResult | null> => {
    const w = ensure();
    if (!w) return Promise.resolve(null);
    const id = ++seq;
    return new Promise((resolve) => {
      waiting.set(id, { resolve, ...(progress ? { progress } : {}) });
      try {
        w.postMessage({ type: 'import', id, bytes, fileName: o.fileName, optimize: o.optimize });
      } catch {
        waiting.delete(id);
        dropWorker();
        resolve(null);
      }
    });
  };

  return async (bytes, options, onProgress) => {
    const fromWorker = await viaWorker(bytes, options, onProgress);
    if (fromWorker) return fromWorker;
    await new Promise<void>((r) => setTimeout(r, 0));
    onProgress?.(0.1);
    return importSvg(bytes, {
      fileName: options.fileName,
      optimize: options.optimize,
      ...(deps.uid ? { uid: deps.uid } : {}),
    });
  };
}

/** Bộ chạy mặc định của Studio: Worker khi trình duyệt có. */
export const defaultImportRunner: ImportRunner = createRunner(
  typeof Worker === 'undefined'
    ? {}
    : {
        createWorker: () =>
          new Worker(new URL('../workers/import.worker.ts', import.meta.url), {
            type: 'module',
          }) as unknown as RunnerWorker,
      },
);
