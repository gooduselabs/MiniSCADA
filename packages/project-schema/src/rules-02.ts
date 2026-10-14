// Luật liên file của bộ kiểm tra 0.2 (contracts/project-format-0.2.md §7). Nhánh 0.1 (rules.ts) giữ nguyên.
// Bản C++ (core/project-manager/rules_02) cài CÙNG luật; vector chung ở tests/project-vectors (ca `v02-*`).
// File nào lỗi parse/schema thì các luật cần file đó bị bỏ qua (như 0.1).
import {
  buildCalcGraph,
  compile,
  validateValueTable,
  type CalcInput,
  type TagDataType as ExprTagType,
} from '@mat/expression';
import { parseAddress, type Area } from '@mat/tag-codec';
import {
  MAX_CLIENTS_LIMIT,
  MAX_SCREEN_TAGS,
  MIN_RUNTIME_02,
  MIN_RUNTIME_03,
  MIN_RUNTIME_06,
  SUPPORTED_SCHEMA_02,
  SUPPORTED_SCHEMA_03,
  SUPPORTED_SCHEMA_06,
  type ErrorCode,
  type Issue,
  type WarningCode,
} from './codes.ts';
import { estimateLogging, loggingRules, unverifiedConnections } from './logging.ts';
import type { ReportsConfig } from './reports.ts';
import { compareSemver, isNumericTag } from './rules.ts';
import { blockDataBytes, planBlocks, requestTimeMs, type Span } from './rtu-estimate.ts';
import { serialPortAllowed, type SerialPolicy } from './serial-allow.ts';
import {
  SUPPORTED_TARGETS,
  type LoggingConfig,
  type Project,
  type Scalar,
  type Screen,
  type TagDataType,
} from './types.ts';
import type {
  BindingSet02,
  Channel,
  ConnectionsConfig,
  FieldDevice,
  ScanGroupName,
  SimConfig,
  TagListV1,
  TagV1,
  ValueTableDoc,
  WatchTableDoc,
} from './types-02.ts';

/** Giới hạn D12 (FR-001). */
export const LIMITS_02 = {
  tags: 2000,
  calculated: 500,
  retain: 500,
  channels: 16,
  devices: 64,
  devicesPerChannel: 32,
  valueTables: 256,
  entries: 256,
  watchTables: 32,
  rows: 200,
} as const;

export const DEFAULT_SCAN_GROUPS: Readonly<Record<ScanGroupName, number>> = {
  fast: 250,
  normal: 1000,
  slow: 5000,
};

export interface Rule02Input {
  project: Project;
  tags?: TagListV1;
  connections?: ConnectionsConfig;
  /** Bảng giá trị đã nạp và qua schema, theo tên trong `project.valueTables`. */
  valueTables: Record<string, { file: string; doc: ValueTableDoc }>;
  watchTables: Record<string, { file: string; doc: WatchTableDoc }>;
  screens: Record<
    string,
    { file: string; screen: Screen; bindings?: BindingSet02; svgText: string | null }
  >;
  checkSvg: boolean;
  logging?: LoggingConfig;
  /** Phiên bản runtime dùng để so `minRuntimeVersion`. */
  runtimeVersion: string;
  /**
   * Định dạng đang kiểm: `0.2` (mặc định) hoặc `0.3` (feature 007). Với 0.3, luật của Tag, kết nối, bảng giá
   * trị, logging dùng lại nguyên; luật màn hình do rules-03 (`screens` truyền vào đây phải rỗng).
   */
  schema?: '0.2' | '0.3' | '0.6';
  /** reports.json đã nạp (định dạng 0.6, feature 010): chỉ để kiểm phiên bản khớp project.json. */
  reports?: ReportsConfig;
  /** Có thì chạy luật E_SERIAL_NOT_ALLOWED của thiết bị (feature 006); không có thì luật không chạy. */
  serialPolicy?: SerialPolicy;
}

export const TYPE_RANGE: Readonly<Record<string, readonly [number, number]>> = {
  INT16: [-32768, 32767],
  UINT16: [0, 65535],
  INT32: [-2147483648, 2147483647],
  UINT32: [0, 4294967295],
  INT64: [-(2 ** 63), 2 ** 63],
  UINT64: [0, 2 ** 64],
  FLOAT32: [-3.4028234663852886e38, 3.4028234663852886e38],
  FLOAT64: [-Number.MAX_VALUE, Number.MAX_VALUE],
};
export const INTEGER_TYPES = new Set<TagDataType>([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
]);
export const utf8Length = (s: string) => new TextEncoder().encode(s).length;

const SERIAL_PORT_PATTERNS = [
  /^tty[A-Za-z]{1,8}[0-9]{1,3}$/,
  /^\/dev\/serial\/by-id\/[A-Za-z0-9._:+-]{1,200}$/,
  /^\/dev\/serial\/by-path\/[A-Za-z0-9._:+-]{1,200}$/,
];

const scalarMatches = (t: TagDataType, v: Scalar) =>
  t === 'BOOL'
    ? typeof v === 'boolean'
    : t === 'STRING'
      ? typeof v === 'string'
      : typeof v === 'number';

export function runRules02(input: Rule02Input): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (
    code: ErrorCode,
    file: string,
    path: string,
    message: string,
    span?: [number, number],
  ) => errors.push(span ? { code, file, path, message, span } : { code, file, path, message });
  const warn = (code: WarningCode, file: string, path: string, message: string) =>
    warnings.push({ code, file, path, message });
  const { project, tags, connections, screens } = input;
  const ver = input.schema ?? '0.2';
  const supported =
    ver === '0.6' ? SUPPORTED_SCHEMA_06 : ver === '0.3' ? SUPPORTED_SCHEMA_03 : SUPPORTED_SCHEMA_02;
  const minRuntime =
    ver === '0.6' ? MIN_RUNTIME_06 : ver === '0.3' ? MIN_RUNTIME_03 : MIN_RUNTIME_02;
  const tagFile = project.tagFile;
  const connFile = project.connectionFile ?? 'connections.json';
  const tableNames = project.valueTables ?? [];
  const tableSet = new Set(tableNames);

  // ---- Phiên bản, runtime, project.json ----
  const versionOf: Array<[string, string]> = [['project.json', project.schemaVersion]];
  if (tags) versionOf.push([tagFile, tags.schemaVersion]);
  if (connections && project.connectionFile)
    versionOf.push([project.connectionFile, connections.schemaVersion]);
  for (const t of Object.values(input.valueTables)) versionOf.push([t.file, t.doc.schemaVersion]);
  for (const t of Object.values(input.watchTables)) versionOf.push([t.file, t.doc.schemaVersion]);
  if (input.logging && project.loggingFile)
    versionOf.push([project.loggingFile, input.logging.schemaVersion]);
  if (input.reports && project.reportsFile)
    versionOf.push([project.reportsFile, input.reports.schemaVersion]);
  for (const s of Object.values(screens)) {
    versionOf.push([s.file, s.screen.schemaVersion]);
    if (s.bindings) versionOf.push([s.screen.bindingFile, s.bindings.schemaVersion]);
  }
  if (!supported.test(project.schemaVersion))
    add(
      'E_SCHEMA_VERSION',
      'project.json',
      '/schemaVersion',
      `schemaVersion ${project.schemaVersion} is not ${ver}.x`,
    );
  for (const [file, v] of versionOf.slice(1))
    if (v !== project.schemaVersion)
      add(
        'E_SCHEMA_VERSION',
        file,
        '/schemaVersion',
        `schemaVersion ${v} differs from project.json (${project.schemaVersion}): every file must match`,
      );
  if (compareSemver(project.minRuntimeVersion, minRuntime) < 0)
    add(
      'E_MIN_RUNTIME',
      'project.json',
      '/minRuntimeVersion',
      `minRuntimeVersion must be >= ${minRuntime}`,
    );
  if (compareSemver(project.minRuntimeVersion, input.runtimeVersion) > 0)
    add(
      'E_RUNTIME_TOO_OLD',
      'project.json',
      '/minRuntimeVersion',
      `Project needs runtime >= ${project.minRuntimeVersion}, this runtime is ${input.runtimeVersion}`,
    );
  if (project.maxClients < 1 || project.maxClients > MAX_CLIENTS_LIMIT)
    add('E_MAX_CLIENTS', 'project.json', '/maxClients', 'maxClients must be 1-10');
  if (!project.screens.includes(project.entryScreen))
    add(
      'E_SCREEN_ID',
      'project.json',
      '/entryScreen',
      `entryScreen '${project.entryScreen}' is not in screens`,
    );

  // valueTables, watchTables của project.json
  if (tableNames.length > LIMITS_02.valueTables)
    add(
      'E_LIMIT',
      'project.json',
      '/valueTables',
      `more than ${LIMITS_02.valueTables} value tables`,
    );
  {
    const seen = new Set<string>();
    tableNames.forEach((n, i) => {
      const k = n.toLowerCase();
      if (seen.has(k))
        add(
          'E_DUP_ID',
          'project.json',
          `/valueTables/${i}`,
          `value table '${n}' is duplicated (case-insensitive)`,
        );
      seen.add(k);
    });
  }
  const watchIds = project.watchTables ?? [];
  if (watchIds.length > LIMITS_02.watchTables)
    add(
      'E_LIMIT',
      'project.json',
      '/watchTables',
      `more than ${LIMITS_02.watchTables} watch tables`,
    );
  {
    const seen = new Set<string>();
    watchIds.forEach((n, i) => {
      if (seen.has(n))
        add('E_DUP_ID', 'project.json', `/watchTables/${i}`, `watch table '${n}' is duplicated`);
      seen.add(n);
    });
  }

  // ---- Bảng giá trị ----
  for (const [name, { file, doc }] of Object.entries(input.valueTables)) {
    if (doc.name !== name)
      add('E_DUP_ID', file, '/name', `name '${doc.name}' differs from the file name '${name}'`);
    if (doc.entries.length > LIMITS_02.entries)
      add('E_LIMIT', file, '/entries', `more than ${LIMITS_02.entries} entries`);
    for (const i of validateValueTable(doc))
      add(
        i.code as ErrorCode,
        file,
        i.entry >= 0 ? `/entries/${i.entry}` : '/default/text',
        i.message,
      );
  }

  // ---- Kết nối ----
  const deviceById = new Map<
    string,
    { device: FieldDevice; channel: Channel; ci: number; di: number }
  >();
  if (connections) {
    const chans = connections.channels;
    if (chans.length > LIMITS_02.channels)
      add('E_LIMIT', connFile, '/channels', `more than ${LIMITS_02.channels} channels`);
    const channelIds = new Set<string>();
    const ports = new Map<string, number>();
    let deviceTotal = 0;
    chans.forEach((ch, ci) => {
      const cp = `/channels/${ci}`;
      if (channelIds.has(ch.id))
        add('E_DUP_ID', connFile, `${cp}/id`, `channel id '${ch.id}' is duplicated`);
      channelIds.add(ch.id);
      if (ch.devices.length > LIMITS_02.devicesPerChannel)
        add(
          'E_LIMIT',
          connFile,
          `${cp}/devices`,
          `more than ${LIMITS_02.devicesPerChannel} field devices in one channel`,
        );
      deviceTotal += ch.devices.length;
      ch.devices.forEach((d, di) => {
        if (deviceById.has(d.id))
          add(
            'E_DUP_ID',
            connFile,
            `${cp}/devices/${di}/id`,
            `field device id '${d.id}' is duplicated`,
          );
        else deviceById.set(d.id, { device: d, channel: ch, ci, di });
      });
      if (ch.kind === 'modbus-rtu' && ch.serial) {
        const port = ch.serial.port;
        if (!SERIAL_PORT_PATTERNS.some((re) => re.test(port)))
          add(
            'E_SERIAL_PORT',
            connFile,
            `${cp}/serial/port`,
            `serial port '${port}' is not allowed`,
          );
        else if (input.serialPolicy && !serialPortAllowed(input.serialPolicy, port))
          add(
            'E_SERIAL_NOT_ALLOWED',
            connFile,
            `${cp}/serial/port`,
            `serial port '${port}' ${input.serialPolicy.isConsole?.(port) ? 'is the console of the system' : 'is not in the serialPorts of this device'}`,
          );
        if (ports.has(port))
          add(
            'E_SERIAL_SHARED',
            connFile,
            `${cp}/serial/port`,
            `port '${port}' is used by channel ${ports.get(port)} too`,
          );
        else ports.set(port, ci);
      }
    });
    if (deviceTotal > LIMITS_02.devices)
      add('E_LIMIT', connFile, '/channels', `more than ${LIMITS_02.devices} field devices`);
  }

  // ---- Tag ----
  const tagType = new Map<string, TagDataType>();
  const tagIndex = new Map<string, number>();
  const tagTable = new Map<string, string | undefined>();
  const projectCalcInputs = new Map<string, string[]>();
  if (tags) {
    if (tags.tags.length > LIMITS_02.tags)
      add('E_LIMIT', tagFile, '/tags', `more than ${LIMITS_02.tags} tags`);
    let calcCount = 0;
    let retainCount = 0;
    tags.tags.forEach((t, i) => {
      if (t.kind === 'calculated') calcCount++;
      if (t.retain === true) retainCount++;
      if (!tagType.has(t.id)) {
        tagType.set(t.id, t.type);
        tagIndex.set(t.id, i);
        tagTable.set(t.id, t.valueTable);
      }
    });
    if (calcCount > LIMITS_02.calculated)
      add('E_LIMIT', tagFile, '/tags', `more than ${LIMITS_02.calculated} calculated tags`);
    if (retainCount > LIMITS_02.retain)
      add('E_LIMIT', tagFile, '/tags', `more than ${LIMITS_02.retain} retained tags`);

    const seenIds = new Set<string>();
    const rtuGroups = new Map<
      string,
      Map<ScanGroupName, Map<string, { area: Area; spans: Span[]; dev: FieldDevice }>>
    >();
    const slowSeen = new Set<string>();
    const bitRmwSeen = new Set<string>();
    const scanGroups = { ...DEFAULT_SCAN_GROUPS, ...(connections?.scanGroups ?? {}) };
    tags.tags.forEach((t, i) => {
      const p = `/tags/${i}`;
      if (seenIds.has(t.id)) add('E_DUP_TAG', tagFile, `${p}/id`, `Tag '${t.id}' is duplicated`);
      seenIds.add(t.id);
      tagChecks(t, p);

      // địa chỉ và thiết bị trường (chỉ Tag ngoài)
      if (t.kind === 'external' && t.source) externalChecks(t, p);
    });

    function tagChecks(t: TagV1, p: string): void {
      const numeric = isNumericTag(t.type);
      // khoảng hiển thị
      const hasRange = t.min !== undefined || t.max !== undefined;
      if (hasRange && !numeric)
        add('E_TAG_RANGE', tagFile, p, `min/max only apply to numeric tags ('${t.id}')`);
      else if (t.min !== undefined && t.max !== undefined && t.min >= t.max)
        add('E_TAG_RANGE', tagFile, p, `min must be less than max ('${t.id}')`);
      // quyền ghi
      if (t.kind === 'calculated' && t.access === 'RW')
        add('E_TAG_ACCESS', tagFile, `${p}/access`, 'a calculated tag is always read-only');
      if (t.kind === 'simulation' && t.access === 'RW' && t.sim?.kind !== 'manual')
        add('E_TAG_ACCESS', tagFile, `${p}/access`, 'only a manual simulation tag can be RW');
      // deadband
      if (t.deadband !== undefined && (!numeric || t.deadband < 0))
        add(
          'E_DEADBAND',
          tagFile,
          `${p}/deadband`,
          'deadband applies to numeric tags and must be >= 0',
        );
      // giới hạn nhập
      if (t.limits) limitChecks(t, p);
      // bảng giá trị
      if (t.valueTable !== undefined && !tableSet.has(t.valueTable))
        add(
          'E_REF_TABLE',
          tagFile,
          `${p}/valueTable`,
          `value table '${t.valueTable}' does not exist`,
        );
      // giữ qua mất điện
      if (t.retain === true && t.kind !== 'internal')
        add('E_RETAIN', tagFile, `${p}/retain`, 'retain only applies to internal tags');
      // giá trị đầu
      if (t.initial !== undefined) initialChecks(t, p);
      // scaling
      if (t.scaling) scalingChecks(t, p);
      // mô phỏng
      if (t.kind === 'calculated' && t.sim !== undefined)
        add('E_SIM', tagFile, `${p}/sim`, 'a calculated tag has no sim');
      else if (t.sim !== undefined) simChecks(t, t.sim, p);
      // ghi không giới hạn
      const writable =
        t.access === 'RW' &&
        (t.kind !== 'simulation' || t.sim?.kind === 'manual') &&
        t.kind !== 'calculated';
      if (writable && numeric && t.limits === undefined)
        warn('W_WRITE_NO_LIMITS', tagFile, `${p}/limits`, `numeric RW tag '${t.id}' has no limits`);
    }

    function limitChecks(t: TagV1, p: string): void {
      const l = t.limits!;
      const numeric = isNumericTag(t.type);
      if ((l.min !== undefined || l.max !== undefined) && !numeric)
        add('E_LIMITS', tagFile, `${p}/limits`, 'limits.min/max only apply to numeric tags');
      if (l.maxLength !== undefined && t.type !== 'STRING')
        add(
          'E_LIMITS',
          tagFile,
          `${p}/limits/maxLength`,
          'limits.maxLength only applies to STRING tags',
        );
      if (l.min !== undefined && l.max !== undefined && l.min > l.max)
        add('E_LIMITS', tagFile, `${p}/limits`, 'limits.min must be <= limits.max');
      if (numeric) {
        const [lo, hi] = TYPE_RANGE[t.type]!;
        if (
          (l.min !== undefined && (l.min < lo || l.min > hi)) ||
          (l.max !== undefined && (l.max < lo || l.max > hi))
        )
          add('E_LIMITS', tagFile, `${p}/limits`, `limits are outside the range of ${t.type}`);
      }
      if (
        l.maxLength !== undefined &&
        t.type === 'STRING' &&
        (l.maxLength < 1 || l.maxLength > 1024)
      )
        add('E_LIMITS', tagFile, `${p}/limits/maxLength`, 'limits.maxLength must be 1-1024');
    }

    function initialChecks(t: TagV1, p: string): void {
      const v = t.initial!;
      const path = `${p}/initial`;
      if (!scalarMatches(t.type, v)) {
        add('E_INITIAL', tagFile, path, `initial has the wrong type for ${t.type}`);
        return;
      }
      if (typeof v === 'number') {
        const [lo, hi] = TYPE_RANGE[t.type] ?? [-Infinity, Infinity];
        if (
          !Number.isFinite(v) ||
          v < lo ||
          v > hi ||
          (INTEGER_TYPES.has(t.type) && !Number.isInteger(v))
        )
          add('E_INITIAL', tagFile, path, `initial is outside the range of ${t.type}`);
      } else if (typeof v === 'string') {
        const bytes = utf8Length(v);
        if (
          (t.retain === true && bytes > 256) ||
          (t.limits?.maxLength !== undefined && bytes > t.limits.maxLength)
        )
          add('E_INITIAL', tagFile, path, 'initial string is too long');
      }
    }

    function scalingChecks(t: TagV1, p: string): void {
      const s = t.scaling!;
      const path = `${p}/scaling`;
      if (t.type !== 'FLOAT32' && t.type !== 'FLOAT64')
        add('E_SCALING', tagFile, path, 'scaling requires type FLOAT32 or FLOAT64');
      const raw = t.source?.rawType ?? t.type;
      if (!isNumericTag(raw)) add('E_SCALING', tagFile, path, 'scaling requires a numeric rawType');
      if (s.rawMin === s.rawMax) add('E_SCALING', tagFile, path, 'rawMin must differ from rawMax');
      if (s.engMin === s.engMax) add('E_SCALING', tagFile, path, 'engMin must differ from engMax');
    }

    function simChecks(t: TagV1, sim: SimConfig, p: string): void {
      const path = `${p}/sim`;
      const bad = (msg: string) => add('E_SIM', tagFile, path, msg);
      const numeric = isNumericTag(t.type);
      const need = (...keys: (keyof SimConfig)[]): boolean => {
        for (const k of keys)
          if (sim[k] === undefined) return (bad(`sim.${sim.kind} needs ${k}`), false);
        return true;
      };
      switch (sim.kind) {
        case 'const':
          if (need('value') && !scalarMatches(t.type, sim.value!))
            bad(`const value does not match ${t.type}`);
          break;
        case 'ramp':
          if (!numeric) bad(`ramp needs a numeric tag, not ${t.type}`);
          need('from', 'to', 'periodMs');
          break;
        case 'sine':
          if (!numeric) bad(`sine needs a numeric tag, not ${t.type}`);
          need('center', 'amplitude', 'periodMs');
          break;
        case 'random':
          if (!numeric && t.type !== 'BOOL')
            bad(`random needs a numeric or BOOL tag, not ${t.type}`);
          if (need('periodMs') && numeric) {
            if (need('min', 'max') && sim.min! >= sim.max!) bad('random needs min < max');
          } else if (sim.min !== undefined && sim.max !== undefined && sim.min >= sim.max)
            bad('random needs min < max');
          break;
        case 'square':
          if (!numeric && t.type !== 'BOOL')
            bad(`square needs a numeric or BOOL tag, not ${t.type}`);
          need('periodMs');
          break;
        case 'manual':
          if (need('initial') && !scalarMatches(t.type, sim.initial!))
            bad(`manual initial does not match ${t.type}`);
          break;
        case 'legacy':
          need('signal');
          break;
      }
    }

    function externalChecks(t: TagV1, p: string): void {
      const src = t.source!;
      const found = deviceById.get(src.device);
      if (!found) {
        if (connections !== undefined || project.connectionFile === undefined)
          add(
            'E_REF_DEVICE',
            tagFile,
            `${p}/source/device`,
            `field device '${src.device}' does not exist`,
          );
        return;
      }
      const dev = found.device;
      const rawType = src.rawType ?? t.type;
      // STRING cần độ dài; độ dài chỉ dành cho STRING
      if (rawType === 'STRING' && src.stringLength === undefined)
        add(
          'E_SCHEMA',
          tagFile,
          `${p}/source/stringLength`,
          'STRING tag needs source.stringLength',
        );
      if (rawType !== 'STRING' && src.stringLength !== undefined)
        add('E_SCHEMA', tagFile, `${p}/source/stringLength`, 'stringLength only applies to STRING');
      const r = parseAddress(src.address, {
        addressBase: dev.addressBase ?? 0,
        rawType,
        stringLength: src.stringLength,
        access: t.access ?? 'R',
      });
      if (!r.ok) {
        add(r.error, tagFile, `${p}/source/address`, `address '${src.address}': ${r.error}`);
        return;
      }
      for (const w of r.warnings)
        warn(
          w as WarningCode,
          tagFile,
          `${p}/source/address`,
          `Modicon address on a device with addressBase 0`,
        );
      const isBit = r.area === 'C' || r.area === 'DI';
      if (!isBit && r.registers > (dev.maxReadRegisters ?? 125))
        add(
          'E_ADDR_READ_LIMIT',
          tagFile,
          `${p}/source`,
          `the tag needs ${r.registers} registers, more than one read allows`,
        );
      if (t.access === 'RW' && !isBit && r.registers > 123)
        add(
          'E_ADDR_WRITE_LIMIT',
          tagFile,
          `${p}/source`,
          `the tag needs ${r.registers} registers, more than one write allows (123)`,
        );
      // bit trong thanh ghi
      if (r.bit !== null && t.access === 'RW') {
        const mode = dev.write?.registerBit ?? 'none';
        if (mode === 'none')
          add(
            'E_BIT_WRITE',
            tagFile,
            `${p}/source/address`,
            `device '${dev.id}' does not allow bit writes (write.registerBit is none)`,
          );
        else if (mode === 'rmw' && !bitRmwSeen.has(dev.id)) {
          bitRmwSeen.add(dev.id);
          warn(
            'W_BIT_RMW',
            connFile,
            `/channels/${found.ci}/devices/${found.di}`,
            `device '${dev.id}' writes bits by read-modify-write`,
          );
        }
      }
      // W_DETECT_SLOW
      const group = src.scanGroup ?? 'normal';
      const period = scanGroups[group];
      const retries = dev.retries ?? (found.channel.kind === 'modbus-rtu' ? 1 : 0);
      if (!slowSeen.has(dev.id) && (dev.timeoutMs ?? 1000) * (retries + 1) > period) {
        slowSeen.add(dev.id);
        warn(
          'W_DETECT_SLOW',
          connFile,
          `/channels/${found.ci}/devices/${found.di}`,
          `timeoutMs x (retries + 1) = ${(dev.timeoutMs ?? 1000) * (retries + 1)} ms exceeds the ${group} scan period (${period} ms)`,
        );
      }
      // gom khoảng cho ước tính RTU
      if (
        found.channel.kind === 'modbus-rtu' &&
        dev.enabled !== false &&
        found.channel.enabled !== false
      ) {
        const byGroup = rtuGroups.get(found.channel.id) ?? new Map();
        rtuGroups.set(found.channel.id, byGroup);
        const byArea = byGroup.get(group) ?? new Map();
        byGroup.set(group, byArea);
        const key = `${dev.id}|${r.area}`;
        const entry = byArea.get(key) ?? { area: r.area, spans: [], dev };
        byArea.set(key, entry);
        entry.spans.push({ start: r.offset, end: r.offset + r.registers });
      }
    }

    // W_RTU_SCAN_TIME
    if (connections) {
      connections.channels.forEach((ch, ci) => {
        const byGroup = rtuGroups.get(ch.id);
        if (!byGroup || ch.kind !== 'modbus-rtu') return;
        const fmt = {
          baud: ch.serial?.baud ?? 9600,
          dataBits: ch.serial?.dataBits ?? 8,
          parity: ch.serial?.parity ?? 'even',
          stopBits: ch.serial?.stopBits ?? 1,
        };
        for (const [group, byArea] of byGroup) {
          let total = 0;
          for (const { area, spans, dev } of byArea.values()) {
            const bits = area === 'C' || area === 'DI';
            const maxLen = bits
              ? Math.min(2000, dev.maxReadBits ?? 2000)
              : Math.min(125, dev.maxReadRegisters ?? 125);
            const maxGap = bits ? (dev.maxGapBits ?? 64) : (dev.maxGapRegisters ?? 10);
            for (const b of planBlocks(spans, maxGap, maxLen))
              total += requestTimeMs(fmt, blockDataBytes(area, b.end - b.start));
          }
          const period = scanGroups[group];
          if (total > period)
            warn(
              'W_RTU_SCAN_TIME',
              connFile,
              `/channels/${ci}`,
              `estimated ${Math.round(total)} ms for one ${group} scan round, longer than the ${period} ms period`,
            );
        }
      });
    }

    // ---- Biểu thức ----
    const calcNodes: CalcInput[] = [];
    const calcIndex = new Map<string, number>();
    tags.tags.forEach((t, i) => {
      if (t.kind !== 'calculated') return;
      if (calcIndex.has(t.id)) return; // trùng id: đã báo E_DUP_TAG
      const p = `/tags/${i}/expression`;
      const r = compile(t.expression ?? '', {
        target: t.type as ExprTagType,
        tagType: (id) => tagType.get(id) as ExprTagType | undefined,
        hasTable: (name) => tableSet.has(name),
      });
      let inputs: string[] = [];
      if (!r.ok) {
        const e = r.errors[0]!;
        add(e.code as ErrorCode, tagFile, p, e.message, e.span);
      } else {
        inputs = r.inputs;
        for (const w of r.warnings) warn(w.code as WarningCode, tagFile, p, w.message);
      }
      calcIndex.set(t.id, calcNodes.length);
      calcNodes.push({ id: t.id, inputs });
      projectCalcInputs.set(t.id, inputs);
    });
    const graph = buildCalcGraph(calcNodes);
    for (const g of graph.issues)
      add(g.code as ErrorCode, tagFile, `/tags/${tagIndex.get(g.id)}/expression`, g.message);
  }

  // ---- Bảng theo dõi ----
  for (const [id, { file, doc }] of Object.entries(input.watchTables)) {
    if (doc.id !== id)
      add('E_DUP_ID', file, '/id', `id '${doc.id}' differs from the file name '${id}'`);
    if (doc.rows.length > LIMITS_02.rows)
      add('E_LIMIT', file, '/rows', `more than ${LIMITS_02.rows} rows`);
    if (tags)
      doc.rows.forEach((row, i) => {
        if (!tagType.has(row.tag))
          warn('W_WATCH_REF', file, `/rows/${i}/tag`, `Tag '${row.tag}' does not exist`);
      });
  }

  // ---- logging.json ----
  if (input.logging && project.loggingFile) {
    const types = tags ? tagType : undefined;
    const logIssues = loggingRules(input.logging, project.loggingFile, types);
    errors.push(...logIssues);
    if (logIssues.length === 0) {
      const conns = input.logging.connections ?? [];
      for (const i of unverifiedConnections(input.logging))
        warn(
          'W_LOG_TLS_UNVERIFIED',
          project.loggingFile,
          `/connections/${i}`,
          `Connection '${conns[i]?.id}' does not verify the server`,
        );
      if (types) {
        const e = estimateLogging(input.logging, types, ver === '0.6');
        for (const code of e.warnings)
          warn(code, project.loggingFile, '', 'logging estimate exceeds the budget');
      }
    }
  }

  // ---- Màn hình và binding ----
  for (const [id, s] of Object.entries(screens)) {
    const { screen, bindings, file } = s;
    if (screen.id !== id)
      add('E_SCREEN_ID', file, '/id', `id '${screen.id}' differs from the file name '${id}'`);
    const uids = new Set<string>();
    screen.elements.forEach((e, i) => {
      if (uids.has(e.elementUid))
        add(
          'E_DUP_UID',
          file,
          `/elements/${i}/elementUid`,
          `elementUid '${e.elementUid}' is duplicated`,
        );
      uids.add(e.elementUid);
    });
    if (input.checkSvg && s.svgText !== null) {
      const declared = new Set<string>();
      try {
        const doc = new DOMParser().parseFromString(s.svgText, 'image/svg+xml');
        doc
          .querySelectorAll('[data-mat-uid]')
          .forEach((el) => declared.add(el.getAttribute('data-mat-uid')!));
      } catch {
        /* SVG hỏng: trình hiển thị sẽ báo */
      }
      screen.elements.forEach((e, i) => {
        if (!declared.has(e.elementUid))
          warn(
            'W_UID_NOT_IN_SVG',
            file,
            `/elements/${i}/elementUid`,
            `SVG '${screen.svgFile}' has no data-mat-uid="${e.elementUid}"`,
          );
      });
    }
    if (!bindings) continue;
    const bfile = screen.bindingFile;
    if (bindings.screenId !== screen.id)
      add(
        'E_SCREEN_ID',
        bfile,
        '/screenId',
        `screenId '${bindings.screenId}' differs from screen '${screen.id}'`,
      );
    const boundTags = new Set(
      bindings.elements.flatMap((eb) => eb.bindings.map((b) => b.source.tagId)),
    );
    if (boundTags.size > MAX_SCREEN_TAGS)
      add(
        'E_SCREEN_TAGS',
        bfile,
        '/elements',
        `screen '${screen.id}' binds ${boundTags.size} tags, at most ${MAX_SCREEN_TAGS}`,
      );
    bindingRules(
      bindings,
      bfile,
      uids,
      { hasTags: tags !== undefined, tagType, tagTable, tableSet },
      add,
    );
  }
  return { errors, warnings };
}

/** Ngữ cảnh Tag/bảng giá trị cho luật binding (dùng chung 0.2 và 0.3). */
export interface BindingCtx {
  /** Có `tags.json` đã nạp (không có thì không kiểm tham chiếu Tag). */
  hasTags: boolean;
  tagType: ReadonlyMap<string, TagDataType>;
  tagTable: ReadonlyMap<string, string | undefined>;
  tableSet: ReadonlySet<string>;
}

/** Luật của một file binding: uid, id, đích, transform, kiểu Tag (contracts/project-format-0.2.md §8, 0.3 §4). */
export function bindingRules(
  bindings: BindingSet02,
  bfile: string,
  uids: ReadonlySet<string>,
  ctx: BindingCtx,
  add: (code: ErrorCode, file: string, path: string, message: string) => void,
): void {
  const { tagType, tagTable, tableSet } = ctx;
  const tags = ctx.hasTags;
  const boundUids = new Set<string>();
  const bindingIds = new Set<string>();
  bindings.elements.forEach((eb, i) => {
    const ep = `/elements/${i}`;
    if (boundUids.has(eb.elementUid))
      add(
        'E_DUP_UID',
        bfile,
        `${ep}/elementUid`,
        `elementUid '${eb.elementUid}' repeats in bindings`,
      );
    boundUids.add(eb.elementUid);
    if (!uids.has(eb.elementUid))
      add(
        'E_REF_UID',
        bfile,
        `${ep}/elementUid`,
        `elementUid '${eb.elementUid}' is not in the screen`,
      );
    eb.bindings.forEach((b, j) => {
      const bp = `${ep}/bindings/${j}`;
      if (bindingIds.has(b.id))
        add('E_DUP_BINDING', bfile, `${bp}/id`, `binding id '${b.id}' is duplicated`);
      bindingIds.add(b.id);
      if (!(SUPPORTED_TARGETS as readonly string[]).includes(b.target)) {
        add('E_TARGET_UNSUPPORTED', bfile, `${bp}/target`, `target '${b.target}' is not supported`);
        return;
      }
      const tr = b.transform;
      const kind = tr.kind;
      if (
        kind !== 'direct' &&
        kind !== 'discreteMap' &&
        kind !== 'linearScale' &&
        kind !== 'valueTable'
      ) {
        add(
          'E_TRANSFORM_UNSUPPORTED',
          bfile,
          `${bp}/transform/kind`,
          `transform '${kind}' is not supported`,
        );
        return;
      }
      if (!tags) return;
      const t = tagType.get(b.source.tagId);
      if (!t) {
        add('E_REF_TAG', bfile, `${bp}/source/tagId`, `Tag '${b.source.tagId}' does not exist`);
        return;
      }
      if (tr.kind === 'valueTable') {
        const name = tr.table ?? tagTable.get(b.source.tagId);
        if (name === undefined || !tableSet.has(name))
          add(
            'E_REF_TABLE',
            bfile,
            `${bp}/transform/table`,
            name === undefined
              ? 'no value table (neither table nor the Tag valueTable)'
              : `value table '${name}' does not exist`,
          );
        if (t === 'STRING')
          add(
            'E_TYPE_MISMATCH',
            bfile,
            `${bp}/transform`,
            'valueTable needs a numeric or BOOL tag',
          );
        const okTarget =
          tr.output === 'text'
            ? b.target === 'text.content'
            : b.target === 'style.fill' || b.target === 'style.stroke';
        if (!okTarget)
          add(
            'E_TYPE_MISMATCH',
            bfile,
            `${bp}/transform/output`,
            `output '${tr.output}' cannot be applied to '${b.target}'`,
          );
      } else if (tr.kind === 'linearScale') {
        if (!isNumericTag(t))
          add(
            'E_TYPE_MISMATCH',
            bfile,
            `${bp}/transform`,
            `linearScale needs a numeric tag, '${b.source.tagId}' is ${t}`,
          );
        if (tr.inMin === tr.inMax)
          add('E_SCALE_RANGE', bfile, `${bp}/transform`, 'inMin must differ from inMax');
      } else if (tr.kind === 'discreteMap') {
        if (tr.cases.some((c) => !scalarMatches(t, c.equals)))
          add(
            'E_TYPE_MISMATCH',
            bfile,
            `${bp}/transform/cases`,
            `equals must have the type of tag ${t}`,
          );
      } else if (!directAccepts(b.target, b.animation, t)) {
        add(
          'E_TYPE_MISMATCH',
          bfile,
          `${bp}/source/tagId`,
          `tag ${t} cannot be used directly for '${b.target}'`,
        );
      }
    });
  });
}

/** Kiểu Tag dùng được với transform `direct` cho từng đích (như 0.1). */
function directAccepts(target: string, animation: 'spin' | undefined, t: TagDataType): boolean {
  switch (target) {
    case 'geometry.levelPercent':
    case 'style.opacity':
      return isNumericTag(t);
    case 'transform.rotate':
      return animation === 'spin' ? isNumericTag(t) || t === 'BOOL' : isNumericTag(t);
    case 'style.visibility':
      return t === 'BOOL' || t === 'STRING';
    case 'style.fill':
    case 'style.stroke':
      return t === 'STRING';
    default:
      return true;
  }
}
