// Chỉ dùng trong test: bỏ khối `<!DOCTYPE …>` ở phần mở đầu của file thô của phần mềm vẽ (Illustrator, CorelDRAW,
// LibreOffice) và thay các entity chuỗi đã khai (`&ns_ai;` của Illustrator) như importer làm ở prescan, vì `parseSvg`
// từ chối DOCTYPE (F12). Tính chuỗi nháy và khối `[…]`. Fixture tin cậy, không dùng cho đầu vào lạ.
export function withoutDoctype(text: string): string {
  const start = text.indexOf('<!DOCTYPE');
  if (start < 0) return text;
  let depth = 0;
  for (let i = start + 9; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const e = text.indexOf(c, i + 1);
      if (e < 0) break;
      i = e;
    } else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) {
      let rest = text.slice(0, start) + text.slice(i + 1);
      const dtd = text.slice(start, i + 1);
      for (let k = dtd.indexOf('<!ENTITY'); k >= 0; k = dtd.indexOf('<!ENTITY', k + 8)) {
        const parts = dtd
          .slice(k + 8)
          .trimStart()
          .split('"');
        const name = parts[0].trim();
        if (parts.length > 2 && name !== '') rest = rest.split(`&${name};`).join(parts[1]);
      }
      return rest;
    }
  }
  return text;
}
