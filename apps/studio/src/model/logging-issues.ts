// Ánh xạ lỗi và cảnh báo của logging.json tới ô của editor Lưu trữ (feature 010, FR-054): lỗi hiện ngay tại ô của lưới
// nhóm và lưới Tag (viền đỏ, cảnh báo viền hổ phách), kết nối theo thẻ, còn lại ở mức file. Hàm thuần.
import type { Issue } from '@mat/project-schema';
import { severityOf } from './issue-map.ts';

export interface LoggingIssueBuckets {
  /** Khóa ô `nhóm:cột` của lưới nhóm. */
  groupCells: Map<string, Issue[]>;
  groupWarns: Map<string, Issue[]>;
  /** Theo chỉ số nhóm → khóa ô `dòng:cột` của lưới Tag. */
  tagCells: Map<number, Map<string, Issue[]>>;
  tagWarns: Map<number, Map<string, Issue[]>>;
  /** Nhóm có lỗi hay cảnh báo (kể cả lỗi không gắn được ô). */
  groupsWithIssues: Set<number>;
  conns: Map<number, Issue[]>;
  /** Cả file, `/loggingFile`, đường dẫn lạ; cảnh báo của cả file (ngân sách ghi). */
  file: Issue[];
  hasErrors: boolean;
}

const GROUP = /^\/groups\/(\d+)(?:\/(.*))?$/;
const TAG = /^tags\/(\d+)(?:\/(.*))?$/;
const CONN = /^\/connections\/(\d+)(?:\/|$)/;

/** Cột lưới nhóm theo trường của nhóm. */
function groupCol(field: string | undefined): string {
  switch (field) {
    case undefined:
      return 'mode';
    case 'id':
      return 'id';
    case 'name':
      return 'name';
    case 'mode':
      return 'mode';
    case 'retentionDays':
      return 'retention';
    case 'aggregates':
      return 'agg';
    case 'tags':
      return 'tags';
    default:
      // periodMs, minIntervalMs, maxIntervalMs, trigger, expectedRowsPerDay
      return field === 'table' ? 'table' : field === 'destinations' ? 'name' : 'interval';
  }
}

function tagCol(field: string | undefined): string {
  switch (field) {
    case 'column':
      return 'column';
    case 'label':
      return 'label';
    case 'deadband':
      return 'deadband';
    case 'maxLength':
      return 'length';
    case 'aggregate':
      return 'agg';
    default:
      return 'tag';
  }
}

function push<K>(map: Map<K, Issue[]>, key: K, issue: Issue): void {
  const cur = map.get(key);
  if (cur) cur.push(issue);
  else map.set(key, [issue]);
}

export function bucketLoggingIssues(
  issues: readonly Issue[],
  loggingFile: string | null,
): LoggingIssueBuckets {
  const out: LoggingIssueBuckets = {
    groupCells: new Map(),
    groupWarns: new Map(),
    tagCells: new Map(),
    tagWarns: new Map(),
    groupsWithIssues: new Set(),
    conns: new Map(),
    file: [],
    hasErrors: false,
  };
  for (const issue of issues) {
    if (issue.file === 'project.json' && issue.path === '/loggingFile') {
      out.file.push(issue);
      continue;
    }
    if (loggingFile === null || issue.file !== loggingFile) continue;
    const warn = severityOf(issue) === 'warning';
    if (!warn) out.hasErrors = true;
    const g = GROUP.exec(issue.path);
    if (g) {
      const gi = Number(g[1]);
      out.groupsWithIssues.add(gi);
      const rest = g[2];
      const tg = rest === undefined ? null : TAG.exec(rest);
      if (tg) {
        const key = `${tg[1]}:${tagCol(tg[2]?.split('/')[0])}`;
        const map = warn ? out.tagWarns : out.tagCells;
        let inner = map.get(gi);
        if (!inner) map.set(gi, (inner = new Map()));
        push(inner, key, issue);
      } else {
        // Lỗi ở chính nhóm nêu tên thuộc tính (thiếu trường, khóa thừa): tô đúng ô của thuộc tính đó (042), không
        // mặc định cột Chế độ.
        const named =
          rest === undefined
            ? /^(?:Instance does not have required property|Property) "([^"]+)"/.exec(
                issue.message,
              )?.[1]
            : undefined;
        const col = groupCol(named ?? rest?.split('/')[0]);
        push(warn ? out.groupWarns : out.groupCells, `${gi}:${col}`, issue);
      }
      continue;
    }
    const c = CONN.exec(issue.path);
    if (c) {
      push(out.conns, Number(c[1]), issue);
      continue;
    }
    out.file.push(issue);
  }
  return out;
}
