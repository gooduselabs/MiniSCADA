// Tiền xử lý trước khi parse (Constitution V; research R3; contract svg-import §1).
// Bộ quét ký tự (không regex): kiểm byte, mã hóa UTF-8, bỏ BOM, bỏ PI ở phần mở đầu, thay entity
// namespace Adobe đã biết rồi bỏ DOCTYPE; mọi entity khác bị từ chối (E_IMPORT_DTD). DTD không bao giờ
// được đưa cho parser XML.

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type PrescanResult =
  | {
      ok: true;
      text: string;
      /** Số lần thay `&ns_*;` bằng URI. */
      entities: number;
      dtdRemoved: boolean;
      /** Đích của các PI đã bỏ (không tính khai báo `xml`). */
      pis: string[];
    }
  | { ok: false; code: 'E_IMPORT_LIMIT' | 'E_IMPORT_ENCODING' | 'E_IMPORT_DTD'; message: string };

/** Entity namespace của Illustrator "Save As" cũ: tên và URI duy nhất được chấp nhận. */
const ADOBE_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['ns_svg', 'http://www.w3.org/2000/svg'],
  ['ns_extend', 'http://ns.adobe.com/Extensibility/1.0/'],
  ['ns_ai', 'http://ns.adobe.com/AdobeIllustrator/10.0/'],
  ['ns_graphs', 'http://ns.adobe.com/Graphs/1.0/'],
  ['ns_vars', 'http://ns.adobe.com/Variables/1.0/'],
  ['ns_imrep', 'http://ns.adobe.com/ImageReplacement/1.0/'],
  ['ns_sfw', 'http://ns.adobe.com/SaveForWeb/1.0/'],
  ['ns_custom', 'http://ns.adobe.com/GenericCustomNamespace/1.0/'],
  ['ns_adobe_xpath', 'http://ns.adobe.com/XPath/1.0/'],
  ['ns_flows', 'http://ns.adobe.com/Flows/1.0/'],
  ['ns_xlink', 'http://www.w3.org/1999/xlink'],
]);

const isWs = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;
const dtdError = (message: string): PrescanResult => ({ ok: false, code: 'E_IMPORT_DTD', message });

function skipWs(s: string, i: number): number {
  while (i < s.length && isWs(s.charCodeAt(i))) i++;
  return i;
}

/** Chỉ số ngay sau `quote` đóng bắt đầu từ i (i trỏ sau nháy mở); -1 nếu không đóng. */
function endOfQuoted(s: string, i: number, quote: number): number {
  const j = s.indexOf(String.fromCharCode(quote), i);
  return j < 0 ? -1 : j + 1;
}

function decodeBytes(input: Uint8Array): string | PrescanResult {
  if (input.length >= 2) {
    const a = input[0];
    const b = input[1];
    if ((a === 0xff && b === 0xfe) || (a === 0xfe && b === 0xff))
      return { ok: false, code: 'E_IMPORT_ENCODING', message: 'Chỉ nhận UTF-8 (phát hiện UTF-16)' };
    if ((a === 0x3c && b === 0x00) || (a === 0x00 && b === 0x3c))
      return {
        ok: false,
        code: 'E_IMPORT_ENCODING',
        message: 'Chỉ nhận UTF-8 (phát hiện UTF-16 không BOM)',
      };
  }
  if (
    input.length >= 4 &&
    input[0] === 0 &&
    input[1] === 0 &&
    input[2] === 0xfe &&
    input[3] === 0xff
  )
    return { ok: false, code: 'E_IMPORT_ENCODING', message: 'Chỉ nhận UTF-8 (phát hiện UTF-32)' };
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(input); // tự bỏ BOM UTF-8
  } catch {
    return { ok: false, code: 'E_IMPORT_ENCODING', message: 'Chuỗi byte UTF-8 không hợp lệ' };
  }
}

/** Phân tích khai báo `<?xml ... ?>`: trả false nếu `encoding` khác UTF-8. */
function declEncodingOk(decl: string): boolean {
  const k = decl.indexOf('encoding');
  if (k < 0) return true;
  let i = skipWs(decl, k + 8);
  if (decl.charCodeAt(i) !== 61) return true;
  i = skipWs(decl, i + 1);
  const q = decl.charCodeAt(i);
  if (q !== 34 && q !== 39) return true;
  const end = decl.indexOf(String.fromCharCode(q), i + 1);
  if (end < 0) return false;
  return decl.slice(i + 1, end).toLowerCase() === 'utf-8';
}

interface DoctypeOk {
  end: number;
  entities: Map<string, string>;
}

/** Quét `<!DOCTYPE ...>` bắt đầu tại i; trả vị trí sau `>` và entity khai báo, hoặc kết quả lỗi. */
function scanDoctype(s: string, i: number): DoctypeOk | PrescanResult {
  const entities = new Map<string, string>();
  let j = i + 9; // sau "<!DOCTYPE"
  // tên và ID ngoài tới '[' hoặc '>'
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 34 || c === 39) {
      j = endOfQuoted(s, j + 1, c);
      if (j < 0) return dtdError('DOCTYPE không đóng');
    } else if (c === 91) {
      break;
    } else if (c === 62) {
      return { end: j + 1, entities };
    } else j++;
  }
  if (j >= s.length) return dtdError('DOCTYPE không đóng');
  j++; // sau '['
  for (;;) {
    j = skipWs(s, j);
    if (j >= s.length) return dtdError('DOCTYPE không đóng');
    const c = s.charCodeAt(j);
    if (c === 93) {
      j = skipWs(s, j + 1);
      if (s.charCodeAt(j) !== 62) return dtdError('DOCTYPE không đóng');
      return { end: j + 1, entities };
    }
    if (c === 37) return dtdError('Tham chiếu thực thể tham số trong DTD không được chấp nhận');
    if (s.startsWith('<!--', j)) {
      const e = s.indexOf('-->', j + 4);
      if (e < 0) return dtdError('Chú thích DTD không đóng');
      j = e + 3;
      continue;
    }
    if (s.startsWith('<?', j)) {
      const e = s.indexOf('?>', j + 2);
      if (e < 0) return dtdError('PI trong DTD không đóng');
      j = e + 2;
      continue;
    }
    if (s.startsWith('<!ENTITY', j)) {
      j = skipWs(s, j + 8);
      if (s.charCodeAt(j) === 37) return dtdError('Thực thể tham số không được chấp nhận');
      let k = j;
      while (k < s.length && !isWs(s.charCodeAt(k)) && s.charCodeAt(k) !== 62) k++;
      const name = s.slice(j, k);
      j = skipWs(s, k);
      const q = s.charCodeAt(j);
      if (q !== 34 && q !== 39)
        return dtdError(`Thực thể "${name}" dùng SYSTEM/PUBLIC hoặc cú pháp lạ`);
      const e = endOfQuoted(s, j + 1, q);
      if (e < 0) return dtdError('Giá trị thực thể không đóng');
      const value = s.slice(j + 1, e - 1);
      if (ADOBE_ENTITIES.get(name) !== value)
        return dtdError(`Thực thể "${name}" không nằm trong bảng Adobe đã biết`);
      j = skipWs(s, e);
      if (s.charCodeAt(j) !== 62) return dtdError('Khai báo ENTITY không đóng');
      entities.set(name, value);
      j++;
      continue;
    }
    if (s.startsWith('<!', j)) {
      // ELEMENT, ATTLIST, NOTATION: vô hại khi DTD bị bỏ; bỏ qua tới '>' (có tính chuỗi nháy)
      let k = j + 2;
      while (k < s.length) {
        const d = s.charCodeAt(k);
        if (d === 34 || d === 39) {
          k = endOfQuoted(s, k + 1, d);
          if (k < 0) return dtdError('Khai báo DTD không đóng');
        } else if (d === 62) break;
        else k++;
      }
      if (k >= s.length) return dtdError('Khai báo DTD không đóng');
      j = k + 1;
      continue;
    }
    return dtdError('Nội dung lạ trong DTD');
  }
}

/** Tiền xử lý đầu vào thô; không parse XML. `maxBytes` mặc định 5 MiB. */
export function prescan(
  input: Uint8Array | string,
  maxBytes: number = MAX_IMPORT_BYTES,
): PrescanResult {
  // 1. Byte: kiểm trước mọi việc khác (chuỗi UTF-16 có độ dài >= số byte UTF-8 / 3 nhưng >= 1 byte mỗi đơn vị).
  if (input.length > maxBytes)
    return { ok: false, code: 'E_IMPORT_LIMIT', message: `File lớn hơn ${maxBytes} byte` };
  let s: string;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).length > maxBytes)
      return { ok: false, code: 'E_IMPORT_LIMIT', message: `File lớn hơn ${maxBytes} byte` };
    s = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  } else {
    const d = decodeBytes(input);
    if (typeof d !== 'string') return d;
    s = d;
  }

  // 2. Phần mở đầu: PI, chú thích, DOCTYPE.
  const pis: string[] = [];
  let entities = new Map<string, string>();
  let dtdRemoved = false;
  let i = 0;
  for (;;) {
    i = skipWs(s, i);
    if (s.startsWith('<?', i)) {
      const e = s.indexOf('?>', i + 2);
      if (e < 0) break; // để parser báo lỗi
      let t = i + 2;
      while (t < e && !isWs(s.charCodeAt(t))) t++;
      const target = s.slice(i + 2, t);
      if (target === 'xml') {
        if (!declEncodingOk(s.slice(t, e)))
          return { ok: false, code: 'E_IMPORT_ENCODING', message: 'Khai báo encoding khác UTF-8' };
      } else pis.push(target);
      i = e + 2;
    } else if (s.startsWith('<!--', i)) {
      const e = s.indexOf('-->', i + 4);
      if (e < 0) break;
      i = e + 3;
    } else if (s.startsWith('<!DOCTYPE', i)) {
      const r = scanDoctype(s, i);
      if ('ok' in r) return r;
      entities = r.entities;
      dtdRemoved = true;
      i = r.end;
    } else break;
  }
  let rest = s.slice(i);

  // 3. Thay entity Adobe bằng URI (DTD đã bỏ nên parser sẽ không thấy ENTITY).
  let replaced = 0;
  for (const [name, value] of entities) {
    const token = '&' + name + ';';
    const parts = rest.split(token);
    if (parts.length > 1) {
      replaced += parts.length - 1;
      rest = parts.join(value);
    }
  }
  return { ok: true, text: rest, entities: replaced, dtdRemoved, pis };
}
