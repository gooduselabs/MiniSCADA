// Định dạng ghi của Studio 0.2 (data-model §1): Tag một dòng, thứ tự khóa chuẩn, bỏ trường bằng mặc định.
import { describe, expect, it } from 'vitest';
import { canonicalTag, formatTagsFile, type TagV1 } from './index.ts';

describe('format-02', () => {
  it('orders keys canonically and drops defaults', () => {
    const t = {
      sim: { periodMs: 1000, kind: 'sine', phase: 0, center: 1, amplitude: 2 },
      type: 'FLOAT64',
      kind: 'simulation',
      id: 'A',
      access: 'R',
      retain: false,
    } as unknown as TagV1;
    expect(JSON.stringify(canonicalTag(t))).toBe(
      '{"id":"A","kind":"simulation","type":"FLOAT64","sim":{"kind":"sine","center":1,"amplitude":2,"periodMs":1000}}',
    );
  });
  it('drops source defaults but keeps explicit values', () => {
    const t: TagV1 = {
      id: 'B',
      kind: 'external',
      type: 'INT16',
      source: {
        device: 'd',
        address: 'HR1',
        scanGroup: 'normal',
        rawType: 'INT16',
        readback: true,
        byteOrder: 'CDAB',
      },
    };
    expect(JSON.stringify(canonicalTag(t, { deviceByteOrder: () => 'ABCD' }).source)).toBe(
      '{"device":"d","address":"HR1","byteOrder":"CDAB"}',
    );
    expect(JSON.stringify(canonicalTag(t, { deviceByteOrder: () => 'CDAB' }).source)).toBe(
      '{"device":"d","address":"HR1"}',
    );
  });
  it('writes one tag per line, two-space outer indent, deterministic', () => {
    const doc = {
      schemaVersion: '0.2.0',
      tags: [
        { id: 'A', kind: 'internal', type: 'BOOL' },
        { id: 'B', kind: 'internal', type: 'BOOL', retain: true },
      ] as TagV1[],
    };
    const s = formatTagsFile(doc);
    expect(s).toBe(
      '{\n  "schemaVersion": "0.2.0",\n  "tags": [\n    {"id":"A","kind":"internal","type":"BOOL"},\n    {"id":"B","kind":"internal","type":"BOOL","retain":true}\n  ]\n}\n',
    );
    expect(formatTagsFile(doc)).toBe(s);
    expect(formatTagsFile({ schemaVersion: '0.2.0', tags: [] })).toBe(
      '{\n  "schemaVersion": "0.2.0",\n  "tags": []\n}\n',
    );
  });
});
