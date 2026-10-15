import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fold, seedAlarmDb } from './index.mjs';

test('fold bỏ dấu tiếng Việt và hạ chữ như foldText của C++', () => {
  assert.equal(fold('Bồn B1 QUÁ ÁP, Đèn'), 'bon b1 qua ap, den');
});

test('seed: số dòng, lược đồ, tính tất định, oracle khớp truy vấn trực tiếp', () => {
  const dir = mkdtempSync(join(tmpdir(), 'alarm-seed-'));
  try {
    const endMs = 1_800_000_000_000;
    const a = seedAlarmDb({ out: join(dir, 'a.db'), rows: 2000, days: 30, seed: 7, endMs });
    const b = seedAlarmDb({ out: join(dir, 'b.db'), rows: 2000, days: 30, seed: 7, endMs });
    assert.deepEqual(a.queries, b.queries);
    const db = new DatabaseSync(join(dir, 'a.db'), { readOnly: true });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM alarm_occurrence').get().n, 2000);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare("SELECT value FROM alarm_meta WHERE key='clean'").get().value, '1');
    const q = db
      .prepare(
        "SELECT COUNT(*) AS n FROM alarm_occurrence WHERE ts_active_ms >= ? AND area = 'bon' AND priority <= 2",
      )
      .get(endMs - 7 * 86400000).n;
    assert.equal(q, a.queries.filter7dAreaBonPrioMajor);
    const s = db
      .prepare("SELECT COUNT(*) AS n FROM alarm_occurrence WHERE text_fold LIKE '%ap suat%'")
      .get().n;
    assert.equal(s, a.queries.search30dApSuat);
    assert.equal(
      db.prepare('SELECT COUNT(DISTINCT alarm_id) AS n FROM alarm_occurrence').get().n <= 200,
      true,
    );
    assert.equal(
      db.prepare('SELECT COUNT(DISTINCT area) AS n FROM alarm_occurrence').get().n >= 4,
      true,
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
