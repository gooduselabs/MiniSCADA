// Phiên thiết bị giả cho test thành phần (feature 006): trạng thái, giá trị và Tag lạ đặt tay; phát sự kiện như phiên thật.
// Không vào bản build: chỉ file *.test.ts import.
import {
  DeviceSession,
  type LiveValue,
  type SessionEvent,
  type SessionState,
} from '../model/device-session.ts';
import type { DeviceInfo } from '../model/device.ts';

export class FakeSession extends DeviceSession {
  fakeState: SessionState = 'monitoring';
  readonly fakeValues = new Map<string, LiveValue>();
  readonly fakeUnknown = new Set<string>();
  /** Các lần `setTags` (đăng ký dữ liệu sống), theo thứ tự. */
  readonly tagCalls: string[][] = [];
  private readonly fakeListeners = new Set<(e: SessionEvent) => void>();

  override get state(): SessionState {
    return this.fakeState;
  }

  override get values(): ReadonlyMap<string, LiveValue> {
    return this.fakeValues;
  }

  override get unknown(): ReadonlySet<string> {
    return this.fakeUnknown;
  }

  /** `system/info` giả (null: chưa có); đổi rồi `push({ type: 'info' })`. */
  fakeInfo: DeviceInfo | null = null;
  override get info(): DeviceInfo | null {
    return this.fakeInfo;
  }

  override subscribe(listener: (e: SessionEvent) => void): () => void {
    this.fakeListeners.add(listener);
    return () => void this.fakeListeners.delete(listener);
  }

  override setTags(tags: readonly string[]): void {
    this.tagCalls.push([...tags]);
  }

  push(e: SessionEvent): void {
    for (const l of [...this.fakeListeners]) l(e);
  }
}
