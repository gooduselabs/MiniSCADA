// @vitest-environment jsdom
// Kiểm project trong Web Worker (feature 006, T089; ADR-016 điểm 3, research R21): gõ không bị trễ với 2.000 Tag và
// 500 biểu thức. Kết quả cũ bị bỏ theo số thế hệ; worker lỗi thì báo và Studio tiếp tục kiểm ngay trong tiến trình
// (không treo giao diện).
import { MemorySource, validateProject, type ProjectSource } from '@mat/project-schema';
import { describe, expect, it, vi } from 'vitest';
import { createHandler, type FromWorker, type ToWorker } from '../workers/validate.worker.ts';
import { ValidateClient, type WorkerLike } from './validate-client.ts';
import { tankDemo } from './test-fixtures.ts';

/** Worker giả chạy cùng bộ xử lý của worker thật, nhưng trong tiến trình (bất đồng bộ như postMessage). */
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  posted: ToWorker[] = [];
  terminated = false;
  /** Giữ các tin tới worker (kiểm thứ tự, kết quả về muộn). */
  hold = false;
  private queue: ToWorker[] = [];
  private readonly handle = createHandler((m) =>
    queueMicrotask(() => this.onmessage?.({ data: m })),
  );

  postMessage(m: ToWorker): void {
    this.posted.push(m);
    if (this.hold) this.queue.push(m);
    else queueMicrotask(() => this.handle(m));
  }

  release(): void {
    this.hold = false;
    for (const m of this.queue.splice(0)) queueMicrotask(() => this.handle(m));
  }

  terminate(): void {
    this.terminated = true;
  }
}

const sourceOf = (files: Record<string, string>): ProjectSource => new MemorySource(files);

describe('ValidateClient', () => {
  it('kiểm qua worker: worker đọc file qua main (read/file), trả cùng kết luận với bộ kiểm tra chạy thẳng', async () => {
    const files = tankDemo();
    const worker = new FakeWorker();
    const client = new ValidateClient({ createWorker: () => worker });
    const got = await client.validate(sourceOf(files));
    const direct = await validateProject(sourceOf(files), { checkSvg: false });
    expect(got.valid).toBe(direct.valid);
    expect(got.errors).toEqual(direct.errors);
    expect(worker.posted[0]).toMatchObject({ type: 'validate' });
    expect(worker.posted.some((m) => m.type === 'file')).toBe(true);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('cảnh báo SVG (W_UID_NOT_IN_SVG, cần DOMParser) vẫn có vì main chạy phần kiểm SVG sau worker', async () => {
    const files = tankDemo();
    files['screens/tank-motor.svg'] = files['screens/tank-motor.svg'].replace(
      /data-mat-uid="[^"]+"/,
      'data-mat-uid="x_khong_co"',
    );
    const client = new ValidateClient({ createWorker: () => new FakeWorker() });
    const got = await client.validate(sourceOf(files));
    expect(got.warnings.map((w) => w.code)).toContain('W_UID_NOT_IN_SVG');
  });

  it('yêu cầu mới trong lúc đang chạy thay thế yêu cầu đang chờ: chỉ kết quả của yêu cầu cuối được tính', async () => {
    const worker = new FakeWorker();
    worker.hold = true;
    const client = new ValidateClient({ createWorker: () => worker });
    const files = tankDemo();
    const first = client.validate(sourceOf(files));
    const second = client.validate(sourceOf(files));
    const third = client.validate(sourceOf(files));
    expect(await second).toMatchObject({ superseded: true });
    worker.release();
    expect(await first).not.toHaveProperty('superseded');
    expect(await third).not.toHaveProperty('superseded');
    expect(worker.posted.filter((m) => m.type === 'validate')).toHaveLength(2);
  });

  it('kết quả của thế hệ cũ về muộn bị bỏ (không đè kết quả mới)', async () => {
    const worker = new FakeWorker();
    const client = new ValidateClient({ createWorker: () => worker });
    const files = tankDemo();
    const p = client.validate(sourceOf(files));
    // Tin "result" của một id lạ không làm gì.
    worker.onmessage?.({
      data: { type: 'result', id: 999, result: { valid: false, errors: [], warnings: [] } },
    });
    const got = await p;
    expect(got.valid).toBe(true);
  });

  it('worker lỗi: báo một lần, yêu cầu đang chờ bị từ chối, các lần sau kiểm ngay trong tiến trình', async () => {
    const worker = new FakeWorker();
    worker.hold = true;
    const onFailure = vi.fn();
    const client = new ValidateClient({ createWorker: () => worker, onFailure });
    const files = tankDemo();
    const pending = client.validate(sourceOf(files));
    worker.onerror?.({ message: 'boom' });
    await expect(pending).rejects.toThrow(/worker/i);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith('boom');
    // Không treo: lần sau chạy thẳng.
    const next = await client.validate(sourceOf(files));
    expect(next.valid).toBe(true);
    expect(worker.terminated).toBe(true);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('không tạo được worker (môi trường không có Worker): kiểm trong tiến trình', async () => {
    const client = new ValidateClient({
      createWorker: () => {
        throw new Error('no Worker');
      },
    });
    const got = await client.validate(sourceOf(tankDemo()));
    expect(got.valid).toBe(true);
  });

  it('thân tin từ worker sai hình dạng bị bỏ qua, không ném lỗi', async () => {
    const worker = new FakeWorker();
    const client = new ValidateClient({ createWorker: () => worker });
    const p = client.validate(sourceOf(tankDemo()));
    worker.onmessage?.({ data: null as never });
    worker.onmessage?.({ data: { type: 'lạ' } as never });
    expect((await p).valid).toBe(true);
  });
});
