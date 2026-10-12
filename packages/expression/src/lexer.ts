// Bộ tách từ (contract expression-language §2). Làm việc trên mảng code point để span tính theo ký tự Unicode.
// Chế độ chặt (parser): dừng ở lỗi đầu tiên, trả token 'lexerr'. Chế độ lỏng (tokens()): ghi token 'lexerr'
// rồi đi tiếp để tô màu phần còn lại.

export type Tok =
  | { k: 'num'; s: number; e: number; v: number }
  | { k: 'str'; s: number; e: number; text: string }
  | { k: 'word'; s: number; e: number; text: string }
  | { k: 'op'; s: number; e: number; text: string }
  | { k: 'end'; s: number; e: number }
  | { k: 'lexerr'; s: number; e: number };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isAlpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));
const isWord = (c: string | undefined): boolean => isDigit(c) || isAlpha(c) || c === '_';
const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\r' || c === '\n';

const TWO = new Set(['||', '&&', '==', '!=', '<=', '>=']);
const ONE = '+-*/%<>!?:(),';

export function lex(cps: readonly string[], tolerant = false): Tok[] {
  const toks: Tok[] = [];
  const n = cps.length;
  let i = 0;
  for (;;) {
    while (i < n && isSpace(cps[i]!)) i++;
    if (i >= n) {
      toks.push({ k: 'end', s: n, e: n });
      return toks;
    }
    const c = cps[i]!;
    // Mỗi nhánh trả vị trí lỗi [s, e) hoặc tiếp tục.
    let errEnd: number;
    if (isDigit(c)) {
      let j = i;
      while (isDigit(cps[j])) j++;
      if (cps[j] === '.' && isDigit(cps[j + 1])) {
        j++;
        while (isDigit(cps[j])) j++;
      }
      if (cps[j] === 'e' || cps[j] === 'E') {
        let k = j + 1;
        if (cps[k] === '+' || cps[k] === '-') k++;
        if (isDigit(cps[k])) {
          while (isDigit(cps[k])) k++;
          j = k;
        }
      }
      const v = Number(cps.slice(i, j).join(''));
      if (!Number.isFinite(v)) errEnd = j;
      else {
        toks.push({ k: 'num', s: i, e: j, v });
        i = j;
        continue;
      }
    } else if (isAlpha(c)) {
      let j = i + 1;
      while (isWord(cps[j])) j++;
      while (cps[j] === '.' && isWord(cps[j + 1])) {
        j += 2;
        while (isWord(cps[j])) j++;
      }
      toks.push({ k: 'word', s: i, e: j, text: cps.slice(i, j).join('') });
      i = j;
      continue;
    } else if (c === '"') {
      let j = i + 1;
      let text = '';
      let bad = -1;
      for (;;) {
        if (j >= n) {
          bad = n;
          break;
        }
        const d = cps[j]!;
        if (d === '"') break;
        if (d === '\\') {
          const nx = cps[j + 1];
          if (nx === '"' || nx === '\\') {
            text += nx;
            j += 2;
            continue;
          }
          // thoát lạ: lỗi tại [j, j+2) (hoặc tới hết chuỗi)
          toks.push({ k: 'lexerr', s: j, e: Math.min(j + 2, n) });
          bad = -2;
          break;
        }
        if ((d.codePointAt(0) ?? 0) < 0x20) {
          toks.push({ k: 'lexerr', s: j, e: j + 1 });
          bad = -2;
          break;
        }
        text += d;
        j++;
      }
      if (bad === -2) {
        if (!tolerant) return toks;
        const last = toks[toks.length - 1]!;
        i = last.e;
        continue;
      }
      if (bad >= 0)
        errEnd = bad; // chưa đóng: lỗi [i, n)
      else {
        toks.push({ k: 'str', s: i, e: j + 1, text });
        i = j + 1;
        continue;
      }
    } else {
      const two = c + (cps[i + 1] ?? '');
      if (TWO.has(two)) {
        toks.push({ k: 'op', s: i, e: i + 2, text: two });
        i += 2;
        continue;
      }
      if (ONE.includes(c)) {
        toks.push({ k: 'op', s: i, e: i + 1, text: c });
        i++;
        continue;
      }
      errEnd = i + 1;
    }
    toks.push({ k: 'lexerr', s: i, e: errEnd });
    if (!tolerant) return toks;
    i = errEnd;
  }
}
