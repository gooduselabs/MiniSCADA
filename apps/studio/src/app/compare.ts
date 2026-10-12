// Nối So sánh và Đọc lên vào Studio thật (feature 005, US3, T138): phần project lấy từ store của 004 (nội dung đã
// lưu trên đĩa), phần thiết bị dùng `DeviceLink` theo id của thiết bị đang Online. Giữ bộ tự so (`CompareRunner`,
// kết quả ghi vào `DeviceSession.compare`) và "Đọc lên phần chọn". Không DOM, không chuỗi giao diện.
import {
  packageDigest,
  packageFile,
  projectFiles,
  sha256WebCrypto,
  type LocalSide,
  type ObjectDiff,
  type PackageFile,
} from '@mat/project-schema';
import type { DeviceSession } from '../model/device-session.ts';
import type { DeviceInfo } from '../model/device.ts';
import {
  applyFromDevice,
  CompareRunner,
  type ApplyReport,
  type CompareEnv,
} from '../model/compare-view.ts';
import {
  deviceError,
  isDeviceError,
  type DeviceError,
  type DeviceLink,
} from '../platform/device-types.ts';
import { createDownloadEnv } from './download-env.ts';
import type { StudioStore } from './store.ts';

export interface CompareDeps {
  store: StudioStore;
  link: DeviceLink;
  session: DeviceSession;
  now: () => number;
}

/** Digest của thiết bị theo `system/info` mới nhất, như `CompareEnv.deviceDigest` mô tả. */
export function deviceDigestKey(info: DeviceInfo | null): string | null {
  if (!info) return null;
  const p = info.project;
  if (typeof p?.digest === 'string') return p.digest;
  if (p?.status === 'active') return 'legacy'; // cài theo cách cũ: chưa có digest, so sẽ báo lỗi rõ
  return 'none';
}

/** Tập file của project theo cấu trúc đọc được (kể cả khi project còn lỗi); chỉ file đã có trên đĩa. */
function savedFiles(store: StudioStore): string[] | null {
  const { outline, docs } = store.state;
  if (!outline.project) return null;
  const screens: Record<string, { screen: { bindingFile: string; svgFile: string } }> = {};
  for (const s of outline.screens)
    if (s.screen)
      screens[s.id] = {
        screen: { bindingFile: s.bindingFile ?? s.screen.bindingFile, svgFile: s.screen.svgFile },
      };
  const refs = projectFiles({
    project: {
      tagFile: outline.tagFile,
      screens: outline.screens.map((s) => s.id),
      ...(outline.loggingFile !== null ? { loggingFile: outline.loggingFile } : {}),
    },
    screens,
  });
  return refs.filter((rel) => {
    const doc = docs[rel];
    return doc !== undefined && doc.created !== true;
  });
}

/** Khóa đổi khi nội dung đã lưu của project đổi (mở project, Lưu, nạp lại từ đĩa). */
export function savedKey(store: StudioStore): string {
  const s = store.state;
  if (!s.project) return '';
  return [
    s.project.display,
    ...Object.keys(s.docs)
      .sort()
      .map((rel) => `${rel}=${s.docs[rel].diskHash ?? s.docs[rel].diskText.length}`),
  ].join('|');
}

export function createCompareEnv(d: CompareDeps): CompareEnv {
  const { store, session } = d;
  const device = createDownloadEnv({
    store,
    link: d.link,
    session,
    save: async () => false,
  }).device;
  return {
    loggedIn: () =>
      session.mode === 'online' && session.auth !== null && session.state === 'monitoring',
    role: () => session.auth?.role ?? null,
    deviceDigest: () => deviceDigestKey(session.info),
    localKey: () => savedKey(store),
    async local(): Promise<LocalSide | null> {
      const paths = savedFiles(store);
      if (!paths) return null;
      const docs = store.state.docs;
      const files: PackageFile[] = [];
      for (const rel of paths)
        files.push(await packageFile(rel, docs[rel].diskText, sha256WebCrypto));
      return {
        digest: await packageDigest(files, sha256WebCrypto),
        files,
        source: {
          read: async (rel) => {
            const doc = store.state.docs[rel];
            if (!doc || doc.created) return { error: 'missing' };
            return doc.diskHash
              ? { text: doc.diskText, hash: doc.diskHash }
              : { text: doc.diskText };
          },
        },
      };
    },
    device: {
      info: device.info,
      manifest: device.manifest,
      fetchPackage: device.fetchPackage,
      readPackageFile: device.readPackageFile,
      discardPackage: device.discardPackage,
    },
    publish: (patch) => session.setCompare(patch),
    now: d.now,
  };
}

/** Lỗi khi lấy phần chọn từ thiết bị: lỗi thiết bị, hoặc `changed` (thiết bị vừa đổi project sau lần so). */
export type TakeResult = ApplyReport | DeviceError;

export class CompareController {
  readonly runner: CompareRunner;
  private readonly deps: CompareDeps;
  private readonly env: CompareEnv;

  constructor(deps: CompareDeps) {
    this.deps = deps;
    this.env = createCompareEnv(deps);
    this.runner = new CompareRunner(this.env);
  }

  /** Gọi mỗi khi phiên hoặc project đổi: tự so khi cần. */
  sync(): void {
    this.runner.sync();
  }

  refresh(): Promise<void> {
    return this.runner.refresh();
  }

  /** Digest của nội dung đã lưu trên máy; `null` khi chưa biết tập file. */
  async localDigest(): Promise<string | null> {
    return (await this.env.local())?.digest ?? null;
  }

  /**
   * Đọc lên phần chọn (FR-030): lấy gói đang chạy, áp các đối tượng đã chọn vào project đang mở thành MỘT bước sửa
   * chưa lưu (hoàn tác được), rồi bỏ gói. Thiết bị đã đổi project sau lần so (digest khác) thì từ chối và so lại.
   */
  async take(objects: readonly ObjectDiff[]): Promise<TakeResult> {
    const { link, session, store } = this.deps;
    const id = session.deviceId;
    if (!id) return { error: 'no-such-device' };
    const pkg = await link.fetchPackage(id).catch((e: unknown) => deviceError(e));
    if (isDeviceError(pkg)) return pkg;
    try {
      const expected = session.compare.info?.deviceDigest;
      if (expected !== undefined && expected !== pkg.digest) {
        void this.refresh();
        return { error: 'changed' };
      }
      return await applyFromDevice(
        store,
        { read: (rel) => link.readPackageFile(pkg.packageId, rel) },
        objects,
      );
    } finally {
      void link.discardPackage(pkg.packageId).catch(() => undefined);
    }
  }
}
