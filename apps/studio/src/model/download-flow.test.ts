// Hộp thoại Nạp xuống (feature 005, data-model §13, FR-020–FR-024; contracts/tauri-commands.md §8): mô hình
// thuần trên project và thiết bị giả. Không gọi lệnh Tauri: mọi bước với thiết bị đi qua `DownloadDevice`.
import { createHash } from 'node:crypto';
import {
  MemorySource,
  packageDigest,
  packageFile,
  type Issue,
  type PackageFile,
} from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import type { DeviceError, Role } from '../platform/device-types.ts';
import type { ReadOutcome } from '../platform/types.ts';
import type { DeviceInfo } from './device.ts';
import {
  DownloadFlow,
  MAX_PACKAGE_BYTES,
  PREVIEW_ROWS,
  type DeployEvent,
  type DeployOperation,
  type DeployStep,
  type DownloadDevice,
  type DownloadProject,
  type PackageInfo,
  type ProjectIdentity,
} from './download-flow.ts';

const sha = (data: string | Uint8Array) =>
  createHash('sha256')
    .update(typeof data === 'string' ? new TextEncoder().encode(data) : data)
    .digest('hex');
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

// ---------- Project mẫu ----------

interface Spec {
  projectId?: string;
  version?: string;
  minRuntime?: string;
  tags?: string[];
  groups?: object[];
}
const tag = (id: string) => ({ id, type: 'FLOAT32', source: { kind: 'mock', signal: 'x' } });
const GROUP = {
  id: 'van-hanh',
  name: 'Vận hành',
  mode: 'onChange',
  retentionDays: 30,
  tags: [{ tagId: 'TANK01.LEVEL' }],
};

function texts(s: Spec = {}): Record<string, string> {
  return {
    'logging.json': json({ schemaVersion: '0.1.0', groups: s.groups ?? [GROUP] }),
    'project.json': json({
      format: 'matscada-project',
      schemaVersion: '0.1.0',
      projectId: s.projectId ?? 'tram-bom',
      projectName: 'Trạm bơm',
      projectVersion: s.version ?? '1.0.0',
      minRuntimeVersion: s.minRuntime ?? '0.4.0',
      entryScreen: 'main',
      screens: ['main'],
      tagFile: 'tags.json',
      maxClients: 10,
      loggingFile: 'logging.json',
    }),
    'screens/main.bindings.json': json({ schemaVersion: '0.1.0', screenId: 'main', elements: [] }),
    'screens/main.screen.json': json({
      schemaVersion: '0.1.0',
      id: 'main',
      name: 'Chính',
      svgFile: 'screens/main.svg',
      viewBox: [0, 0, 100, 100],
      fitMode: 'contain',
      bindingFile: 'screens/main.bindings.json',
      elements: [],
    }),
    'screens/main.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    'tags.json': json({
      schemaVersion: '0.1.0',
      tags: (s.tags ?? ['TANK01.LEVEL', 'MOTOR01.RUN']).map(tag),
    }),
  };
}

const identityOf = (t: Record<string, string>): ProjectIdentity => {
  const p = JSON.parse(t['project.json']) as ProjectIdentity;
  return {
    projectId: p.projectId,
    projectName: p.projectName,
    projectVersion: p.projectVersion,
    minRuntimeVersion: p.minRuntimeVersion,
  };
};

async function packageOf(
  t: Record<string, string>,
  origin: 'built' | 'fetched',
  packageId: string,
  extra = 0,
): Promise<PackageInfo> {
  const files: PackageFile[] = await Promise.all(
    Object.keys(t)
      .sort()
      .map((p) => packageFile(p, t[p], sha)),
  );
  const digest = await packageDigest(files, sha);
  return {
    packageId,
    origin,
    digest,
    size: files.reduce((n, f) => n + f.size, 0) + 500 + extra,
    manifest: {
      format: 'matscada-package',
      formatVersion: '1.0.0',
      project: identityOf(t),
      createdAt: '2026-10-11T00:00:00Z',
      generator: { name: 'mAT Studio', version: '0.2.0' },
      files,
      digest,
    },
  };
}

const ERROR: Issue = { code: 'E_TAG_RANGE', file: 'tags.json', path: '/tags/0', message: 'x' };
const WARNING: Issue = {
  code: 'W_LOG_WRITE_BUDGET',
  file: 'logging.json',
  path: '/groups/0',
  message: 'x',
};

/** Project đang mở trong Studio: `read` là nội dung 004 đã đọc (hash lúc đọc), `disk` là file trên đĩa. */
class FakeProject implements DownloadProject {
  disk: Record<string, string>;
  read: Record<string, string>;
  isDirty = false;
  saveOk = true;
  errors: Issue[] = [];
  warnings: Issue[] = [];
  calls: string[] = [];
  constructor(t: Record<string, string>) {
    this.disk = { ...t };
    this.read = { ...t };
  }
  dirty() {
    return this.isDirty;
  }
  async save() {
    this.calls.push('save');
    if (this.saveOk) this.isDirty = false;
    return this.saveOk;
  }
  async reload() {
    this.calls.push('reload');
    this.read = { ...this.disk };
  }
  async check() {
    this.calls.push('check');
    return { errors: [...this.errors], warnings: [...this.warnings] };
  }
  identity() {
    return identityOf(this.read);
  }
  files() {
    return Object.keys(this.read)
      .sort()
      .map((rel) => ({ rel, hash: sha(this.read[rel]) }));
  }
  source() {
    return new MemorySource(this.read);
  }
}

const STEP_IDS = ['receive', 'verify-package', 'validate', 'backup', 'activate', 'health'];
const steps = (...states: DeployStep['state'][]): DeployStep[] =>
  states.map((state, i) => ({ id: STEP_IDS[i], state }));

/** Thiết bị giả: project đang chạy, system/info, phiên, chỗ trống; nạp xuống theo kịch bản của từng test. */
class FakeDevice implements DownloadDevice {
  running: Record<string, string> | null;
  runningSeq = 6;
  runtimeVersion = '0.4.0';
  clients = 4;
  own = 1;
  operationInfo: { kind: string; step: string; since: number } | null = null;
  infoError: DeviceError | null = null;
  sessionInfo: { user: string; role: Role } | null = { user: 'kysu1', role: 'engineer' };
  free: number | null = 1_000_000_000;
  extraSize = 0;
  digest: string | null = null;
  calls: string[] = [];
  built: Array<Array<{ rel: string; hash: string }>> = [];
  discarded: string[] = [];
  deploys: Array<{ packageId: string; base: string }> = [];
  restores: Array<{ seq: number; base: string }> = [];
  lastOperation: DeployOperation | null | DeviceError = null;
  /** Kịch bản nạp xuống/khôi phục; mặc định thành công. */
  onDeploy: (on: (e: DeployEvent) => void) => Promise<DeployOperation | DeviceError>;
  onRestore: (on: (e: DeployEvent) => void) => Promise<DeployOperation | DeviceError>;
  private readonly project: FakeProject;
  private seq = 0;

  constructor(project: FakeProject, running: Record<string, string> | null) {
    this.project = project;
    this.running = running;
    this.onDeploy = (on) => this.commit(on, 'deploy');
    this.onRestore = (on) => this.commit(on, 'restore');
  }

  async init(): Promise<this> {
    this.digest = this.running ? (await packageOf(this.running, 'fetched', 'x')).digest : null;
    return this;
  }

  /** Thao tác thành công: gửi gói, chạy từng bước, chạy lại, commit. */
  async commit(on: (e: DeployEvent) => void, kind: 'deploy' | 'restore') {
    const skip = kind === 'restore';
    if (!skip) {
      on({ kind: 'send', sent: 0, total: 2000 });
      on({ kind: 'send', sent: 2000, total: 2000 });
    }
    const first = skip ? 'skipped' : 'ok';
    on({
      kind: 'operation',
      op: opOf(kind, 'running', steps(first, first, 'running', 'pending', 'pending', 'pending')),
    });
    on({ kind: 'restarting' });
    clock.t += 6500;
    const final = opOf(kind, 'committed', steps(first, first, 'ok', 'ok', 'ok', 'ok'));
    on({ kind: 'operation', op: final });
    return final;
  }

  async info(): Promise<DeviceInfo | DeviceError> {
    this.calls.push('info');
    if (this.infoError) return this.infoError;
    const p = this.running ? identityOf(this.running) : null;
    return {
      runtimeVersion: this.runtimeVersion,
      protocolVersion: '1.1.0',
      clients: this.clients,
      maxClients: 10,
      project: p
        ? {
            status: 'active',
            projectId: p.projectId,
            projectVersion: p.projectVersion,
            projectName: p.projectName,
            digest: this.digest,
            errors: [],
          }
        : { status: 'missing', digest: null, errors: [] },
      operation: this.operationInfo,
    };
  }
  async session() {
    this.calls.push('session');
    return this.sessionInfo;
  }
  async freeBytes() {
    return this.free;
  }
  ownLiveSessions() {
    return this.own;
  }
  async buildPackage(files: Array<{ rel: string; hash: string }>) {
    this.built.push(files);
    // Rust đọc lại file trên đĩa, so với hash lúc giao diện đọc (contract §8).
    for (const f of files)
      if (sha(this.project.disk[f.rel] ?? '') !== f.hash)
        return { error: 'changed', detail: f.rel };
    const t = Object.fromEntries(files.map((f) => [f.rel, this.project.disk[f.rel]]));
    return packageOf(t, 'built', `built-${++this.seq}`, this.extraSize);
  }
  async manifest() {
    this.calls.push('manifest');
    if (!this.running) return { error: 'no-project-package' };
    return (await packageOf(this.running, 'fetched', 'm')).manifest;
  }
  async fetchPackage() {
    this.calls.push('fetch');
    if (!this.running) return { error: 'no-project-package' };
    return packageOf(this.running, 'fetched', `fetched-${++this.seq}`);
  }
  async readPackageFile(packageId: string, rel: string): Promise<ReadOutcome> {
    this.calls.push(`read ${packageId} ${rel}`);
    const text = this.running?.[rel];
    return text === undefined ? { error: 'missing' } : { text, hash: sha(text) };
  }
  async discardPackage(packageId: string) {
    this.discarded.push(packageId);
  }
  async deploy(packageId: string, base: string, on: (e: DeployEvent) => void) {
    this.deploys.push({ packageId, base });
    return this.onDeploy(on);
  }
  async restore(seq: number, base: string, on: (e: DeployEvent) => void) {
    this.restores.push({ seq, base });
    return this.onRestore(on);
  }
  async operation() {
    this.calls.push('operation');
    return this.lastOperation;
  }
}

const D_OLD = `sha256:${'6'.repeat(64)}`;
const D_NEW = `sha256:${'7'.repeat(64)}`;

function opOf(
  kind: 'deploy' | 'restore',
  result: DeployOperation['result'],
  s: DeployStep[],
  extra: Partial<DeployOperation> = {},
): DeployOperation {
  return {
    opId: 'op-1',
    kind,
    user: 'kysu1',
    source: '192.168.1.20',
    startedAt: '2026-10-11T03:11:52Z',
    endedAt: result === 'running' ? null : '2026-10-11T03:11:58Z',
    from: { seq: 6, digest: D_OLD, projectVersion: '1.0.0' },
    to: { seq: 7, digest: D_NEW, projectId: 'tram-bom', projectVersion: '1.1.0' },
    steps: s,
    result,
    error: null,
    clientsNotified: result === 'committed' ? 3 : 0,
    ...extra,
  };
}

const clock = { t: 1_000 };

async function setup(local: Spec = { version: '1.1.0' }, device: Spec | null = {}) {
  clock.t = 1_000;
  const project = new FakeProject(texts(local));
  const dev = await new FakeDevice(project, device ? texts(device) : null).init();
  const flow = new DownloadFlow({ project, device: dev, now: () => clock.t });
  const seen: string[] = [];
  flow.subscribe((f) => {
    if (seen.at(-1) !== f.state) seen.push(f.state);
  });
  return { project, device: dev, flow, seen };
}

/** Mở hộp thoại tới bước xem trước. */
async function previewOf(local?: Spec, device?: Spec | null) {
  const h = await setup(local, device);
  await h.flow.open();
  expect(h.flow.state).toBe('preview');
  return { ...h, preview: h.flow.preview! };
}

// ---------- Đường đi chính ----------

describe('DownloadFlow: closed → preparing → preview → running → result', () => {
  it('đường đi chính: đóng gói từ file đã đọc, so với thiết bị, xem trước, nạp xuống, kết quả', async () => {
    const h = await setup({ version: '1.1.0', tags: ['TANK01.LEVEL', 'MOTOR01.RUN', 'X.NEW'] });
    expect(h.flow.state).toBe('closed');
    await h.flow.open();
    expect(h.flow.state).toBe('preview');
    // Gói đóng từ tập file của project kèm SHA-256 lúc 004 đọc.
    expect(h.device.built).toEqual([h.project.files()]);
    const pv = h.flow.preview!;
    expect(pv.canDeploy).toBe(true);
    expect(pv.blockers).toEqual([]);
    expect(pv.baseDigest).toBe(h.device.digest);
    expect(Object.keys(pv.rows)).toEqual([...PREVIEW_ROWS]);
    expect(PREVIEW_ROWS).toEqual([
      'check',
      'runtime',
      'replace',
      'clients',
      'size',
      'logging',
      'device',
    ]);

    await h.flow.deploy();
    expect(h.device.deploys).toEqual([{ packageId: 'built-1', base: h.device.digest }]);
    expect(h.seen).toEqual(['preparing', 'preview', 'running', 'result']);
    const r = h.flow.result!;
    expect(r.kind).toBe('deploy');
    expect(r.outcome).toBe('committed');
    expect(r.durationMs).toBe(6500);
    expect(r.running).toEqual({ seq: 7, digest: D_NEW, projectVersion: '1.1.0' });
    expect(r.clientsNotified).toBe(3);
    expect(r.previousSeq).toBe(6);
    expect(r.error).toBeNull();

    expect(h.flow.close()).toBe(true);
    expect(h.flow.state).toBe('closed');
    expect(h.device.discarded).toContain('built-1'); // gói tạm bỏ khi đóng hộp thoại
  });

  it('còn thay đổi chưa lưu: hỏi "Lưu rồi nạp xuống" hoặc Hủy; Hủy thì không đóng gói gì', async () => {
    const h = await setup();
    h.project.isDirty = true;
    await h.flow.open();
    expect(h.flow.state).toBe('preparing');
    expect(h.flow.step).toBe('ask-save');
    expect(h.device.built).toEqual([]);
    expect(h.flow.close()).toBe(true);
    expect(h.flow.state).toBe('closed');
    expect(h.project.calls).toEqual([]);
    expect(h.device.built).toEqual([]);
  });

  it('Lưu rồi nạp xuống: lưu, kiểm, đóng gói từ file đã lưu, rồi xem trước', async () => {
    const h = await setup();
    h.project.isDirty = true;
    await h.flow.open();
    await h.flow.saveAndContinue();
    expect(h.project.calls.slice(0, 2)).toEqual(['save', 'check']);
    expect(h.flow.state).toBe('preview');
    expect(h.device.built).toHaveLength(1);
  });

  it('lưu không được (hủy khi xung đột, lỗi ghi): đóng hộp thoại, không đóng gói', async () => {
    const h = await setup();
    h.project.isDirty = true;
    h.project.saveOk = false;
    await h.flow.open();
    await h.flow.saveAndContinue();
    expect(h.flow.state).toBe('closed');
    expect(h.device.built).toEqual([]);
  });

  it('file trên đĩa khác lần đọc của 004: đọc lại, kiểm lại rồi đóng gói lại', async () => {
    const h = await setup();
    h.project.disk['tags.json'] = json({ schemaVersion: '0.1.0', tags: [tag('SUA.NGOAI')] });
    await h.flow.open();
    expect(h.project.calls).toEqual(['check', 'reload', 'check']);
    expect(h.device.built).toHaveLength(2);
    expect(h.device.built[1]).toContainEqual({
      rel: 'tags.json',
      hash: sha(h.project.disk['tags.json']),
    });
    expect(h.flow.state).toBe('preview');
    expect(h.flow.preview!.package?.packageId).toBe('built-1');
  });

  it('file cứ đổi mãi: sau 3 lần đóng gói thì báo lỗi gói và khóa nạp', async () => {
    const h = await setup();
    let n = 0;
    h.project.reload = async () => {
      h.project.calls.push('reload');
      h.project.read = { ...h.project.disk };
      h.project.disk['tags.json'] = json({ schemaVersion: '0.1.0', tags: [tag(`N${++n}`)] });
    };
    h.project.disk['tags.json'] = json({ schemaVersion: '0.1.0', tags: [tag('N0')] });
    await h.flow.open();
    expect(h.device.built).toHaveLength(3);
    const pv = h.flow.preview!;
    expect(pv.package).toBeNull();
    expect(pv.rows.size).toMatchObject({
      status: 'error',
      problem: 'package',
      error: { error: 'changed', detail: 'tags.json' },
    });
    expect(pv.blockers).toContain('package');
    expect(pv.canDeploy).toBe(false);
  });
});

// ---------- Các dòng xem trước và điều kiện khóa (FR-020) ----------

describe('DownloadFlow: bước xem trước', () => {
  it('Kiểm tra project: có lỗi thì khóa nạp, kèm danh sách lỗi', async () => {
    const h = await setup();
    h.project.errors = [ERROR];
    await h.flow.open();
    const pv = h.flow.preview!;
    expect(pv.rows.check).toEqual({ id: 'check', status: 'error', errors: [ERROR], warnings: [] });
    expect(pv.blockers).toEqual(['errors']);
    expect(pv.canDeploy).toBe(false);
    await h.flow.deploy();
    expect(h.device.deploys).toEqual([]);
    expect(h.flow.state).toBe('preview');
  });

  it('có cảnh báo thì phải đánh dấu "đã đọc cảnh báo"', async () => {
    const h = await setup();
    h.project.warnings = [WARNING];
    await h.flow.open();
    const pv = h.flow.preview!;
    expect(pv.rows.check.status).toBe('warn');
    expect(pv.needsAck).toBe(true);
    expect(pv.acknowledged).toBe(false);
    expect(pv.canDeploy).toBe(false);
    h.flow.acknowledge(true);
    expect(h.flow.preview!.canDeploy).toBe(true);
    h.flow.acknowledge(false);
    expect(h.flow.preview!.canDeploy).toBe(false);
    h.flow.acknowledge(true);
    await h.flow.deploy();
    expect(h.flow.state).toBe('result');
  });

  it('Tương thích runtime: project cần runtime mới hơn thiết bị thì khóa', async () => {
    const newer = await previewOf({ version: '1.1.0', minRuntime: '0.5.0' });
    expect(newer.preview.rows.runtime).toEqual({
      id: 'runtime',
      status: 'error',
      required: '0.5.0',
      device: '0.4.0',
    });
    expect(newer.preview.blockers).toEqual(['runtime']);
    const same = await previewOf({ version: '1.1.0', minRuntime: '0.4.0' });
    expect(same.preview.rows.runtime.status).toBe('ok');
    const h = await setup();
    h.device.runtimeVersion = 'lạ';
    await h.flow.open();
    expect(h.flow.preview!.rows.runtime).toMatchObject({ status: 'unknown', device: null });
    expect(h.flow.preview!.blockers).toEqual([]);
  });

  it('Thay project đang chạy: phiên bản cũ → mới, tóm tắt CompareResult; gói đọc lên bỏ sau khi so', async () => {
    const h = await previewOf({ version: '1.1.0', tags: ['TANK01.LEVEL', 'MOTOR01.RUN', 'X.NEW'] });
    const row = h.preview.rows.replace;
    expect(row.status).toBe('notice');
    expect(row.device).toEqual({
      state: 'active',
      projectId: 'tram-bom',
      projectName: 'Trạm bơm',
      projectVersion: '1.0.0',
      digest: h.device.digest,
    });
    expect(row.local).toMatchObject({ projectId: 'tram-bom', projectVersion: '1.1.0' });
    expect(row.otherProject).toBe(false);
    expect(row.compareError).toBeNull();
    expect(row.compare?.same).toBe(false);
    expect(row.summary).toEqual({
      same: false,
      counts: { '=': 6, '≠': 1, '+': 1, '-': 0 },
      byKind: { project: { '≠': 1, '+': 0, '-': 0 }, tag: { '≠': 0, '+': 1, '-': 0 } },
    });
    // Có file JSON khác: tải manifest rồi gói của thiết bị, đọc đúng file khác, rồi bỏ gói.
    expect(h.device.calls.filter((c) => c === 'manifest' || c === 'fetch')).toEqual([
      'manifest',
      'fetch',
    ]);
    expect(h.device.calls.filter((c) => c.startsWith('read '))).toEqual([
      'read fetched-2 project.json',
      'read fetched-2 tags.json',
    ]);
    expect(h.device.discarded).toEqual(['fetched-2']);
  });

  it('Thay project đang chạy: giống hệt thì chỉ cần system/info', async () => {
    const h = await previewOf({}, {});
    expect(h.preview.rows.replace.summary?.same).toBe(true);
    expect(h.device.calls).not.toContain('manifest');
    expect(h.device.calls).not.toContain('fetch');
  });

  it('Thay project đang chạy: thiết bị chưa có project thì mọi thứ là +, gửi base `none`', async () => {
    const h = await previewOf({}, null);
    const row = h.preview.rows.replace;
    expect(row.status).toBe('ok');
    expect(row.device).toEqual({ state: 'none' });
    expect(row.summary?.counts).toEqual({ '=': 0, '≠': 0, '+': 7, '-': 0 });
    expect(h.preview.baseDigest).toBe('none');
    expect(h.device.calls).not.toContain('manifest');
    await h.flow.deploy();
    expect(h.device.deploys[0].base).toBe('none');
  });

  it('Thay project đang chạy: project khác trên thiết bị được đánh dấu', async () => {
    const h = await previewOf({ projectId: 'tram-khac' });
    expect(h.preview.rows.replace.otherProject).toBe(true);
  });

  it('Thay project đang chạy: không so được (đọc gói bị từ chối) vẫn xem trước được', async () => {
    const h = await setup({ version: '1.1.0' });
    h.device.fetchPackage = async () => ({ error: 'forbidden' });
    await h.flow.open();
    const row = h.flow.preview!.rows.replace;
    expect(row.compare).toBeNull();
    expect(row.compareError).toBe('forbidden');
    expect(h.flow.preview!.rows.logging.status).toBe('unknown');
    expect(h.flow.preview!.canDeploy).toBe(true);
  });

  it('Client sẽ tải lại: system/info.clients trừ phiên của Studio', async () => {
    const h = await previewOf();
    expect(h.preview.rows.clients).toEqual({ id: 'clients', status: 'notice', count: 3 });
    const only = await setup();
    only.device.clients = 1;
    await only.flow.open();
    expect(only.flow.preview!.rows.clients).toEqual({ id: 'clients', status: 'ok', count: 0 });
  });

  it('Dung lượng: gói > 50 MiB hoặc thiết bị thiếu chỗ thì khóa', async () => {
    expect(MAX_PACKAGE_BYTES).toBe(52_428_800);
    const ok = await previewOf();
    const size = ok.preview.rows.size;
    expect(size).toMatchObject({
      status: 'ok',
      bytes: ok.preview.package!.size,
      limit: MAX_PACKAGE_BYTES,
      freeBytes: 1_000_000_000,
      problem: null,
    });
    // Cần chỗ cho gói và các file sau khi giải nén.
    const unpacked = ok.preview.package!.manifest.files.reduce((n, f) => n + f.size, 0);
    expect(size.needBytes).toBe(ok.preview.package!.size + unpacked);

    const big = await setup();
    big.device.extraSize = MAX_PACKAGE_BYTES;
    await big.flow.open();
    expect(big.flow.preview!.rows.size).toMatchObject({ status: 'error', problem: 'too-large' });
    expect(big.flow.preview!.blockers).toEqual(['too-large']);

    const full = await setup();
    full.device.free = 100;
    await full.flow.open();
    expect(full.flow.preview!.rows.size).toMatchObject({ status: 'error', problem: 'no-space' });
    expect(full.flow.preview!.blockers).toEqual(['no-space']);

    const unknown = await setup();
    unknown.device.free = null;
    await unknown.flow.open();
    expect(unknown.flow.preview!.rows.size).toMatchObject({ status: 'ok', freeBytes: null });
  });

  it('Lưu trữ dữ liệu: nhóm thêm, bớt, đổi; cột mới', async () => {
    const h = await previewOf({
      version: '1.1.0',
      groups: [
        { ...GROUP, tags: [{ tagId: 'TANK01.LEVEL' }, { tagId: 'MOTOR01.RUN' }] },
        {
          id: 'ca-dem',
          name: 'Ca đêm',
          mode: 'cyclic',
          periodMs: 5000,
          retentionDays: 7,
          tags: [],
        },
      ],
    });
    expect(h.preview.rows.logging).toEqual({
      id: 'logging',
      status: 'notice',
      impact: {
        settings: '=',
        added: ['ca-dem'],
        removed: [],
        changed: ['van-hanh'],
        newColumns: [{ group: 'van-hanh', tagId: 'MOTOR01.RUN' }],
        connections: { added: [], removed: [], changed: [] },
      },
    });
    const same = await previewOf({ version: '1.1.0' });
    expect(same.preview.rows.logging.status).toBe('ok');
  });

  it('Thiết bị: phiên còn hạn, role ≥ engineer, thiết bị không bận', async () => {
    const ok = await previewOf();
    expect(ok.preview.rows.device).toEqual({
      id: 'device',
      status: 'ok',
      user: 'kysu1',
      role: 'engineer',
      problems: [],
      busy: null,
      error: null,
    });
    const cases: Array<[(d: FakeDevice) => void, string]> = [
      [(d) => (d.sessionInfo = null), 'session'],
      [(d) => (d.sessionInfo = { user: 'xem1', role: 'viewer' }), 'role'],
      [(d) => (d.sessionInfo = { user: 'vh1', role: 'operator' }), 'role'],
      [(d) => (d.operationInfo = { kind: 'deploy', step: 'health', since: 1791601205000 }), 'busy'],
      [(d) => (d.infoError = { error: 'unreachable' }), 'unreachable'],
    ];
    for (const [arrange, problem] of cases) {
      const h = await setup();
      arrange(h.device);
      await h.flow.open();
      const pv = h.flow.preview!;
      expect(pv.rows.device.status, problem).toBe('error');
      expect(pv.rows.device.problems, problem).toEqual([problem]);
      expect(pv.blockers, problem).toEqual([problem]);
      expect(pv.canDeploy, problem).toBe(false);
    }
    const busy = await setup();
    busy.device.operationInfo = { kind: 'deploy', step: 'health', since: 1791601205000 };
    await busy.flow.open();
    expect(busy.flow.preview!.rows.device.busy).toEqual({
      opId: null,
      kind: 'deploy',
      step: 'health',
      user: null,
      source: null,
      since: 1791601205000,
    });
    const admin = await setup();
    admin.device.sessionInfo = { user: 'admin', role: 'administrator' };
    await admin.flow.open();
    expect(admin.flow.preview!.canDeploy).toBe(true);
  });
});

// ---------- Tiến trình và kết quả ----------

describe('DownloadFlow: running theo DeployEvent, result', () => {
  it('running: bước theo DeployEvent (gửi gói, trạng thái từng bước, thiết bị chạy lại)', async () => {
    const h = await previewOf();
    const snapshots: Array<{ steps: string; send: string; restarting: boolean }> = [];
    h.flow.subscribe((f) => {
      const r = f.running;
      if (r)
        snapshots.push({
          steps: r.steps.map((s) => `${s.id}:${s.state}`).join(' '),
          send: r.send ? `${r.send.sent}/${r.send.total}` : '-',
          restarting: r.restarting,
        });
    });
    await h.flow.deploy();
    expect(snapshots[0]).toEqual({
      steps:
        'receive:running verify-package:pending validate:pending backup:pending activate:pending health:pending',
      send: '-',
      restarting: false,
    });
    expect(snapshots.map((s) => s.send)).toContain('2000/2000');
    expect(snapshots).toContainEqual({
      steps:
        'receive:ok verify-package:ok validate:running backup:pending activate:pending health:pending',
      send: '2000/2000',
      restarting: false,
    });
    // Thiết bị chạy lại: cờ bật tới khi thao tác báo trạng thái mới.
    const restart = snapshots.findIndex((s) => s.restarting);
    expect(restart).toBeGreaterThan(0);
    expect(snapshots[restart + 1]?.restarting).toBe(false);
    expect(h.flow.running).toBeNull();
    expect(h.flow.result!.steps.map((s) => s.state)).toEqual(Array(6).fill('ok'));
  });

  it('kiểm tra sức khỏe lỗi: rolled-back, bản đang chạy là bản cũ ("đã quay về bản X")', async () => {
    const h = await previewOf();
    h.device.onDeploy = async (on) => {
      const op = opOf(
        'deploy',
        'rolled-back',
        [...steps('ok', 'ok', 'ok', 'ok', 'ok', 'failed'), { id: 'rollback', state: 'ok' }],
        { error: { code: 'HEALTH_TIMEOUT', message: 'quá 15 s' } },
      );
      on({ kind: 'operation', op });
      return op;
    };
    await h.flow.deploy();
    const r = h.flow.result!;
    expect(r.outcome).toBe('rolled-back');
    expect(r.running).toEqual({ seq: 6, digest: D_OLD, projectVersion: '1.0.0' });
    expect(r.error).toEqual({ code: 'HEALTH_TIMEOUT', message: 'quá 15 s' });
    expect(r.previousSeq).toBeNull();
    expect(r.steps.map((s) => `${s.id}:${s.state}`)).toEqual([
      'receive:ok',
      'verify-package:ok',
      'validate:ok',
      'backup:ok',
      'activate:ok',
      'health:failed',
      'rollback:ok',
    ]);
  });

  it('kiểm project trên thiết bị lỗi: failed kèm issues, bản cũ chạy tiếp', async () => {
    const h = await previewOf();
    const issues: Issue[] = [ERROR];
    h.device.onDeploy = async () =>
      opOf('deploy', 'failed', steps('ok', 'ok', 'failed', 'pending', 'pending', 'pending'), {
        error: { code: 'E_VALIDATION', issues },
      });
    await h.flow.deploy();
    expect(h.flow.result).toMatchObject({
      outcome: 'failed',
      error: { code: 'E_VALIDATION', issues },
      running: { seq: 6, projectVersion: '1.0.0' },
      clientsNotified: 0,
    });
  });

  it('từ result chạy Khôi phục bản trước (kind = restore) trên cùng chuỗi kiểm tra', async () => {
    const h = await previewOf();
    await h.flow.deploy();
    expect(h.flow.result!.previousSeq).toBe(6);
    const seen: string[] = [];
    h.flow.subscribe((f) => {
      if (f.running)
        seen.push(
          f.running.steps
            .slice(0, 2)
            .map((s) => s.state)
            .join(','),
        );
    });
    await h.flow.restore();
    expect(h.device.restores).toEqual([{ seq: 6, base: D_NEW }]);
    expect(seen[0]).toBe('skipped,skipped');
    expect(h.flow.state).toBe('result');
    expect(h.flow.result).toMatchObject({ kind: 'restore', outcome: 'committed' });
  });

  it('Khôi phục bản đã chọn khi hộp thoại đang đóng (danh sách bản lưu)', async () => {
    const h = await setup();
    await h.flow.restore(5, D_OLD);
    expect(h.device.restores).toEqual([{ seq: 5, base: D_OLD }]);
    expect(h.flow.result).toMatchObject({ kind: 'restore', outcome: 'committed' });
    // Không có bản nào để khôi phục: không làm gì.
    const none = await setup();
    await none.flow.restore();
    expect(none.flow.state).toBe('closed');
    expect(none.device.restores).toEqual([]);
  });

  it('BASE_CHANGED: có người vừa nạp xuống, về bước xem trước (so lại, đánh dấu lại cảnh báo)', async () => {
    const h = await setup({ version: '1.1.0' });
    h.project.warnings = [WARNING];
    await h.flow.open();
    h.flow.acknowledge(true);
    h.device.onDeploy = async () => {
      h.device.running = texts({ version: '1.0.5' }); // máy khác vừa nạp bản này
      h.device.digest = (await packageOf(h.device.running, 'fetched', 'x')).digest;
      return { error: 'base-changed' };
    };
    const infos = h.device.calls.filter((c) => c === 'info').length;
    await h.flow.deploy();
    expect(h.flow.state).toBe('preview');
    const pv = h.flow.preview!;
    expect(pv.notice).toEqual({ code: 'base-changed' });
    expect(pv.acknowledged).toBe(false);
    expect(pv.canDeploy).toBe(false);
    expect(pv.rows.replace.device.projectVersion).toBe('1.0.5');
    expect(pv.baseDigest).toBe(h.device.digest);
    expect(h.device.calls.filter((c) => c === 'info').length).toBe(infos + 1);
    expect(h.device.discarded).toContain('built-1');
  });

  it('DEVICE_BUSY khi bấm Nạp xuống: về bước xem trước, hiện ai, từ đâu, từ lúc nào', async () => {
    const h = await previewOf();
    const busy = {
      opId: 'op-9',
      kind: 'deploy',
      user: 'kysu2',
      source: '192.168.1.30',
      since: 1791601205000,
    };
    h.device.onDeploy = async () => {
      h.device.operationInfo = { kind: 'deploy', step: 'validate', since: busy.since };
      return { error: 'busy', detail: busy };
    };
    await h.flow.deploy();
    const pv = h.flow.preview!;
    expect(pv.notice).toEqual({ code: 'busy', busy: { ...busy, step: 'validate' } });
    expect(pv.rows.device.problems).toEqual(['busy']);
    expect(pv.rows.device.busy).toEqual({ ...busy, step: 'validate' });
  });

  it('phiên hết hạn hoặc thiếu quyền khi gửi: về bước xem trước', async () => {
    for (const code of ['session-expired', 'forbidden'] as const) {
      const h = await previewOf();
      h.device.onDeploy = async () => {
        h.device.sessionInfo = code === 'forbidden' ? { user: 'kysu1', role: 'viewer' } : null;
        return { error: code };
      };
      await h.flow.deploy();
      expect(h.flow.state, code).toBe('preview');
      expect(h.flow.preview!.notice, code).toEqual({ code });
      expect(h.flow.preview!.rows.device.problems, code).toEqual([
        code === 'forbidden' ? 'role' : 'session',
      ]);
    }
  });

  it('lỗi trước khi thiết bị nhận gói (507, 503…): kết quả error, không đổi gì trên thiết bị', async () => {
    const h = await previewOf();
    h.device.onDeploy = async () => ({ error: 'no-space' });
    await h.flow.deploy();
    expect(h.flow.result).toMatchObject({
      outcome: 'error',
      error: { code: 'no-space' },
      op: null,
      running: null,
    });
  });

  it('mất theo dõi khi thiết bị chạy lại: hỏi thao tác gần nhất', async () => {
    const done = opOf('deploy', 'committed', steps('ok', 'ok', 'ok', 'ok', 'ok', 'ok'));
    const h = await previewOf();
    h.device.onDeploy = async (on) => {
      on({
        kind: 'operation',
        op: opOf('deploy', 'running', steps('ok', 'ok', 'ok', 'ok', 'running', 'pending')),
      });
      return { error: 'lost' };
    };
    h.device.lastOperation = done;
    await h.flow.deploy();
    expect(h.device.calls).toContain('operation');
    expect(h.flow.result).toMatchObject({ outcome: 'committed', op: done });

    const other = await previewOf();
    other.device.onDeploy = async (on) => {
      on({
        kind: 'operation',
        op: opOf('deploy', 'running', steps('ok', 'ok', 'ok', 'ok', 'running', 'pending')),
      });
      return { error: 'lost' };
    };
    other.device.lastOperation = { ...done, opId: 'op-khac' };
    await other.flow.deploy();
    expect(other.flow.result).toMatchObject({ outcome: 'lost', error: { code: 'lost' } });
  });

  it('không đóng được khi đang chạy (Esc)', async () => {
    const h = await previewOf();
    let finish: (op: DeployOperation) => void = () => {};
    h.device.onDeploy = () => new Promise((resolve) => (finish = resolve));
    const running = h.flow.deploy();
    await Promise.resolve();
    expect(h.flow.state).toBe('running');
    expect(h.flow.canClose).toBe(false);
    expect(h.flow.close()).toBe(false);
    expect(h.flow.state).toBe('running');
    finish(opOf('deploy', 'committed', steps('ok', 'ok', 'ok', 'ok', 'ok', 'ok')));
    await running;
    expect(h.flow.state).toBe('result');
    expect(h.flow.canClose).toBe(true);
  });

  it('đóng hộp thoại giữa lúc chuẩn bị: bỏ kết quả, bỏ gói đã đóng', async () => {
    const h = await setup();
    let release: () => void = () => {};
    const check = h.project.check.bind(h.project);
    h.project.check = async () => {
      await new Promise<void>((r) => (release = r));
      return check();
    };
    const opening = h.flow.open();
    await Promise.resolve();
    expect(h.flow.state).toBe('preparing');
    h.flow.close();
    release();
    await opening;
    expect(h.flow.state).toBe('closed');
    expect(h.device.built).toEqual([]);
  });
});
