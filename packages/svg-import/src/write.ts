// Bộ ghi SVG tuần tự riêng (research R6; FR-020, FR-022): thứ tự thuộc tính cố định, thoát ký tự cố định,
// duyệt không đệ quy, KHÔNG dùng XMLSerializer (kết quả khác nhau giữa jsdom và Chrome).
import { ATTR_RULES, PRESENTATION, SVG_NS, TEXT_ELEMENTS } from '@mat/svg-renderer';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const TAIL_ATTRS = ['transform', 'data-mat-uid', 'data-mat-name'];

const orderCache = new Map<string, Map<string, number>>();

/** Hạng của từng tên thuộc tính trong một phần tử: id, hình học, trình bày, transform, data-mat-*. */
function orderFor(tag: string): Map<string, number> {
  let m = orderCache.get(tag);
  if (m) return m;
  m = new Map<string, number>();
  let k = 0;
  m.set('id', k++);
  for (const name of ATTR_RULES.get(tag)?.keys() ?? []) if (!m.has(name)) m.set(name, k++);
  for (const name of PRESENTATION.keys()) if (!m.has(name)) m.set(name, k++);
  for (const name of TAIL_ATTRS) if (!m.has(name)) m.set(name, k++);
  orderCache.set(tag, m);
  return m;
}

function escAttr(v: string): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < v.length; i++) {
    let rep: string | null = null;
    switch (v.charCodeAt(i)) {
      case 38: rep = '&amp;'; break; // prettier-ignore
      case 60: rep = '&lt;'; break; // prettier-ignore
      case 62: rep = '&gt;'; break; // prettier-ignore
      case 34: rep = '&quot;'; break; // prettier-ignore
      case 9: rep = '&#9;'; break; // prettier-ignore
      case 10: rep = '&#10;'; break; // prettier-ignore
      case 13: rep = '&#13;'; break; // prettier-ignore
    }
    if (rep !== null) {
      out += v.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? v : out + v.slice(last);
}

function escText(v: string): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < v.length; i++) {
    let rep: string | null = null;
    switch (v.charCodeAt(i)) {
      case 38: rep = '&amp;'; break; // prettier-ignore
      case 60: rep = '&lt;'; break; // prettier-ignore
      case 62: rep = '&gt;'; break; // prettier-ignore
      case 13: rep = '&#13;'; break; // prettier-ignore
    }
    if (rep !== null) {
      out += v.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? v : out + v.slice(last);
}

function attrList(el: Element, isRoot: boolean): string {
  const order = orderFor(el.localName);
  const items: Array<{ name: string; value: string; rank: number }> = [];
  for (const a of Array.from(el.attributes)) {
    if (a.namespaceURI === XMLNS_NS) continue;
    const name = a.prefix ? `${a.prefix}:${a.localName}` : a.localName;
    items.push({ name, value: a.value, rank: order.get(name) ?? 100000 });
  }
  items.sort((x, y) => x.rank - y.rank || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  let out = isRoot ? ` xmlns="${SVG_NS}"` : '';
  for (const it of items) out += ` ${it.name}="${escAttr(it.value)}"`;
  return out;
}

type Task = { node: Node; inline: boolean } | { close: string; newline: boolean };

/** Ghi cây đã làm sạch thành chuỗi SVG tất định (kết thúc bằng xuống dòng). */
export function writeSvg(root: Element): string {
  const out: string[] = [];
  const stack: Task[] = [{ node: root, inline: false }];
  while (stack.length > 0) {
    const t = stack.pop()!;
    if ('close' in t) {
      out.push(`</${t.close}>`);
      if (t.newline) out.push('\n');
      continue;
    }
    const node = t.node;
    if (node.nodeType === 3 || node.nodeType === 4) {
      out.push(escText(node.nodeValue ?? ''));
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const name = el.localName;
    const textual = TEXT_ELEMENTS.has(name);
    const inline = t.inline || textual;
    const kids: Node[] = [];
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1) kids.push(c);
      else if (inline && (c.nodeType === 3 || c.nodeType === 4)) kids.push(c);
    }
    const nl = !t.inline;
    out.push(`<${name}${attrList(el, el === root)}`);
    if (kids.length === 0) {
      out.push('/>');
      if (nl) out.push('\n');
      continue;
    }
    out.push('>');
    if (!inline) out.push('\n');
    stack.push({ close: name, newline: nl });
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], inline });
  }
  return out.join('');
}
