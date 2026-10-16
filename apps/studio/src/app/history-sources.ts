// Nguồn lịch sử của Studio (feature 010, US8): một nguồn mô phỏng và một nguồn thiết bị cho MỖI StudioApp, dùng chung cho khung Xem
// trước báo cáo (editor Mẫu báo cáo) và xem trước màn hình có widget lịch sử. Mô phỏng sinh từ logging.json và danh sách Tag của
// project (tất định, có khoảng thiếu giả); thiết bị đi qua `DeviceLink.get` với hàng đợi chung (token Bearer do lớp Rust giữ).
import { SimHistorySource } from '@mat/tag-sim';
import type { HistorySource } from '@mat/ui-components';
import { simHistoryGroups } from '../model/sim-history-groups.ts';
import { DeviceHistorySource } from '../platform/device-history.ts';
import type { StudioApp } from './app.ts';

const sims = new WeakMap<StudioApp, { key: unknown[]; src: SimHistorySource }>();
const devices = new WeakMap<StudioApp, DeviceHistorySource>();

/** Nguồn mô phỏng theo cấu hình lưu trữ và Tag hiện tại (dựng lại khi hai thứ đó đổi). */
export function simHistoryFor(app: StudioApp): SimHistorySource {
  const o = app.store.state.outline;
  const key = [o.logging, o.tags];
  const cur = sims.get(app);
  if (cur && cur.key.every((k, i) => k === key[i])) return cur.src;
  const src = new SimHistorySource({
    groups: simHistoryGroups(o.logging, o.tags),
    now: () => Date.now(),
  });
  sims.set(app, { key, src });
  return src;
}

/** Nguồn thiết bị: chỉ có dữ liệu khi đang theo dõi (monitoring) với lớp thiết bị; không thì báo chưa Online. */
export function deviceHistoryFor(app: StudioApp): DeviceHistorySource {
  let s = devices.get(app);
  if (!s) {
    s = new DeviceHistorySource({
      link: {
        get: (id, path, query) =>
          app.link ? app.link.get(id, path, query) : Promise.resolve({ error: 'no-such-device' }),
      },
      deviceId: () =>
        app.link && app.session.state === 'monitoring' ? app.session.deviceId : null,
      requestLogin: () => void app.run('online.login'),
    });
    devices.set(app, s);
  }
  return s;
}

/** Nguồn cho chế độ xem trước màn hình: `off` không có (widget hiện khung xem trước). */
export function historyFor(
  app: StudioApp,
  mode: 'off' | 'sim' | 'device',
): HistorySource | undefined {
  return mode === 'sim'
    ? simHistoryFor(app)
    : mode === 'device'
      ? deviceHistoryFor(app)
      : undefined;
}
