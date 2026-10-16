// T120 (lỗi theo ô): ánh xạ lỗi và cảnh báo của logging.json tới ô của lưới nhóm, lưới Tag, kết nối và cả file.
import type { Issue } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { bucketLoggingIssues } from './logging-issues.ts';

const issue = (code: string, path: string, file = 'logging.json'): Issue =>
  ({
    code,
    file,
    path,
    message: `${code} ${path}`,
  }) as Issue;

describe('bucketLoggingIssues', () => {
  it('lỗi nhóm vào đúng ô của lưới nhóm', () => {
    const b = bucketLoggingIssues(
      [
        issue('E_LOG_DUP_ID', '/groups/1/id'),
        issue('E_LOG_MODE', '/groups/0'),
        issue('E_LOG_TRIGGER', '/groups/2/trigger/tagId'),
        issue('E_SCHEMA', '/groups/0/retentionDays'),
        issue('E_LOG_AGG', '/groups/3/aggregates'),
        issue('E_SCHEMA', '/groups/3/periodMs'),
        issue('E_SCHEMA', '/groups/3/minIntervalMs'),
      ],
      'logging.json',
    );
    expect(b.groupCells.get('1:id')).toHaveLength(1);
    expect(b.groupCells.get('0:mode')).toHaveLength(1);
    expect(b.groupCells.get('2:interval')).toHaveLength(1);
    expect(b.groupCells.get('0:retention')).toHaveLength(1);
    expect(b.groupCells.get('3:agg')).toHaveLength(1);
    expect(b.groupCells.get('3:interval')).toHaveLength(2);
    expect(b.groupsWithIssues.has(0)).toBe(true);
    expect(b.hasErrors).toBe(true);
  });

  it('lỗi Tag theo nhóm và dòng, cột đúng', () => {
    const b = bucketLoggingIssues(
      [
        issue('E_LOG_COLUMN', '/groups/0/tags/2/column'),
        issue('E_SCHEMA', '/groups/0/tags/1/deadband'),
        issue('E_LOG_AGG', '/groups/1/tags/0/aggregate'),
        issue('E_REF_TAG', '/groups/1/tags/3/tagId'),
        issue('E_SCHEMA', '/groups/1/tags/3/maxLength'),
        issue('E_LOG_DUP_TAG', '/groups/1/tags/4'),
      ],
      'logging.json',
    );
    expect(b.tagCells.get(0)!.get('2:column')).toHaveLength(1);
    expect(b.tagCells.get(0)!.get('1:deadband')).toHaveLength(1);
    expect(b.tagCells.get(1)!.get('0:agg')).toHaveLength(1);
    expect(b.tagCells.get(1)!.get('3:tag')).toHaveLength(1);
    expect(b.tagCells.get(1)!.get('3:length')).toHaveLength(1);
    expect(b.tagCells.get(1)!.get('4:tag')).toHaveLength(1);
  });

  it('cảnh báo vào bản đồ cảnh báo, không tính là lỗi', () => {
    const b = bucketLoggingIssues([issue('W_LOG_WRITE_BUDGET', '')], 'logging.json');
    expect(b.hasErrors).toBe(false);
    expect(b.file.length).toBe(1);
    const c = bucketLoggingIssues(
      [issue('W_LOG_RETENTION', '/groups/0/retentionDays')],
      'logging.json',
    );
    expect(c.groupWarns.get('0:retention')).toHaveLength(1);
    expect(c.groupCells.size).toBe(0);
  });

  it('kết nối: theo chỉ số; file khác bị bỏ; E_LOG_SECRET theo kết nối', () => {
    const b = bucketLoggingIssues(
      [
        issue('E_LOG_REF_DEST', '/groups/0/destinations/0'),
        issue('E_LOG_SECRET', '/connections/1/url'),
        issue('E_SCHEMA', '/connections/0/port'),
        issue('E_SCHEMA', '/x', 'tags.json'),
        issue('E_SCHEMA', '', 'logging.json'),
      ],
      'logging.json',
    );
    expect(b.conns.get(1)).toHaveLength(1);
    expect(b.conns.get(0)).toHaveLength(1);
    expect(b.groupsWithIssues.has(0)).toBe(true);
    expect(b.file.length).toBe(1);
    expect([...b.conns.values()].flat().every((i) => i.file === 'logging.json')).toBe(true);
  });

  it('đường dẫn lạ không ném, rơi vào mức file', () => {
    const b = bucketLoggingIssues([issue('E_SCHEMA', '/khong/biet')], 'logging.json');
    expect(b.file.length).toBe(1);
  });
});
