// tokens(): phân loại để tô màu cú pháp, gợi ý và đổi tên Tag (FR-047). Chịu lỗi: không dừng ở token lạ.
import { lex } from './lexer.ts';
import type { Token, TokenKind } from './types.ts';

export function tokens(src: string): Token[] {
  const cps = Array.from(src);
  const toks = lex(cps, true).filter((t) => t.k !== 'end');
  const out: Token[] = [];
  const parenNames: string[] = [];
  const textOf = (s: number, e: number): string => cps.slice(s, e).join('');
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    let kind: TokenKind;
    switch (t.k) {
      case 'num':
        kind = 'number';
        break;
      case 'str':
        kind = 'string';
        break;
      case 'lexerr':
        kind = 'error';
        break;
      case 'op': {
        kind = t.text === '(' || t.text === ')' || t.text === ',' ? 'punctuation' : 'operator';
        if (t.text === ')') parenNames.pop();
        break;
      }
      case 'word': {
        const next = toks[i + 1];
        const prev = toks[i - 1];
        const isCall = !t.text.includes('.') && next?.k === 'op' && next.text === '(';
        if (isCall) {
          kind = 'function';
          parenNames.push(t.text);
        } else if (t.text === 'true' || t.text === 'false') kind = 'keyword';
        else if (
          !t.text.includes('.') &&
          prev?.k === 'op' &&
          prev.text === ',' &&
          next?.k === 'op' &&
          next.text === ')' &&
          parenNames[parenNames.length - 1] === 'text'
        )
          kind = 'table';
        else kind = 'tag';
        break;
      }
      default:
        continue;
    }
    // '(' của lời gọi hàm đã đẩy tên ở token từ; '(' lẻ đẩy chuỗi rỗng
    if (t.k === 'op' && t.text === '(') {
      const prev = toks[i - 1];
      const isCallParen = prev?.k === 'word' && !prev.text.includes('.');
      if (!isCallParen) parenNames.push('');
    }
    out.push({ kind, span: [t.s, t.e], text: textOf(t.s, t.e) });
  }
  return out;
}
