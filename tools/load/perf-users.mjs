// Tài khoản, nhóm và quy tắc của phép đo T032 (013, SC-006); dùng chung bởi tools/load/perf-client.mjs (trong container)
// và tools/load/perf012-013.mjs (máy dev). Màn hình perf-01..perf-10 của tools/load/gen-perf-projects.mjs: item iNN của
// màn s gắn SIM.T(50(s-1)+NN+1).
export const USERS = [
  { name: 'u01', role: 'operator', groups: ['ca-a'] },
  { name: 'u02', role: 'operator', groups: ['ca-a'] },
  { name: 'u03', role: 'operator', groups: ['ca-a'] },
  { name: 'u04', role: 'operator', groups: ['ca-b'] },
  { name: 'u05', role: 'operator', groups: ['ca-b'] },
  { name: 'u06', role: 'operator', groups: ['ca-b'] },
  { name: 'u07', role: 'viewer', groups: ['bao-tri'] },
  { name: 'u08', role: 'viewer', groups: ['bao-tri'] },
  { name: 'u09', role: 'engineer', groups: ['quan-doc'] },
  { name: 'u10', role: 'viewer', groups: [] },
];
export const GROUPS = [
  ['ca-a', 'Ca A'],
  ['ca-b', 'Ca B'],
  ['bao-tri', 'Bảo trì'],
  ['quan-doc', 'Quản đốc'],
];
export const sid = (s) => `perf-${String(s).padStart(2, '0')}`;
export const iid = (i) => `i${String(i).padStart(2, '0')}`;
const tagOf = (s, i) => `SIM.T${String((s - 1) * 50 + i + 1).padStart(4, '0')}`;

/** 52 quy tắc: perf-09 chỉ ca-a và quản đốc; perf-10 chỉ bảo trì và quản đốc; 5 card đầu của perf-01..08 chỉ ca-b,
 * quản đốc, engineer trở lên; perf-01 i10..i19 chỉ u01 và bảo trì. */
export function rules() {
  const r = [
    { resource: `screen:${sid(9)}`, level: 'view', grantees: ['group:ca-a', 'group:quan-doc'] },
    { resource: `screen:${sid(10)}`, level: 'view', grantees: ['group:bao-tri', 'group:quan-doc'] },
  ];
  for (let s = 1; s <= 8; s++)
    for (let i = 0; i < 5; i++)
      r.push({
        resource: `item:${sid(s)}/${iid(i)}`,
        level: 'view',
        grantees: ['group:ca-b', 'group:quan-doc', 'role:engineer'],
      });
  for (let i = 10; i < 20; i++)
    r.push({
      resource: `item:${sid(1)}/${iid(i)}`,
      level: 'view',
      grantees: ['user:u01', 'group:bao-tri'],
    });
  return r;
}

const RANK = { viewer: 0, operator: 1, engineer: 2, administrator: 3 };
/** Tập Tag SIM.T* được phép của `u` theo rules() (contracts/access-model.md §4; mặc định project là viewer). */
export function allowedTags(u) {
  const inG = (g) => u.groups.includes(g);
  const out = [];
  for (let s = 1; s <= 10; s++) {
    if (s === 9 && !(inG('ca-a') || inG('quan-doc'))) continue;
    if (s === 10 && !(inG('bao-tri') || inG('quan-doc'))) continue;
    for (let i = 0; i < 50; i++) {
      if (s <= 8 && i < 5 && !(inG('ca-b') || inG('quan-doc') || RANK[u.role] >= RANK.engineer))
        continue;
      if (s === 1 && i >= 10 && i < 20 && !(u.name === 'u01' || inG('bao-tri'))) continue;
      out.push(tagOf(s, i));
    }
  }
  return out;
}
