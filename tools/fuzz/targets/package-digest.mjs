// Mục tiêu fuzz `package-digest` (T058): phía TS của gói .matscada là digest nội dung (packages/project-schema/src/
// package-digest.ts; bộ đọc gói chỉ có ở C++ và Rust). Danh sách tệp lấy từ kho mầm project-json rồi đột biến (đường
// dẫn Unicode, ký tự điều khiển, surrogate lẻ, trùng, kích thước và mã băm sai). Bất biến:
//  - danh sách hợp lệ theo bộ kiểm tham chiếu viết riêng ở đây: digestText không ném và bằng văn bản tham chiếu (sắp
//    theo điểm mã), không phụ thuộc thứ tự đầu vào; packageDigest = sha256 của văn bản đó;
//  - danh sách sai: ném Error (không trả kết quả);
//  - compareUtf8 cùng dấu với so điểm mã.
import { createHash } from 'node:crypto';
import { int, loadCorpus, pick } from '../ts-lib.mjs';

const ps = await import('../../../packages/project-schema/src/index.ts');
const sha = (data) => createHash('sha256').update(data).digest('hex');

export async function setup() {
  const projects = loadCorpus('project-json.json');
  const lists = projects.map((p) =>
    Object.entries(p.files).map(([path, text]) => ({
      path,
      size: Buffer.byteLength(text),
      sha256: sha(Buffer.from(text)),
    })),
  );
  return { lists };
}

const PATHS = ['a', 'A', 'a/b', 'ä', 'á', 'Đ/x.json', '😀.svg', 'z', ' ', 'a b', 'a\u0000', 'a\u001f', 'a\u007f', '\ud800', 'x\udc00', '😀', 'a/../b', '', 'ﬀ', '￿']; // prettier-ignore

export function generate(ctx, r) {
  const files = structuredClone(pick(r, ctx.lists)).slice(0, int(r, 0, 40));
  const n = int(r, 0, 4);
  for (let k = 0; k < n; k++) {
    const i = files.length ? int(r, 0, files.length - 1) : 0;
    const f = files[i];
    const op = int(r, 0, 9);
    const path = typeof f?.path === 'string' ? f.path : '';
    if (op === 0 || !f)
      files.push({ path: pick(r, PATHS), size: int(r, 0, 1e6), sha256: sha(String(r())) });
    else if (op === 1) f.path = pick(r, PATHS) + (r() < 0.5 ? path : '');
    else if (op === 2) files.push({ ...f });
    else if (op === 3) f.size = pick(r, [-1, 0.5, 2 ** 53, 2 ** 53 - 1, NaN, '5', null, 1e21]);
    else if (op === 4)
      f.sha256 = pick(r, [
        f.sha256.toUpperCase(),
        f.sha256.slice(1),
        '',
        f.sha256 + '0',
        'g'.repeat(64),
      ]);
    else if (op === 5) f.path = pick(r, [1, null, undefined, ['a']]);
    else if (op === 6) f.path = path.toUpperCase();
    else if (op === 7) files.reverse();
    else if (op === 8) f.path = path + pick(r, PATHS);
    else files.splice(i, 1);
  }
  const order = files.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { files, order, pair: [pick(r, PATHS), pick(r, PATHS)] };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const wellFormed = (s) => s.isWellFormed();
const cmpCp = (a, b) => {
  const x = Array.from(a, (c) => c.codePointAt(0));
  const y = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

function reference(files) {
  for (const f of files) {
    if (typeof f.path !== 'string' || f.path === '' || CONTROL.test(f.path) || !wellFormed(f.path))
      return null;
    if (!Number.isSafeInteger(f.size) || f.size < 0) return null;
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) return null;
  }
  const sorted = [...files].sort((a, b) => cmpCp(a.path, b.path));
  for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].path === sorted[i].path) return null;
  return sorted.map((f) => `${f.sha256} ${f.size} ${f.path}\n`).join('');
}

const sgn = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);

export async function check(_ctx, input) {
  const problems = [];
  const counters = [];
  const { files, order, pair } = input;
  const want = reference(files);
  let got = null;
  let threw = null;
  try {
    got = ps.digestText(files);
  } catch (e) {
    threw = e;
  }
  if (want === null) {
    counters.push('rejected');
    if (threw === null) problems.push('danh sách sai mà digestText không ném');
    else if (!(threw instanceof Error) || threw instanceof TypeError || threw instanceof RangeError)
      problems.push(`ném lỗi không phải lỗi kiểm tra: ${threw?.stack ?? threw}`);
  } else {
    counters.push('accepted');
    if (threw !== null)
      problems.push(`danh sách đúng mà digestText ném: ${threw?.message ?? threw}`);
    else {
      if (got !== want) problems.push('văn bản digest khác tham chiếu');
      const shuffled = ps.digestText(order.map((i) => files[i]));
      if (shuffled !== got) problems.push('digest phụ thuộc thứ tự đầu vào');
      const d = await ps.packageDigest(files, (b) => sha(b));
      if (d !== `sha256:${sha(Buffer.from(want))}`)
        problems.push('packageDigest khác sha256 của văn bản');
    }
  }
  if (
    sgn(ps.compareUtf8(pair[0], pair[1])) !== sgn(cmpCp(pair[0], pair[1])) &&
    pair.every(wellFormed)
  )
    problems.push(`compareUtf8 lệch so điểm mã: ${JSON.stringify(pair)}`);
  return { problems, counters };
}
