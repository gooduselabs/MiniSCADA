// Phần project của Nạp xuống (feature 006, T191 tìm thấy lỗi): tập file đóng gói phải lấy được cả với project 0.2 (store giữ
// `loaded02`, không có `loaded`), nếu không Nạp xuống báo "Chưa đóng gói được (no-project)".
import { describe, expect, it } from 'vitest';
import { FakeSession } from '../ui/fake-session.ts';
import { newApp02 } from '../ui/test-helpers.ts';
import { createDownloadEnv } from './download-env.ts';

describe('createDownloadEnv: tập file của project', () => {
  it('project 0.2: có đủ file (tags, kết nối, bảng giá trị, bảng theo dõi, màn hình) kèm SHA-256', async () => {
    const { app } = await newApp02();
    const env = createDownloadEnv({
      store: app.store,
      link: {} as never,
      session: new FakeSession(),
      save: async () => true,
    });
    const files = env.project.files();
    expect(files).not.toBeNull();
    const rels = files!.map((f) => f.rel);
    for (const want of [
      'project.json',
      'tags.json',
      'connections.json',
      'value-tables/TrangThaiBom.json',
      'watch-tables/van-hanh.json',
      'screens/main.screen.json',
      'screens/main.bindings.json',
      'screens/main.svg',
    ])
      expect(rels, want).toContain(want);
    expect(files!.every((f) => /^[0-9a-f]{64}$/.test(f.hash))).toBe(true);
  });
});
