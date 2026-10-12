// T011 (audit C-02): mỗi file schemas/*.schema.json hợp lệ theo meta-schema draft-07, và chỉ dùng từ
// khóa của draft-07: một từ khóa gõ sai (ví dụ "maxItem") bị cả bộ kiểm tra TS lẫn C++ bỏ qua mà
// không báo. Meta-schema: third_party/json-schema (third_party/LICENSES.md).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';
import { RUNTIME_VERSION, SUPPORTED_SCHEMA, SUPPORTED_SCHEMA_02 } from './codes.ts';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
const meta = read('third_party/json-schema/draft-07.schema.json') as Schema;
// Bản chặt: mọi schema con chỉ được có từ khóa draft-07 (`$ref: "#"` của meta-schema trỏ về gốc này).
// Bản sao riêng: @cfworker ghi URI tuyệt đối vào từng schema con khi nạp.
const strict = {
  ...(read('third_party/json-schema/draft-07.schema.json') as object),
  $id: 'urn:mat:draft-07-strict',
  additionalProperties: false,
} as Schema;
const files = readdirSync(resolve(ROOT, 'schemas')).filter((f) => f.endsWith('.schema.json'));

describe('schemas/*.schema.json theo meta-schema draft-07', () => {
  // Feature 005 (T087): manifest của gói .matscada, chỉ bản C++ và Rust dùng; cũng phải đúng draft-07.
  it('đủ 9 schema (0.2: thêm connections, value-table, watch-table)', () => {
    expect([...files].sort()).toEqual([
      'binding.schema.json',
      'connections.schema.json',
      'logging.schema.json',
      'package-manifest.schema.json',
      'project.schema.json',
      'screen.schema.json',
      'tag.schema.json',
      'value-table.schema.json',
      'watch-table.schema.json',
    ]);
  });

  // T032: schemas/0.1 là bản sao đóng băng của schema 0.1 (SHA-256 của bản trước khi lên 0.2.0).
  it('schemas/0.1/*.schema.json giống từng byte bản 0.1 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'project.schema.json': 'd5d071ffe2ab96248732e8c9803d977d306c05a6f654074cc9b50626372d86f3',
      'tag.schema.json': '96b7a705bd86f348dc9e3ed7015a3af80ef4d93465a8656c2cad5b39e4f8cae3',
      'screen.schema.json': 'b203f936d07c0db70c2984ef521732550284710db336acf820de00d3e51ad460',
      'binding.schema.json': 'c45e96057db1c9bb21acf54570f14431b32a311570474b99089e56547d566c7e',
      'logging.schema.json': '7f2bd679e22bb208912f7bfb1a571d0e28e6fd390a56f6a910f72cd4131c4e81',
    };
    expect(readdirSync(resolve(ROOT, 'schemas/0.1')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.1', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  it('`$id` của schema 0.2 theo phiên bản; bản đóng băng giữ 0.1', () => {
    for (const f of files.filter((x) => x !== 'package-manifest.schema.json'))
      expect(read(`schemas/${f}`).$id, f).toMatch(/\/0\.2\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.1')))
      expect(read(`schemas/0.1/${f}`).$id, f).toMatch(/\/0\.1\.json$/);
  });

  for (const f of readdirSync(resolve(ROOT, 'schemas/0.1'))) {
    it(`0.1/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/0.1/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  for (const f of files) {
    it(`${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  it('bản chặt bắt được từ khóa gõ sai', () => {
    const v = new Validator(strict, '7', false);
    expect(
      v.validate({ type: 'object', properties: { a: { type: 'array', maxItem: 3 } } }).valid,
    ).toBe(false);
    expect(
      v.validate({ type: 'object', properties: { a: { type: 'array', maxItems: 3 } } }).valid,
    ).toBe(true);
  });
});

// Audit C-12: schemas/protocol-version.json là nguồn tham chiếu; mã TS và C++ phải khớp nó.
describe('schemas/protocol-version.json', () => {
  const v = read('schemas/protocol-version.json') as { live: string; project: string[] };

  it('các phiên bản schema project được bộ kiểm tra chấp nhận (0.1 và 0.2)', () => {
    expect(v.project).toEqual(['0.1', '0.2']);
    const accepts = (version: string) =>
      SUPPORTED_SCHEMA.test(version) || SUPPORTED_SCHEMA_02.test(version);
    for (const p of v.project) {
      expect(accepts(`${p}.0`)).toBe(true);
      expect(accepts(`${p}.7`)).toBe(true);
    }
    expect(accepts('0.3.0')).toBe(false);
    expect(accepts('1.0.0')).toBe(false);
  });

  it('phiên bản runtime và giao thức giống bản C++', () => {
    const header = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
    const cpp = (src: string, name: string) => new RegExp(`${name} = "([^"]+)"`).exec(src)?.[1];
    expect(cpp(header('core/project-manager/project_validator.hpp'), 'kRuntimeVersion')).toBe(
      RUNTIME_VERSION,
    );
    expect(cpp(header('server/websocket/live_hub.hpp'), 'kLiveProtocolVersion')).toBe(v.live);
  });
});
