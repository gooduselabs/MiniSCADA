// So sánh project 0.4 (T018; FR-010): số binding và sự kiện theo item và phần tử, file SVG theo digest.
// Sự kiện click của phần tử là đối tượng kind `binding` có khoá `<màn hình>/<item>/<elementUid>/@click` (`@` không thể là
// một phần của `binding.id`, nên không đụng khoá binding; không thêm kind mới để giao diện Studio không đổi).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MemorySource,
  compareProjects,
  packageDigest,
  packageFile,
  projectFiles,
  validateProject,
  type CompareResult,
  type DeviceSide,
  type LocalSide,
} from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/v04-valid-full');
const sha = (d: Uint8Array) => createHash('sha256').update(d).digest('hex');
const MB = 'screens/main.svg1.bindings.json';

function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else if (n !== 'expected.json') out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project
async function side(texts: Record<string, string>) {
  const v = await validateProject(new MemorySource(texts), { checkSvg: false });
  const names = projectFiles(v.project04!);
  const list = await Promise.all(names.map((p) => packageFile(p, texts[p]!, sha)));
  const digest = await packageDigest(list, sha);
  const source = new MemorySource(texts);
  return {
    local: { digest, files: list, source } satisfies LocalSide,
    device: { digest, files: async () => list, source: async () => source } satisfies DeviceSide,
  };
}
const edit = (mutate: (b: Json) => void) => {
  const f = tree(DIR);
  const b = JSON.parse(f[MB]!);
  mutate(b);
  f[MB] = JSON.stringify(b, null, 2) + '\n';
  return f;
};
const diff = async (local: Record<string, string>, device: Record<string, string>) =>
  compareProjects((await side(local)).local, (await side(device)).device);
const find = (r: CompareResult, key: string) =>
  r.objects.find((o) => o.kind === 'binding' && o.key === key);

describe('compareProjects với project 0.4', () => {
  it('hai bên giống nhau: binding của item svg theo khoá <màn hình>/<item>/<uid>/<id>, đều =', async () => {
    const f = tree(DIR);
    const r = await diff(f, f);
    expect(r.same).toBe(true);
    const keys = r.objects.filter((o) => o.kind === 'binding').map((o) => o.key);
    expect(keys).toContain('main/svg1/el_aaa/b1');
    expect(r.objects.every((o) => o.status === '=')).toBe(true);
  });

  it('sự kiện click của phần tử là đối tượng riêng, kể cả phần tử chỉ có events', async () => {
    const withEvent = edit((b) => {
      b.elements = b.elements.filter((e: Json) => e.elementUid !== 'el_ccc');
      b.elements.push({ elementUid: 'el_ccc', events: { click: { action: 'closePopup' } } });
    });
    const plain = edit((b) => {
      b.elements = b.elements.filter((e: Json) => e.elementUid !== 'el_ccc');
    });
    const r = await diff(withEvent, plain);
    expect(find(r, 'main/svg1/el_ccc/@click')?.status).toBe('+');
    const r2 = await diff(plain, withEvent);
    expect(find(r2, 'main/svg1/el_ccc/@click')?.status).toBe('-');
  });

  it('đổi hành động của sự kiện: ≠ kèm trường; binding khác giữ =', async () => {
    const mk = (label: string) =>
      edit((b) => {
        b.elements = [
          { elementUid: 'el_aaa', events: { click: { action: 'closePopup', label } } },
          {
            elementUid: 'el_bbb',
            bindings: [
              {
                id: 'q',
                target: 'style.opacity',
                source: { type: 'tag', tagId: 'TANK01.LEVEL' },
                transform: { kind: 'direct' },
              },
            ],
          },
        ];
      });
    const r = await diff(mk('x'), mk('x'));
    expect(r.same).toBe(true);
    const r2 = await diff(mk('x'), mk('y'));
    const ev = find(r2, 'main/svg1/el_aaa/@click');
    expect(ev?.status).toBe('≠');
    expect(ev?.fields.some((x) => x.path === '/label')).toBe(true);
    expect(find(r2, 'main/svg1/el_bbb/q')?.status).toBe('=');
  });

  it('file SVG ở graphics/ so theo digest (không so sâu)', async () => {
    const a = tree(DIR);
    const b = { ...a, 'graphics/main.svg': a['graphics/main.svg']! + '<!-- x -->\n' };
    const r = await diff(a, b);
    const svg = r.objects.find((o) => o.kind === 'svg');
    expect(svg).toMatchObject({ key: 'graphics/main.svg', status: '≠' });
  });
});
