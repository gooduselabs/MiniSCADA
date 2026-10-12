// Web Worker kiểm project (feature 006, T090; ADR-016 điểm 3, research R21): chạy `validateProject` ngoài luồng giao
// diện để gõ không bị trễ với 2.000 Tag và 500 biểu thức. Worker không tự đọc file: mỗi lần bộ kiểm tra cần một file,
// worker hỏi luồng chính (`read` → `file`), nên nội dung là nội dung đang sửa của Studio. Không có DOMParser trong
// worker: kiểm SVG (W_UID_NOT_IN_SVG) do luồng chính làm sau (validate-client.ts).
import {
  validateProject,
  type ProjectSource,
  type ReadResult,
  type ValidationResult,
} from '@mat/project-schema';

export type ToWorker =
  | { type: 'validate'; id: number }
  | { type: 'file'; id: number; req: number; result: ReadResult };

export type FromWorker =
  | { type: 'read'; id: number; req: number; rel: string }
  | { type: 'result'; id: number; result: ValidationResult }
  | { type: 'error'; id: number; message: string };

/** Bộ xử lý tin của worker; tách ra để test chạy trong tiến trình. */
export function createHandler(post: (m: FromWorker) => void): (m: ToWorker) => void {
  const pending = new Map<string, (r: ReadResult) => void>();
  let seq = 0;
  return (m) => {
    if (m.type === 'file') {
      const key = `${m.id}:${m.req}`;
      pending.get(key)?.(m.result);
      pending.delete(key);
      return;
    }
    if (m.type !== 'validate') return;
    const source: ProjectSource = {
      read: (rel) =>
        new Promise<ReadResult>((resolve) => {
          const req = ++seq;
          pending.set(`${m.id}:${req}`, resolve);
          post({ type: 'read', id: m.id, req, rel });
        }),
    };
    validateProject(source, { checkSvg: false }).then(
      (result) => post({ type: 'result', id: m.id, result }),
      (e: unknown) => post({ type: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) }),
    );
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
