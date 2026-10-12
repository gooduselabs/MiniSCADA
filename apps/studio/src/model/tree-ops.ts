// Thêm, đổi tên, nhân bản, xóa trên cây project 0.2 (feature 006, T084, FR-043). Hàm thuần: nhận nút và outline, trả
// danh sách sửa đổi (store áp thành MỘT bước hoàn tác) kèm nút nên chọn sau đó, hoặc lỗi bằng khóa chuỗi.
import type {
  Channel,
  FieldDevice,
  TagV1,
  ValueTableDoc,
  WatchTableDoc,
} from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import { newChannel, newDevice } from './connections.ts';
import type { ProjectEdit, ProjectOutline } from './project-doc.ts';
import type { NodeRef } from './tree.ts';
import { newWatchTable } from './watch-table.ts';

export const canAdd = (ref: NodeRef): boolean => ref !== undefined;
export const canRename = (ref: NodeRef): boolean =>
  ref.type === 'channel' ||
  ref.type === 'device' ||
  ref.type === 'valueTable' ||
  ref.type === 'watch';
export const canDuplicate = canRename;
export const canRemove = canRename;

export interface AddPlan {
  edits: ProjectEdit[];
  /** Nút nên chọn sau khi thêm. */
  select: string;
}

export interface RemovePlan {
  edits: ProjectEdit[];
  /** Số Tag còn tham chiếu tới đối tượng vừa xóa (bộ kiểm tra sẽ báo E_REF_*). */
  orphanTags: number;
}

const VT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const tagsOf = (o: ProjectOutline): TagV1[] => (o.tags?.tags ?? []) as unknown as TagV1[];
const channelsOf = (o: ProjectOutline): Channel[] => o.connections?.channels ?? [];
const deviceIds = (o: ProjectOutline): string[] =>
  channelsOf(o).flatMap((c) => (c.devices ?? []).map((d) => d.id));
const channelIds = (o: ProjectOutline): string[] => channelsOf(o).map((c) => c.id);

function locateDevice(
  o: ProjectOutline,
  id: string,
): { channel: number; index: number; device: FieldDevice } | null {
  const chs = channelsOf(o);
  for (let c = 0; c < chs.length; c++) {
    const i = (chs[c].devices ?? []).findIndex((d) => d.id === id);
    if (i >= 0) return { channel: c, index: i, device: chs[c].devices[i] };
  }
  return null;
}

/** Id mới `<gốc>-2`, `-3`… không trùng và không quá `max` ký tự. */
function copyId(id: string, taken: ReadonlySet<string>, max: number, sep = '-'): string {
  const base = id.slice(0, max - 3);
  for (let n = 2; ; n++) {
    const next = `${base}${sep}${n}`;
    if (!taken.has(next)) return next;
  }
}

const copyName = (name: string, max: number): string => {
  const suffix = t('tree.copySuffix');
  return `${name.slice(0, Math.max(0, max - suffix.length - 1))} ${suffix}`;
};

/** Tên hiện tại của đối tượng (cho ô đổi tên). */
export function currentName(ref: NodeRef, o: ProjectOutline): string {
  switch (ref.type) {
    case 'channel':
      return channelsOf(o).find((c) => c.id === ref.id)?.name ?? ref.id;
    case 'device':
      return locateDevice(o, ref.id)?.device.name ?? ref.id;
    case 'valueTable':
      return ref.name;
    case 'watch':
      return o.watchTables.find((w) => w.id === ref.id)?.doc?.name ?? ref.id;
    default:
      return '';
  }
}

export function planAdd(
  ref: NodeRef,
  o: ProjectOutline,
  kind: 'modbus-tcp' | 'modbus-rtu' = 'modbus-tcp',
): AddPlan {
  switch (ref.type) {
    case 'connections': {
      const channel = newChannel(channelIds(o), kind, deviceIds(o));
      return { edits: [{ kind: 'channelUpsert', channel }], select: `channel:${channel.id}` };
    }
    case 'channel':
    case 'device': {
      const chs = channelsOf(o);
      const at =
        ref.type === 'channel'
          ? chs.findIndex((c) => c.id === ref.id)
          : (locateDevice(o, ref.id)?.channel ?? -1);
      if (at < 0) return { edits: [], select: '' };
      const device = newDevice(chs[at], deviceIds(o));
      return {
        edits: [{ kind: 'deviceUpsert', channel: at, device }],
        select: `fdev:${device.id}`,
      };
    }
    case 'valueTables':
    case 'valueTable': {
      const taken = new Set(o.valueTables.map((v) => v.name.toLowerCase()));
      let n = 1;
      while (taken.has(`banggiatri${n}`)) n++;
      const name = `BangGiaTri${n}`;
      const table: ValueTableDoc = { schemaVersion: '0.2.0', name, entries: [] };
      return { edits: [{ kind: 'valueTableUpsert', table }], select: `valuetable:${name}` };
    }
    case 'watchTables':
    case 'watch': {
      const table = newWatchTable(
        o.watchTables.map((w) => w.id),
        '',
      );
      return { edits: [{ kind: 'watchTableUpsert', table }], select: `watch:${table.id}` };
    }
  }
}

export type RenameResult = { edits: ProjectEdit[] } | { error: MessageKey };

export function planRename(ref: NodeRef, raw: string, o: ProjectOutline): RenameResult {
  const name = raw.trim();
  if (name === '') return { error: 'tree.err.empty' };
  switch (ref.type) {
    case 'channel': {
      const index = channelsOf(o).findIndex((c) => c.id === ref.id);
      if (index < 0) return { edits: [] };
      if (name.length > 64) return { error: 'tree.err.tooLong' };
      const channel = channelsOf(o)[index];
      if (channel.name === name) return { edits: [] };
      return { edits: [{ kind: 'channelUpsert', index, channel: { ...channel, name } }] };
    }
    case 'device': {
      const at = locateDevice(o, ref.id);
      if (!at) return { edits: [] };
      if (name.length > 64) return { error: 'tree.err.tooLong' };
      if (at.device.name === name) return { edits: [] };
      return {
        edits: [
          {
            kind: 'deviceUpsert',
            channel: at.channel,
            index: at.index,
            device: { ...at.device, name },
          },
        ],
      };
    }
    case 'valueTable': {
      if (name === ref.name) return { edits: [] };
      if (!VT_NAME.test(name)) return { error: 'tree.err.vtName' };
      if (
        o.valueTables.some(
          (v) => v.name !== ref.name && v.name.toLowerCase() === name.toLowerCase(),
        )
      )
        return { error: 'tree.err.vtDup' };
      return { edits: [{ kind: 'valueTableRename', from: ref.name, to: name }] };
    }
    case 'watch': {
      const w = o.watchTables.find((x) => x.id === ref.id);
      if (!w?.doc) return { edits: [] };
      if (name.length > 80) return { error: 'tree.err.tooLong' };
      if (w.doc.name === name) return { edits: [] };
      return { edits: [{ kind: 'watchTableUpsert', table: { ...w.doc, name } }] };
    }
    default:
      return { edits: [] };
  }
}

export function planDuplicate(ref: NodeRef, o: ProjectOutline): AddPlan {
  const none: AddPlan = { edits: [], select: '' };
  switch (ref.type) {
    case 'channel': {
      const src = channelsOf(o).find((c) => c.id === ref.id);
      if (!src) return none;
      const taken = new Set([...channelIds(o), ...deviceIds(o)]);
      const id = copyId(src.id, taken, 32);
      taken.add(id);
      const devices = (src.devices ?? []).map((d) => {
        const did = copyId(d.id, taken, 32);
        taken.add(did);
        return { ...structuredClone(d), id: did };
      });
      const channel: Channel = {
        ...structuredClone(src),
        id,
        name: copyName(src.name, 64),
        devices,
      };
      return { edits: [{ kind: 'channelUpsert', channel }], select: `channel:${id}` };
    }
    case 'device': {
      const at = locateDevice(o, ref.id);
      if (!at) return none;
      const id = copyId(at.device.id, new Set([...channelIds(o), ...deviceIds(o)]), 32);
      const device: FieldDevice = {
        ...structuredClone(at.device),
        id,
        name: copyName(at.device.name, 64),
      };
      return {
        edits: [{ kind: 'deviceUpsert', channel: at.channel, device }],
        select: `fdev:${id}`,
      };
    }
    case 'valueTable': {
      const src = o.valueTables.find((v) => v.name === ref.name)?.doc;
      if (!src) return none;
      const taken = new Set(o.valueTables.map((v) => v.name.toLowerCase()));
      let n = 2;
      let name = `${ref.name.slice(0, 60)}_${n}`;
      while (taken.has(name.toLowerCase())) name = `${ref.name.slice(0, 60)}_${++n}`;
      const table: ValueTableDoc = { ...structuredClone(src), name };
      return { edits: [{ kind: 'valueTableUpsert', table }], select: `valuetable:${name}` };
    }
    case 'watch': {
      const src = o.watchTables.find((w) => w.id === ref.id)?.doc;
      if (!src) return none;
      const id = copyId(src.id, new Set(o.watchTables.map((w) => w.id)), 48);
      const table: WatchTableDoc = { ...structuredClone(src), id, name: copyName(src.name, 80) };
      return { edits: [{ kind: 'watchTableUpsert', table }], select: `watch:${id}` };
    }
    default:
      return none;
  }
}

export function planRemove(ref: NodeRef, o: ProjectOutline): RemovePlan {
  const tags = tagsOf(o);
  switch (ref.type) {
    case 'channel': {
      const index = channelsOf(o).findIndex((c) => c.id === ref.id);
      if (index < 0) return { edits: [], orphanTags: 0 };
      const ids = new Set((channelsOf(o)[index].devices ?? []).map((d) => d.id));
      const orphanTags = tags.filter(
        (x) => x.kind === 'external' && x.source && ids.has(x.source.device),
      ).length;
      return { edits: [{ kind: 'channelRemove', index }], orphanTags };
    }
    case 'device': {
      const at = locateDevice(o, ref.id);
      if (!at) return { edits: [], orphanTags: 0 };
      const orphanTags = tags.filter(
        (x) => x.kind === 'external' && x.source?.device === ref.id,
      ).length;
      return {
        edits: [{ kind: 'deviceRemove', channel: at.channel, index: at.index }],
        orphanTags,
      };
    }
    case 'valueTable':
      return {
        edits: [{ kind: 'valueTableRemove', name: ref.name }],
        orphanTags: tags.filter((x) => x.valueTable === ref.name).length,
      };
    case 'watch':
      return { edits: [{ kind: 'watchTableRemove', id: ref.id }], orphanTags: 0 };
    default:
      return { edits: [], orphanTags: 0 };
  }
}

export interface NodeTag {
  /** Chỉ số Tag trong `tags.json`. */
  row: number;
  id: string;
  type: string;
}

/**
 * Các Tag của nút đang chọn (vùng Details, FR-043): kênh → Tag ngoài của mọi thiết bị trường của kênh; thiết bị trường →
 * Tag ngoài của thiết bị; bảng giá trị → Tag dùng bảng; bảng theo dõi → Tag của các dòng có trong project. Nút khác: `null`
 * (Details dùng danh sách mặc định).
 */
export function tagsOfNode(ref: NodeRef | null, o: ProjectOutline): NodeTag[] | null {
  if (!ref) return null;
  const tags = tagsOf(o);
  const pick = (test: (t: TagV1) => boolean): NodeTag[] =>
    tags.flatMap((tag, row) => (test(tag) ? [{ row, id: tag.id, type: tag.type }] : []));
  switch (ref.type) {
    case 'channel': {
      const ids = new Set(
        (channelsOf(o).find((c) => c.id === ref.id)?.devices ?? []).map((d) => d.id),
      );
      return pick((x) => x.kind === 'external' && !!x.source && ids.has(x.source.device));
    }
    case 'device':
      return pick((x) => x.kind === 'external' && x.source?.device === ref.id);
    case 'valueTable':
      return pick((x) => x.valueTable === ref.name);
    case 'watch': {
      const names = new Set(
        (o.watchTables.find((w) => w.id === ref.id)?.doc?.rows ?? []).map((r) => r.tag),
      );
      return pick((x) => names.has(x.id));
    }
    default:
      return null;
  }
}
