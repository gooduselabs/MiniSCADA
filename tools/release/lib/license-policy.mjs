// Chính sách license cho bản phân phối (feature 011, T057; FR-027, D16; Constitution VII "Ràng buộc công nghệ").
//
// classifyLicense(biểu thức) đọc biểu thức kiểu SPDX (`OR`, `AND`, `WITH`, ngoặc; `/` cũ của crates.io coi như `OR`)
// và trả { verdict, chosen }:
//   allowed      license cho phép link tĩnh trong sản phẩm thương mại khi giữ thông báo bản quyền;
//   conditional  copyleft mức tệp (MPL): dùng được khi không sửa mã của thư viện, phải nêu nơi lấy mã nguồn;
//   denied       copyleft mạnh hoặc mức thư viện (GPL, AGPL, LGPL khi link tĩnh, SSPL…): không được phân phối;
//   unknown      không khai báo, không đọc được, hoặc license lạ: phải rà tay rồi ghi đè trong third_party/LICENSES.md.
// `OR` lấy nhánh tốt nhất (người dùng được chọn license), `AND` lấy nhánh xấu nhất (phải tuân thủ cả hai).

const ALLOWED = new Set(
  [
    'MIT',
    'MIT-0',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    'Zlib',
    '0BSD',
    'Unlicense',
    'CC0-1.0',
    'CC-BY-4.0',
    'BlueOak-1.0.0',
    'Unicode-3.0',
    'Unicode-DFS-2016',
    'CDLA-Permissive-2.0',
    'BSL-1.0',
    'Python-2.0',
    'PostgreSQL',
    'curl',
    'X11',
    'NCSA',
    'LicenseRef-Public-Domain',
    // Phông chữ: SIL Open Font License cho phép nhúng và phân phối kèm phần mềm (không bán riêng phông).
    'OFL-1.1',
  ].map((s) => s.toLowerCase()),
);
const CONDITIONAL = new Set(['MPL-2.0', 'MPL-1.1'].map((s) => s.toLowerCase()));
const DENIED = /^(AGPL|GPL|LGPL|SSPL|EUPL|OSL|CPAL|RPL|CC-BY-NC|CC-BY-SA|Commons-Clause)/i;

const RANK = { allowed: 0, conditional: 1, unknown: 2, denied: 3 };

function tokenize(text) {
  const norm = text.replace(/\s*\/\s*/g, ' OR ');
  const tokens = [];
  const re = /\s*(\(|\)|[^\s()]+)/g;
  let m;
  while ((m = re.exec(norm)) !== null) {
    if (m[1]) tokens.push(m[1]);
  }
  return tokens;
}

function classifyId(id) {
  const key = id.toLowerCase().replace(/\+$/, '');
  if (ALLOWED.has(key)) return 'allowed';
  if (CONDITIONAL.has(key)) return 'conditional';
  if (DENIED.test(id)) return 'denied';
  return 'unknown';
}

function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (t, op) => typeof t === 'string' && t.toUpperCase() === op;
  function atom() {
    const t = tokens[i++];
    if (t === undefined) throw new Error('hết biểu thức');
    if (t === '(') {
      const r = or();
      if (tokens[i++] !== ')') throw new Error('thiếu )');
      return r;
    }
    if (t === ')' || isOp(t, 'AND') || isOp(t, 'OR') || isOp(t, 'WITH')) {
      throw new Error(`gặp ${t}`);
    }
    let text = t;
    if (isOp(peek(), 'WITH')) {
      i++;
      const exc = tokens[i++];
      if (!exc || exc === '(' || exc === ')') throw new Error('thiếu ngoại lệ sau WITH');
      text = `${t} WITH ${exc}`;
    }
    return { verdict: classifyId(t), chosen: text };
  }
  function and() {
    let r = atom();
    while (isOp(peek(), 'AND')) {
      i++;
      const b = atom();
      r = {
        verdict: RANK[b.verdict] > RANK[r.verdict] ? b.verdict : r.verdict,
        chosen: `${r.chosen} AND ${b.chosen}`,
      };
    }
    return r;
  }
  function or() {
    let r = and();
    while (isOp(peek(), 'OR')) {
      i++;
      const b = and();
      if (RANK[b.verdict] < RANK[r.verdict]) r = b;
    }
    return r;
  }
  const r = or();
  if (i !== tokens.length) throw new Error('thừa token');
  return r;
}

/**
 * @param {string|null|undefined} expr
 * @returns {{ verdict: 'allowed'|'conditional'|'denied'|'unknown', chosen: string|null }}
 */
export function classifyLicense(expr) {
  if (typeof expr !== 'string' || !expr.trim()) return { verdict: 'unknown', chosen: null };
  if (/^SEE LICENSE IN/i.test(expr.trim())) return { verdict: 'unknown', chosen: null };
  try {
    return parse(tokenize(expr.trim()));
  } catch {
    return { verdict: 'unknown', chosen: null };
  }
}

/** true khi biểu thức là một mã license SPDX đơn (không toán tử, không LicenseRef). */
export function isSimpleId(expr) {
  return (
    typeof expr === 'string' &&
    /^[A-Za-z0-9.+-]+$/.test(expr) &&
    !expr.startsWith('LicenseRef-') &&
    classifyId(expr) !== 'unknown'
  );
}
