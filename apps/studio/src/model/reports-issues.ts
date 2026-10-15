// Ánh xạ lỗi và cảnh báo của reports.json tới ô của editor Mẫu báo cáo (feature 010, FR-054): lỗi hiện NGAY tại trường của mẫu
// hoặc tại ô của lưới cột (viền đỏ), phần còn lại ở mức file. Hàm thuần. Mã `E_RPT_*`: contracts/templates-config.md §3.
import type { Issue } from '@mat/project-schema';
import { severityOf } from './issue-map.ts';

export interface ReportIssueBuckets {
  /** Theo chỉ số mẫu → trường (`id`, `name`, `group`, `period`, `shifts`, `columns`, `self`…) → lỗi. */
  fields: Map<number, Map<string, Issue[]>>;
  /** Theo chỉ số mẫu → ô `cột:khóa` của lưới cột (`tag`, `label`, `unit`, `decimals`, `fns`). */
  cells: Map<number, Map<string, Issue[]>>;
  /** Cả file, `/reportsFile`, hình dạng lạ. */
  file: Issue[];
  hasErrors: boolean;
}

const REPORT = /^\/reports\/(\d+)(?:\/(.*))?$/;
const COLUMN = /^columns\/(\d+)(?:\/(.*))?$/;

function colKey(rest: string | undefined): string {
  switch (rest?.split('/')[0]) {
    case 'label':
      return 'label';
    case 'unit':
      return 'unit';
    case 'decimals':
      return 'decimals';
    case 'functions':
      return 'fns';
    default:
      return 'tag';
  }
}

function push(map: Map<number, Map<string, Issue[]>>, i: number, key: string, issue: Issue): void {
  let inner = map.get(i);
  if (!inner) map.set(i, (inner = new Map()));
  const cur = inner.get(key);
  if (cur) cur.push(issue);
  else inner.set(key, [issue]);
}

export function bucketReportIssues(
  issues: readonly Issue[],
  reportsFile: string | null,
): ReportIssueBuckets {
  const out: ReportIssueBuckets = {
    fields: new Map(),
    cells: new Map(),
    file: [],
    hasErrors: false,
  };
  for (const issue of issues) {
    if (issue.file === 'project.json' && issue.path === '/reportsFile') {
      out.file.push(issue);
      continue;
    }
    if (reportsFile === null || issue.file !== reportsFile) continue;
    if (severityOf(issue) !== 'warning') out.hasErrors = true;
    const m = REPORT.exec(issue.path);
    if (!m) {
      out.file.push(issue);
      continue;
    }
    const i = Number(m[1]);
    const rest = m[2];
    const c = rest === undefined ? null : COLUMN.exec(rest);
    if (c) push(out.cells, i, `${c[1]}:${colKey(c[2])}`, issue);
    else push(out.fields, i, rest === undefined ? 'self' : rest.split('/')[0]!, issue);
  }
  return out;
}
