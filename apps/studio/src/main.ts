// mAT Studio — Sprint 1: mở project viết tay, kiểm tra (bộ kiểm tra dùng chung), sửa cấu hình,
// kết nối thiết bị, xem trước sống, mở web thiết bị. Chưa có trình vẽ (Sprint 3).
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  validateProject,
  type Issue,
  type LoadedProject,
  type Project,
  type TagDataType,
  type TagDefinition,
  type TagList,
} from '@mat/project-schema';
import { checkDevice, loadDevice, normalizeDevice, saveDevice } from './device.ts';
import { Preview } from './preview.ts';
import {
  applyProjectEdits,
  serialize,
  validateEdited,
  type EditableProject,
  type ProjectEdit,
} from './project-form.ts';
import {
  TauriProjectSource,
  openDeviceWeb,
  pickProject,
  writeProjectFile,
} from './tauri-source.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const insideTauri = isTauri();
const source = new TauriProjectSource();
const preview = new Preview();
const TYPES: TagDataType[] = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];

let saved: EditableProject | null = null; // nội dung trên đĩa
let current: EditableProject | null = null; // nội dung đang sửa
let lastValid: LoadedProject | null = null;
let validateTimer = 0;

// ---------- Tabs ----------
document.querySelectorAll<HTMLButtonElement>('[role=tab]').forEach((b) =>
  b.addEventListener('click', () => {
    document
      .querySelectorAll<HTMLButtonElement>('[role=tab]')
      .forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document
      .querySelectorAll<HTMLElement>('.tab')
      .forEach((s) => (s.hidden = s.id !== `tab-${b.dataset.tab}`));
  }),
);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = '',
  cls = '',
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

// ---------- Mở project ----------
async function openProject(): Promise<void> {
  if (!insideTauri) {
    $('project-path').textContent = 'Cần chạy trong ứng dụng Studio (Tauri) để mở thư mục';
    return;
  }
  const path = await pickProject();
  if (!path) return;
  preview.stop();
  $('project-path').textContent = path;
  const pj = await source.readText('project.json');
  let project: Project | null = null;
  let tags: TagList | null = null;
  try {
    project = pj ? (JSON.parse(pj) as Project) : null;
    const tj = project ? await source.readText(project.tagFile ?? 'tags.json') : null;
    tags = tj ? (JSON.parse(tj) as TagList) : null;
  } catch {
    /* JSON hỏng: bộ kiểm tra sẽ báo E_JSON */
  }
  if (project && tags && Array.isArray(tags.tags)) {
    saved = { project, tags };
    current = saved;
    renderForm();
  } else {
    saved = current = null;
    $('project-form').hidden = true;
  }
  await runValidation();
}

// ---------- Form ----------
function renderForm(): void {
  if (!current) return;
  const form = $<HTMLFormElement>('project-form');
  form.hidden = false;
  const p = current.project;
  (form.elements.namedItem('projectName') as HTMLInputElement).value = p.projectName ?? '';
  (form.elements.namedItem('projectVersion') as HTMLInputElement).value = p.projectVersion ?? '';
  (form.elements.namedItem('maxClients') as HTMLInputElement).value = String(p.maxClients ?? '');
  const sel = form.elements.namedItem('entryScreen') as HTMLSelectElement;
  sel.replaceChildren(
    ...(p.screens ?? []).map((s) => new Option(s, s, false, s === p.entryScreen)),
  );
  const body = $('tags').querySelector('tbody')!;
  body.replaceChildren(...current.tags.tags.map((t) => tagRow(t)));
}

function input(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = el('input');
  i.value = value;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

function tagRow(t: TagDefinition): HTMLTableRowElement {
  const tr = el('tr');
  const type = el('select');
  TYPES.forEach((x) => type.append(new Option(x, x, false, x === t.type)));
  const cells: HTMLElement[] = [
    input(t.id, { 'data-f': 'id', size: '16' }),
    type,
    input(t.unit ?? '', { 'data-f': 'unit', size: '5' }),
    input(t.min === undefined ? '' : String(t.min), { 'data-f': 'min', size: '5' }),
    input(t.max === undefined ? '' : String(t.max), { 'data-f': 'max', size: '5' }),
    input(t.source?.signal ?? '', { 'data-f': 'signal', size: '12' }),
    input(t.description ?? '', { 'data-f': 'description', size: '22' }),
  ];
  type.dataset.f = 'type';
  const del = el('button', 'Xóa');
  del.type = 'button';
  del.addEventListener('click', () => {
    tr.remove();
    onFormChange();
  });
  for (const c of [...cells, del]) {
    const td = el('td');
    td.append(c);
    tr.append(td);
  }
  return tr;
}

function readTag(tr: HTMLTableRowElement): TagDefinition {
  const v = (f: string) => (tr.querySelector(`[data-f="${f}"]`) as HTMLInputElement).value.trim();
  const num = (s: string) => (s === '' ? undefined : Number(s));
  // Thứ tự khóa giống file chuẩn: id, type, description, unit, min, max, source
  const t: Record<string, unknown> = { id: v('id'), type: v('type') };
  if (v('description')) t.description = v('description');
  if (v('unit')) t.unit = v('unit');
  if (num(v('min')) !== undefined) t.min = num(v('min'));
  if (num(v('max')) !== undefined) t.max = num(v('max'));
  t.source = { kind: 'mock', signal: v('signal') };
  return t as unknown as TagDefinition;
}

function editsFromForm(): ProjectEdit[] {
  const form = $<HTMLFormElement>('project-form');
  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
  const edits: ProjectEdit[] = [
    { kind: 'project', field: 'projectName', value: val('projectName') },
    { kind: 'project', field: 'projectVersion', value: val('projectVersion') },
    { kind: 'project', field: 'entryScreen', value: val('entryScreen') },
    { kind: 'project', field: 'maxClients', value: Number(val('maxClients')) },
  ];
  for (let i = saved!.tags.tags.length - 1; i >= 0; i--)
    edits.push({ kind: 'tagRemove', index: i });
  $('tags')
    .querySelectorAll('tbody tr')
    .forEach((tr) => edits.push({ kind: 'tagUpsert', tag: readTag(tr as HTMLTableRowElement) }));
  return edits;
}

function onFormChange(): void {
  if (!saved) return;
  const next = applyProjectEdits(saved, editsFromForm());
  // Không đổi gì so với đĩa: giữ nguyên đối tượng gốc (tránh ghi lại khi chỉ thay đổi rồi hoàn tác).
  current =
    serialize(next.project) === serialize(saved.project) &&
    serialize(next.tags) === serialize(saved.tags)
      ? saved
      : next;
  clearTimeout(validateTimer);
  validateTimer = window.setTimeout(() => void runValidation(), 250);
}

// ---------- Kiểm tra ----------
function renderIssues(errors: Issue[], warnings: Issue[]): void {
  const all = [...errors, ...warnings];
  $('check-summary').textContent = errors.length
    ? `${errors.length} lỗi${warnings.length ? `, ${warnings.length} cảnh báo` : ''} — runtime sẽ KHÔNG kích hoạt project này`
    : warnings.length
      ? `Hợp lệ với ${warnings.length} cảnh báo (Studio chặn lưu khi còn cảnh báo UID)`
      : 'Hợp lệ — runtime sẽ chấp nhận project này';
  $('check-list').replaceChildren(
    ...all.map((e) => {
      const tr = el('tr');
      [e.code, e.file, e.path || '—', e.message].forEach((t) => tr.append(el('td', t)));
      return tr;
    }),
  );
  $('form-errors').replaceChildren(
    ...all.map((e) => el('li', `${e.code} · ${e.file}${e.path} — ${e.message}`)),
  );
}

async function runValidation(): Promise<void> {
  const status = $('project-status');
  const r = current
    ? await validateEdited(source, current.project, current.tags)
    : await validateProject(source);
  renderIssues(r.errors, r.warnings);
  const ok = r.valid && r.warnings.length === 0;
  lastValid = r.valid ? (r.project ?? null) : null;
  status.textContent = ok ? 'Hợp lệ' : r.valid ? 'Có cảnh báo' : `Lỗi (${r.errors.length})`;
  status.className = `pill ${ok ? 'ok' : 'bad'}`;
  const dirty = current !== null && current !== saved;
  $<HTMLButtonElement>('save').disabled = !(dirty && ok);
  $<HTMLButtonElement>('revert').disabled = !dirty;
  $('save-status').textContent = dirty ? 'Có thay đổi chưa lưu' : '';
}

async function save(): Promise<void> {
  if (!current || !saved) return;
  const r = await validateEdited(source, current.project, current.tags);
  if (!r.valid || r.warnings.length) return renderIssues(r.errors, r.warnings);
  try {
    if (serialize(current.project) !== serialize(saved.project))
      await writeProjectFile('project.json', serialize(current.project));
    if (serialize(current.tags) !== serialize(saved.tags))
      await writeProjectFile(current.project.tagFile, serialize(current.tags));
    saved = current;
    $('save-status').textContent = `Đã lưu lúc ${new Date().toLocaleTimeString('vi-VN')}`;
  } catch (e) {
    $('save-status').textContent = `Lỗi khi lưu: ${String(e)}`;
  }
  await runValidation();
}

// ---------- Thiết bị ----------
function deviceBase(): string | null {
  const r = normalizeDevice($<HTMLInputElement>('device-address').value);
  $('device-status').textContent = r.ok ? '' : r.error;
  return r.ok ? r.base : null;
}

async function checkDeviceUi(): Promise<void> {
  const base = deviceBase();
  if (!base) return;
  saveDevice($<HTMLInputElement>('device-address').value.trim());
  $('device-status').textContent = `Đang kết nối ${base}…`;
  const r = await checkDevice(base);
  const dl = $('device-info');
  if (!r.ok) {
    $('device-status').textContent = r.error;
    dl.replaceChildren();
    return;
  }
  $('device-status').textContent = `Kết nối được ${base}`;
  const i = r.info;
  const rows: Array<[string, string]> = [
    ['Runtime', `${i.runtimeVersion ?? '?'} (giao thức ${i.protocolVersion ?? '?'})`],
    ['Phiên đang mở', `${i.clients ?? '?'} / ${i.maxClients ?? '?'}`],
    [
      'Project trên thiết bị',
      `${i.project?.status ?? '?'}${i.project?.projectId ? ` · ${i.project.projectId} ${i.project.projectVersion}` : ''}`,
    ],
  ];
  dl.replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
}

// ---------- Xem trước ----------
const PREVIEW_LABEL: Record<string, string> = {
  connecting: 'Đang kết nối…',
  open: 'Đã mở',
  live: 'Trực tuyến',
  offline: 'Mất kết nối',
  full: 'Thiết bị đầy 10 phiên — tự thử lại sau 30 s',
  incompatible: 'Giao thức không tương thích',
  stopped: 'Đã dừng',
};

async function startPreview(): Promise<void> {
  const base = deviceBase();
  const status = $('preview-status');
  if (!lastValid) {
    status.textContent = 'Project chưa hợp lệ';
    return;
  }
  if (!base) {
    status.textContent = 'Nhập địa chỉ thiết bị ở tab Thiết bị';
    return;
  }
  const screen = lastValid.screens[lastValid.project.entryScreen];
  const svg = await source.readText(screen.screen.svgFile);
  if (svg === null) {
    status.textContent = `Không đọc được ${screen.screen.svgFile}`;
    return;
  }
  preview.onState = (s) => {
    status.textContent = PREVIEW_LABEL[s] ?? s;
    status.className = `pill ${s === 'live' ? 'ok' : s === 'connecting' || s === 'open' ? '' : 'bad'}`;
    $('preview-retry').hidden = s !== 'full' && s !== 'offline';
  };
  const tagTypes = Object.fromEntries(lastValid.tags.tags.map((t) => [t.id, t.type]));
  const missing = preview.start($('preview-host'), svg, screen, base, tagTypes);
  if (missing.length) console.warn('elementUid không có trong SVG:', missing);
  $<HTMLButtonElement>('preview-start').disabled = true;
  $<HTMLButtonElement>('preview-stop').disabled = false;
}

function stopPreview(): void {
  preview.stop();
  $('preview-status').textContent = 'Đã dừng';
  $('preview-status').className = 'pill';
  $<HTMLButtonElement>('preview-start').disabled = false;
  $<HTMLButtonElement>('preview-stop').disabled = true;
}

// ---------- Giới thiệu (giữ từ Sprint 0) ----------
async function renderEnv(): Promise<void> {
  const ua = navigator.userAgent;
  const rows: Array<[string, string]> = [
    ['WebView', (/Edg\/([\d.]+)/.exec(ua) ?? /Chrome\/([\d.]+)/.exec(ua))?.[1] ?? ua],
  ];
  if (insideTauri) {
    const info = await invoke<{ name: string; version: string; tauri: string }>('app_info');
    rows.unshift(['Ứng dụng', `${info.name} ${info.version}`], ['Tauri', info.tauri]);
  } else {
    rows.unshift(['Chế độ', 'Chạy ngoài Tauri (chỉ giao diện, không có Rust backend)']);
  }
  $('env').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));
}

// ---------- Nối sự kiện ----------
$('open').addEventListener('click', () => void openProject());
$('project-form').addEventListener('input', onFormChange);
$('tags').addEventListener('input', onFormChange);
$('tags').addEventListener('change', onFormChange);
$('tag-add').addEventListener('click', () => {
  if (!saved) return;
  $('tags')
    .querySelector('tbody')!
    .append(tagRow({ id: '', type: 'FLOAT32', source: { kind: 'mock', signal: '' } }));
  onFormChange();
});
$('save').addEventListener('click', () => void save());
$('revert').addEventListener('click', () => {
  current = saved;
  renderForm();
  void runValidation();
});
$('device-address').setAttribute('value', loadDevice() ?? '');
$('device-form').addEventListener('submit', (e) => {
  e.preventDefault();
  void checkDeviceUi();
});
$('device-open-web').addEventListener('click', () => {
  const base = deviceBase();
  if (base)
    void openDeviceWeb(`${base}/`).catch((e) => ($('device-status').textContent = String(e)));
});
$('preview-start').addEventListener('click', () => void startPreview());
$('preview-stop').addEventListener('click', stopPreview);
$('preview-retry').addEventListener('click', () => preview.retryNow());
$('project-form').hidden = true;
void renderEnv();
