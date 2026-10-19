// Khóa liên tiến trình cho test dùng chứng chỉ thử trong Cert:\CurrentUser\My (feature 011, T088): `node --test` chạy các
// tệp test song song mà chúng cùng tạo/gỡ một chứng chỉ thử. Khóa là thư mục tạm (mkdir nguyên tử); khóa treo quá 10 phút
// (tiến trình chết) bị chiếm lại.
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const lock = join(tmpdir(), 'mat-test-cert.lock');
const STALE_MS = 10 * 60 * 1000;

/** Chờ rồi giữ khóa; gọi `releaseCertLock()` khi xong. */
export function acquireCertLock(timeoutMs = 15 * 60 * 1000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lock);
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS)
          rmSync(lock, { recursive: true, force: true });
      } catch {
        /* khóa vừa được nhả */
      }
      if (Date.now() > end) throw new Error('hết thời gian chờ khóa chứng chỉ thử', { cause: e });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
}

export function releaseCertLock() {
  rmSync(lock, { recursive: true, force: true });
}
