// NodeId dạng chuỗi của Tag OPC UA (feature 019, specs/019-driver-opcua/spec.md D4):
// `[ns=<0–65535>;](i=<0–4294967295>|s=<chuỗi>|g=<GUID>|b=<base64>)`. Không có `ns=` là namespace 0; `nsu=`
// chưa hỗ trợ. Bản C++ giống hệt: drivers/opcua/node_id.cpp; vector chung tests/opcua-vectors/nodeid.json.

export type OpcUaIdType = 'i' | 's' | 'g' | 'b';
export type OpcUaNodeIdErrorCode = 'E_ADDR_SYNTAX' | 'E_ADDR_RANGE';

export type OpcUaNodeIdResult =
  | {
      ok: true;
      ns: number;
      idType: OpcUaIdType;
      /** i: số thập phân không số 0 đầu; g: chữ thường; s, b: nguyên văn. */
      id: string;
      /** Dạng chuẩn: ns=0 bỏ tiền tố. */
      normalized: string;
    }
  | { ok: false; error: OpcUaNodeIdErrorCode };

const DIGITS = /^[0-9]+$/;
const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Số thập phân (chỉ chữ số) trong [0, max]; null khi vượt. */
function decimal(s: string, max: number): number | null {
  const t = s.replace(/^0+(?=.)/, '');
  if (t.length > 10) return null;
  const v = Number(t);
  return v > max ? null : v;
}

export function parseOpcUaNodeId(address: string): OpcUaNodeIdResult {
  const syntax = { ok: false, error: 'E_ADDR_SYNTAX' } as const;
  const range = { ok: false, error: 'E_ADDR_RANGE' } as const;
  let rest = address;
  let ns = 0;
  if (rest.startsWith('ns=')) {
    const semi = rest.indexOf(';');
    if (semi < 0) return syntax;
    const n = rest.slice(3, semi);
    if (!DIGITS.test(n)) return syntax;
    const v = decimal(n, 65535);
    if (v === null) return range;
    ns = v;
    rest = rest.slice(semi + 1);
  }
  if (rest.length < 2 || rest[1] !== '=') return syntax;
  const kind = rest[0];
  const body = rest.slice(2);
  let id: string;
  switch (kind) {
    case 'i': {
      if (!DIGITS.test(body)) return syntax;
      const v = decimal(body, 4294967295);
      if (v === null) return range;
      id = String(v);
      break;
    }
    case 's':
      if (body.length === 0) return syntax;
      for (const ch of body) {
        const c = ch.codePointAt(0)!;
        if (c < 0x20 || c === 0x7f) return syntax;
      }
      id = body;
      break;
    case 'g':
      if (!GUID.test(body)) return syntax;
      id = body.toLowerCase();
      break;
    case 'b':
      if (body.length === 0 || body.length % 4 !== 0 || !B64.test(body)) return syntax;
      id = body;
      break;
    default:
      return syntax;
  }
  const idType = kind as OpcUaIdType;
  return {
    ok: true,
    ns,
    idType,
    id,
    normalized: `${ns === 0 ? '' : `ns=${ns};`}${idType}=${id}`,
  };
}
