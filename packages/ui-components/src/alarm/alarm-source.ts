// Nguồn alarm (feature 009; contracts/ui-alarm.md §2): kiểu của `AlarmSource` nằm ở host/types.ts; file này xuất lại và
// cấp phần dùng chung cho mọi bản cài: hàm thông báo gộp ở cuối microtask (`AlarmNotifier`) và snapshot rỗng.
import type { AlarmCounts, AlarmSnapshot, AlarmSource, AlarmSourceStatus } from '../host/types.ts';

export type {
  AlarmAckOutcome,
  AlarmAckRequest,
  AlarmAckResultCode,
  AlarmActionError,
  AlarmActionOutcome,
  AlarmAreaInfo,
  AlarmClassInfo,
  AlarmColor,
  AlarmCounts,
  AlarmFilter,
  AlarmInstance,
  AlarmLimitName,
  AlarmPriority,
  AlarmShelf,
  AlarmShelveRequest,
  AlarmSnapshot,
  AlarmSoundKind,
  AlarmSource,
  AlarmSourceStatus,
  AlarmState,
  AlarmType,
} from '../host/types.ts';

export const emptyCounts = (): AlarmCounts => ({
  active: 0,
  unack: 0,
  rtnUnack: 0,
  shelved: 0,
  disabled: 0,
  byPriority: {
    critical: { active: 0, unack: 0 },
    major: { active: 0, unack: 0 },
    minor: { active: 0, unack: 0 },
    advisory: { active: 0, unack: 0 },
  },
});

export const emptySnapshot = (): AlarmSnapshot => ({
  instances: [],
  classes: [],
  areas: [],
  counts: emptyCounts(),
  revision: 0,
});

type Change = readonly string[] | 'all';

/** Người nghe và gộp thay đổi: nhiều lần `notify` trong một lượt chỉ gọi lại một lần ở cuối microtask. */
export class AlarmNotifier {
  readonly #listeners = new Set<(c: Change) => void>();
  #ids = new Set<string>();
  #all = false;
  #queued = false;

  subscribe(fn: (c: Change) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  notify(c: Change): void {
    if (c === 'all') this.#all = true;
    else for (const id of c) this.#ids.add(id);
    if (this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => this.flush());
  }

  /** Gọi ngay phần đang chờ (test, hoặc khi cần đồng bộ). */
  flush(): void {
    this.#queued = false;
    if (!this.#all && this.#ids.size === 0) return;
    const c: Change = this.#all ? 'all' : [...this.#ids];
    this.#all = false;
    this.#ids = new Set();
    for (const l of [...this.#listeners]) {
      try {
        l(c);
      } catch {
        /* người nghe lỗi không làm hỏng nguồn */
      }
    }
  }
}

/** Nguồn không có dữ liệu (nơi chứa chưa cấp): `status` = `none`. */
const EMPTY: AlarmSnapshot = emptySnapshot();
export const NO_ALARM_SOURCE: AlarmSource = {
  snapshot: () => EMPTY,
  subscribe: () => () => undefined,
  counts: () => EMPTY.counts,
  classes: () => [],
  areas: () => [],
  status: (): AlarmSourceStatus => 'none',
  now: () => Date.now(),
};
