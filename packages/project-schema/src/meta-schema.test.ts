// T011 (audit C-02): mỗi file schemas/*.schema.json hợp lệ theo meta-schema draft-07, và chỉ dùng từ
// khóa của draft-07: một từ khóa gõ sai (ví dụ "maxItem") bị cả bộ kiểm tra TS lẫn C++ bỏ qua mà
// không báo. Meta-schema: third_party/json-schema (third_party/LICENSES.md).
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';
import { RUNTIME_VERSION, SUPPORTED_SCHEMA } from './codes.ts';

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
  it('đủ 6 schema', () => {
    expect([...files].sort()).toEqual([
      'binding.schema.json',
      'logging.schema.json',
      'package-manifest.schema.json',
      'project.schema.json',
      'screen.schema.json',
      'tag.schema.json',
    ]);
  });

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
  const v = read('schemas/protocol-version.json') as { live: string; project: string };

  it('phiên bản schema project được bộ kiểm tra chấp nhận', () => {
    expect(SUPPORTED_SCHEMA.test(`${v.project}.0`)).toBe(true);
    expect(SUPPORTED_SCHEMA.test(`${v.project}.7`)).toBe(true);
    const [major, minor] = v.project.split('.').map(Number);
    expect(SUPPORTED_SCHEMA.test(`${major}.${minor + 1}.0`)).toBe(false);
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
