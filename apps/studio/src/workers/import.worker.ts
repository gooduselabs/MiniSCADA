// Web Worker nhập SVG (feature 008, T057; contract studio-svg-editor §3): chạy `importSvg` ngoài luồng giao diện và báo tiến độ
// qua postMessage. Lưu ý: Web Worker không có `DOMParser`, mà importer (và bộ lọc allowlist) cần nó; khi thiếu, worker
// trả `unsupported` và bộ chạy (model/import-runner.ts) rơi về luồng chính. Worker không đọc file, không ghi gì.
import { importSvg, type ImportResult } from '@mat/svg-import';

export type ToWorker = {
  type: 'import';
  id: number;
  bytes: Uint8Array;
  fileName: string;
  optimize: boolean;
};

export type FromWorker =
  | { type: 'progress'; id: number; fraction: number }
  | { type: 'result'; id: number; result: ImportResult }
  | { type: 'unsupported'; id: number }
  | { type: 'error'; id: number; message: string };

export interface HandlerOptions {
  /** Có `DOMParser` hay không; mặc định theo môi trường. */
  hasDom?: boolean;
  /** Bộ sinh UID (test dùng bản tất định). */
  uid?: () => string;
  importer?: typeof importSvg;
}

/** Bộ xử lý tin của worker; tách ra để test chạy trong tiến trình. */
export function createHandler(
  post: (m: FromWorker) => void,
  opts: HandlerOptions = {},
): (m: ToWorker) => void {
  return (m) => {
    if (m.type !== 'import') return;
    const hasDom = opts.hasDom ?? typeof DOMParser !== 'undefined';
    if (!hasDom) {
      post({ type: 'unsupported', id: m.id });
      return;
    }
    post({ type: 'progress', id: m.id, fraction: 0.1 });
    try {
      const run = opts.importer ?? importSvg;
      const result = run(m.bytes, {
        fileName: m.fileName,
        optimize: m.optimize,
        ...(opts.uid ? { uid: opts.uid } : {}),
      });
      post({ type: 'result', id: m.id, result });
    } catch (e) {
      post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) });
    }
  };
}

declare const WorkerGlobalScope: (abstract new () => unknown) | undefined;
declare const self: {
  onmessage: ((e: { data: ToWorker }) => void) | null;
  postMessage(m: FromWorker): void;
};

// Trong worker thật: nối tin tới bộ xử lý. Trong test (import thường) thì không làm gì.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const handle = createHandler((m) => self.postMessage(m));
  self.onmessage = (e) => handle(e.data);
}
