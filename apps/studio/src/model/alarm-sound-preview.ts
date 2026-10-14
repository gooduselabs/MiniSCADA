// Nghe thử âm thanh của lớp alarm (feature 009, T078, FR-076; contract studio-alarm-editor §4): phát đúng kiểu theo
// `SOUND_PATTERNS` dùng chung với trang vận hành (@mat/ui-components, phụ thuộc một chiều từ Studio sang gói) bằng một
// AudioContext tạo trong thao tác bấm (chính sách tự phát của trình duyệt). Lặp theo chu kỳ tới khi Dừng; mọi lần dừng có
// bao biên độ ngắn (không lách tách). Không tải tệp âm thanh.
import { SOUND_PATTERNS, type AlarmSoundKind, type SoundPattern } from '@mat/ui-components';

interface ParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}
interface OscLike {
  type: string;
  frequency: ParamLike;
  connect(n: unknown): unknown;
  disconnect(): unknown;
  start(t: number): unknown;
  stop(t: number): unknown;
}
interface GainLike {
  gain: ParamLike;
  connect(n: unknown): unknown;
  disconnect(): unknown;
}
export interface PreviewAudioContext {
  currentTime: number;
  state: string;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscLike;
  createGain(): GainLike;
  close(): Promise<void>;
}

export interface SoundPreviewOptions {
  createContext?: () => PreviewAudioContext;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export interface SoundPreview {
  stop(): void;
  readonly playing: boolean;
}

const defaultContext = (): PreviewAudioContext => {
  const g = globalThis as unknown as {
    AudioContext?: new () => PreviewAudioContext;
    webkitAudioContext?: new () => PreviewAudioContext;
  };
  const C = g.AudioContext ?? g.webkitAudioContext;
  if (!C) throw new Error('no Web Audio');
  return new C();
};

/** Lên lịch một chu kỳ của kiểu âm thanh bắt đầu tại `at` (giây của AudioContext). */
function scheduleCycle(osc: OscLike, gain: GainLike, p: SoundPattern, at: number): void {
  for (const s of p.segments) {
    const t0 = at + s.startMs / 1000;
    const t1 = t0 + s.durMs / 1000;
    osc.frequency.setValueAtTime(s.fromHz, t0);
    osc.frequency.linearRampToValueAtTime(s.toHz, t1);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(p.peak, t0 + s.attackMs / 1000);
    gain.gain.setValueAtTime(p.peak, t0 + (s.attackMs + s.holdMs) / 1000);
    gain.gain.linearRampToValueAtTime(0, t1);
  }
}

/**
 * Phát kiểu âm thanh `kind` lặp theo chu kỳ cho tới khi `stop()`. `none` hoặc không có Web Audio: trả `null` (không phát).
 * Phải gọi từ trình xử lý sự kiện của người dùng.
 */
export function playSoundPreview(
  kind: AlarmSoundKind,
  opts: SoundPreviewOptions = {},
): SoundPreview | null {
  const pattern = SOUND_PATTERNS[kind];
  if (!pattern) return null;
  let ctx: PreviewAudioContext;
  try {
    ctx = (opts.createContext ?? defaultContext)();
  } catch {
    return null;
  }
  void ctx.resume().catch(() => undefined);
  const set = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = pattern.wave;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  let next = ctx.currentTime + 0.02;
  let timer: unknown = null;
  let playing = true;
  const pump = (): void => {
    if (!playing) return;
    // Lên lịch trước hai chu kỳ để không ngắt quãng khi bộ đếm giờ trễ.
    while (next < ctx.currentTime + (pattern.cycleMs * 2) / 1000) {
      scheduleCycle(osc, gain, pattern, next);
      next += pattern.cycleMs / 1000;
    }
    timer = set(pump, pattern.cycleMs / 2);
  };
  pump();
  return {
    get playing() {
      return playing;
    },
    stop() {
      if (!playing) return;
      playing = false;
      if (timer !== null) clear(timer);
      const now = ctx.currentTime;
      const end = now + pattern.stopReleaseMs / 1000;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, end);
      osc.stop(end + 0.02);
      set(() => {
        osc.disconnect();
        gain.disconnect();
        void ctx.close().catch(() => undefined);
      }, pattern.stopReleaseMs + 60);
    },
  };
}
