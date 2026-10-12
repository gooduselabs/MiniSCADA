// Máy khách của worker kiểm project (feature 006, T090; ADR-016 điểm 3): đưa việc kiểm ra ngoài luồng giao diện.
// - Mỗi yêu cầu có số thế hệ (`id`); yêu cầu mới trong lúc đang chạy thay thế yêu cầu đang chờ (yêu cầu bị thay
//   được trả `superseded`); tin của thế hệ lạ bị bỏ.
// - Worker lỗi: báo một lần (`onFailure`), từ chối yêu cầu đang chờ, các lần sau kiểm ngay trong tiến trình
//   (không treo giao diện). Không có Worker (test, môi trường hạn chế): kiểm trong tiến trình.
// - Kiểm SVG (W_UID_NOT_IN_SVG) cần DOMParser nên luồng chính làm sau khi worker trả kết quả.
import {
  validateProject,
  type Issue,
  type ProjectSource,
  type ReadResult,
  type ValidationResult,
} from '@mat/project-schema';
import type { FromWorker, ToWorker } from '../workers/validate.worker.ts';
import { t } from '../i18n/index.ts';

export type { FromWorker, ToWorker };

/** Phần của Worker mà máy khách dùng (test thay bằng bản giả). */
export interface WorkerLike {
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  postMessage(m: ToWorker): void;
  terminate(): void;
}

export type ValidateOutcome = ValidationResult & { superseded?: true };

export interface ValidateClientDeps {
  /** Tạo worker; ném lỗi hoặc không có thì kiểm trong tiến trình. */
  createWorker?: () => WorkerLike;
  /** Worker lỗi (chỉ báo một lần). */
  onFailure?: (message: string) => void;
}

interface Job {
  source: ProjectSource;
  resolve: (r: ValidateOutcome) => void;
  reject: (e: Error) => void;
}

const SUPERSEDED: ValidateOutcome = { valid: false, errors: [], warnings: [], superseded: true };

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (r: ReadResult): string | null => ('text' in r ? r.text : null);

/** W_UID_NOT_IN_SVG của từng màn hình (cùng điều kiện với bộ kiểm tra trong tiến trình). */
async function svgUidWarnings(source: ProjectSource): Promise<Issue[]> {
  if (typeof DOMParser === 'undefined') return [];
  const out: Issue[] = [];
  const project = parse(text(await source.read('project.json')));
  const ids = isObject(project) && Array.isArray(project.screens) ? project.screens : [];
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    const file = `screens/${id}.screen.json`;
    const screen = parse(text(await source.read(file)));
    if (!isObject(screen) || typeof screen.svgFile !== 'string' || !Array.isArray(screen.elements))
      continue;
    const svg = text(await source.read(screen.svgFile));
    if (svg === null) continue;
    const declared = new Set<string>();
    try {
      new DOMParser()
        .parseFromString(svg, 'image/svg+xml')
        .querySelectorAll('[data-mat-uid]')
        .forEach((el) => declared.add(el.getAttribute('data-mat-uid') ?? ''));
    } catch {
      continue;
    }
    screen.elements.forEach((e: unknown, i: number) => {
      const uid = isObject(e) ? e.elementUid : undefined;
      if (typeof uid === 'string' && !declared.has(uid))
        out.push({
          code: 'W_UID_NOT_IN_SVG',
          file,
          path: `/elements/${i}/elementUid`,
          message: t('validate.uidNotInSvg', { svg: String(screen.svgFile), uid }),
        });
    });
  }
  return out;
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return null;
  }
}

export class ValidateClient {
  private worker: WorkerLike | null = null;
  private failed = false;
  private seq = 0;
  private running: { id: number; job: Job } | null = null;
  private queued: Job | null = null;
  private readonly deps: ValidateClientDeps;

  constructor(deps: ValidateClientDeps = {}) {
    this.deps = deps;
  }

  /** Kiểm một project qua `source`; kết quả `superseded` khi đã có yêu cầu mới hơn. */
  validate(source: ProjectSource): Promise<ValidateOutcome> {
    return new Promise<ValidateOutcome>((resolve, reject) => {
      if (this.queued) this.queued.resolve(SUPERSEDED);
      this.queued = { source, resolve, reject };
      this.pump();
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failed = true;
    this.queued?.resolve(SUPERSEDED);
    this.queued = null;
  }

  private ensureWorker(): WorkerLike | null {
    if (this.failed) return null;
    if (this.worker) return this.worker;
    try {
      const make =
        this.deps.createWorker ??
        (typeof Worker === 'undefined'
          ? null
          : () =>
              new Worker(new URL('../workers/validate.worker.ts', import.meta.url), {
                type: 'module',
              }) as unknown as WorkerLike);
      if (!make) throw new Error('no Worker');
      const w = make();
      w.onmessage = (e) => this.onMessage(e.data);
      w.onerror = (e) => this.fail(e.message ?? 'worker error');
      this.worker = w;
      return w;
    } catch {
      this.failed = true;
      return null;
    }
  }

  private pump(): void {
    if (this.running || !this.queued) return;
    const job = this.queued;
    this.queued = null;
    const worker = this.ensureWorker();
    if (!worker) {
      this.runInline(job);
      return;
    }
    const id = ++this.seq;
    this.running = { id, job };
    worker.postMessage({ type: 'validate', id });
  }

  private runInline(job: Job): void {
    this.running = { id: -1, job };
    validateProject(job.source).then(
      (r) => this.finish(-1, r),
      (e: unknown) => this.finishError(-1, e instanceof Error ? e : new Error(String(e))),
    );
  }

  private onMessage(m: FromWorker): void {
    if (!isObject(m)) return;
    const run = this.running;
    if (!run || m.id !== run.id) return; // thế hệ lạ (cũ) về muộn: bỏ
    if (m.type === 'read') {
      void run.job.source.read(m.rel).then((result) => {
        if (this.running === run)
          this.worker?.postMessage({ type: 'file', id: m.id, req: m.req, result });
      });
    } else if (m.type === 'result') {
      void svgUidWarnings(run.job.source).then(
        (extra) => {
          if (this.running !== run) return;
          const warnings = [...m.result.warnings, ...extra];
          this.finish(m.id, { ...m.result, warnings });
        },
        () => this.finish(m.id, m.result),
      );
    } else if (m.type === 'error') {
      this.finishError(m.id, new Error(m.message));
    }
  }

  private finish(id: number, result: ValidateOutcome): void {
    const run = this.running;
    if (!run || run.id !== id) return;
    this.running = null;
    run.job.resolve(result);
    this.pump();
  }

  private finishError(id: number, error: Error): void {
    const run = this.running;
    if (!run || run.id !== id) return;
    this.running = null;
    run.job.reject(error);
    this.pump();
  }

  /** Worker lỗi: báo, bỏ worker, từ chối yêu cầu đang chạy; các lần sau kiểm trong tiến trình. */
  private fail(message: string): void {
    if (!this.failed || this.worker) {
      this.failed = true;
      this.worker?.terminate();
      this.worker = null;
      this.deps.onFailure?.(message);
    }
    const run = this.running;
    this.running = null;
    run?.job.reject(new Error(`worker: ${message}`));
    this.pump();
  }
}
