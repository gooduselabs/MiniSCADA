// Logic form cấu hình project của Studio (FR-033): sửa project.json/tags.json bất biến, kiểm bằng
// bộ kiểm tra dùng chung trước khi cho lưu, ghi theo định dạng chuẩn JSON 2 dấu cách.
import {
  validateProject,
  type ProjectSource,
  type Project,
  type TagDefinition,
  type TagList,
  type ValidationResult,
} from '@mat/project-schema';

export type ProjectField = 'projectName' | 'projectVersion' | 'entryScreen' | 'maxClients';

export type ProjectEdit =
  | { kind: 'project'; field: ProjectField; value: string | number }
  | { kind: 'tagUpsert'; index?: number; tag: TagDefinition }
  | { kind: 'tagRemove'; index: number };

export interface EditableProject {
  project: Project;
  tags: TagList;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Áp các sửa đổi lên bản sao (không đụng bản gốc); giữ thứ tự khóa và trường không sửa. */
export function applyProjectEdits(base: EditableProject, edits: ProjectEdit[]): EditableProject {
  const project = clone(base.project);
  const tags = clone(base.tags);
  for (const e of edits) {
    if (e.kind === 'project') {
      (project as unknown as Record<string, unknown>)[e.field] = e.value;
    } else if (e.kind === 'tagUpsert') {
      if (e.index === undefined) tags.tags.push(clone(e.tag));
      else tags.tags[e.index] = clone(e.tag);
    } else {
      tags.tags.splice(e.index, 1);
    }
  }
  return { project, tags };
}

/** Định dạng chuẩn của file project do Studio ghi (cũng là định dạng của project mẫu). */
export const serialize = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

/** Nguồn đọc = project trên đĩa + các file đang sửa trong bộ nhớ. */
export class OverlaySource implements ProjectSource {
  private readonly base: ProjectSource;
  private readonly overrides: Record<string, string>;
  constructor(base: ProjectSource, overrides: Record<string, string>) {
    this.base = base;
    this.overrides = overrides;
  }
  readText(rel: string): Promise<string | null> {
    return Object.prototype.hasOwnProperty.call(this.overrides, rel)
      ? Promise.resolve(this.overrides[rel])
      : this.base.readText(rel);
  }
}

/** Kiểm toàn bộ project như runtime sẽ kiểm, với project/tags đang sửa. */
export function validateEdited(
  source: ProjectSource,
  project: Project,
  tags: TagList,
): Promise<ValidationResult> {
  return validateProject(
    new OverlaySource(source, {
      'project.json': serialize(project),
      [project.tagFile]: serialize(tags),
    }),
  );
}
