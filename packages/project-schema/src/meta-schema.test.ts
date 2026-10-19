// T011 (audit C-02): mỗi file schemas/*.schema.json hợp lệ theo meta-schema draft-07, và chỉ dùng từ
// khóa của draft-07: một từ khóa gõ sai (ví dụ "maxItem") bị cả bộ kiểm tra TS lẫn C++ bỏ qua mà
// không báo. Meta-schema: third_party/json-schema (third_party/LICENSES.md).
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator, type Schema } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';
import {
  RUNTIME_VERSION,
  SUPPORTED_SCHEMA,
  SUPPORTED_SCHEMA_02,
  SUPPORTED_SCHEMA_03,
  SUPPORTED_SCHEMA_04,
  SUPPORTED_SCHEMA_05,
  SUPPORTED_SCHEMA_06,
  SUPPORTED_SCHEMA_10,
} from './codes.ts';

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));
const meta = read('third_party/json-schema/draft-07.schema.json') as Schema;
// Bản chặt: mọi schema con chỉ được có từ khóa draft-07 (`$ref: "#"` của meta-schema trỏ về gốc này).
// Bản sao riêng: @cfworker ghi URI tuyệt đối vào từng schema con khi nạp.
const strict = {
  ...(read('third_party/json-schema/draft-07.schema.json') as object),
  $id: 'urn:mat:draft-07-strict',
  additionalProperties: false,
} as Schema;
const files = readdirSync(resolve(ROOT, 'schemas')).filter((f) => f.endsWith('.schema.json'));
/** SHA-256 của bộ 1.0.0 đóng băng ở schemas/1.0 (T017; không bao giờ đổi). */
const FROZEN_10: Record<string, string> = {
  'alarm-classes.schema.json': 'c8c33817724cdb88c0efad50443a964639b042c9574caf260c35cf49e989e34a',
  'alarms.schema.json': '425c9688e132b966bbe787e136c845f986e3d3828241ec69f7bd610b3bf4443c',
  'binding.schema.json': '93e7038bc1354e4e2170ac0bed316d57798d6d3c84e19c07caec4f33e979fd72',
  'connections.schema.json': '471a5b66cdbacf4ab80dae5d00c26fcc277af7a71f17ca1fe26c6634ed433255',
  'logging.schema.json': '1c055b4b1af1dbada7f116060ab3a57a385671421beb1c682f208a80664ad975',
  'logic.schema.json': '5c4e8c250a313409696fb1b3d071280d2358ea6c515e3beca7e2e24b99374301',
  'project.schema.json': 'bd685af47790186c1e231e1fca002a41e0b1f923f72c768a16f537983775dab7',
  'reports.schema.json': '91679a87467402d2f09f1ec7fac964d0243bf6d348047460940eef0ec8c5eaeb',
  'screen.schema.json': 'b64d0706a676041754320bb3e78fbedfc1d7d2b878a509bc9e6095dd15c6118b',
  'tag.schema.json': 'c6d4a159954e1b9a5c6cd69228a24393d6499108d091e79e31a26a78a34928d9',
  'template.schema.json': '0d3c0c0b96a32d18ebfa650c7ae6ee1b10b20e0a66fdce07c593a7b54b621712',
  'value-table.schema.json': '3388190678da855ec210db179e720ffe3529d6e563d59e6cee071a7010b7fef6',
  'watch-table.schema.json': 'be3d9e79aea3b1c5bf164c4d9b54d387c598880cc6b91daabb141310565d27f6',
};

describe('schemas/*.schema.json theo meta-schema draft-07', () => {
  // Feature 005 (T087): manifest của gói .matscada, chỉ bản C++ và Rust dùng; cũng phải đúng draft-07.
  it('đủ 14 schema (1.0: tập file của 0.6 cộng logic.schema.json, template.schema.json)', () => {
    expect([...files].sort()).toEqual([
      'alarm-classes.schema.json',
      'alarms.schema.json',
      'binding.schema.json',
      'connections.schema.json',
      'logging.schema.json',
      'logic.schema.json',
      'package-manifest.schema.json',
      'project.schema.json',
      'reports.schema.json',
      'screen.schema.json',
      'tag.schema.json',
      'template.schema.json',
      'value-table.schema.json',
      'watch-table.schema.json',
    ]);
  });

  // T032: schemas/0.1 là bản sao đóng băng của schema 0.1 (SHA-256 của bản trước khi lên 0.2.0).
  it('schemas/0.1/*.schema.json giống từng byte bản 0.1 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'project.schema.json': 'd5d071ffe2ab96248732e8c9803d977d306c05a6f654074cc9b50626372d86f3',
      'tag.schema.json': '96b7a705bd86f348dc9e3ed7015a3af80ef4d93465a8656c2cad5b39e4f8cae3',
      'screen.schema.json': 'b203f936d07c0db70c2984ef521732550284710db336acf820de00d3e51ad460',
      'binding.schema.json': 'c45e96057db1c9bb21acf54570f14431b32a311570474b99089e56547d566c7e',
      'logging.schema.json': '7f2bd679e22bb208912f7bfb1a571d0e28e6fd390a56f6a910f72cd4131c4e81',
    };
    expect(readdirSync(resolve(ROOT, 'schemas/0.1')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.1', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  // Feature 007 (T010): schemas/0.2 là bản sao đóng băng của schema 0.2.0 (SHA-256 trước khi lên 0.3.0).
  it('schemas/0.2/*.schema.json giống từng byte bản 0.2 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'project.schema.json': 'c549475796cdc8feff4b16bf832eee69c32e8491792ff12745f398e28efaea9c',
      'tag.schema.json': 'c7397f031c36bc46ec34b5c1b8a71480b8bfd4a4c916159ac7b7ee654088469c',
      'screen.schema.json': '3252351ff97faba9fdc398e8bb395080723997be50df148426ffe680df852e01',
      'binding.schema.json': '26257281a86e72f0ab3b263378c54acd173eafdb13c8a69f6ec78ca78413539f',
      'logging.schema.json': '1ff12f952e4fd4cea115a29b0b32f28dc22544a9c882ee6ef2dbba238706f8d1',
      'connections.schema.json': 'd175dd14decaa0db4ca3536616e4fd79abd6504d3c0a0eea9861823f28b25ae7',
      'value-table.schema.json': 'c070707fd7918f4d02dae7fdf840430bd4522ec12781417dc96336838a8d96d1',
      'watch-table.schema.json': '348492e08491a33fff4f1415b92ed8123a1896bc6ad98f8f30d4c709e94d0c8c',
    };
    expect(readdirSync(resolve(ROOT, 'schemas/0.2')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.2', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  // Features 008 (T012) và 009 (T014): schemas/0.3 là bản sao đóng băng của schema 0.3.0 (SHA-256 trước khi lên 0.4.0).
  it('schemas/0.3/*.schema.json giống từng byte bản 0.3 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'binding.schema.json': '439956089cdd8a9d4c6e5db08411915a2169a1845a5fc99d692196a4037b77bb',
      'connections.schema.json': '33ac3f3090df3dd20b76a57c3e6dded61a07954da0f80c1436ee944d63453253',
      'logging.schema.json': 'c6a9fcec760be701e616680bec04c6274c74123b6102b31412b16e2df1928a3a',
      'project.schema.json': '1b4682fafca52306b4a66cc8640e5f31da3b1cf1e651572f5fb25222b9e97a05',
      'screen.schema.json': '68a51bfa524041b4322f7ebdc101629dd6cf7d5b885037f759b73519374a6895',
      'tag.schema.json': '8371efbc3baa5ed55d69c9500e0235a904240a21e09b2dcbe9bd6cbde30e717d',
      'value-table.schema.json': '0713986175b4e8fa43c6e5e161483b7d52860e6036a770a85e4905ee329323d7',
      'watch-table.schema.json': '3b79683b3a66641b6f1be187904fe725d8ad1cf0090f87a666c879329ae4dd3d',
    };
    expect(
      readdirSync(resolve(ROOT, 'schemas/0.3'))
        .filter((x) => x.endsWith('.schema.json'))
        .sort(),
    ).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.3', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  // Gộp 008 + 009: schemas/0.4 là bản sao đóng băng của schema 0.4.0 (feature 008; SHA-256 trước khi lên 0.5.0 của feature 009).
  it('schemas/0.4/*.schema.json giống từng byte bản 0.4 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'binding.schema.json': '322a002ce327de454e130bfba709511a72a3367672252d7f6f1889e7f9f1a9c8',
      'connections.schema.json': '9b8c26b7a4fb3573693bd2e684ebc90bad25116b450fb26fa07a5316ea9c6938',
      'logging.schema.json': '5d0424a63d7fd357f914d7211dfb9eda1678953798c4033f4acb9791c941400c',
      'project.schema.json': 'c9ee86293a723616290b9ade03f2245a4b9f0d3462933337aef1f626652890b0',
      'screen.schema.json': '50970e86dcf6fd56e021e27cf0e0a6aad40443483a4afdc6fc6b991bb34c95f8',
      'tag.schema.json': '2679bc8b8e0b8d044f8161d74610e6e7ca119239bff1fb8284f00bdb2d84a6ee',
      'value-table.schema.json': 'b15c5b36fbbb2c14514c2cbd8fe572a8f5367a958fbfc76b913d5ff73b0cf50f',
      'watch-table.schema.json': '93e6909b459ac7cc88f35c566e9e95da197642751c603f222fe8baa06fb71d47',
    };
    expect(readdirSync(resolve(ROOT, 'schemas/0.4')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.4', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  // Gộp 008 + 009 + 010: schemas/0.5 là bản sao đóng băng của schema 0.5.0 (feature 009; SHA-256 trước khi lên 0.6.0 của feature 010).
  it('schemas/0.5/*.schema.json giống từng byte bản 0.5 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'alarm-classes.schema.json':
        'ab947384ad7d34b2be06d070037e7feaf608f72efd2b7a8573131c8cda54bd6f',
      'alarms.schema.json': 'b3938052c72e7a98478029cbd41df4e5596bfe1c7b02ea23f0f379c842e8a398',
      'binding.schema.json': '7ea46ad320f2b9a2d5ea6c355cc5677c482bca12731608cca017ca2f2e003338',
      'connections.schema.json': '30285c32afe1f6f5d847b27691c01edbb9085b63f22170dc381bba9c6b351c15',
      'logging.schema.json': 'ebd2dbea3c2f561303f1d9497093e084f182544f69941c30130413b51ab449ff',
      'project.schema.json': 'f9be3573666ec503c6256cbbf3eb164803a01fe8f8f583c066f93cb5ded6d127',
      'screen.schema.json': 'cfd501efd4a49b12d039f9daf2a6c932baf5f4eca3d05c5709d1567b29483668',
      'tag.schema.json': '12db8d2ec56cc1d037bcde14ecdef7e7b19c688396a5a3bf46bec7dbabe0db55',
      'value-table.schema.json': 'c68d59c5480d76f76f50b561a7ca65ec99b1dd61176eac54f4d56669c3bcf74e',
      'watch-table.schema.json': '4ba0c33ed7e9191747c634d4886d935f4a2900211ee72e7de9c6443e5f4acd7d',
    };
    expect(readdirSync(resolve(ROOT, 'schemas/0.5')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.5', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  // Feature 011 (T017): schemas/0.6 là bản sao đóng băng của schema 0.6.0 (feature 010; SHA-256 trước khi lên 1.0.0).
  it('schemas/0.6/*.schema.json giống từng byte bản 0.6 đã đóng băng', () => {
    const frozen: Record<string, string> = {
      'alarm-classes.schema.json':
        '35ff821d0ec05bf4a18192cc77b93a2758a2d5ba24118422da7521395853a69a',
      'alarms.schema.json': 'ac6899eccba9fcdefbf62d497ba2bf481f5c60d4dfa767807815787f8eca8453',
      'binding.schema.json': 'afe111775d995f147de30aef65ce42fdf75e2dd2fbbec0f8f3ee78de18911325',
      'connections.schema.json': 'a20533fdf986bbfe5d0aa798b408e42736a0df9e25c8678a72f6ef91902ff926',
      'logging.schema.json': '87f6923578870ef4dd4a863db2d8d6d2adeccd3ae315c129fb81385c2dd3024d',
      'project.schema.json': '497dcad25761997fdc23aa7455233fa335cbf2bfb14c950b966776e85a483021',
      'reports.schema.json': 'ed89291bda72fc1ee5626c04b37ce10606fc3b28357505f8d75a1340801dd353',
      'screen.schema.json': '57544cd8e0fc3501ffb28cb46677afe7a492c3fdf74edc9e4cfbaf0e605dd7c8',
      'tag.schema.json': '5c8f503b965c70b51c4030be752897c0c39b45bbe8d78dc86651476718d75b77',
      'value-table.schema.json': 'ebca4e100b5101899d0afad67e254b0189967060837d902fd564ddc5f8c7a225',
      'watch-table.schema.json': 'aedcae27a949bb420c3732a81b0001a25db54cc9b2362a18c5197fbe12855d04',
    };
    expect(readdirSync(resolve(ROOT, 'schemas/0.6')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/0.6', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  // Feature 011 (T017): schemas/1.0 là bản đóng băng của bộ schema 1.0.0 (contracts/project-format-1.0.md §7); dòng 1.x
  // chỉ thêm (MINOR) ở thư mục gốc, bản này không bao giờ đổi.
  it('schemas/1.0/*.schema.json giống từng byte bản 1.0 đã đóng băng', () => {
    const frozen: Record<string, string> = FROZEN_10;
    expect(readdirSync(resolve(ROOT, 'schemas/1.0')).sort()).toEqual(Object.keys(frozen).sort());
    for (const [f, hash] of Object.entries(frozen))
      expect(
        createHash('sha256')
          .update(readFileSync(resolve(ROOT, 'schemas/1.0', f)))
          .digest('hex'),
        f,
      ).toBe(hash);
  });

  it('`$id` của schema 1.0 theo phiên bản; bản đóng băng giữ 0.1 đến 0.6 và 1.0', () => {
    for (const f of files.filter((x) => x !== 'package-manifest.schema.json'))
      expect(read(`schemas/${f}`).$id, f).toMatch(/\/1\.0\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/1.0')))
      expect(read(`schemas/1.0/${f}`).$id, f).toMatch(/\/1\.0\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.6')))
      expect(read(`schemas/0.6/${f}`).$id, f).toMatch(/\/0\.6\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.5')))
      expect(read(`schemas/0.5/${f}`).$id, f).toMatch(/\/0\.5\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.4')))
      expect(read(`schemas/0.4/${f}`).$id, f).toMatch(/\/0\.4\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.3')).filter((x) =>
      x.endsWith('.schema.json'),
    ))
      expect(read(`schemas/0.3/${f}`).$id, f).toMatch(/\/0\.3\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.2')))
      expect(read(`schemas/0.2/${f}`).$id, f).toMatch(/\/0\.2\.json$/);
    for (const f of readdirSync(resolve(ROOT, 'schemas/0.1')))
      expect(read(`schemas/0.1/${f}`).$id, f).toMatch(/\/0\.1\.json$/);
  });

  for (const dir of ['1.0', '0.6'])
    for (const f of readdirSync(resolve(ROOT, `schemas/${dir}`))) {
      it(`${dir}/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
        const schema = read(`schemas/${dir}/${f}`);
        expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
        expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
      });
    }

  for (const f of readdirSync(resolve(ROOT, 'schemas/0.5'))) {
    it(`0.5/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/0.5/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  for (const f of readdirSync(resolve(ROOT, 'schemas/0.4'))) {
    it(`0.4/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/0.4/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  for (const f of readdirSync(resolve(ROOT, 'schemas/0.3')).filter((x) =>
    x.endsWith('.schema.json'),
  )) {
    it(`0.3/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/0.3/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  for (const f of readdirSync(resolve(ROOT, 'schemas/0.2'))) {
    it(`0.2/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/0.2/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  for (const f of readdirSync(resolve(ROOT, 'schemas/0.1'))) {
    it(`0.1/${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/0.1/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  for (const f of files) {
    it(`${f}: hợp lệ và chỉ dùng từ khóa draft-07`, () => {
      const schema = read(`schemas/${f}`);
      expect(new Validator(meta, '7', false).validate(schema).errors).toEqual([]);
      expect(new Validator(strict, '7', false).validate(schema).errors).toEqual([]);
    });
  }

  it('bản chặt bắt được từ khóa gõ sai', () => {
    const v = new Validator(strict, '7', false);
    expect(
      v.validate({ type: 'object', properties: { a: { type: 'array', maxItem: 3 } } }).valid,
    ).toBe(false);
    expect(
      v.validate({ type: 'object', properties: { a: { type: 'array', maxItems: 3 } } }).valid,
    ).toBe(true);
  });
});

// Audit C-12: schemas/protocol-version.json là nguồn tham chiếu; mã TS và C++ phải khớp nó.
describe('schemas/protocol-version.json', () => {
  const v = read('schemas/protocol-version.json') as { live: string; project: string[] };

  // Runtime 1.0.0 (feature 011): bản TS và C++ cùng nhận 0.1 đến 0.6 và 1.0; 1.1 từ feature 012.
  it('các phiên bản schema project được bộ kiểm tra chấp nhận (0.1 đến 0.6, 1.0 và 1.1)', () => {
    expect(v.project).toEqual(['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '1.0', '1.1']);
    const accepts = (version: string) =>
      SUPPORTED_SCHEMA.test(version) ||
      SUPPORTED_SCHEMA_02.test(version) ||
      SUPPORTED_SCHEMA_03.test(version) ||
      SUPPORTED_SCHEMA_04.test(version) ||
      SUPPORTED_SCHEMA_05.test(version) ||
      SUPPORTED_SCHEMA_06.test(version) ||
      SUPPORTED_SCHEMA_10.test(version);
    for (const p of v.project) {
      expect(accepts(`${p}.0`)).toBe(true);
      expect(accepts(`${p}.7`)).toBe(true);
    }
    expect(accepts('0.7.0')).toBe(false);
    expect(accepts('1.0.0')).toBe(true);
    expect(accepts('1.0.0-rc.1')).toBe(false);
    expect(accepts('1.1.0')).toBe(true); // feature 012
    expect(accepts('1.2.0')).toBe(false);
    expect(accepts('2.0.0')).toBe(false);
  });

  it('phiên bản runtime và giao thức giống bản C++', () => {
    const header = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
    const cpp = (src: string, name: string) => new RegExp(`${name} = "([^"]+)"`).exec(src)?.[1];
    expect(cpp(header('core/project-manager/project_validator.hpp'), 'kRuntimeVersion')).toBe(
      RUNTIME_VERSION,
    );
    expect(cpp(header('server/websocket/live_hub.hpp'), 'kLiveProtocolVersion')).toBe(v.live);
  });
});
