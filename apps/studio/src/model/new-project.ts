// Project mới (lệnh Project → Project mới…, 2026-10-20): dựng bộ file của project định dạng 1.1 từ tên, mã, mẫu và
// chủ đề. Hàm thuần: ghi đĩa do lệnh Rust `project_create` (tạo thư mục con `<mã>` trong thư mục cha đã chọn).
//
// Ba mẫu: "Trống" (một màn hình lưới `tong-quan` có một hàng ba ô trống, chưa có Tag), "Trạm bơm" dựng từ
// projects/grid-demo nhúng vào bản build lúc build (bộ cài không có thư mục projects/), chỉ đổi mã, tên và chủ đề, và
// "Dashboard" (feature 014): chỉ màn hình Bảng điều khiển của grid-demo (thẻ chỉ số màu, biểu đồ có tiêu đề và ngưỡng)
// cùng Tag, kết nối, bảng giá trị của nó; hộp thoại gợi ý chủ đề Tối cho mẫu này. "Sơ đồ công nghệ (SVG)" (feature 026):
// projects/svg-showcase nhúng lúc build (sơ đồ SVG vẽ tay có hoạt ảnh, màn hình lưới kết hợp, faceplate bơm).
import { t } from '../i18n/index.ts';

/** Mẫu của project mới. */
export type NewProjectTemplate = 'blank' | 'pump' | 'dashboard' | 'diagram';
/** Chủ đề cũ (feature 012): feature 029 chỉ còn một giao diện, giá trị này bị bỏ qua và không ghi vào project.json. */
export type NewProjectTheme = 'vivid' | 'industrial' | 'dark';

export const NEW_PROJECT_TEMPLATES: readonly NewProjectTemplate[] = [
  'blank',
  'pump',
  'dashboard',
  'diagram',
];

export interface NewProjectOptions {
  name: string;
  id: string;
  template: NewProjectTemplate;
  /** Bỏ qua (feature 029). */
  theme?: NewProjectTheme;
}

export interface NewProjectFiles {
  /** Đường dẫn tương đối → nội dung. */
  files: Record<string, string>;
  /** Màn hình mở sẵn sau khi tạo. */
  entryScreen: string;
}

/** Độ dài tối đa của mã project (`projectId` của schema). */
export const PROJECT_ID_MAX = 48;
/** Độ dài tối đa của tên project (`projectName` của schema). */
export const PROJECT_NAME_MAX = 80;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,47}$/;
/** Tên thiết bị của Windows: mã project là tên thư mục (như `check_rel`/`valid_project_id` của Rust). */
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Mã project hợp lệ: theo `projectId` của schema và dùng được làm tên thư mục trên Windows. */
export function isValidProjectId(id: string): boolean {
  return ID_RE.test(id) && !WINDOWS_DEVICE_RE.test(id);
}

/**
 * Mã project từ tên: bỏ dấu tiếng Việt (đ → d), chữ thường, mỗi chuỗi ký tự khác chữ số thành một gạch nối, tối đa
 * 48 ký tự. Tên không có chữ hay số thì rỗng; một ký tự thì thêm `-1` cho đủ hai ký tự.
 */
export function projectIdFromName(name: string): string {
  let id = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, PROJECT_ID_MAX)
    .replace(/-+$/, '');
  if (id.length === 1) id = `${id}-1`;
  if (WINDOWS_DEVICE_RE.test(id)) id = `${id}-1`;
  return id;
}

const text = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;

// ---- Mẫu trống ----

const BLANK_SCREEN = 'tong-quan';

function blankFiles(o: NewProjectOptions, name: string): Record<string, string> {
  return {
    'project.json': text({
      format: 'matscada-project',
      schemaVersion: '1.1.0',
      projectId: o.id,
      projectName: name,
      projectVersion: '0.1.0',
      minRuntimeVersion: '1.1.0',
      entryScreen: BLANK_SCREEN,
      screens: [BLANK_SCREEN],
      tagFile: 'tags.json',
      navigation: {
        position: 'left',
        items: [{ label: t('np.blank.screen'), screen: BLANK_SCREEN, icon: 'home' }],
      },
      maxClients: 10,
    }),
    'tags.json': text({ schemaVersion: '1.1.0', tags: [] }),
    [`screens/${BLANK_SCREEN}.screen.json`]: text({
      schemaVersion: '1.1.0',
      id: BLANK_SCREEN,
      name: t('np.blank.screen'),
      size: { width: 1920, height: 1080 },
      layout: {
        mode: 'grid',
        columns: 12,
        gap: 12,
        padding: 16,
        rows: [
          {
            id: 'r1',
            height: 'auto',
            cells: [
              { id: 'c1', span: 4 },
              { id: 'c2', span: 4 },
              { id: 'c3', span: 4 },
            ],
          },
        ],
      },
      items: [],
    }),
  };
}

// ---- Mẫu trạm bơm (projects/grid-demo nhúng lúc build) ----

const PUMP_RAW = import.meta.glob('../../../../projects/grid-demo/**/*.{json,svg}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const PUMP_PREFIX = '../../../../projects/grid-demo/';

function pumpFiles(o: NewProjectOptions, name: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(PUMP_RAW)) files[k.slice(PUMP_PREFIX.length)] = v;
  const project = JSON.parse(files['project.json']) as Record<string, unknown>;
  delete project.theme;
  files['project.json'] = text({ ...project, projectId: o.id, projectName: name });
  return files;
}

// ---- Mẫu dashboard (feature 014): một màn hình của grid-demo ----

const DASHBOARD_SCREEN = 'bang-dieu-khien';

function dashboardFiles(o: NewProjectOptions, name: string): Record<string, string> {
  const all = pumpFiles(o, name);
  const project = JSON.parse(all['project.json']) as Record<string, unknown> & {
    navigation?: { items?: Array<{ screen?: string }> };
  };
  const keep = (rel: string): boolean =>
    rel === 'project.json' ||
    rel === project.tagFile ||
    rel === project.connectionFile ||
    rel.startsWith('value-tables/') ||
    rel === `screens/${DASHBOARD_SCREEN}.screen.json`;
  const files: Record<string, string> = {};
  for (const [rel, v] of Object.entries(all)) if (keep(rel)) files[rel] = v;
  const rest = { ...project };
  delete rest.templates;
  files['project.json'] = text({
    ...rest,
    entryScreen: DASHBOARD_SCREEN,
    screens: [DASHBOARD_SCREEN],
    navigation: {
      ...project.navigation,
      items: (project.navigation?.items ?? []).filter((i) => i.screen === DASHBOARD_SCREEN),
    },
  });
  return files;
}

// ---- Mẫu sơ đồ công nghệ SVG (feature 026, projects/svg-showcase nhúng lúc build) ----

const DIAGRAM_RAW = import.meta.glob('../../../../projects/svg-showcase/**/*.{json,svg}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const DIAGRAM_PREFIX = '../../../../projects/svg-showcase/';

function diagramFiles(o: NewProjectOptions, name: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(DIAGRAM_RAW)) files[k.slice(DIAGRAM_PREFIX.length)] = v;
  const project = JSON.parse(files['project.json']) as Record<string, unknown>;
  delete project.theme;
  files['project.json'] = text({ ...project, projectId: o.id, projectName: name });
  return files;
}

/** Bộ file của project mới. Tên cắt khoảng trắng hai đầu; mã phải đã hợp lệ (`isValidProjectId`). */
export function buildNewProject(o: NewProjectOptions): NewProjectFiles {
  const name = o.name.trim();
  const files =
    o.template === 'pump'
      ? pumpFiles(o, name)
      : o.template === 'dashboard'
        ? dashboardFiles(o, name)
        : o.template === 'diagram'
          ? diagramFiles(o, name)
          : blankFiles(o, name);
  const entry = (JSON.parse(files['project.json']) as { entryScreen: string }).entryScreen;
  return { files, entryScreen: entry };
}
