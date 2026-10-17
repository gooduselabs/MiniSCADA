// Mục tiêu fuzz `project-json` (T058): validateProject của @mat/project-schema trên project đột biến (mọi định dạng
// 0.1 đến 1.0; kho mầm tests/fuzz-corpus/project-json.json). Bất biến:
//  - không ném ngoại lệ (đầu vào xấu chỉ ra lỗi kiểm tra);
//  - valid ⇔ errors rỗng; mã lỗi thuộc ERROR_CODES (E_*), cảnh báo là W_*; issue có file, path, message là chuỗi;
//  - tất định: cứ 16 ca, chạy lại cho cùng dãy mã;
//  - project hợp lệ: không có đối tượng project nạp nào bị thiếu (valid ⇒ có project/project02/project03).
import { installDom } from '../../svg-import/chrome-util.mjs';
import { dictionaryOf, int, loadCorpus, mutateJson, mutateText, pick } from '../ts-lib.mjs';

installDom();
const ps = await import('../../../packages/project-schema/src/index.ts');

export async function setup() {
  const projects = loadCorpus('project-json.json');
  const parsed = [];
  for (const p of projects)
    for (const [rel, text] of Object.entries(p.files))
      if (rel.endsWith('.json'))
        try {
          parsed.push(JSON.parse(text.replace(/^\ufeff/, '')));
        } catch {
          // mầm JSON hỏng có chủ đích
        }
  return { projects, dict: dictionaryOf(parsed), parsed };
}

export function generate(ctx, r) {
  const base = pick(r, ctx.projects);
  const files = { ...base.files };
  const names = Object.keys(files).sort();
  const edits = r() < 0.7 ? 1 : int(r, 2, 4);
  for (let k = 0; k < edits; k++) {
    const rel = r() < 0.4 && names.includes('project.json') ? 'project.json' : pick(r, names);
    const text = files[rel];
    if (text === undefined) continue;
    const op = r();
    if (op < 0.04) {
      delete files[rel];
      continue;
    }
    if (op < 0.07) {
      // thêm tệp lạ (đường dẫn tham chiếu sai, hoa thường)
      files[pick(r, [rel.toUpperCase(), rel + '.bak', 'x/' + rel, rel.replace('.json', '.JSON')])] =
        text;
      continue;
    }
    if (!rel.endsWith('.json') || op < 0.2) {
      files[rel] = mutateText(text, r);
      continue;
    }
    let doc;
    try {
      doc = JSON.parse(text.replace(/^\ufeff/, ''));
    } catch {
      files[rel] = mutateText(text, r);
      continue;
    }
    const donor = pick(r, ctx.parsed);
    const m = mutateJson(doc, r, ctx.dict, donor);
    files[rel] = m === undefined ? '' : JSON.stringify(m, null, r() < 0.5 ? 2 : 0);
  }
  return { base: base.name, files };
}

const codesOf = (res) =>
  JSON.stringify([res.valid, res.errors.map((e) => e.code), res.warnings.map((w) => w.code)]);
let n = 0;

export async function check(_ctx, input) {
  const problems = [];
  const counters = [];
  const src = new ps.MemorySource(input.files);
  const res = await ps.validateProject(src);
  if (typeof res.valid !== 'boolean' || !Array.isArray(res.errors) || !Array.isArray(res.warnings))
    return { problems: ['kết quả sai dạng'] };
  if (res.valid !== (res.errors.length === 0)) problems.push('valid lệch với errors');
  for (const e of res.errors) {
    if (!ps.ERROR_CODES.includes(e.code)) problems.push(`mã lỗi lạ: ${e.code}`);
    if (typeof e.file !== 'string' || typeof e.path !== 'string' || typeof e.message !== 'string')
      problems.push(`issue sai dạng: ${JSON.stringify(e)}`);
  }
  for (const w of res.warnings)
    if (!/^W_[A-Z0-9_]+$/.test(w.code)) problems.push(`mã cảnh báo lạ: ${w.code}`);
  if (
    res.valid &&
    !['project', 'project02', 'project03', 'project04', 'project05', 'project10'].some(
      (k) => res[k],
    )
  )
    problems.push('hợp lệ nhưng không có project nạp');
  if (n++ % 16 === 0) {
    const again = await ps.validateProject(new ps.MemorySource(input.files));
    if (codesOf(again) !== codesOf(res)) problems.push('không tất định: lần hai khác lần một');
  }
  counters.push(res.valid ? 'valid' : 'invalid');
  if (!res.valid) counters.push('code:' + res.errors[0].code);
  return { problems, counters };
}
