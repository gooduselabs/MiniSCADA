// Kho project của trang vận hành (feature 007, FR-006, FR-020, FR-023; research R5, R6).
//  - `open()`: `GET /api/v1/projects/active`. Project 0.3 trả TÓM TẮT (không có `items`): tag, bảng giá trị, navigation,
//    danh sách màn hình; mỗi màn hình tải khi cần qua `GET /project/<file>`. Project 0.1 và 0.2 trả bản đầy đủ như
//    runtime 0.5 (`screens` là bản đồ id → {screen, bindings}) và đi qua bộ chuyển sang mô hình v1 (§8 của
//    contracts/project-format-0.3.md: một item `svg1` phủ kín khung).
//  - Cache tối đa 8 màn hình đã dựng mô hình (bỏ cái dùng lâu nhất). Lỗi của một màn hình chỉ làm màn hình đó hỏng, không
//    được cache, tải lại được. Màn hình đầu tải ngay sau tóm tắt, song song với việc dựng shell.
//  - Bộ chuyển 0.1/0.2 là `toScreenModel` của @mat/project-schema (data-model §9), cùng hàm với `migrate02to03` của Studio.
import type { ValueTable } from '@mat/expression';
import { toScreenModel } from '@mat/project-schema';
import type { ElementBindings02, Navigation, Screen, ScreenModel } from '@mat/project-schema';
import type { TagInfo } from '@mat/ui-components';
import type { ReportsFile } from './report-page.ts';
import { activeStamp, type ProjectStamp } from './reload.ts';

export const MAX_CACHED_SCREENS = 8;

export interface ScreenSummary {
  id: string;
  name: string;
  kind: 'screen' | 'popup';
  /** Đường dẫn trong `/project/` (project 0.3); vắng ở project 0.1/0.2. */
  file?: string;
}

export interface ApiIssue {
  code: string;
  file: string;
  path: string;
  message: string;
}

export interface ProjectSummary {
  /** Project 0.1 hoặc 0.2 (thân đầy đủ, bộ chuyển v1). */
  legacy: boolean;
  id: string;
  name: string;
  entry: string;
  tags: TagInfo[];
  valueTables: Record<string, ValueTable>;
  navigation: Navigation | null;
  screens: ScreenSummary[];
  stamp: ProjectStamp | null;
  /** Project 0.6: file mẫu báo cáo trong /project/ (feature 010). */
  reportsFile?: string;
  /** Project 1.1 (feature 012): chủ đề giao diện; vắng = industrial (giao diện cũ). */
  theme?: 'vivid' | 'industrial' | 'dark';
}

const THEMES = new Set(['vivid', 'industrial', 'dark']);

export type OpenResult =
  | { status: 'ok'; summary: ProjectSummary }
  | { status: 'no-project'; errors: ApiIssue[] }
  /** 401: `viewerLogin: required` và chưa đăng nhập. */
  | { status: 'login-required' };

export class ScreenLoadError extends Error {
  readonly screenId: string;
  readonly status: number | null;
  constructor(screenId: string, message: string, status: number | null = null) {
    super(message);
    this.name = 'ScreenLoadError';
    this.screenId = screenId;
    this.status = status;
  }
}

// ---- Đọc thân JSON một cách phòng thủ ----

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

/** id thiết bị (và kênh) → tên, từ `connections` dạng 0.3 (mảng) hoặc 0.2 (`channels[].devices[]`). */
function deviceNames(connections: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (Array.isArray(connections)) {
    for (const c of connections)
      if (isObj(c) && typeof c.id === 'string') out.set(c.id, str(c.name, c.id));
  } else if (isObj(connections) && Array.isArray(connections.channels)) {
    for (const ch of connections.channels) {
      if (!isObj(ch)) continue;
      if (typeof ch.id === 'string') out.set(ch.id, str(ch.name, ch.id));
      if (Array.isArray(ch.devices))
        for (const d of ch.devices)
          if (isObj(d) && typeof d.id === 'string') out.set(d.id, str(d.name, d.id));
    }
  }
  return out;
}

function toTagInfo(t: Obj, names: Map<string, string>): TagInfo {
  const info: TagInfo = {
    id: str(t.id),
    type: str(t.type, 'FLOAT32') as TagInfo['type'],
    access: t.access === 'RW' ? 'RW' : 'R',
    kind:
      (['external', 'internal', 'calculated', 'simulation'] as const).find((k) => k === t.kind) ??
      'simulation',
  };
  if (typeof t.description === 'string') info.description = t.description;
  if (typeof t.unit === 'string') info.unit = t.unit;
  if (typeof t.min === 'number') info.min = t.min;
  if (typeof t.max === 'number') info.max = t.max;
  if (isObj(t.limits)) info.limits = t.limits as NonNullable<TagInfo['limits']>;
  if (typeof t.valueTable === 'string') info.valueTable = t.valueTable;
  const dev = isObj(t.source) ? str(t.source.device) : '';
  if (dev) info.deviceName = names.get(dev) ?? dev;
  return info;
}

const projectUrl = (file: string) => {
  const parts = file.split('/');
  if (parts.some((p) => p === '.' || p === '..' || p === ''))
    throw new Error(`Đường dẫn file không hợp lệ: ${file}`);
  return '/project/' + parts.map(encodeURIComponent).join('/');
};

export interface ProjectStoreOptions {
  fetch?: typeof fetch;
  maxCached?: number;
}

export class ProjectStore {
  #fetch: typeof fetch;
  #max: number;
  #summary: ProjectSummary | null = null;
  /** Tăng mỗi lần `open()`: phân biệt yêu cầu tải màn hình của project cũ với của project hiện hành. */
  #gen = 0;
  /** Project 0.1/0.2: màn hình và binding có sẵn trong thân. */
  #legacyScreens = new Map<string, Screen>();
  #legacyBindings = new Map<string, ElementBindings02[]>();
  #cache = new Map<string, ScreenModel>();
  #inflight = new Map<string, Promise<ScreenModel>>();

  constructor(opt: ProjectStoreOptions = {}) {
    this.#fetch = opt.fetch ?? ((...a) => fetch(...a));
    this.#max = opt.maxCached ?? MAX_CACHED_SCREENS;
  }

  get summary(): ProjectSummary | null {
    return this.#summary;
  }

  /**
   * Bỏ cache màn hình (feature 013: quyền đổi, máy chủ lọc item theo phiên nên bản cũ có thể sai). Yêu cầu đang bay của
   * thế hệ cũ không vào cache mới.
   */
  invalidate(): void {
    this.#cache.clear();
    this.#inflight.clear();
    this.#reports = null;
    this.#gen++;
  }

  /** id màn hình đang nằm trong cache (cũ → mới). */
  cached(): string[] {
    return [...this.#cache.keys()];
  }

  async open(): Promise<OpenResult> {
    const res = await this.#fetch('/api/v1/projects/active', { cache: 'no-store' });
    if (res.status === 503) {
      const body: unknown = await res.json().catch(() => null);
      const errors = isObj(body) && Array.isArray(body.errors) ? (body.errors as ApiIssue[]) : [];
      return { status: 'no-project', errors };
    }
    if (res.status === 401) return { status: 'login-required' };
    if (!res.ok) throw new Error(`Không tải được project (HTTP ${res.status})`);
    const body: unknown = await res.json();
    if (!isObj(body) || !isObj(body.project) || !isObj(body.tags) || !Array.isArray(body.tags.tags))
      throw new Error('Thân projects/active không đúng hình dạng');
    const summary = this.#summarize(body);
    this.#summary = summary;
    this.#cache.clear();
    this.#inflight.clear();
    this.#reports = null;
    this.#gen++; // yêu cầu của thế hệ cũ, nếu xong muộn, không được vào cache của project mới
    // Màn hình đầu tải ngay, không chờ shell dựng; lỗi của nó hiện khi shell gọi `screen()`.
    void this.screen(summary.entry).catch(() => undefined);
    return { status: 'ok', summary };
  }

  #summarize(body: Obj): ProjectSummary {
    const project = body.project as Obj;
    const names = deviceNames(body.connections);
    const tagList = (body.tags as Obj).tags as unknown[];
    const tags = tagList.filter(isObj).map((t) => toTagInfo(t, names));
    const legacy = !Array.isArray(body.screens);
    const screens: ScreenSummary[] = [];
    this.#legacyScreens.clear();
    this.#legacyBindings.clear();
    if (legacy) {
      const rec = isObj(body.screens) ? body.screens : {};
      for (const [id, v] of Object.entries(rec)) {
        if (!isObj(v) || !isObj(v.screen)) continue;
        const sc = v.screen as unknown as Screen;
        this.#legacyScreens.set(id, sc);
        if (isObj(v.bindings) && Array.isArray(v.bindings.elements))
          this.#legacyBindings.set(sc.bindingFile, v.bindings.elements as ElementBindings02[]);
        screens.push({ id, name: str(sc.name, id), kind: 'screen' });
      }
    } else {
      for (const s of body.screens as unknown[]) {
        if (!isObj(s) || typeof s.id !== 'string') continue;
        const entry: ScreenSummary = {
          id: s.id,
          name: str(s.name, s.id),
          kind: s.kind === 'popup' ? 'popup' : 'screen',
        };
        if (typeof s.file === 'string') entry.file = s.file;
        screens.push(entry);
      }
    }
    return {
      legacy,
      id: str(project.projectId),
      name: str(project.projectName, str(project.projectId)),
      entry: str(project.entryScreen, screens[0]?.id ?? ''),
      tags,
      valueTables: isObj(body.valueTables) ? (body.valueTables as Record<string, ValueTable>) : {},
      navigation: isObj(body.navigation) ? (body.navigation as unknown as Navigation) : null,
      screens,
      stamp: activeStamp(200, body),
      ...(typeof project.reportsFile === 'string' ? { reportsFile: project.reportsFile } : {}),
      ...(typeof project.theme === 'string' && THEMES.has(project.theme)
        ? { theme: project.theme as NonNullable<ProjectSummary['theme']> }
        : {}),
    };
  }

  /** Mô hình của một màn hình (cache, gom các lần gọi đồng thời). Lỗi: `ScreenLoadError`, không cache. */
  screen(id: string): Promise<ScreenModel> {
    const hit = this.#cache.get(id);
    if (hit) {
      this.#cache.delete(id); // làm "mới" lại
      this.#cache.set(id, hit);
      return Promise.resolve(hit);
    }
    const pending = this.#inflight.get(id);
    if (pending) return pending;
    const gen = this.#gen;
    const p: Promise<ScreenModel> = this.#load(id).then(
      (m) => {
        if (gen === this.#gen) {
          if (this.#inflight.get(id) === p) this.#inflight.delete(id);
          this.#cache.set(id, m);
          while (this.#cache.size > this.#max)
            this.#cache.delete(this.#cache.keys().next().value as string);
        }
        return m;
      },
      (e: unknown) => {
        if (gen === this.#gen && this.#inflight.get(id) === p) this.#inflight.delete(id);
        throw e;
      },
    );
    this.#inflight.set(id, p);
    return p;
  }

  async #load(id: string): Promise<ScreenModel> {
    const sum = this.#summary?.screens.find((s) => s.id === id);
    if (!sum) throw new ScreenLoadError(id, `Màn hình "${id}" không có trong project`);
    const legacy = this.#legacyScreens.get(id);
    if (legacy) {
      try {
        return toScreenModel(legacy);
      } catch (e) {
        throw new ScreenLoadError(id, e instanceof Error ? e.message : String(e));
      }
    }
    if (!sum.file) throw new ScreenLoadError(id, `Màn hình "${id}" thiếu đường dẫn file`);
    let res: Response;
    try {
      res = await this.#fetch(projectUrl(sum.file), { cache: 'no-cache' });
    } catch (e) {
      throw new ScreenLoadError(
        id,
        `Không tải được màn hình "${id}": ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok)
      throw new ScreenLoadError(
        id,
        `Không tải được màn hình "${id}" (HTTP ${res.status})`,
        res.status,
      );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ScreenLoadError(id, `File màn hình "${id}" không phải JSON hợp lệ`, res.status);
    }
    if (!isObj(body) || !Array.isArray(body.items) || !isObj(body.size))
      throw new ScreenLoadError(id, `File màn hình "${id}" không đúng hình dạng`, res.status);
    return body as unknown as ScreenModel;
  }

  #reports: Promise<ReportsFile | null> | null = null;

  /** Mẫu báo cáo (reports.json); null khi project không có. Lỗi tải ném ra để trang báo cáo hiện thông báo. */
  reports(): Promise<ReportsFile | null> {
    const file = this.#summary?.reportsFile;
    if (!file) return Promise.resolve(null);
    this.#reports ??= (async () => {
      const res = await this.#fetch(projectUrl(file), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Không tải được ${file} (HTTP ${res.status})`);
      const body: unknown = await res.json();
      return isObj(body) && Array.isArray(body.reports) ? (body as unknown as ReportsFile) : null;
    })().catch((e: unknown) => {
      this.#reports = null;
      throw e;
    });
    return this.#reports;
  }

  async loadSvg(path: string): Promise<string> {
    const res = await this.#fetch(projectUrl(path), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Không tải được ${path} (HTTP ${res.status})`);
    return res.text();
  }

  async loadBindings(path: string): Promise<ElementBindings02[]> {
    const inline = this.#legacyBindings.get(path);
    if (inline) return inline;
    const res = await this.#fetch(projectUrl(path), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Không tải được ${path} (HTTP ${res.status})`);
    const body: unknown = await res.json();
    return isObj(body) && Array.isArray(body.elements)
      ? (body.elements as ElementBindings02[])
      : [];
  }
}
