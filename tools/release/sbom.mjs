// SBOM CycloneDX 1.5 của bản phát hành (feature 011, T095; FR-052, SC-018, D16).
//
//   node tools/release/sbom.mjs --out release/<ver>/sbom.cdx.json [--version <ver>] [--root <repo>]
//        [--cargo-metadata auto|none|<tệp JSON>]
//
// Thành phần: mọi gói của `package-lock.json` và `Cargo.lock` (100 %, kể cả gói chỉ khi phát triển, đánh
// `scope: excluded`) và thư viện vendored trong `third_party/LICENSES.md`. `bom-ref` là purl; thứ tự theo purl; cùng
// đầu vào cho cùng đầu ra trừ `serialNumber` (UUID ngẫu nhiên) và `metadata.timestamp` (giờ chạy, hoặc
// `SOURCE_DATE_EPOCH` nếu đặt). Không thêm phụ thuộc npm.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectComponents } from './lib/components.mjs';
import { isSimpleId } from './lib/license-policy.mjs';
import { loadCargoMetadata } from './license-report.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function licensesOf(c) {
  if (!c.license) return [{ license: { name: 'UNKNOWN' } }];
  if (isSimpleId(c.license)) return [{ license: { id: c.license } }];
  return [{ expression: c.license }];
}

/**
 * @param {ReturnType<typeof collectComponents>} collected
 * @param {{ version?: string, timestamp?: string, serialNumber?: string }} [opt]
 */
export function buildSbom(collected, opt = {}) {
  const toolVersion = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version;
  const components = collected.components.map((c) => {
    const o = {
      type: 'library',
      'bom-ref': c.purl,
      name: c.name,
      version: c.version,
      purl: c.purl,
      licenses: licensesOf(c),
    };
    if (c.own) o.supplier = { name: 'ATPro' };
    if (c.dev) o.scope = 'excluded';
    if (c.hashes.length) o.hashes = [...c.hashes].sort((a, b) => (a.alg < b.alg ? -1 : 1));
    if (c.url) o.externalReferences = [{ type: 'distribution', url: c.url }];
    const props = [{ name: 'mat:ecosystem', value: c.ecosystem }];
    if (c.licenseSource) props.push({ name: 'mat:licenseSource', value: c.licenseSource });
    if (c.dev) props.push({ name: 'mat:dev', value: 'true' });
    o.properties = props;
    return o;
  });
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: opt.serialNumber ?? `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: opt.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      tools: {
        components: [
          {
            type: 'application',
            name: 'mat-sbom',
            version: toolVersion,
            description: 'tools/release/sbom.mjs',
          },
        ],
      },
      component: {
        type: 'application',
        'bom-ref': 'mat-scada',
        name: 'mAT SCADA',
        version: opt.version ?? '0.0.0',
        supplier: { name: 'ATPro' },
      },
      properties: [
        { name: 'mat:count:npm', value: String(collected.counts.npm) },
        { name: 'mat:count:cargo', value: String(collected.counts.cargo) },
        { name: 'mat:count:vendored', value: String(collected.counts.vendored) },
        { name: 'mat:cargoLicenses', value: collected.cargoLicenses },
      ],
    },
    components,
  };
}

function timestampFromEnv() {
  const s = process.env.SOURCE_DATE_EPOCH;
  if (!s || !/^\d+$/.test(s)) return undefined;
  return new Date(Number(s) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function main() {
  const o = { root: repoRoot, out: null, version: undefined, cargoMetadata: 'auto' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[++i];
    if (v === undefined) {
      console.error(`sbom: thiếu giá trị cho ${a}`);
      process.exit(2);
    }
    if (a === '--root') o.root = resolve(v);
    else if (a === '--out') o.out = resolve(v);
    else if (a === '--version') o.version = v;
    else if (a === '--cargo-metadata') o.cargoMetadata = v;
    else {
      console.error(`sbom: tham số lạ: ${a}`);
      process.exit(2);
    }
  }
  if (!o.out) {
    console.error('sbom: cần --out <sbom.cdx.json>');
    process.exit(2);
  }
  const { metadata, note } = loadCargoMetadata(o.cargoMetadata, o.root);
  if (note) console.error(`sbom: ${note} (license của crate ghi UNKNOWN)`);
  const collected = collectComponents({ root: o.root, cargoMetadata: metadata });
  const bom = buildSbom(collected, { version: o.version, timestamp: timestampFromEnv() });
  writeFileSync(o.out, JSON.stringify(bom, null, 2) + '\n');
  console.log(
    `sbom: ${bom.components.length} thành phần (npm ${collected.counts.npm}, cargo ${collected.counts.cargo}, vendored ${collected.counts.vendored}) → ${o.out}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
