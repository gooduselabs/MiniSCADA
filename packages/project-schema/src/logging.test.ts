// Ước tính ghi eMMC và dung lượng lưu (specs/003-data-logging/contracts/logging-config.md).
// Bản C++ (core/project-manager/tests/logging_estimate_test.cpp) phải cho cùng số.
import { describe, expect, it } from 'vitest';
import {
  defaultTableName,
  estimateLogging,
  findSecretKey,
  findUrlCredentials,
  unverifiedConnections,
} from './logging.ts';
import type { LoggingConfig, LoggingGroup, TagDataType } from './types.ts';

const types = (entries: Array<[string, TagDataType]>) => new Map<string, TagDataType>(entries);

function oneGroup(g: Partial<LoggingGroup>): LoggingConfig {
  return {
    schemaVersion: '0.1.0',
    groups: [{ id: 'g', name: 'G', mode: 'cyclic', retentionDays: 1, tags: [], ...g }],
  };
}

function floats(n: number, periodMs: number) {
  const tags = Array.from({ length: n }, (_, i) => ({ tagId: `T${i}` }));
  const map = types(tags.map((t) => [t.tagId, 'FLOAT32']));
  return { cfg: oneGroup({ periodMs, tags }), map };
}

describe('estimateLogging', () => {
  it('500 FLOAT32 every second: about 0.99 GB written per day, no warning', () => {
    const { cfg, map } = floats(500, 1000);
    const e = estimateLogging(cfg, map);
    // 2 × 86 400 × (24 + 500 × 9) + 17 280 × 3 × 4 096
    expect(e.writeBytesPerDay).toBe(994083840);
    expect(e.warnings).toEqual([]);
  });

  it('the same every 100 ms: about 8.0 GB per day, W_LOG_WRITE_BUDGET', () => {
    const { cfg, map } = floats(500, 100);
    const e = estimateLogging(cfg, map);
    expect(e.writeBytesPerDay).toBe(8029808640);
    // one day of such rows is already 3.9 GB: over the size cap as well
    expect(e.storageBytes).toBe(864000 * 4524);
    expect(e.warnings).toEqual(['W_LOG_WRITE_BUDGET', 'W_LOG_SIZE_CAP']);
  });

  it('more than 2 GiB to keep for the retention: W_LOG_SIZE_CAP', () => {
    const cfg = oneGroup({
      periodMs: 1000,
      retentionDays: 3650,
      tags: [{ tagId: 'A' }, { tagId: 'B' }, { tagId: 'C' }],
    });
    const e = estimateLogging(
      cfg,
      types([
        ['A', 'FLOAT32'],
        ['B', 'BOOL'],
        ['C', 'STRING'],
      ]),
    );
    // row = 24 + 9 + 2 + (2 + min(255, 64)) = 101 bytes
    expect(e.storageBytes).toBe(86400 * 101 * 3650);
    expect(e.warnings).toEqual(['W_LOG_SIZE_CAP']);
  });

  it('cell sizes by type; onChange counts at its minimum interval', () => {
    const cfg = oneGroup({
      mode: 'onChange',
      minIntervalMs: 2000,
      tags: [
        { tagId: 'B' },
        { tagId: 'I16' },
        { tagId: 'U32' },
        { tagId: 'I64' },
        { tagId: 'S', maxLength: 10 },
      ],
    });
    const e = estimateLogging(
      cfg,
      types([
        ['B', 'BOOL'],
        ['I16', 'INT16'],
        ['U32', 'UINT32'],
        ['I64', 'INT64'],
        ['S', 'STRING'],
      ]),
    );
    const row = 24 + 2 + 3 + 5 + 9 + (2 + 10);
    const rows = 86400000 / 2000;
    expect(e.storageBytes).toBe(rows * row);
    expect(e.writeBytesPerDay).toBe(2 * rows * row + Math.min(17280, rows) * 3 * 4096);
    // default minimum interval: 1 s
    const d = estimateLogging(
      oneGroup({ mode: 'onChange', tags: [{ tagId: 'B' }] }),
      types([['B', 'BOOL']]),
    );
    expect(d.storageBytes).toBe(86400 * 26);
  });
});

describe('names and connections (review I9, S13; security review M2, L4)', () => {
  it('a group id starting with a digit gets the t_ table prefix', () => {
    expect(defaultTableName('3pha')).toBe('t_3pha');
    expect(defaultTableName('van-hanh')).toBe('van_hanh');
  });

  it('secret keys compare in ASCII only', () => {
    expect(findSecretKey({ a: { PassWord: 1 } })).toBe('/a/PassWord');
    expect(findSecretKey({ ['to\u212Aen']: 1 })).toBeNull();
  });

  it('a user or password in a connection URL is a secret', () => {
    const cfg = (url: string) => ({ connections: [{ id: 'a' }, { id: 'b', url }] });
    expect(findUrlCredentials(cfg('https://admin:S3cret@influx:8086'))).toBe('/connections/1/url');
    expect(findUrlCredentials(cfg('https://admin@influx:8086'))).toBe('/connections/1/url');
    expect(findUrlCredentials(cfg('https://influx:8086/a@b'))).toBeNull(); // in the path
    expect(findUrlCredentials(cfg('https://influx:8086'))).toBeNull();
  });

  it('connections a group sends to without checking the server', () => {
    const cfg = {
      schemaVersion: '0.1.0',
      groups: [
        {
          id: 'g',
          name: 'G',
          mode: 'cyclic' as const,
          periodMs: 1000,
          retentionDays: 1,
          tags: [],
          destinations: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        },
      ],
      connections: [
        // no tls: verify-full, the server is checked (Constitution V)
        { id: 'a', type: 'mysql' as const, host: 'h', database: 'd', user: 'u' },
        {
          id: 'b',
          type: 'postgresql' as const,
          host: 'h',
          database: 'd',
          user: 'u',
          tls: 'verify-full' as const,
        },
        {
          id: 'c',
          type: 'mssql' as const,
          host: 'h',
          database: 'd',
          user: 'u',
          tls: 'require' as const,
        },
        { id: 'd', type: 'influxdb' as const, url: 'https://i:8086', org: 'o', bucket: 'b' },
        {
          id: 'e',
          type: 'influxdb' as const,
          url: 'https://i:8086',
          org: 'o',
          bucket: 'b',
          tls: 'require' as const,
        },
        { id: 'f', type: 'influxdb' as const, url: 'http://10.0.0.7:8086', org: 'o', bucket: 'b' },
        {
          id: 'g',
          type: 'influxdb' as const,
          url: 'http://127.0.0.1:8086/',
          org: 'o',
          bucket: 'b',
        },
        {
          id: 'h',
          type: 'mysql' as const,
          host: 'h',
          database: 'd',
          user: 'u',
          tls: 'prefer' as const,
        },
        {
          id: 'unused',
          type: 'mysql' as const,
          host: 'h',
          database: 'd',
          user: 'u',
          tls: 'disable' as const,
        },
      ],
    };
    expect(unverifiedConnections(cfg)).toEqual([2, 4, 5, 7]);
  });
});
