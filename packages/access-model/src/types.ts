// Kiểu của mô hình quyền (feature 013; specs/013-access-control/contracts/access-model.md §1.2, §2, §5, §7). Cùng hình
// với bản C++ core/auth/access_model.hpp; vector chung tests/access-vectors (README.md ở đó ghi quy ước).

export const ROLES = ['viewer', 'operator', 'engineer', 'administrator'] as const;
export type Role = (typeof ROLES)[number];
export type AccessLevel = 'view' | 'operate';

/** Trang hệ thống có quy tắc (`page:<tên>`); `page:admin` chỉ administrator, không có quy tắc. */
export const SYSTEM_PAGES = ['alarms', 'history', 'reports', 'watch'] as const;
export type SystemPage = (typeof SYSTEM_PAGES)[number];

// ---------- danh mục tài nguyên (§7): đã áp mặc định project (§3) ----------

export interface CatalogItem {
  id: string;
  /** Widget nhóm `control` của danh mục widget, hoặc item SVG có sự kiện ghi (write, toggle, pulse). */
  operable: boolean;
  view: Role;
  /** Chỉ có (và chỉ dùng) khi `operable`. */
  operate?: Role;
  /** Tag trong binding của item (đọc và ghi). */
  tags: string[];
}

export interface CatalogScreen {
  id: string;
  popup: boolean;
  view: Role;
  items: CatalogItem[];
}

export interface CatalogTagSet {
  id: string;
  tags: string[];
}

export interface CatalogAlarm {
  id: string;
  tag: string;
}

export interface ResourceCatalog {
  screens: CatalogScreen[];
  historyGroups: CatalogTagSet[];
  reports: CatalogTagSet[];
  alarms: CatalogAlarm[];
}

// ---------- kho quy tắc access.json (§1.2) ----------

export interface AccessGroup {
  id: string;
  name: string;
}

export interface AccessRule {
  /** `screen:<id>`, `item:<screen>/<item>`, `page:<tên>`, `history:<groupId>`, `report:<id>`. */
  resource: string;
  level: AccessLevel;
  /** `*`, `user:<name>`, `group:<id>`, `role:<vai trò>`; rỗng là không ai (ngoài administrator). */
  grantees: string[];
}

export interface AccessStore {
  schemaVersion: string;
  rev: number;
  groups: AccessGroup[];
  rules: AccessRule[];
}

// ---------- chủ thể (§4) ----------

export interface Principal {
  /** null: phiên ẩn danh (chỉ khi `viewerLogin: off`). */
  user: string | null;
  role: Role;
  groups: string[];
}

// ---------- kết quả ----------

export interface OrphanRule {
  resource: string;
  level: AccessLevel;
}

/**
 * Quyền hiệu lực (§5, §7). `screens` theo thứ tự danh mục; mọi mảng khác sắp theo chuỗi, không trùng;
 * `hiddenItems`/`lockedItems` chỉ có khóa khi danh sách khác rỗng. `liveTags`, `historyTags`, `alarms` chỉ dùng ở máy
 * chủ (không gửi cho trang).
 */
export interface EffectiveAccess {
  user: string | null;
  role: Role;
  groups: string[];
  anonymous: boolean;
  storeRev: number;
  screens: string[];
  hiddenItems: Record<string, string[]>;
  lockedItems: Record<string, string[]>;
  pages: SystemPage[];
  admin: boolean;
  liveTags: string[];
  historyTags: string[];
  alarms: string[];
  orphans: OrphanRule[];
}
