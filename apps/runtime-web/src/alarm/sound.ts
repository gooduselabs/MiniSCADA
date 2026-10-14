// Âm thanh alarm bằng Web Audio (feature 009, FR-059; contracts/ui-alarm.md §9). Do TRANG lo, không phải widget.
//  - Không tải tệp âm thanh, không tài nguyên ngoài; một AudioContext, một OscillatorNode + một GainNode, biên độ đỉnh 0,25,
//    mọi lần bật/tắt có bao biên độ tuyến tính (không lách tách). Kiểu âm lấy từ `SOUND_PATTERNS` (dùng chung với Studio).
//  - Mặc định TẮT (D23, D38). Chrome chỉ cho tạo/resume AudioContext trong một thao tác người dùng: `toggle()` và `unlock()`
//    phải được gọi từ trình xử lý sự kiện của người dùng; chưa được thì `state` = `suspended` và có chỉ báo (không lỗi console).
//  - Chọn MỘT kiểu: lớp của alarm ACTIVE_UNACK không shelved có mức ưu tiên cao nhất (có `sound` ≠ none); cùng mức thì kiểu mạnh hơn.
//  - "Tắt tiếng": dừng tiếng các alarm hiện có, KHÔNG xác nhận; alarm mới (lần xảy ra mới) bật tiếng lại. Không lưu qua tải lại.
//  - Tùy chọn lưu `localStorage` khóa `mat.alarm.sound` (on/off) bọc try/catch.
import {
  PRIORITY_RANK,
  SOUND_PATTERNS,
  type AlarmInstance,
  type AlarmSnapshot,
  type AlarmSoundKind,
  type AlarmSourceStatus,
  type SoundPattern,
} from '@mat/ui-components';

export const SOUND_STORAGE_KEY = 'mat.alarm.sound';

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
export interface OscillatorLike {
  type: string;
  frequency: AudioParamLike;
  connect(node: unknown): unknown;
  disconnect(): unknown;
  start(time: number): unknown;
  stop(time: number): unknown;
}
export interface GainLike {
  gain: AudioParamLike;
  connect(node: unknown): unknown;
  disconnect(): unknown;
}
export interface AudioContextLike {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
  close(): Promise<void>;
}

export interface AlarmSoundOptions {
  createContext?: () => AudioContextLike;
  storage?: () => Storage | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export type SoundState = 'off' | 'on' | 'suspended';

const LOOKAHEAD_S = 2.5;
const PUMP_MS = 500;

const keyOf = (i: AlarmInstance): string => `${i.id}#${i.occurrence}`;

export class AlarmSound {
  readonly #createContext: () => AudioContextLike;
  readonly #storage: () => Storage | null;
  readonly #set: (fn: () => void, ms: number) => unknown;
  readonly #clear: (h: unknown) => void;
  readonly #listeners = new Set<() => void>();
  #pref: boolean;
  #ctx: AudioContextLike | null = null;
  #snap: AlarmSnapshot | null = null;
  #status: AlarmSourceStatus = 'offline';
  #muted = new Set<string>();
  #mutedFlag = false;
  #candidates: AlarmInstance[] = [];
  #kind: AlarmSoundKind = 'none';
  #osc: OscillatorLike | null = null;
  #gain: GainLike | null = null;
  #next = 0;
  #pump: unknown = null;
  #first = true;

  constructor(o: AlarmSoundOptions = {}) {
    this.#createContext =
      o.createContext ??
      (() => {
        const g = globalThis as unknown as {
          AudioContext?: new () => AudioContextLike;
          webkitAudioContext?: new () => AudioContextLike;
        };
        const C = g.AudioContext ?? g.webkitAudioContext;
        if (!C) throw new Error('no Web Audio');
        return new C();
      });
    this.#storage =
      o.storage ??
      (() => {
        try {
          return globalThis.localStorage;
        } catch {
          return null;
        }
      });
    this.#set = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clear = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.#pref = this.#read();
  }

  #read(): boolean {
    try {
      return this.#storage()?.getItem(SOUND_STORAGE_KEY) === 'on';
    } catch {
      return false;
    }
  }

  #write(on: boolean): void {
    try {
      this.#storage()?.setItem(SOUND_STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* cửa sổ riêng tư: giữ trong bộ nhớ */
    }
  }

  /** `off`: tắt (mặc định); `on`: đang bật và AudioContext chạy; `suspended`: đã bật nhưng trình duyệt chưa cho phát. */
  get state(): SoundState {
    if (!this.#pref) return 'off';
    return this.#ctx && this.#ctx.state === 'running' ? 'on' : 'suspended';
  }

  /** Kiểu đang phát (`none` khi im). */
  get playing(): AlarmSoundKind {
    return this.#osc ? this.#kind : 'none';
  }

  /** Các alarm có tiếng đang bị "Tắt tiếng" (không còn alarm nào nghe được). */
  get muted(): boolean {
    return this.#mutedFlag;
  }

  /** Có alarm cần tiếng mà âm thanh chưa bật được: hiện chỉ báo "Âm thanh đang tắt, bấm để bật". */
  hintVisible(): boolean {
    return this.#candidates.length > 0 && this.state !== 'on';
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #emit(): void {
    for (const fn of [...this.#listeners]) fn();
  }

  async #ensureContext(): Promise<void> {
    try {
      if (!this.#ctx || this.#ctx.state === 'closed') this.#ctx = this.#createContext();
      if (this.#ctx.state !== 'running') await this.#ctx.resume();
    } catch {
      /* chưa phát được: state vẫn suspended và có chỉ báo */
    }
  }

  /** Công tắc "Âm thanh": gọi trong trình xử lý nhấp của người dùng. */
  async toggle(): Promise<void> {
    if (this.#pref) {
      this.#pref = false;
      this.#write(false);
      this.#stop();
    } else {
      this.#pref = true;
      this.#write(true);
      await this.#ensureContext();
    }
    this.#evaluate();
    this.#emit();
  }

  /** Mọi thao tác người dùng khi đã lưu "bật" mà context chưa chạy: thử khôi phục (được phép vì có thao tác). */
  async unlock(): Promise<void> {
    if (!this.#pref || this.state === 'on') return;
    await this.#ensureContext();
    this.#evaluate();
    this.#emit();
  }

  /** "Tắt tiếng": dừng tiếng của các alarm hiện có, KHÔNG xác nhận; alarm mới bật tiếng lại. */
  mute(): void {
    for (const i of this.#candidates) this.#muted.add(keyOf(i));
    this.#evaluate();
    this.#emit();
  }

  /** Cập nhật theo nguồn alarm (gọi mỗi lần nguồn đổi). */
  update(snap: AlarmSnapshot, status: AlarmSourceStatus): void {
    this.#snap = snap;
    this.#status = status;
    this.#evaluate();
    this.#emit();
  }

  dispose(): void {
    this.#stop();
    void this.#ctx?.close().catch(() => undefined);
    this.#ctx = null;
  }

  // ---- chọn kiểu ---------------------------------------------------------------------------------------------------

  #evaluate(): void {
    const snap = this.#snap;
    const live = this.#status === 'live' && snap !== null;
    const classes = new Map(snap?.classes.map((c) => [c.id, c]) ?? []);
    const cands: AlarmInstance[] = [];
    if (live)
      for (const i of snap.instances) {
        if (i.state !== 'ACTIVE_UNACK' || i.shelved) continue;
        const k = classes.get(i.class)?.sound ?? 'none';
        if (k !== 'none') cands.push(i);
      }
    this.#candidates = cands;
    if (live) {
      // Dọn khóa tắt tiếng của alarm không còn.
      const alive = new Set(cands.map(keyOf));
      for (const k of this.#muted) if (!alive.has(k)) this.#muted.delete(k);
    }
    const audible = cands.filter((i) => !this.#muted.has(keyOf(i)));
    this.#mutedFlag = audible.length === 0 && cands.length > 0;
    if (this.state !== 'on' || audible.length === 0) {
      this.#stop();
      return;
    }
    let best = -1;
    let kind: AlarmSoundKind = 'none';
    let strength = 0;
    for (const i of audible) {
      const k = classes.get(i.class)!.sound;
      const p = SOUND_PATTERNS[k];
      if (!p) continue;
      const rank = PRIORITY_RANK[i.priority];
      if (rank > best || (rank === best && p.strength > strength)) {
        best = rank;
        kind = k;
        strength = p.strength;
      }
    }
    if (kind === this.#kind && this.#osc) return;
    this.#stop();
    this.#start(kind);
  }

  // ---- phát --------------------------------------------------------------------------------------------------------

  #start(kind: AlarmSoundKind): void {
    const p = SOUND_PATTERNS[kind];
    const ctx = this.#ctx;
    if (!p || !ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = p.wave;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    gain.gain.setValueAtTime(0, t0);
    osc.start(t0);
    this.#osc = osc;
    this.#gain = gain;
    this.#kind = kind;
    this.#next = t0;
    this.#first = true;
    this.#run(p);
  }

  #run(p: SoundPattern): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#osc || !this.#gain) return;
    while (this.#next < ctx.currentTime + LOOKAHEAD_S) {
      this.#cycle(p, this.#next, this.#first);
      this.#first = false;
      this.#next += p.cycleMs / 1000;
    }
    this.#pump = this.#set(() => this.#run(p), PUMP_MS);
  }

  /** Lên lịch một chu kỳ bằng thời gian của AudioContext (không đếm giờ thô). */
  #cycle(p: SoundPattern, t: number, first: boolean): void {
    const f = this.#osc!.frequency;
    const g = this.#gain!.gain;
    for (const s of p.segments) {
      const start = t + s.startMs / 1000;
      const end = start + s.durMs / 1000;
      f.setValueAtTime(s.fromHz, start);
      if (s.toHz !== s.fromHz) f.linearRampToValueAtTime(s.toHz, end);
      // Chu kỳ liên tục (còi hú) chỉ tăng dần ở lần đầu; các chu kỳ sau giữ nguyên biên độ.
      const attack = p.continuous && !first ? 0 : s.attackMs;
      if (attack > 0) {
        g.setValueAtTime(0, start);
        g.linearRampToValueAtTime(p.peak, start + attack / 1000);
      } else g.setValueAtTime(p.peak, start);
      g.setValueAtTime(p.peak, start + (attack + s.holdMs) / 1000);
      if (s.releaseMs > 0)
        g.linearRampToValueAtTime(0, start + (attack + s.holdMs + s.releaseMs) / 1000);
    }
  }

  #stop(): void {
    if (this.#pump !== null) this.#clear(this.#pump);
    this.#pump = null;
    const osc = this.#osc;
    const gain = this.#gain;
    const ctx = this.#ctx;
    this.#osc = null;
    this.#gain = null;
    this.#kind = 'none';
    if (!osc || !gain || !ctx) return;
    const rel = (SOUND_PATTERNS.siren?.stopReleaseMs ?? 60) / 1000;
    const now = ctx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      osc.frequency.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + rel);
      osc.stop(now + rel + 0.01);
    } catch {
      /* đã dừng */
    }
    this.#set(
      () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* đã ngắt */
        }
      },
      rel * 1000 + 50,
    );
  }
}
