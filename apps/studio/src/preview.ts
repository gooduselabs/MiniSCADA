// Xem trước màn hình với dữ liệu sống từ thiết bị (FR-035): CÙNG package với runtime web
// (svg-renderer, binding-engine, live-client); SVG/binding lấy từ project trên máy Windows.
import { DomApplier } from '@mat/binding-engine';
import { LiveConnection, type ConnState } from '@mat/live-client';
import type { LoadedScreen, TagDataType } from '@mat/project-schema';
import { mountScreen, type MountedScreen } from '@mat/svg-renderer';
import { liveUrl } from './device.ts';

export class Preview {
  private mounted: MountedScreen | null = null;
  private applier: DomApplier | null = null;
  private conn: LiveConnection | null = null;
  onState: ((state: ConnState, conn: LiveConnection) => void) | null = null;

  start(
    host: HTMLElement,
    svgText: string,
    screen: LoadedScreen,
    deviceBase: string,
    tagTypes: Record<string, TagDataType> = {},
  ): string[] {
    this.stop();
    this.mounted = mountScreen(host, svgText, screen.screen);
    this.applier = new DomApplier({
      elements: this.mounted.elements,
      bindings: screen.bindings.elements,
      tagTypes,
    });
    const conn = new LiveConnection({ url: liveUrl(deviceBase), tags: this.applier.tagIds() });
    conn.onChange = (c) => this.applier?.update(c);
    conn.onState = (s, c) => this.onState?.(s, c);
    this.conn = conn;
    conn.start();
    return [...new Set([...this.mounted.missingUids, ...this.applier.missing])];
  }

  retryNow(): void {
    this.conn?.retryNow();
  }

  /** Dừng xem trước: đóng WebSocket (trả slot cho thiết bị), hủy animation. */
  stop(): void {
    this.conn?.stop();
    this.applier?.dispose();
    this.mounted?.unmount();
    this.conn = null;
    this.applier = null;
    this.mounted = null;
  }

  get running(): boolean {
    return this.conn !== null;
  }
}
