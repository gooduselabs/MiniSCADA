// Bảng Tag với Tag của server OPC UA (feature 019, US5, contracts/opcua.md §1): NodeId kiểm bằng parseOpcUaNodeId, chuẩn hóa
// (giữ chữ hoa/thường, ns=0 bỏ tiền tố, GUID chữ thường), lỗi theo mã bằng tiếng Việt, gợi ý định dạng NodeId, không thứ tự
// byte, điền xuống tăng id số hay số cuối của id chuỗi, nhóm thuộc tính không có mã hàm/thanh ghi. Chẩn đoán: details OPC UA;
// câu lỗi của bộ kiểm tra cho NodeId.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { issueText } from '../app/code-text.ts';
import { opcuaDetailRows, parseDriverDiag } from './driver-diag.ts';
import { applyEdits, type EditableProject, type ProjectEdit } from './project-doc.ts';
import { t } from '../i18n/index.ts';
import {
  addressInfoText,
  propertyGroups,
  stepOpcUaNodeId,
  tableInputs,
  tagTable,
  type TagTable,
} from './tag-table.ts';

const DEVICES = [
  { id: 'plc1-main', name: 'PLC chính', addressBase: 0 as const, kind: 'modbus-tcp' },
  { id: 'srv1', name: 'Server', kind: 'opcua' },
];

const TAGS: TagV1[] = [
  {
    id: 'TANK01.LEVEL',
    kind: 'external',
    type: 'FLOAT32',
    source: { device: 'plc1-main', address: 'HR100' },
  },
  {
    id: 'UA.LEVEL',
    kind: 'external',
    type: 'FLOAT64',
    source: { device: 'srv1', address: 'ns=2;s=Tank.Level' },
  },
  {
    id: 'UA.NAME',
    kind: 'external',
    type: 'STRING',
    source: { device: 'srv1', address: 'ns=2;s=Name', stringLength: 20 },
  },
];

const make = (tags: readonly TagV1[] = TAGS): TagTable =>
  tagTable({ tags, devices: DEVICES, valueTables: [], version: '0.2' });

function applyTo(tags: readonly TagV1[], edits: readonly ProjectEdit[]): TagV1[] {
  const base = {
    project: { schemaVersion: '1.1.0' },
    tags: { schemaVersion: '1.1.0', tags: structuredClone(tags) },
  } as unknown as EditableProject;
  return (applyEdits(base, edits).state.tags as { tags: TagV1[] }).tags;
}

const rowOf = (a: TagTable, id: string) => {
  for (let i = 0; i < a.rowCount(); i++) if (a.text(i, 'id') === id) return i;
  throw new Error(id);
};

describe('Bảng Tag: NodeId OPC UA', () => {
  it('tableInputs mang loại kênh của thiết bị trường', () => {
    const inputs = tableInputs({
      tags: { tags: [] },
      connections: { channels: [{ kind: 'opcua', devices: [{ id: 'srv1', name: 'S' }] }] },
      valueTables: [],
    });
    expect(inputs.devices?.map((d) => [d.id, d.kind])).toEqual([['srv1', 'opcua']]);
  });

  it('NodeId đúng: giữ chữ hoa/thường và dấu cách bên trong, ns=0 bỏ tiền tố; thông tin ns và loại id', () => {
    const a = make();
    const r = rowOf(a, 'UA.LEVEL');
    const out = a.apply([{ row: r, col: 'address', text: ' ns=3;s="DB Data".Motor Speed ' }]);
    expect(out.rejected).toEqual([]);
    expect(applyTo(TAGS, out.edits)[r].source?.address).toBe('ns=3;s="DB Data".Motor Speed');
    const z = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'ns=0;i=2258' }]).edits);
    expect(z[r].source?.address).toBe('i=2258');
    expect(a.addressInfo(r)).toEqual({
      ok: true,
      normalized: 'ns=2;s=Tank.Level',
      opcua: { ns: 2, idType: 's' },
    });
    expect(addressInfoText(a.addressInfo(r)!)).toBe('Namespace 2 · id chuỗi');
    expect(a.text(r, 'fc')).toBe('');
    expect(a.text(r, 'regs')).toBe('');
  });

  it('NodeId sai: lưu nguyên chữ (không viết hoa) để bộ kiểm tra đánh dấu; lỗi tiếng Việt theo mã', () => {
    const a = make();
    const r = rowOf(a, 'UA.LEVEL');
    const bad = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'nsu=urn:x;s=a' }]).edits);
    expect(bad[r].source?.address).toBe('nsu=urn:x;s=a');
    expect(make(bad).addressInfo(r)).toMatchObject({ ok: false, error: 'tt.err.opcuaNodeId' });
    const range = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'ns=70000;i=1' }]).edits);
    expect(make(range).addressInfo(r)).toMatchObject({ error: 'tt.err.opcuaNodeIdRange' });
  });

  it('gợi ý theo loại kênh; thứ tự byte không dùng; nhóm thuộc tính không có mã hàm, thanh ghi, thứ tự byte', () => {
    const a = make();
    const r = rowOf(a, 'UA.LEVEL');
    expect(a.addressSyntaxHint(r)).toBe(t('tt.hint.opcuaSyntax'));
    expect(a.addressSyntaxHint(rowOf(a, 'TANK01.LEVEL'))).toBe(t('tt.hint.syntax'));
    expect(a.isOpcUaRow(r)).toBe(true);
    expect(a.text(r, 'byteOrder')).toBe('');
    expect(a.editable(r, 'byteOrder')).toBe(false);
    const s = rowOf(a, 'UA.NAME');
    expect(a.text(s, 'stringByteOrder')).toBe('');
    expect(a.editable(s, 'stringByteOrder')).toBe(false);
    const keys = propertyGroups(TAGS[2], { opcua: true })
      .flatMap((g) => g.fields)
      .map((f) => f.col);
    expect(keys).toContain('stringLength');
    for (const k of ['fc', 'offset', 'regs', 'byteOrder', 'stringByteOrder'])
      expect(keys).not.toContain(k);
    expect(
      propertyGroups(TAGS[2])
        .flatMap((g) => g.fields)
        .map((f) => f.col),
    ).toContain('fc');
  });

  it('đổi thiết bị sang server OPC UA bỏ byteOrder/stringByteOrder cũ', () => {
    const tags: TagV1[] = [
      {
        id: 'X',
        kind: 'external',
        type: 'FLOAT32',
        source: { device: 'plc1-main', address: 'HR1', byteOrder: 'CDAB' },
      },
    ];
    const out = applyTo(tags, make(tags).apply([{ row: 0, col: 'device', text: 'srv1' }]).edits);
    expect(out[0].source).toEqual({ device: 'srv1', address: 'HR1' });
  });

  it('điền xuống: id số tăng; số cuối của id chuỗi tăng giữ số chữ số; còn lại không điền', () => {
    expect(stepOpcUaNodeId('ns=3;i=1001', 2)).toBe('ns=3;i=1003');
    expect(stepOpcUaNodeId('i=4294967295', 1)).toBeUndefined();
    expect(stepOpcUaNodeId('ns=2;s=Tag09', 1)).toBe('ns=2;s=Tag10');
    expect(stepOpcUaNodeId('ns=2;s=Pump.Speed', 1)).toBeUndefined();
    expect(stepOpcUaNodeId('ns=2;g=09087e75-8e5e-499b-954f-f2a9603db28a', 1)).toBeUndefined();
    const a = make();
    expect(a.fillNext(rowOf(a, 'UA.LEVEL'), 'address', 'ns=2;s=Pump01', 1)).toBe('ns=2;s=Pump02');
  });
});

describe('Chẩn đoán và câu lỗi OPC UA', () => {
  it('details của kênh OPC UA theo thứ tự hợp đồng §3, bỏ khóa lạ và rỗng', () => {
    expect(
      opcuaDetailRows({
        lastStatus: 'BadNodeIdUnknown',
        endpointUrl: 'opc.tcp://x:4840',
        foo: 'bar',
        readMode: '',
        securityPolicy: 'None',
      }),
    ).toEqual([
      { key: 'endpointUrl', value: 'opc.tcp://x:4840' },
      { key: 'securityPolicy', value: 'None' },
      { key: 'lastStatus', value: 'BadNodeIdUnknown' },
    ]);
    expect(opcuaDetailRows(null)).toEqual([]);
    const d = parseDriverDiag({
      at: 1,
      channels: [
        {
          id: 'ua-1',
          name: 'UA',
          kind: 'opcua',
          state: 'connected',
          details: { readMode: 'poll', n: 3 },
          devices: [],
        },
      ],
      badTags: [],
    });
    expect(d?.channels[0].details).toEqual({ readMode: 'poll' });
  });

  it('issueText: NodeId sai, byteOrder trên Tag OPC UA, mã riêng của kênh OPC UA', () => {
    expect(
      issueText({ code: 'E_ADDR_SYNTAX', message: "OPC UA NodeId 'HR1': E_ADDR_SYNTAX" }),
    ).toContain('NodeId không đúng cú pháp');
    expect(
      issueText({ code: 'E_ADDR_SYNTAX', message: "address 'X': E_ADDR_SYNTAX" }),
    ).not.toContain('NodeId');
    expect(
      issueText({ code: 'E_SCHEMA', message: 'byteOrder does not apply to OPC UA tags' }),
    ).toContain('Tag OPC UA không có thứ tự byte');
    expect(issueText({ code: 'E_OPCUA_SECURITY', message: '' })).toContain('policy');
    expect(issueText({ code: 'W_OPCUA_CERT_NOT_PINNED', message: '' })).toContain('chưa tin');
  });
});
