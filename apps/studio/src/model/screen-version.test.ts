// Màn hình thêm mới phải mang schemaVersion của project (feature 011): `newScreen` tạo 0.3.0, nhưng project 0.4 đến 1.0
// đòi mọi tệp cùng phiên bản (`E_SCHEMA_VERSION`), nên `screenUpsert` ghi theo phiên bản của project.json.
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDocEdits, loadDoc, withEditable, type ProjectDoc } from './project-doc.ts';
import { newScreen } from './screen-ops.ts';
import { readProjectDir, REPO } from './test-fixtures.ts';

function open(): Record<string, ProjectDoc> {
  const docs: Record<string, ProjectDoc> = {};
  for (const [rel, text] of Object.entries(readProjectDir(resolve(REPO, 'projects/history-demo'))))
    docs[rel] = loadDoc(
      rel,
      text,
      `hash:${rel}`,
      false,
      rel === 'tags.json' ? 'tags02' : undefined,
    );
  return withEditable(docs);
}

describe('screenUpsert và schemaVersion', () => {
  it('màn hình mới trong project 0.6.0 được ghi 0.6.0, không phải 0.3.0', () => {
    const out = applyDocEdits(open(), [
      { kind: 'screenUpsert', screen: newScreen('screen', 'man-hinh-9', 'Mới') },
    ]);
    const v = (out['project.json']!.value as { schemaVersion: string }).schemaVersion;
    expect(v).toBe('0.6.0');
    const doc = out['screens/man-hinh-9.screen.json']!.value as { schemaVersion: string };
    expect(doc.schemaVersion).toBe(v);
  });

  it('sửa màn hình cũ lệch phiên bản (0.3.0) đưa nó về phiên bản của project', () => {
    const docs = open();
    const first = Object.keys(docs).find((k) => /^screens\/.*\.screen\.json$/.test(k))!;
    const screen = { ...(docs[first]!.value as object), schemaVersion: '0.3.0' };
    const out = applyDocEdits(docs, [{ kind: 'screenUpsert', screen: screen as never }]);
    expect((out[first]!.value as { schemaVersion: string }).schemaVersion).toBe('0.6.0');
  });
});
