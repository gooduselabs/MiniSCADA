// system/info của runtime 1.0 (feature 011, contracts/device-api-011.md §5; FR-010, T030): Studio đọc
// `warningDetails`, `update`, `logic`; thiết bị cũ không có các khối này thì coi là không hỗ trợ (R32).
import { describe, expect, it } from 'vitest';
import {
  acceptedHostsOf,
  deviceSupport,
  pulseStuckTags,
  warningChips,
  warningList,
} from './device.ts';

describe('deviceSupport', () => {
  it('thiết bị 0.x (không có update, logic): không hỗ trợ OTA và logic', () => {
    expect(deviceSupport({ runtimeVersion: '0.9.0', warnings: ['VIEWER_PUBLIC'] })).toEqual({
      update: false,
      updateEnabled: false,
      logic: false,
      logicWrites: 'off',
    });
    expect(deviceSupport(null)).toEqual({
      update: false,
      updateEnabled: false,
      logic: false,
      logicWrites: 'off',
    });
  });
  it('runtime 1.0: theo hai khối của system/info', () => {
    expect(
      deviceSupport({
        runtimeVersion: '1.0.0',
        update: { enabled: true, supported: true },
        logic: { present: true, writes: 'stopped' },
      }),
    ).toEqual({ update: true, updateEnabled: true, logic: true, logicWrites: 'stopped' });
  });
  it('giá trị lạ không làm lỗi và không bật chức năng', () => {
    expect(
      deviceSupport({
        update: { enabled: 'yes', supported: 1 },
        logic: { present: true, writes: 'x' },
      }),
    ).toEqual({ update: false, updateEnabled: false, logic: true, logicWrites: 'off' });
  });
});

describe('warningList', () => {
  it('ghép mã với warningDetails; mã lạ vẫn đọc được', () => {
    const list = warningList({
      warnings: ['VIEWER_PUBLIC', 'W_FUTURE_CODE'],
      warningDetails: [
        {
          code: 'VIEWER_PUBLIC',
          message: 'Trang mở cho mọi địa chỉ.',
          since: 1792000000000,
          detail: null,
        },
        { code: 'W_FUTURE_CODE', message: 'Cảnh báo mới.', since: 1792000001000, detail: { a: 1 } },
      ],
    });
    expect(list).toEqual([
      {
        code: 'VIEWER_PUBLIC',
        message: 'Trang mở cho mọi địa chỉ.',
        since: 1792000000000,
        detail: null,
      },
      { code: 'W_FUTURE_CODE', message: 'Cảnh báo mới.', since: 1792000001000, detail: { a: 1 } },
    ]);
  });
  it('thiết bị 0.x chỉ có mã: thông điệp rỗng, since null', () => {
    expect(warningList({ warnings: ['HTTPS_DOWN', 42] })).toEqual([
      { code: 'HTTPS_DOWN', message: '', since: null, detail: null },
    ]);
  });
  it('warningDetails hỏng thì bỏ qua phần chi tiết', () => {
    expect(warningList({ warnings: ['A_B'], warningDetails: 'x' })).toEqual([
      { code: 'A_B', message: '', since: null, detail: null },
    ]);
  });
});

// T052 (FR-036, FR-013): chip cho cảnh báo mới của 011, danh sách Host thiết bị nhận, Tag có xung kẹt.
describe('warningChips, acceptedHostsOf, pulseStuckTags', () => {
  const info = {
    warnings: [
      'VIEWER_PUBLIC',
      'HOST_CHECK_OFF',
      'SSH_ROOT_PASSWORD',
      'PULSE_STUCK',
      'TIME_NOT_SYNCED',
      'LOGIC_WRITES_STOPPED',
      'LOGIC_FUTURE',
      'UPDATE_ROLLED_BACK',
      'W_OTHER',
    ],
    warningDetails: [
      {
        code: 'PULSE_STUCK',
        message: 'Xung kẹt',
        since: 1,
        detail: { tags: ['P1.CMD', 7, 'P2.CMD'] },
      },
    ],
  };
  it('chỉ mã của 011 (HOST_CHECK_OFF, SSH_ROOT_PASSWORD, PULSE_STUCK, TIME_NOT_SYNCED, LOGIC_*, UPDATE_*), theo thứ tự', () => {
    const chips = warningChips(info);
    expect(chips.map((c) => c.code)).toEqual([
      'HOST_CHECK_OFF',
      'SSH_ROOT_PASSWORD',
      'PULSE_STUCK',
      'TIME_NOT_SYNCED',
      'LOGIC_WRITES_STOPPED',
      'LOGIC_FUTURE',
      'UPDATE_ROLLED_BACK',
    ]);
    expect(chips.map((c) => c.key)).toEqual([
      'HOST_CHECK_OFF',
      'SSH_ROOT_PASSWORD',
      'PULSE_STUCK',
      'TIME_NOT_SYNCED',
      'LOGIC_WRITES_STOPPED',
      'LOGIC',
      'UPDATE_ROLLED_BACK',
    ]);
    expect(chips.find((c) => c.code === 'PULSE_STUCK')!.tone).toBe('err');
    expect(chips.find((c) => c.code === 'HOST_CHECK_OFF')!.tone).toBe('warn');
    expect(chips.find((c) => c.code === 'PULSE_STUCK')!.message).toBe('Xung kẹt');
    expect(warningChips(null)).toEqual([]);
  });
  it('pulseStuckTags: Tag của PULSE_STUCK (chuỗi), rỗng khi không có', () => {
    expect(pulseStuckTags(info)).toEqual(['P1.CMD', 'P2.CMD']);
    expect(pulseStuckTags({ warnings: ['PULSE_STUCK'] })).toEqual([]);
    expect(pulseStuckTags(null)).toEqual([]);
  });
  it('acceptedHostsOf: names, ips là mảng chuỗi; runtime cũ thì null', () => {
    expect(
      acceptedHostsOf({ acceptedHosts: { names: ['localhost', 'bl335', 1], ips: ['*'] } }),
    ).toEqual({ names: ['localhost', 'bl335'], ips: ['*'] });
    expect(acceptedHostsOf({ deviceId: 'x' })).toBeNull();
    expect(acceptedHostsOf(null)).toBeNull();
    expect(acceptedHostsOf({ acceptedHosts: 'x' })).toBeNull();
  });
});
