// Không gian làm việc của Studio (feature 004, data-model §1): kích thước vùng, task card, theme, nhãn
// giai đoạn, địa chỉ thiết bị. Lưu trong localStorage của WebView2; chỉ là tiện ích, mất hay hỏng thì về
// mặc định, storage bị chặn cũng không làm Studio lỗi.

export type Theme = 'system' | 'light' | 'dark';
export type TaskCard = 'toolbox' | 'library' | 'online' | 'find';

export interface Workspace {
  leftWidth: number;
  detailsHeight: number;
  inspectorHeight: number;
  /** Feature 015: khung dưới gập (chỉ còn dải tab); `inspectorHeight` giữ chiều cao để mở lại. */
  inspectorCollapsed: boolean;
  taskCard: TaskCard;
  taskCardOpen: boolean;
  theme: Theme;
  showPhases: boolean;
  deviceAddress: string;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const WORKSPACE_KEY = 'mat-studio.workspace';
/** Khóa địa chỉ thiết bị của Studio Sprint 1, giữ nguyên để không mất địa chỉ đã nhập. */
export const DEVICE_KEY = 'mat-studio.device';

/** Cửa sổ hẹp hơn mức này thì task card nổi và mặc định thu lại (mockup, mat-shell). */
export const TASK_CARD_MIN_WINDOW = 1180;

const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
const TASK_CARDS: readonly TaskCard[] = ['toolbox', 'library', 'online', 'find'];

export function defaultWorkspace(windowWidth: number): Workspace {
  return {
    leftWidth: 264,
    detailsHeight: 196,
    inspectorHeight: 218,
    inspectorCollapsed: false,
    taskCard: 'toolbox',
    taskCardOpen: windowWidth >= TASK_CARD_MIN_WINDOW,
    theme: 'system',
    showPhases: true,
    deviceAddress: '',
  };
}

function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Đọc từng trường; trường thiếu, sai kiểu hay ngoài tập giá trị thì lấy mặc định. */
export function loadWorkspace(storage: StorageLike | null, windowWidth: number): Workspace {
  const ws = defaultWorkspace(windowWidth);
  let raw: Record<string, unknown> = {};
  try {
    const text = read(storage, WORKSPACE_KEY);
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  if (isNum(raw.leftWidth)) ws.leftWidth = raw.leftWidth;
  if (isNum(raw.detailsHeight)) ws.detailsHeight = raw.detailsHeight;
  if (isNum(raw.inspectorHeight)) ws.inspectorHeight = raw.inspectorHeight;
  if (typeof raw.inspectorCollapsed === 'boolean') ws.inspectorCollapsed = raw.inspectorCollapsed;
  if (TASK_CARDS.includes(raw.taskCard as TaskCard)) ws.taskCard = raw.taskCard as TaskCard;
  if (typeof raw.taskCardOpen === 'boolean') ws.taskCardOpen = raw.taskCardOpen;
  if (THEMES.includes(raw.theme as Theme)) ws.theme = raw.theme as Theme;
  if (typeof raw.showPhases === 'boolean') ws.showPhases = raw.showPhases;
  ws.deviceAddress = read(storage, DEVICE_KEY) ?? '';
  return ws;
}

export function saveWorkspace(storage: StorageLike | null, ws: Workspace): void {
  const { deviceAddress, ...rest } = ws;
  try {
    storage?.setItem(WORKSPACE_KEY, JSON.stringify(rest));
    storage?.setItem(DEVICE_KEY, deviceAddress);
  } catch {
    /* storage bị chặn: chỉ là tiện ích, bỏ qua */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/**
 * Kẹp kích thước vùng (data-model §1). `leftColumnHeight`/`centerHeight` = 0 khi chưa đo được
 * (chưa vẽ): khi đó chỉ kẹp cận dưới.
 */
export function clampLayout(
  ws: Workspace,
  dims: { leftColumnHeight: number; centerHeight: number },
): Workspace {
  const detailsMax = dims.leftColumnHeight > 0 ? dims.leftColumnHeight - 120 : Infinity;
  const inspectorMax = dims.centerHeight > 0 ? dims.centerHeight - 150 : Infinity;
  return {
    ...ws,
    leftWidth: clamp(ws.leftWidth, 180, 480),
    detailsHeight: clamp(ws.detailsHeight, 70, detailsMax),
    inspectorHeight: clamp(ws.inspectorHeight, 90, inspectorMax),
  };
}

/** "Đặt lại bố cục": về kích thước và task card mặc định, giữ theme, địa chỉ thiết bị, nhãn giai đoạn. */
export function resetLayout(ws: Workspace, windowWidth: number): Workspace {
  return {
    ...defaultWorkspace(windowWidth),
    theme: ws.theme,
    deviceAddress: ws.deviceAddress,
    showPhases: ws.showPhases,
  };
}
