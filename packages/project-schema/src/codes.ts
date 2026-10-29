// Mã lỗi dùng chung TS ↔ C++ (specs/002-vertical-slice/contracts/project-format.md).
// Contract là tập mã; câu chữ `message` có thể khác giữa hai bản.

export const ERROR_CODES = [
  'E_JSON',
  'E_SCHEMA',
  'E_SCHEMA_VERSION',
  'E_RUNTIME_TOO_OLD',
  'E_FILE_MISSING',
  'E_PATH',
  'E_SCREEN_ID',
  'E_DUP_TAG',
  'E_TAG_RANGE',
  'E_DUP_UID',
  'E_DUP_BINDING',
  'E_REF_UID',
  'E_REF_TAG',
  'E_TARGET_UNSUPPORTED',
  'E_TRANSFORM_UNSUPPORTED',
  'E_TYPE_MISMATCH',
  'E_SCALE_RANGE',
  'E_MAX_CLIENTS',
  'E_SCREEN_TAGS',
  // feature 003: logging.json (specs/003-data-logging/contracts/logging-config.md)
  'E_LOG_SECRET',
  'E_LOG_DUP_ID',
  'E_LOG_REF_TAG',
  'E_LOG_DUP_TAG',
  'E_LOG_REF_DEST',
  'E_LOG_COLUMN',
  'E_LOG_TABLE',
  'E_LOG_DEADBAND',
  'E_LOG_MAXLEN',
  'E_LOG_MODE',
  'E_LOG_LIMIT',
  'E_LOG_CONN',
  'E_LOG_TLS',
  // feature 006: định dạng 0.2 (specs/006-tags-modbus/contracts/project-format-0.2.md §7.1)
  'E_MIN_RUNTIME',
  'E_LIMIT',
  'E_DUP_ID',
  'E_REF_DEVICE',
  'E_REF_TABLE',
  'E_ADDR_SYNTAX',
  'E_ADDR_AREA',
  'E_ADDR_RANGE',
  'E_ADDR_READ_LIMIT',
  'E_ADDR_WRITE_LIMIT',
  'E_BIT_WRITE',
  'E_SCALING',
  'E_DEADBAND',
  'E_LIMITS',
  'E_TAG_ACCESS',
  'E_SIM',
  'E_INITIAL',
  'E_RETAIN',
  'E_EXPR_SYNTAX',
  'E_EXPR_UNKNOWN_TAG',
  'E_EXPR_UNKNOWN_TABLE',
  'E_EXPR_UNKNOWN_FUNC',
  'E_EXPR_ARITY',
  'E_EXPR_TYPE',
  'E_EXPR_CYCLE',
  'E_EXPR_DEPTH',
  'E_EXPR_LIMIT',
  'E_VT_OVERLAP',
  'E_VT_RANGE',
  'E_VT_TEXT',
  'E_SERIAL_PORT',
  'E_SERIAL_SHARED',
  /** Chỉ có khi validator được đưa một SerialPolicy (luật của thiết bị, không có trong vector chung). */
  'E_SERIAL_NOT_ALLOWED',
  // feature 007: định dạng 0.3 (specs/007-screens-widgets/contracts/project-format-0.3.md §7.1)
  'E_SCREEN_SIZE',
  'E_SCREEN_KIND',
  'E_ITEM_ID',
  'E_ITEM_SIZE',
  'E_WIDGET_UNKNOWN',
  'E_WIDGET_SLOT',
  'E_WIDGET_PROP',
  'E_WIDGET_TAG_TYPE',
  'E_WIDGET_LIMITS',
  'E_WIDGET_MINROLE',
  'E_WIDGET_CONFIRM',
  'E_ACTION',
  'E_ACTION_TARGET',
  'E_NAV',
  // feature 009: định dạng 0.5 (specs/009-alarms/contracts/project-format-0.5.md §5.1)
  'E_ALARM_ID_DUP',
  'E_ALARM_ID_FORMAT',
  'E_ALARM_TYPE',
  'E_ALARM_TAG_REF',
  'E_ALARM_TAG_TYPE',
  'E_ALARM_DEVICE_REF',
  'E_ALARM_CLASS_REF',
  'E_ALARM_AREA_REF',
  'E_ALARM_TRIGGER',
  'E_ALARM_ON',
  'E_ALARM_LIMIT_NONE',
  'E_ALARM_LIMIT_ORDER',
  'E_ALARM_DEADBAND',
  'E_ALARM_DELAY_RANGE',
  'E_ALARM_TEXT_LEN',
  'E_ALARM_TEXT_TOKEN',
  'E_ALARM_FIELD',
  'E_ALARM_COUNT',
  'E_ALARM_CLASS_DUP',
  'E_ALARM_CLASS_FIELD',
  'E_ALARM_AREA_DUP',
  'E_ALARM_AREA_COUNT',
  'E_ALARM_CLASS_COUNT',
  // feature 008: định dạng 0.4 (specs/008-svg-import-binding/contracts/project-format-0.4.md §6)
  'E_BIND_TRANSFORM',
  'E_BIND_PARAM',
  'E_RANGE',
  'E_EVENT_ACTION',
  'E_EVENT_TAG',
  'E_EVENT_TARGET',
  'E_EVENT_CONFIRM',
  'E_EVENT_MINROLE',
  /** Chỉ bản TS (cần nội dung SVG; core/ không parse SVG, Constitution II). */
  'E_SVG_UNSAFE',
  /** Chỉ bản TS. */
  'E_SVG_LIMIT',
  // feature 010: logging 0.2 (contracts/logging-config-0.2.md §3), reports.json (templates-config.md §3),
  // widget lịch sử (widget-catalog-010.md §3)
  'E_LOG_TRIGGER',
  'E_LOG_AGG',
  'E_RPT_DUP_ID',
  'E_RPT_REF_GROUP',
  'E_RPT_REF_TAG',
  'E_RPT_NO_AGG',
  'E_RPT_PERIOD',
  'E_RPT_SHIFT',
  'E_RPT_FN',
  'E_RPT_LIMIT',
  'E_RPT_KIND',
  // feature 024: logo báo cáo, recipe (specs/024-recipes/plan.md mục Hợp đồng)
  'E_RPT_LOGO',
  'E_RECIPE_VERSION',
  'E_RECIPE_DUP_ID',
  'E_RECIPE_TAG',
  'E_RECIPE_TAG_RW',
  'E_RECIPE_LIMIT',
  'E_RECIPE_VALUE',
  'E_NAV_REPORT',
  'E_WIDGET_HISTORY_GROUP',
  'E_WIDGET_HISTORY_TAG',
  'E_WIDGET_HISTORY_AGG',
  // feature 011: định dạng 1.0.0 (specs/011-pilot-hardening/contracts/project-format-1.0.md §3-§5, §7)
  /** Template: id khác tên file, id item trong template sai dạng hoặc trùng. */
  'E_TEMPLATE_ID',
  /** `tpl` của item: `tid` không có, `rid` không có trong template, id item khác `<inst>.<rid>`, một bản sao hai template. */
  'E_TEMPLATE_REF',
  /** `{name}` không khai, ngoài chỗ dùng được, `{`/`}` lạ; khai báo tham số sai; giá trị tham số của bản sao sai. */
  'E_TEMPLATE_PARAM',
  /** Tag sau khi thay tham số (bản sao template, popup có tham số) không có hoặc sai kiểu khe. */
  'E_TEMPLATE_TAG_REF',
  /** `args` của hành động popup: thiếu, thừa, sai kiểu, hoặc quá 1.000 bộ khác nhau cho một popup. */
  'E_POPUP_ARGS',
  // feature 011: logic.json (specs/011-pilot-hardening/contracts/logic-engine.md §11; rules-logic.ts)
  'E_LOGIC_LIMIT',
  'E_LOGIC_ID',
  'E_LOGIC_TAG_REF',
  'E_LOGIC_TYPE',
  'E_LOGIC_EXPR',
  'E_LOGIC_TAG_COLLISION',
  'E_LOGIC_CYCLE',
  'E_LOGIC_SELF_TRIGGER',
  'E_LOGIC_WRITE_UNDECLARED',
  'E_LOGIC_WRITE_TARGET',
  'E_LOGIC_WRITE_VALUE',
  'E_LOGIC_ACTION',
  'E_LOGIC_TIMER',
  'E_LOGIC_COUNTER',
  'E_LOGIC_TOTALIZER',
  'E_LOGIC_SCHEDULE',
  'E_LOGIC_VERSION',
  // feature 012: bố cục lưới, chủ đề (specs/012-screen-grid-layout/contracts/project-format-1.1.md §3; rules-11.ts)
  /** `layout.columns` khác 12 hoặc `mode` khác `grid`. */
  'E_LAYOUT_COLUMNS',
  /** `span` ngoài 1..12, `offset` ngoài 0..11, hoặc tổng offset + span của hàng quá 12. */
  'E_LAYOUT_SPAN',
  /** Id hàng hoặc ô sai mẫu hoặc trùng trong màn hình. */
  'E_LAYOUT_ID',
  /** Ô trỏ tới item không có. */
  'E_LAYOUT_ITEM_REF',
  /** Một item nằm ở nhiều ô. */
  'E_LAYOUT_ITEM_DUP',
  /** Item của màn hình lưới có vị trí tuyệt đối, hoặc item của màn hình tự do thiếu vị trí. */
  'E_LAYOUT_ITEM_POS',
  /** Quá 100 hàng, hoặc hàng có 0 hay quá 12 ô. */
  'E_LAYOUT_LIMIT',
  /** `layout` hoặc `theme` ở project dưới 1.1, hoặc project 1.1 có runtime tối thiểu dưới 1.1.0. */
  'E_LAYOUT_VERSION',
  // feature 013: vai trò tối thiểu của màn hình và item (specs/013-access-control/spec.md FR-050; rules-11.ts)
  /** `security.operate` là viewer, thấp hơn `view`, khác `minRole`; hoặc `security.view`/`operate` ở project 1.0. */
  'E_SECURITY_LEVEL',
  /** `security.operate` trên item không thao tác được (widget không thuộc nhóm control, SVG không có sự kiện ghi). */
  'E_SECURITY_ITEM',
  // feature 016, 019: driver Siemens S7 (rules-s7.ts), OPC UA client (rules-opcua.ts)
  /** Kênh của driver chỉ có từ định dạng 1.1 (kênh `s7`, `opcua`, `mqtt`) nằm trong project 1.0. */
  'E_DRIVER_VERSION',
  /** Kênh S7 có `remoteTsap` cùng với `rack` hoặc `slot`. */
  'E_S7_TSAP',
  /** Kênh OPC UA: securityMode và securityPolicy không khớp. */
  'E_OPCUA_SECURITY',
  /** Kênh OPC UA: auth username thiếu username/secretId, hoặc anonymous có chúng. */
  'E_OPCUA_AUTH',
  // feature 018 (rules-fins.ts), 017 (rules-mc.ts), 020 (rules-bacnet.ts): kênh fins, mc, bacnet
  /** Kênh loại `fins`, `mc`, `bacnet` hoặc `source.bcd` ở project dưới 1.1. */
  'E_CHANNEL_VERSION',
  // feature 022: driver MQTT client (rules-mqtt.ts)
  /** Kênh MQTT: serverCertSha256, caCertPem hoặc serverName khi tls.enabled là false. */
  'E_MQTT_TLS',
  /** Tag MQTT: hướng của địa chỉ không khớp quyền (`sub` mà RW, `pub` mà chỉ đọc). */
  'E_MQTT_DIRECTION',
  /** Nhóm publish MQTT có Tag không tồn tại. */
  'E_MQTT_GROUP_TAG',
  /** Feature 025: mẫu tên Tag của nhóm publish MQTT không khớp Tag nào, hoặc nhóm quá 500 Tag. */
  'E_MQTT_GROUP_PATTERN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
/**
 * W_LOG_*: ước tính ghi/dung lượng vượt ngân sách; kết nối không xác thực máy chủ. Không chặn lưu
 * hay kích hoạt (FR-024).
 */
export type WarningCode =
  | 'W_UID_NOT_IN_SVG'
  | 'W_LOG_WRITE_BUDGET'
  | 'W_LOG_SIZE_CAP'
  | 'W_LOG_TLS_UNVERIFIED'
  // feature 006 (contracts/project-format-0.2.md §7.2)
  | 'W_WRITE_NO_LIMITS'
  | 'W_DETECT_SLOW'
  | 'W_RTU_SCAN_TIME'
  | 'W_BIT_RMW'
  | 'W_EXPR_INT64'
  | 'W_WATCH_REF'
  | 'W_ADDR_MODICON_BASE0'
  // feature 007 (contracts/project-format-0.3.md §7.2)
  | 'W_ITEM_OUTSIDE'
  | 'W_SCREEN_EMPTY'
  | 'W_STRETCH_WIDGETS'
  | 'W_CONFIRM_NONE'
  | 'W_PULSE_READBACK'
  | 'W_ACTION_NOOP'
  | 'W_SCREEN_TAGS_MANY'
  | 'W_ITEM_COVERED'
  // feature 009 (contracts/project-format-0.5.md §5.2)
  | 'W_ALARM_COUNT_HIGH'
  | 'W_ALARM_NO_ACK_CRITICAL'
  | 'W_ALARM_CHATTER_RISK'
  | 'W_ALARM_DEVICE_EMPTY'
  // feature 009, danh mục widget 0.4.0 (contracts/ui-alarm.md §13.3)
  | 'W_WIDGET_ALARM_REF'
  // feature 008 (contracts/project-format-0.4.md §6); W_SVG_*, W_BIND_ELEMENT_KIND, W_BIND_CLIP_EXISTS: chỉ bản TS
  | 'W_ANIM_MANY'
  | 'W_BLINK_ONLY'
  | 'W_EVENT_CONFIRM_NONE'
  | 'W_EVENT_PULSE_READBACK'
  | 'W_SVG_HEAVY'
  | 'W_BIND_ELEMENT_KIND'
  | 'W_BIND_CLIP_EXISTS'
  // feature 010 (contracts/logging-config-0.2.md §4): ước tính ghi > 8 GiB/ngày
  | 'W_LOG_WRITE_EXTREME'
  // feature 011 (contracts/project-format-1.0.md §4): item của bản sao không còn khớp template
  | 'W_TEMPLATE_DRIFT'
  // feature 012 (contracts/project-format-1.1.md §3): item của màn hình lưới không nằm trong ô nào
  | 'W_LAYOUT_ITEM_ORPHAN'
  // feature 030: mục menu trỏ trang hệ thống mà project không có tính năng tương ứng
  | 'W_NAV_SYSTEM'
  // feature 040 (chỉ Studio): project có alarm mà web không có lối vào (chuông tắt, menu không có mục Alarm)
  | 'W_ALARM_NO_ACCESS'
  // feature 011 (contracts/logic-engine.md §11): logic.json
  | 'W_LOGIC_PT_ROUNDED'
  | 'W_LOGIC_WRITE_CONFLICT'
  | 'W_LOGIC_RETAIN_IO'
  // feature 019 (specs/019-driver-opcua/contracts/opcua.md §1)
  | 'W_OPCUA_PLAIN_PASSWORD'
  | 'W_OPCUA_CERT_NOT_PINNED'
  // feature 022 (specs/022-driver-mqtt/spec.md FR-002, FR-003)
  | 'W_MQTT_TLS_NOT_PINNED'
  | 'W_MQTT_PLAIN_PASSWORD'
  | 'W_LOGIC_WRITES_OFF'
  | 'W_LOGIC_NO_HOLD'
  | 'W_LOGIC_DISABLED';

export interface Issue {
  code: ErrorCode | WarningCode;
  file: string;
  path: string; // JSON Pointer ("" = cả file)
  message: string;
  /** Lỗi trong biểu thức: [đầu, cuối) theo ký tự Unicode trong chuỗi `expression` (định dạng 0.2). */
  span?: [number, number];
}

/**
 * Phiên bản runtime mà bộ kiểm tra này đại diện (so với `minRuntimeVersion`). `1.0.0-rc.N` (T191): `compareSemver` chỉ so
 * phần số nên project `minRuntimeVersion` 1.0.0 chạy được trên 1.0.0-rc.1 (ADR 035). Khớp `kRuntimeVersion` của C++.
 */
export const RUNTIME_VERSION = '1.1.0-alpha.1';
/** v0: chấp nhận đúng 0.1.x, không hậu tố pre-release (MAJOR = 0 nên MINOR cũng phải khớp, ADR-004). */
export const SUPPORTED_SCHEMA = /^0\.1\.\d+$/;
/** Định dạng 0.2: mọi file bằng đúng `project.json.schemaVersion`, khớp mẫu này. */
export const SUPPORTED_SCHEMA_02 = /^0\.2\.\d+$/;
/** Runtime tối thiểu của project 0.2 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_02 = '0.5.0';
/** Định dạng 0.3: mọi file bằng đúng `project.json.schemaVersion`, khớp mẫu này. */
export const SUPPORTED_SCHEMA_03 = /^0\.3\.\d+$/;
/** Runtime tối thiểu của project 0.3 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_03 = '0.6.0';
/**
 * Định dạng 0.4 (feature 008: SVG, binding, sự kiện, symbol) và 0.5 (feature 009: alarm, tập con siêu của 0.4):
 * mọi file bằng đúng `project.json.schemaVersion`.
 */
export const SUPPORTED_SCHEMA_04 = /^0\.4\.\d+$/;
export const SUPPORTED_SCHEMA_05 = /^0\.5\.\d+$/;
/** Runtime tối thiểu của project 0.4 và 0.5 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_04 = '0.7.0';
export const MIN_RUNTIME_05 = '0.8.0';
/** Định dạng 0.6 (feature 010: reportsFile, navigation[].report, logging trigger/tổng hợp): mọi file cùng phiên bản. */
export const SUPPORTED_SCHEMA_06 = /^0\.6\.\d+$/;
/** Runtime tối thiểu của project 0.6 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_06 = '0.9.0';
/**
 * Họ 1.x mà validator này hiểu: 1.0.x (feature 011: logic, template, faceplate) và 1.1.x (feature 012: bố cục lưới,
 * chủ đề). Cùng một bộ schema ở thư mục gốc `schemas/` (dòng 1.x chỉ thêm, MINOR); phần chỉ có ở 1.1 do luật
 * `E_LAYOUT_VERSION` kiểm. 1.2 trở lên bị từ chối. Mọi file cùng phiên bản.
 */
export const SUPPORTED_SCHEMA_10 = /^1\.[01]\.\d+$/;
/** Đúng 1.1.x (feature 012). */
export const SUPPORTED_SCHEMA_11 = /^1\.1\.\d+$/;
/** Runtime tối thiểu của project 1.0 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_10 = '1.0.0';
/** Runtime tối thiểu của project 1.1 (E_LAYOUT_VERSION). */
export const MIN_RUNTIME_11 = '1.1.0';
/** Số Tag riêng biệt trên một màn hình (kèm popup nó mở) từ đó cảnh báo W_SCREEN_TAGS_MANY. */
export const WARN_SCREEN_TAGS = 500;
/** Trần file JSON của project. */
export const MAX_FILE_BYTES = 1024 * 1024;
/** Trần SVG mà Studio/CLI đọc (ADR-003). Bản C++ chỉ kiểm SVG có tồn tại, không đọc nội dung. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;
export const MAX_CLIENTS_LIMIT = 10;
/** Số Tag khác nhau tối đa trên một màn hình: một subscribe của giao thức live (live-ws.md). */
export const MAX_SCREEN_TAGS = 1000;
/** Kiểm trước khi parse/so pattern, giống hệt bản C++ (review M1, M3). */
export const MAX_JSON_DEPTH = 64;
export const MAX_STRING_BYTES = 1024;
