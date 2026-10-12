// Tài liệu project 0.2 (feature 006, T079, data-model §13.1): sửa theo đối tượng project.json, tags.json,
// connections.json, value-tables/*.json, watch-tables/*.json; file mới tạo khi có nội dung đầu tiên, bảng bị xóa thì
// file bị xóa khi lưu; sửa đổi mới (tagUpsert/tagField v1, channel*, device*, scanGroups, valueTable*, watchTable*,
// batch = một bước hoàn tác); ghi bằng format-02; chế độ chỉ đọc khóa mọi sửa. Test "nội dung chờ ghi" của 005 ở
// project-doc.test.ts vẫn xanh.
import {
  MemorySource,
  formatTagsFile,
  validateProject,
  type Channel,
  type ConnectionsConfig,
  type TagListV1,
  type TagV1,
  type ValueTableDoc,
  type WatchTableDoc,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  applyDocEdits,
  applyProjectEdits,
  filesOf,
  isDirty,
  loadDoc,
  markSaved,
  outlineOf,
  restoreSnapshot,
  snapshotOf,
  withEditable,
  writeOrder,
  writtenText,
  type ProjectDoc,
  type ProjectDocs,
  type ProjectEdit,
} from './project-doc.ts';
import { full02 } from './test-fixtures.ts';

/** Mở project 0.2 như store: mọi file là tài liệu, file Tag theo format-02, file đối tượng sửa được. */
function open(files: Record<string, string> = full02(), readOnly = false): ProjectDocs {
  const docs: Record<string, ProjectDoc> = {};
  for (const [rel, text] of Object.entries(files))
    docs[rel] = loadDoc(
      rel,
      text,
      `hash:${rel}`,
      false,
      rel === 'tags.json' ? 'tags02' : undefined,
    );
  return withEditable(docs, { readOnly });
}

const tagsOf = (docs: ProjectDocs): TagV1[] => (docs['tags.json'].value as TagListV1).tags;
const connOf = (docs: ProjectDocs): ConnectionsConfig =>
  docs['connections.json'].value as ConnectionsConfig;
const apply = (docs: ProjectDocs, ...edits: ProjectEdit[]) => applyDocEdits(docs, edits);
const validate = async (docs: ProjectDocs) => {
  const files: Record<string, string> = {};
  for (const [rel, doc] of Object.entries(docs))
    if (!doc.removed)
      files[rel] =
        doc.value === null && doc.pending === undefined ? doc.diskText : writtenText(doc);
  return validateProject(new MemorySource(files), { checkSvg: false });
};
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

const NEW_TAG: TagV1 = {
  id: 'PUMP02.FAULT',
  kind: 'external',
  type: 'BOOL',
  source: { device: 'plc1', address: 'HR13.0' },
};
const NEW_TABLE: ValueTableDoc = {
  schemaVersion: '0.2.0',
  name: 'Van',
  entries: [{ value: 0, text: 'Đóng' }],
};
const NEW_WATCH: WatchTableDoc = {
  schemaVersion: '0.2.0',
  id: 'bom-2',
  name: 'Bơm 2',
  rows: [{ tag: 'TANK01.LEVEL' }],
};

describe('mở project 0.2', () => {
  it('chỉ project.json, file Tag, kết nối, bảng giá trị, bảng theo dõi sửa được; màn hình và lưu trữ thì không', () => {
    const docs = open();
    const editable = Object.values(docs)
      .filter((d) => d.editable)
      .map((d) => d.rel)
      .sort();
    expect(editable).toEqual([
      'connections.json',
      'project.json',
      'tags.json',
      'value-tables/TrangThaiBom.json',
      'watch-tables/van-hanh.json',
    ]);
    expect(docs['screens/main.screen.json'].editable).toBe(false);
  });

  it('mở xong không có gì chưa lưu, kể cả tags.json viết thụt 2 dấu cách (format-02 là chuẩn của Studio)', () => {
    const docs = open();
    expect(writeOrder(docs)).toEqual([]);
    expect(isDirty(docs['tags.json'])).toBe(false);
  });

  it('outlineOf: phiên bản, kênh, bảng giá trị, bảng theo dõi', () => {
    const o = outlineOf(filesOf(open()));
    expect(o.version).toBe('0.2');
    expect(o.connectionFile).toBe('connections.json');
    expect(o.connections?.channels.map((c) => c.id)).toEqual(['plc1', 'rs485-1']);
    expect(o.valueTables.map((v) => [v.name, v.file, v.doc?.name])).toEqual([
      ['TrangThaiBom', 'value-tables/TrangThaiBom.json', 'TrangThaiBom'],
    ]);
    expect(o.watchTables.map((w) => [w.id, w.doc?.rows.length])).toEqual([['van-hanh', 3]]);
    expect(outlineOf(filesOf(open({ 'project.json': '{"schemaVersion":"0.1.0"}' }))).version).toBe(
      '0.1',
    );
  });

  it('chế độ chỉ đọc (project 0.1 không nâng cấp): không tài liệu nào sửa được, mọi sửa bị bỏ', () => {
    const docs = open(full02(), true);
    expect(Object.values(docs).every((d) => !d.editable)).toBe(true);
    const after = apply(docs, { kind: 'tagUpsert', tag: NEW_TAG });
    expect(after).toEqual(docs);
    expect(writeOrder(after)).toEqual([]);
  });
});

describe('Tag v1', () => {
  it('tagUpsert thêm cuối rồi thay đúng dòng; tagRemove bỏ dòng', () => {
    let docs = apply(open(), { kind: 'tagUpsert', tag: NEW_TAG });
    expect(tagsOf(docs).at(-1)?.id).toBe('PUMP02.FAULT');
    expect(tagsOf(docs)).toHaveLength(14);
    docs = apply(docs, { kind: 'tagUpsert', index: 13, tag: { ...NEW_TAG, id: 'PUMP02.ERR' } });
    expect(tagsOf(docs).at(-1)?.id).toBe('PUMP02.ERR');
    docs = apply(docs, { kind: 'tagRemove', index: 13 });
    expect(tagsOf(docs)).toHaveLength(13);
  });

  it('tagField gán trường của Tag v1, kể cả trường lồng; khóa mới chèn theo thứ tự chuẩn của format-02', () => {
    let docs = apply(
      open(),
      { kind: 'tagField', index: 1, field: 'access', value: 'R' },
      { kind: 'tagField', index: 1, field: 'deadband', value: 0.25 },
      { kind: 'tagField', index: 1, field: 'description', value: 'Điểm đặt' },
    );
    expect(Object.keys(tagsOf(docs)[1])).toEqual([
      'id',
      'kind',
      'type',
      'description',
      'unit',
      'access',
      'limits',
      'deadband',
      'source',
    ]);
    docs = apply(docs, { kind: 'tagField', index: 1, field: 'deadband', value: undefined });
    expect(tagsOf(docs)[1]).not.toHaveProperty('deadband');
    docs = apply(docs, {
      kind: 'tagField',
      index: 1,
      field: 'source',
      value: { device: 'plc1', address: 'HR201', byteOrder: 'CDAB' },
    });
    expect(tagsOf(docs)[1].source?.address).toBe('HR201');
  });

  it('tags.json được ghi bằng format-02 (mỗi Tag một dòng, không ghi trường bằng mặc định)', () => {
    const docs = apply(open(), {
      kind: 'tagUpsert',
      tag: { ...NEW_TAG, access: 'R', source: { ...NEW_TAG.source!, scanGroup: 'normal' } },
    });
    const text = writtenText(docs['tags.json']);
    expect(text).toBe(formatTagsFile(docs['tags.json'].value as TagListV1));
    expect(text.split('\n').filter((l) => l.includes('PUMP02.FAULT'))).toHaveLength(1);
    expect(text).not.toContain('"scanGroup":"normal"');
    expect(text).not.toContain('"access":"R"');
    expect(writeOrder(docs).map((d) => d.rel)).toEqual(['tags.json']);
  });

  it('kết quả đi qua bộ kiểm tra dùng chung: hợp lệ; sửa địa chỉ sai thì E_ADDR_SYNTAX', async () => {
    let docs = apply(open(), { kind: 'tagUpsert', tag: NEW_TAG });
    expect(codes(await validate(docs))).toEqual([]);
    docs = apply(docs, {
      kind: 'tagField',
      index: 13,
      field: 'source',
      value: { device: 'plc1', address: 'HR12.16' },
    });
    expect(codes(await validate(docs))).toContain('E_ADDR_SYNTAX');
  });
});

describe('Kết nối: kênh, thiết bị trường, nhóm quét', () => {
  const CH: Channel = {
    id: 'plc2',
    name: 'PLC 2',
    kind: 'modbus-tcp',
    tcp: { host: '192.168.10.6', port: 502 },
    devices: [{ id: 'plc2', name: 'PLC 2', unitId: 1 }],
  };

  it('channelUpsert thêm và thay; channelRemove bỏ', () => {
    let docs = apply(open(), { kind: 'channelUpsert', channel: CH });
    expect(connOf(docs).channels.map((c) => c.id)).toEqual(['plc1', 'rs485-1', 'plc2']);
    docs = apply(docs, {
      kind: 'channelUpsert',
      index: 2,
      channel: { ...CH, name: 'PLC hai' },
    });
    expect(connOf(docs).channels[2].name).toBe('PLC hai');
    docs = apply(docs, { kind: 'channelRemove', index: 2 });
    expect(connOf(docs).channels).toHaveLength(2);
  });

  it('deviceUpsert thêm và thay thiết bị trong kênh; deviceRemove bỏ', () => {
    let docs = apply(open(), {
      kind: 'deviceUpsert',
      channel: 1,
      device: { id: 'meter3', name: 'Đồng hồ 3', slave: 3, addressBase: 1 },
    });
    expect(connOf(docs).channels[1].devices.map((d) => d.id)).toEqual([
      'meter1',
      'meter2',
      'meter3',
    ]);
    docs = apply(docs, {
      kind: 'deviceUpsert',
      channel: 1,
      index: 0,
      device: { id: 'meter1', name: 'Đồng hồ một', slave: 1, addressBase: 1, timeoutMs: 500 },
    });
    expect(connOf(docs).channels[1].devices[0].timeoutMs).toBe(500);
    docs = apply(docs, { kind: 'deviceRemove', channel: 1, index: 2 });
    expect(connOf(docs).channels[1].devices).toHaveLength(2);
  });

  it('scanGroups đặt chu kỳ nhóm quét; undefined thì bỏ khóa', () => {
    let docs = apply(open(), {
      kind: 'scanGroups',
      value: { fast: 500, normal: 1000, slow: 5000 },
    });
    expect(connOf(docs).scanGroups?.fast).toBe(500);
    docs = apply(docs, { kind: 'scanGroups', value: undefined });
    expect(connOf(docs)).not.toHaveProperty('scanGroups');
  });

  it('project chưa có kết nối: lần sửa đầu tạo connections.json và đặt connectionFile', () => {
    const files = full02();
    delete files['connections.json'];
    const project = JSON.parse(files['project.json']) as Record<string, unknown>;
    delete project.connectionFile;
    files['project.json'] = JSON.stringify(project, null, 2) + '\n';
    const tags = JSON.parse(files['tags.json']) as TagListV1;
    tags.tags = tags.tags.filter((t) => t.kind !== 'external');
    files['tags.json'] = JSON.stringify(tags, null, 2) + '\n';
    const docs = apply(open(files), { kind: 'channelUpsert', channel: CH });
    expect(docs['connections.json']).toMatchObject({ created: true, editable: true });
    expect(connOf(docs).schemaVersion).toBe('0.2.0');
    expect((docs['project.json'].value as { connectionFile?: string }).connectionFile).toBe(
      'connections.json',
    );
    expect(writeOrder(docs).map((d) => d.rel)).toEqual(['connections.json', 'project.json']);
  });

  it('kết quả hợp lệ với bộ kiểm tra; trùng id kênh thì E_DUP_ID', async () => {
    const docs = apply(open(), { kind: 'channelUpsert', channel: CH });
    expect(codes(await validate(docs))).toEqual([]);
    const dup = apply(docs, { kind: 'channelUpsert', channel: { ...CH, name: 'trùng' } });
    expect(codes(await validate(dup))).toContain('E_DUP_ID');
  });
});

describe('Bảng giá trị và Bảng theo dõi', () => {
  it('valueTableUpsert bảng mới: tạo file, thêm tên vào project.json; file chỉ có khi có nội dung', async () => {
    const docs = apply(open(), { kind: 'valueTableUpsert', table: NEW_TABLE });
    const doc = docs['value-tables/Van.json'];
    expect(doc).toMatchObject({ created: true, editable: true, diskHash: null });
    expect(isDirty(doc)).toBe(true);
    expect((docs['project.json'].value as { valueTables: string[] }).valueTables).toEqual([
      'TrangThaiBom',
      'Van',
    ]);
    expect(writeOrder(docs).map((d) => d.rel)).toEqual(['value-tables/Van.json', 'project.json']);
    expect(codes(await validate(docs))).toEqual([]);
  });

  it('valueTableUpsert bảng có sẵn thay nội dung; chỉ file đó chưa lưu', () => {
    const next: ValueTableDoc = {
      ...(open()['value-tables/TrangThaiBom.json'].value as ValueTableDoc),
      entries: [{ value: 0, text: 'Tắt' }],
    };
    const docs = apply(open(), { kind: 'valueTableUpsert', table: next });
    expect(writeOrder(docs).map((d) => d.rel)).toEqual(['value-tables/TrangThaiBom.json']);
  });

  it('valueTableRemove: file bị xóa khi lưu (đánh dấu removed, ghi sau cùng), bỏ khỏi project.json và khỏi outline', () => {
    const docs = apply(open(), { kind: 'valueTableRemove', name: 'TrangThaiBom' });
    const doc = docs['value-tables/TrangThaiBom.json'];
    expect(doc.removed).toBe(true);
    expect(isDirty(doc)).toBe(true);
    // Danh sách rỗng thì bỏ cả khóa khỏi project.json.
    expect((docs['project.json'].value as { valueTables?: string[] }).valueTables).toBeUndefined();
    expect(writeOrder(docs).map((d) => d.rel)).toEqual([
      'project.json',
      'value-tables/TrangThaiBom.json',
    ]);
    expect(filesOf(docs)).not.toHaveProperty('value-tables/TrangThaiBom.json');
    expect(outlineOf(filesOf(docs)).valueTables).toEqual([]);
  });

  it('bảng mới rồi xóa trước khi lưu: không còn file nào', () => {
    let docs = apply(open(), { kind: 'valueTableUpsert', table: NEW_TABLE });
    docs = apply(docs, { kind: 'valueTableRemove', name: 'Van' });
    expect(docs['value-tables/Van.json']).toBeUndefined();
    // project.json về đúng như trên đĩa nên không còn chưa lưu.
    expect(writeOrder(docs)).toEqual([]);
  });

  it('valueTableRename: file mới tên mới, file cũ bị xóa, Tag dùng bảng đổi theo', async () => {
    const docs = apply(open(), { kind: 'valueTableRename', from: 'TrangThaiBom', to: 'TinhTrang' });
    expect((docs['value-tables/TinhTrang.json'].value as ValueTableDoc).name).toBe('TinhTrang');
    expect(docs['value-tables/TrangThaiBom.json'].removed).toBe(true);
    expect(tagsOf(docs).find((t) => t.id === 'PUMP01.STATE')?.valueTable).toBe('TinhTrang');
    expect((docs['project.json'].value as { valueTables: string[] }).valueTables).toEqual([
      'TinhTrang',
    ]);
    // Biểu thức text(…, TrangThaiBom) không tự đổi (rename Tag/bảng ở rename.ts): bộ kiểm tra báo.
    expect(codes(await validate(docs))).toContain('E_EXPR_UNKNOWN_TABLE');
  });

  it('watchTableUpsert tạo và thay; watchTableRemove xóa file', async () => {
    let docs = apply(open(), { kind: 'watchTableUpsert', table: NEW_WATCH });
    expect(docs['watch-tables/bom-2.json']).toMatchObject({ created: true });
    expect((docs['project.json'].value as { watchTables: string[] }).watchTables).toEqual([
      'van-hanh',
      'bom-2',
    ]);
    expect(codes(await validate(docs))).toEqual([]);
    docs = apply(docs, {
      kind: 'watchTableUpsert',
      table: { ...NEW_WATCH, rows: [{ tag: 'TANK01.SP', writeValue: '80' }] },
    });
    expect((docs['watch-tables/bom-2.json'].value as WatchTableDoc).rows[0].writeValue).toBe('80');
    docs = apply(docs, { kind: 'watchTableRemove', id: 'van-hanh' });
    expect(docs['watch-tables/van-hanh.json'].removed).toBe(true);
    expect((docs['project.json'].value as { watchTables: string[] }).watchTables).toEqual([
      'bom-2',
    ]);
  });
});

describe('batch và hoàn tác', () => {
  it('batch áp mọi sửa đổi con theo thứ tự (một giá trị ProjectEdit)', () => {
    const docs = apply(open(), {
      kind: 'batch',
      edits: [
        { kind: 'tagUpsert', tag: NEW_TAG },
        { kind: 'tagUpsert', tag: { ...NEW_TAG, id: 'PUMP03.FAULT' } },
        { kind: 'valueTableUpsert', table: NEW_TABLE },
      ],
    });
    expect(
      tagsOf(docs)
        .slice(-2)
        .map((t) => t.id),
    ).toEqual(['PUMP02.FAULT', 'PUMP03.FAULT']);
    expect(docs['value-tables/Van.json']).toBeDefined();
  });

  it('batch lồng batch; batch rỗng không đổi gì', () => {
    const docs = open();
    expect(apply(docs, { kind: 'batch', edits: [] })).toEqual(docs);
    const nested = apply(docs, {
      kind: 'batch',
      edits: [{ kind: 'batch', edits: [{ kind: 'tagUpsert', tag: NEW_TAG }] }],
    });
    expect(tagsOf(nested)).toHaveLength(14);
  });

  it('applyProjectEdits (hàm thuần) không đụng bản gốc', () => {
    const files = full02();
    const base = {
      project: JSON.parse(files['project.json']),
      tags: JSON.parse(files['tags.json']) as TagListV1,
    };
    const out = applyProjectEdits(base, [{ kind: 'tagUpsert', tag: NEW_TAG }]);
    expect(base.tags.tags).toHaveLength(13);
    expect((out.tags as TagListV1).tags).toHaveLength(14);
  });

  it('snapshot và khôi phục: hoàn tác tạo bảng bỏ file mới; làm lại tạo lại', () => {
    const before = open();
    const snapBefore = snapshotOf(before);
    const after = apply(before, { kind: 'valueTableUpsert', table: NEW_TABLE });
    const snapAfter = snapshotOf(after);
    const undone = restoreSnapshot(after, snapBefore);
    expect(undone['value-tables/Van.json']).toBeUndefined();
    expect((undone['project.json'].value as { valueTables: string[] }).valueTables).toEqual([
      'TrangThaiBom',
    ]);
    expect(writeOrder(undone)).toEqual([]);
    const redone = restoreSnapshot(undone, snapAfter);
    expect(redone['value-tables/Van.json']).toMatchObject({ created: true, editable: true });
    expect(isDirty(redone['value-tables/Van.json'])).toBe(true);
  });

  it('hoàn tác xóa bảng: file hết bị đánh dấu xóa; hoàn tác tạo bảng đã lưu: file bị đánh dấu xóa', () => {
    const before = open();
    const removed = apply(before, { kind: 'valueTableRemove', name: 'TrangThaiBom' });
    const undone = restoreSnapshot(removed, snapshotOf(before));
    expect(undone['value-tables/TrangThaiBom.json'].removed).toBeUndefined();
    expect(writeOrder(undone)).toEqual([]);
    // Bảng đã tạo và lưu (không còn `created`), rồi hoàn tác tạo: phải xóa file khi lưu.
    const created = apply(before, { kind: 'valueTableUpsert', table: NEW_TABLE });
    const saved: Record<string, ProjectDoc> = { ...created };
    for (const rel of ['value-tables/Van.json', 'project.json'])
      saved[rel] = markSaved(created[rel], writtenText(created[rel]), `hash:${rel}`);
    const undoneCreate = restoreSnapshot(saved, snapshotOf(before));
    expect(undoneCreate['value-tables/Van.json'].removed).toBe(true);
    expect(writeOrder(undoneCreate).map((d) => d.rel)).toEqual([
      'project.json',
      'value-tables/Van.json',
    ]);
  });

  it('snapshot không gồm tài liệu chỉ đọc; gồm cờ xóa', () => {
    const removed = apply(open(), { kind: 'valueTableRemove', name: 'TrangThaiBom' });
    const snap = JSON.parse(snapshotOf(removed)) as Record<string, unknown>;
    expect(snap['removed:value-tables/TrangThaiBom.json']).toBe(true);
    expect(snap).not.toHaveProperty('screens/main.screen.json');
  });
});
