// Nối DownloadFlow (model/download-flow.ts) vào Studio thật (feature 005, T124): phần project lấy từ store của 004
// (lưu, kiểm, tập file, nội dung đã lưu), phần thiết bị gọi `DeviceLink` theo id của thiết bị đang Online.
// Không chứa chuỗi giao diện.
import {
  compareSemver,
  projectFiles,
  stripBom,
  type Issue,
  type ProjectSource,
} from '@mat/project-schema';
import type { DeviceInfo } from '../model/device.ts';
import type { DeviceSession } from '../model/device-session.ts';
import type { DownloadDevice, DownloadEnv, DownloadProject } from '../model/download-flow.ts';
import type { StudioStore } from './store.ts';
import {
  deviceError,
  isDeviceError,
  type DeployOperation,
  type DeviceError,
  type DeviceLink,
  type PackageManifest,
} from '../platform/device-types.ts';

export interface DownloadEnvDeps {
  store: StudioStore;
  link: DeviceLink;
  session: DeviceSession;
  /** Lưu mọi file chưa lưu (app hỏi khi xung đột); `true` khi đã lưu hết. */
  save: () => Promise<boolean>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Phần project: store của 004. */
function projectSide(d: DownloadEnvDeps): DownloadProject {
  const { store } = d;
  const source = (): ProjectSource => {
    const docs = store.state.docs;
    return {
      read: async (rel) => {
        const doc = docs[rel];
        return doc
          ? doc.diskHash
            ? { text: doc.diskText, hash: doc.diskHash }
            : { text: doc.diskText }
          : { error: 'missing' };
      },
    };
  };
  return {
    dirty: () => store.dirtyFiles().length > 0,
    save: d.save,
    reload: () => store.validateNow(),
    async check() {
      await store.idle();
      const issues: readonly Issue[] = store.state.issues;
      return {
        errors: issues.filter((i) => i.code.startsWith('E_')),
        warnings: issues.filter((i) => !i.code.startsWith('E_')),
      };
    },
    identity() {
      const text = store.state.docs['project.json']?.diskText;
      if (text === undefined) return null;
      let v: unknown;
      try {
        v = JSON.parse(stripBom(text));
      } catch {
        return null;
      }
      if (!isObject(v)) return null;
      const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : null);
      const [projectId, projectName, projectVersion, minRuntimeVersion] = [
        s('projectId'),
        s('projectName'),
        s('projectVersion'),
        s('minRuntimeVersion'),
      ];
      // Cột Tương thích runtime (feature 009, FR-014): project có alarm cần runtime từ 0.8.0, dù `minRuntimeVersion` ghi thấp hơn.
      const needsAlarm = typeof v.alarmFile === 'string' || typeof v.alarmClassFile === 'string';
      const required =
        minRuntimeVersion && needsAlarm && compareSemver(minRuntimeVersion, ALARM_MIN_RUNTIME) < 0
          ? ALARM_MIN_RUNTIME
          : minRuntimeVersion;
      return projectId && projectName && projectVersion && required
        ? { projectId, projectName, projectVersion, minRuntimeVersion: required }
        : null;
    },
    files() {
      // Project 0.2 giữ kết quả nạp ở `loaded02` (feature 006); 0.1 ở `loaded`.
      const loaded = store.state.loaded ?? store.state.loaded02 ?? store.state.loaded03;
      if (!loaded) return null;
      const out: Array<{ rel: string; hash: string }> = [];
      for (const rel of projectFiles(loaded)) {
        const hash = store.state.docs[rel]?.diskHash;
        if (!hash) return null;
        out.push({ rel, hash });
      }
      return out;
    },
    source,
    screens() {
      if (store.state.outline.schema !== '0.3') return null;
      let popups = 0;
      let controls = 0;
      for (const s of store.state.outline.screens) {
        if (s.model?.kind === 'popup') popups++;
        for (const it of s.model?.items ?? []) {
          if (it.type !== 'widget') continue;
          const a = it.events?.click?.action;
          if (
            it.widget === 'switch' ||
            it.widget === 'setpoint' ||
            it.widget === 'slider' ||
            it.widget === 'select' ||
            (it.widget === 'button' && (a === 'write' || a === 'toggle' || a === 'pulse'))
          )
            controls++;
        }
      }
      // Tổng dung lượng SVG (UTF-8) của mọi tài liệu `.svg` còn trong project.
      let svgBytes = 0;
      for (const rel of Object.keys(store.state.docs)) {
        if (!rel.endsWith('.svg') || store.state.docs[rel]?.removed) continue;
        svgBytes += new TextEncoder().encode(store.textOf(rel)).length;
      }
      return { screens: store.state.outline.screens.length, popups, controls, svgBytes };
    },
  };
}

/** Phần thiết bị: `DeviceLink` theo id của thiết bị đang Online (`session.deviceId`). */
function deviceSide(d: DownloadEnvDeps): DownloadDevice {
  const { link, session } = d;
  const id = (): string | null => session.deviceId;
  const noDevice: DeviceError = { error: 'no-such-device' };
  /** `GET` một đường dẫn, trả thân (JSON object) hoặc lỗi. */
  async function getBody<T>(
    path: string,
    query?: Record<string, string>,
  ): Promise<T | DeviceError> {
    const dev = id();
    if (!dev) return noDevice;
    const r = await link.get(dev, path, query).catch((e: unknown) => deviceError(e));
    return isDeviceError(r) ? r : (r.body as T);
  }
  return {
    async info() {
      const body = await getBody<unknown>('/api/v1/system/info');
      if (isDeviceError(body)) return body;
      return isObject(body) ? (body as DeviceInfo) : { error: 'bad-response' };
    },
    async session() {
      const dev = id();
      if (!dev) return null;
      const s = await link.session(dev).catch(() => null);
      return s ? { user: s.user, role: s.role } : null;
    },
    async freeBytes() {
      const body = await getBody<unknown>('/api/v1/diagnostics');
      if (isDeviceError(body) || !isObject(body) || !isObject(body.disk)) return null;
      const free = body.disk.freeBytes;
      return typeof free === 'number' && Number.isFinite(free) ? free : null;
    },
    ownLiveSessions: () => (session.live === 'live' || session.live === 'open' ? 1 : 0),
    buildPackage: (files) => link.buildPackage(files).catch((e: unknown) => deviceError(e)),
    async manifest() {
      const body = await getBody<unknown>('/api/v1/project/manifest');
      if (isDeviceError(body)) return body;
      return isObject(body) ? (body as unknown as PackageManifest) : { error: 'bad-response' };
    },
    async fetchPackage() {
      const dev = id();
      return dev ? link.fetchPackage(dev).catch((e: unknown) => deviceError(e)) : noDevice;
    },
    readPackageFile: (packageId, rel) => link.readPackageFile(packageId, rel),
    discardPackage: (packageId) => link.discardPackage(packageId),
    async deploy(packageId, baseDigest, onEvent) {
      const dev = id();
      return dev
        ? link.deploy(dev, packageId, baseDigest, onEvent).catch((e: unknown) => deviceError(e))
        : noDevice;
    },
    async restore(seq, baseDigest, onEvent) {
      const dev = id();
      return dev
        ? link.restore(dev, seq, baseDigest, onEvent).catch((e: unknown) => deviceError(e))
        : noDevice;
    },
    async operation() {
      const body = await getBody<DeployOperation | null>('/api/v1/project/operation');
      return body;
    },
  };
}

/** Runtime tối thiểu của alarm (định dạng 0.5, API 1.3.0). */
export const ALARM_MIN_RUNTIME = '0.8.0';

export function createDownloadEnv(d: DownloadEnvDeps): DownloadEnv {
  return { project: projectSide(d), device: deviceSide(d) };
}

/** Một bản trong kho của thiết bị (`GET /api/v1/project/versions`, device-api §4). */
export interface VersionRow {
  seq: number;
  state: 'active' | 'backup';
  digest: string;
  projectId: string;
  projectName: string;
  projectVersion: string;
  size: number;
  /** ms UTC; `null` khi thiết bị không báo. */
  activatedAt: number | null;
  deployedBy: string | null;
  deployedFrom: string | null;
  source: string | null;
  restorable: boolean;
}

export interface VersionList {
  active: number | null;
  rows: VersionRow[];
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Danh sách bản lưu từ thân của `GET /api/v1/project/versions`; thân sai dạng thì `null`. */
export function parseVersions(body: unknown): VersionList | null {
  if (!isObject(body) || !Array.isArray(body.versions)) return null;
  const rows: VersionRow[] = [];
  for (const v of body.versions) {
    if (!isObject(v) || typeof v.seq !== 'number' || typeof v.digest !== 'string') return null;
    const at = typeof v.activatedAt === 'string' ? Date.parse(v.activatedAt) : Number.NaN;
    rows.push({
      seq: v.seq,
      state: v.state === 'active' ? 'active' : 'backup',
      digest: v.digest,
      projectId: str(v.projectId) ?? '',
      projectName: str(v.projectName) ?? str(v.projectId) ?? '',
      projectVersion: str(v.projectVersion) ?? '',
      size: typeof v.size === 'number' ? v.size : 0,
      activatedAt: Number.isFinite(at) ? at : null,
      deployedBy: str(v.deployedBy),
      deployedFrom: str(v.deployedFrom),
      source: str(v.source),
      restorable: v.state !== 'active' && v.restorable !== false,
    });
  }
  return { active: typeof body.active === 'number' ? body.active : null, rows };
}
