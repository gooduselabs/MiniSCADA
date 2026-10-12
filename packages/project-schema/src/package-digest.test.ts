// Digest nội dung của gói (specs/005-device-online/contracts/matscada-package.md §4). Cùng vector với bản C++
// (core/package/tests/digest_test.cpp) và Rust: tests/package-vectors (vector digest-*, gói hợp lệ) và trường
// `digest` của vector hợp lệ trong tests/project-vectors.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  compareUtf8,
  digestText,
  packageDigest,
  packageFile,
  sha256WebCrypto,
  type PackageFile,
} from './index.ts';

const PACKAGE_VECTORS = resolve(__dirname, '../../../tests/package-vectors');
const PROJECT_VECTORS = resolve(__dirname, '../../../tests/project-vectors');

/** Hàm băm truyền vào trong test: node:crypto, đồng bộ. Studio truyền WebCrypto (bất đồng bộ). */
const nodeSha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Thư mục vector là thư mục có expected.json (out/ của vector gói lớn thì không). */
const vectorDirs = (root: string) =>
  readdirSync(root).filter((d) => existsSync(join(root, d, 'expected.json')));
const expectedOf = (root: string, dir: string) =>
  JSON.parse(readFileSync(join(root, dir, 'expected.json'), 'utf8'));

const file = (path: string, size: number, sha256: string): PackageFile => ({ path, size, sha256 });
/** Ví dụ của contract §4, cũng là vector digest-basic. */
const BASIC = [
  file('project.json', 21, 'c2de611dec8c30e06c2e27e6cbf5ea4a95e27c75b88f4791c0ad700b62ac8310'),
  file('screens/main.svg', 42, 'fb91f9a03c202c5f160eef644da6f2f704b19ac5c5f8b4c124e1b0b485ad57a0'),
  file('tags.json', 36, 'b7869ffaa4571f9761542fbb1656a6e75e11bb2cfc4284dc844241dbdc6ba0f2'),
];
const BASIC_DIGEST = 'sha256:c337083b40dd7b12f8db0ace06bfb5fb8bb682931ef795cbf030dfcd0e14e119';
const H = 'a'.repeat(64);

describe('digest nội dung (contract §4)', () => {
  it('ví dụ của contract: mỗi file một dòng "<sha256> <size> <path>\\n"', async () => {
    expect(digestText(BASIC)).toBe(
      `${BASIC[0].sha256} 21 project.json\n` +
        `${BASIC[1].sha256} 42 screens/main.svg\n` +
        `${BASIC[2].sha256} 36 tags.json\n`,
    );
    expect(await packageDigest(BASIC, nodeSha256)).toBe(BASIC_DIGEST);
  });

  it('size viết thập phân, không có số 0 ở đầu', () => {
    const text = digestText([file('a.json', 0, H), file('b.json', 7, H), file('c.json', 1000, H)]);
    expect(text).toBe(`${H} 0 a.json\n${H} 7 b.json\n${H} 1000 c.json\n`);
    expect(digestText([file('big.svg', 52428800, H)])).toBe(`${H} 52428800 big.svg\n`);
  });

  it('sắp theo byte UTF-8, không theo localeCompare hay theo đơn vị UTF-16', () => {
    // Thứ tự byte UTF-8 đúng (cũng là thứ tự điểm mã).
    const sorted = [
      'Z.json', // 0x5A: chữ hoa đứng trước mọi chữ thường
      'a b.json', // 0x20
      'a-b.json', // 0x2D
      'a.json', // 0x2E
      'a/b.json', // 0x2F: so cả chuỗi, không so từng đoạn
      'screens/10.svg',
      'screens/9.svg',
      'screens/z.svg',
      'screens/ơ.svg', // U+01A1 (C6 A1)
      'screens/ｆ.svg', // U+FF46 (EF BD 86)
      'screens/😀.svg', // U+1F600 (F0 9F 98 80); UTF-16 D83D đứng trước FF46
    ];
    const shuffled = [...sorted].reverse();
    expect([...shuffled].sort(compareUtf8)).toEqual(sorted);
    // Hai cách sắp hay gặp cho kết quả khác: test trên phân biệt được.
    expect([...shuffled].sort((a, b) => a.localeCompare(b))).not.toEqual(sorted);
    expect([...shuffled].sort()).not.toEqual(sorted);

    const text = digestText(shuffled.map((p) => file(p, 1, H)));
    expect(
      text
        .split('\n')
        .slice(0, -1)
        .map((l) => l.slice(67)),
    ).toEqual(sorted);
  });

  it('compareUtf8: âm, 0, dương như so byte', () => {
    expect(compareUtf8('a', 'b')).toBeLessThan(0);
    expect(compareUtf8('b', 'a')).toBeGreaterThan(0);
    expect(compareUtf8('ệ', 'ệ')).toBe(0);
    expect(compareUtf8('a', 'a/')).toBeLessThan(0); // tiền tố đứng trước
    expect(compareUtf8('ｆ', '\u{1F600}')).toBeLessThan(0);
    expect(compareUtf8('\u{1F600}', 'ｆ')).toBeGreaterThan(0);
  });

  it('không phụ thuộc thứ tự đầu vào, không sửa mảng đầu vào', async () => {
    const reversed = [...BASIC].reverse();
    const before = JSON.stringify(reversed);
    expect(await packageDigest(reversed, nodeSha256)).toBe(BASIC_DIGEST);
    expect(JSON.stringify(reversed)).toBe(before);
  });

  it('hàm băm truyền vào: đồng bộ hay bất đồng bộ (WebCrypto) cho cùng kết quả', async () => {
    const spy = vi.fn(nodeSha256);
    expect(await packageDigest(BASIC, spy)).toBe(BASIC_DIGEST);
    // Băm đúng một lần, trên byte UTF-8 của văn bản.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(spy.mock.calls[0][0])).toBe(digestText(BASIC));

    expect(await packageDigest(BASIC, sha256WebCrypto)).toBe(BASIC_DIGEST);
    expect(await sha256WebCrypto(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('packageFile: size là số byte UTF-8, giữ BOM', async () => {
    expect(await packageFile('a.json', '{"b":"ệ"}\n', nodeSha256)).toEqual(
      file('a.json', 12, nodeSha256(new TextEncoder().encode('{"b":"ệ"}\n'))),
    );
    const bom = await packageFile('b.json', String.fromCharCode(0xfeff) + '{}', nodeSha256);
    expect(bom.size).toBe(5);
    expect(bom.sha256).toBe(nodeSha256(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])));
    const bytes = new Uint8Array([0x3c, 0x73, 0xea, 0xd2]); // byte không phải UTF-8 vẫn băm nguyên văn
    expect(await packageFile('c.svg', bytes, nodeSha256)).toEqual(
      file('c.svg', 4, nodeSha256(bytes)),
    );
  });

  it('từ chối dữ liệu sai dạng (lỗi lập trình)', async () => {
    const bad: PackageFile[][] = [
      [file('a.json', 1, H), file('a.json', 2, H)], // trùng
      [file('a.json', 1, H.toUpperCase())], // hex chữ hoa
      [file('a.json', 1, 'a'.repeat(63))],
      [file('a.json', -1, H)],
      [file('a.json', 1.5, H)],
      [file('a.json', Number.NaN, H)],
      [file('', 1, H)],
      [file('a\n.json', 1, H)], // ký tự điều khiển làm lẫn dòng
      [file('a\uD800.json', 1, H)], // surrogate đứng lẻ: không có dạng UTF-8
    ];
    for (const files of bad) {
      expect(() => digestText(files), JSON.stringify(files)).toThrow();
      await expect(packageDigest(files, nodeSha256)).rejects.toThrow();
    }
    await expect(packageDigest(BASIC, () => 'ABC')).rejects.toThrow();
    await expect(packageFile('a.json', '{}', () => 'xyz')).rejects.toThrow();
  });
});

describe('tests/package-vectors (chung với C++, Rust)', () => {
  const dirs = vectorDirs(PACKAGE_VECTORS);
  const withDigest = dirs.filter((d) => {
    const e = expectedOf(PACKAGE_VECTORS, d);
    return typeof e.digest === 'string' && Array.isArray(e.files);
  });

  it('có vector digest-basic, digest-order và gói hợp lệ', () => {
    expect(withDigest).toContain('digest-basic');
    expect(withDigest).toContain('digest-order');
    expect(withDigest.filter((d) => expectedOf(PACKAGE_VECTORS, d).ok === true).length).toBe(
      withDigest.length - 2,
    );
    expect(withDigest.length).toBeGreaterThanOrEqual(5);
    expect(expectedOf(PACKAGE_VECTORS, 'digest-basic').digest).toBe(BASIC_DIGEST);
  });

  for (const d of withDigest) {
    it(d, async () => {
      const e = expectedOf(PACKAGE_VECTORS, d);
      expect(await packageDigest(e.files, nodeSha256)).toBe(e.digest);
      if (e.text !== undefined) expect(digestText(e.files)).toBe(e.text);
      if (e.contents !== undefined) {
        // size và sha256 của vector tính được từ nội dung (byte UTF-8)
        for (const f of e.files as PackageFile[])
          expect(await packageFile(f.path, e.contents[f.path], nodeSha256)).toEqual(f);
      }
    });
  }

  it('tank-demo đóng gói nén và không nén cùng digest với project tank-demo', () => {
    const project = expectedOf(PROJECT_VECTORS, 'valid-tank-demo').digest;
    expect(project).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(expectedOf(PACKAGE_VECTORS, 'valid-tank-demo-deflate').digest).toBe(project);
    expect(expectedOf(PACKAGE_VECTORS, 'valid-tank-demo-stored').digest).toBe(project);
  });
});

describe('tests/project-vectors: digest của project hợp lệ', () => {
  const valid = vectorDirs(PROJECT_VECTORS).filter((d) => expectedOf(PROJECT_VECTORS, d).valid);

  it('mọi vector hợp lệ có files và digest', () => {
    expect(valid.length).toBeGreaterThanOrEqual(10);
    for (const d of valid) {
      const e = expectedOf(PROJECT_VECTORS, d);
      expect(Array.isArray(e.files), d).toBe(true);
      expect(e.digest, d).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  for (const d of valid) {
    it(d, async () => {
      const e = expectedOf(PROJECT_VECTORS, d);
      // byte trên đĩa (giữ BOM, đúng như gói sẽ chứa)
      const files = await Promise.all(
        (e.files as string[]).map((rel) =>
          packageFile(rel, readFileSync(join(PROJECT_VECTORS, d, rel)), nodeSha256),
        ),
      );
      expect(await packageDigest(files, nodeSha256)).toBe(e.digest);
    });
  }
});
