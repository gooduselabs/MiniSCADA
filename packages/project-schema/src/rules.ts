// Luật liên file của bộ kiểm tra (ngoài JSON Schema), contracts/project-format.md.
// Bản C++ (core/project-manager/project_validator.cpp) cài CÙNG luật và thứ tự bỏ qua:
// file nào lỗi parse/schema thì các luật cần file đó bị bỏ qua.
import {
  MAX_CLIENTS_LIMIT,
  RUNTIME_VERSION,
  SUPPORTED_SCHEMA,
  type ErrorCode,
  type Issue,
} from './codes.ts';
import {
  SUPPORTED_TARGETS,
  type Binding,
  type BindingSet,
  type Project,
  type Scalar,
  type Screen,
  type TagDataType,
  type TagList,
} from './types.ts';

export interface RuleInput {
  project: Project;
  tags?: TagList;
  screens: Record<
    string,
    { file: string; screen: Screen; bindings?: BindingSet; svgText: string | null }
  >;
  checkSvg: boolean;
}

const NUMERIC = new Set<TagDataType>([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
]);
export const isNumericTag = (t: TagDataType) => NUMERIC.has(t);

/** So SemVer theo MAJOR.MINOR.PATCH (bỏ phần pre-release). */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

const scalarMatches = (t: TagDataType, v: Scalar) =>
  t === 'BOOL'
    ? typeof v === 'boolean'
    : t === 'STRING'
      ? typeof v === 'string'
      : typeof v === 'number';

/** Kiểu Tag dùng được với transform `direct` cho từng đích. */
function directAccepts(b: Binding, t: TagDataType): boolean {
  switch (b.target) {
    case 'geometry.levelPercent':
    case 'style.opacity':
      return isNumericTag(t);
    case 'transform.rotate':
      return b.animation === 'spin' ? isNumericTag(t) || t === 'BOOL' : isNumericTag(t);
    case 'style.visibility':
      return t === 'BOOL' || t === 'STRING';
    case 'style.fill':
    case 'style.stroke':
      return t === 'STRING';
    default:
      return true; // text.content
  }
}

export function runRules(input: RuleInput): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (code: ErrorCode, file: string, path: string, message: string) =>
    errors.push({ code, file, path, message });
  const { project, tags, screens } = input;

  // Phiên bản schema + runtime
  const versionOf: Array<[string, string]> = [['project.json', project.schemaVersion]];
  if (tags) versionOf.push([project.tagFile, tags.schemaVersion]);
  for (const s of Object.values(screens)) {
    versionOf.push([s.file, s.screen.schemaVersion]);
    if (s.bindings) versionOf.push([s.screen.bindingFile, s.bindings.schemaVersion]);
  }
  for (const [file, v] of versionOf)
    if (!SUPPORTED_SCHEMA.test(v))
      add(
        'E_SCHEMA_VERSION',
        file,
        '/schemaVersion',
        `schemaVersion ${v} không hỗ trợ (cần 0.1.x)`,
      );
  if (compareSemver(project.minRuntimeVersion, RUNTIME_VERSION) > 0)
    add(
      'E_RUNTIME_TOO_OLD',
      'project.json',
      '/minRuntimeVersion',
      `Project cần runtime ≥ ${project.minRuntimeVersion}, runtime hiện tại ${RUNTIME_VERSION}`,
    );
  if (project.maxClients < 1 || project.maxClients > MAX_CLIENTS_LIMIT)
    add('E_MAX_CLIENTS', 'project.json', '/maxClients', 'maxClients phải trong 1–10');
  if (!project.screens.includes(project.entryScreen))
    add(
      'E_SCREEN_ID',
      'project.json',
      '/entryScreen',
      `entryScreen '${project.entryScreen}' không có trong screens`,
    );

  // Tag
  const tagType = new Map<string, TagDataType>();
  if (tags) {
    tags.tags.forEach((t, i) => {
      const p = `/tags/${i}`;
      if (tagType.has(t.id)) add('E_DUP_TAG', project.tagFile, `${p}/id`, `Tag '${t.id}' bị trùng`);
      else tagType.set(t.id, t.type);
      const hasRange = t.min !== undefined || t.max !== undefined;
      if (hasRange && !isNumericTag(t.type))
        add('E_TAG_RANGE', project.tagFile, p, `min/max chỉ dùng cho Tag số ('${t.id}')`);
      else if (t.min !== undefined && t.max !== undefined && t.min >= t.max)
        add('E_TAG_RANGE', project.tagFile, p, `min phải nhỏ hơn max ('${t.id}')`);
    });
  }

  // Screen + binding
  for (const [id, s] of Object.entries(screens)) {
    const { screen, bindings, file } = s;
    if (screen.id !== id)
      add('E_SCREEN_ID', file, '/id', `id '${screen.id}' khác tên file '${id}'`);
    const uids = new Set<string>();
    screen.elements.forEach((e, i) => {
      if (uids.has(e.elementUid))
        add(
          'E_DUP_UID',
          file,
          `/elements/${i}/elementUid`,
          `elementUid '${e.elementUid}' bị trùng`,
        );
      uids.add(e.elementUid);
    });

    if (input.checkSvg && s.svgText !== null) {
      const declared = new Set<string>();
      try {
        const doc = new DOMParser().parseFromString(s.svgText, 'image/svg+xml');
        doc
          .querySelectorAll('[data-mat-uid]')
          .forEach((el) => declared.add(el.getAttribute('data-mat-uid')!));
      } catch {
        /* SVG hỏng: trình hiển thị sẽ báo; không phải lỗi validator v0 */
      }
      screen.elements.forEach((e, i) => {
        if (!declared.has(e.elementUid))
          warnings.push({
            code: 'W_UID_NOT_IN_SVG',
            file,
            path: `/elements/${i}/elementUid`,
            message: `SVG '${screen.svgFile}' không có phần tử data-mat-uid="${e.elementUid}"`,
          });
      });
    }

    if (!bindings) continue;
    const bfile = screen.bindingFile;
    if (bindings.screenId !== screen.id)
      add(
        'E_SCREEN_ID',
        bfile,
        '/screenId',
        `screenId '${bindings.screenId}' khác screen '${screen.id}'`,
      );
    const boundUids = new Set<string>();
    const bindingIds = new Set<string>();
    bindings.elements.forEach((eb, i) => {
      const ep = `/elements/${i}`;
      if (boundUids.has(eb.elementUid))
        add(
          'E_DUP_UID',
          bfile,
          `${ep}/elementUid`,
          `elementUid '${eb.elementUid}' lặp trong bindings`,
        );
      boundUids.add(eb.elementUid);
      if (!uids.has(eb.elementUid))
        add(
          'E_REF_UID',
          bfile,
          `${ep}/elementUid`,
          `elementUid '${eb.elementUid}' không có trong screen`,
        );
      eb.bindings.forEach((b, j) => {
        const bp = `${ep}/bindings/${j}`;
        if (bindingIds.has(b.id))
          add('E_DUP_BINDING', bfile, `${bp}/id`, `binding id '${b.id}' bị trùng`);
        bindingIds.add(b.id);
        if (!(SUPPORTED_TARGETS as readonly string[]).includes(b.target)) {
          add('E_TARGET_UNSUPPORTED', bfile, `${bp}/target`, `Đích '${b.target}' chưa hỗ trợ ở v0`);
          return;
        }
        const kind = (b.transform as { kind: string }).kind;
        if (kind !== 'direct' && kind !== 'discreteMap' && kind !== 'linearScale') {
          add(
            'E_TRANSFORM_UNSUPPORTED',
            bfile,
            `${bp}/transform/kind`,
            `Transform '${kind}' chưa hỗ trợ ở v0`,
          );
          return;
        }
        if (!tags) return;
        const t = tagType.get(b.source.tagId);
        if (!t) {
          add('E_REF_TAG', bfile, `${bp}/source/tagId`, `Tag '${b.source.tagId}' không tồn tại`);
          return;
        }
        const tr = b.transform;
        if (tr.kind === 'linearScale') {
          if (!isNumericTag(t))
            add(
              'E_TYPE_MISMATCH',
              bfile,
              `${bp}/transform`,
              `linearScale cần Tag số, '${b.source.tagId}' là ${t}`,
            );
          if (tr.inMin === tr.inMax)
            add('E_SCALE_RANGE', bfile, `${bp}/transform`, 'inMin phải khác inMax');
        } else if (tr.kind === 'discreteMap') {
          if (tr.cases.some((c) => !scalarMatches(t, c.equals)))
            add(
              'E_TYPE_MISMATCH',
              bfile,
              `${bp}/transform/cases`,
              `equals phải cùng kiểu với Tag ${t}`,
            );
        } else if (!directAccepts(b, t)) {
          add(
            'E_TYPE_MISMATCH',
            bfile,
            `${bp}/source/tagId`,
            `Tag ${t} không dùng trực tiếp được cho '${b.target}'`,
          );
        }
      });
    });
  }
  return { errors, warnings };
}
