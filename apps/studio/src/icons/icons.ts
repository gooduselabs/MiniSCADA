// Icon của Studio (feature 004, research R4, ADR-009): Fluent UI System Icons nạp lúc build (`?raw`),
// chỉ những icon dùng tới, cộng vài ký hiệu công nghiệp tự vẽ (bơm, van, bồn, motor, ống) mà bộ Fluent
// không có. Tất cả gom thành một sprite <symbol> đặt trong document; thành phần Studio render ở light
// DOM nên dùng <svg class="ic"><use href="#i-tên"></use></svg>. Nội dung SVG là tài nguyên của Studio,
// không phải dữ liệu project; dựng bằng DOMParser, không qua innerHTML.
import add from '@fluentui/svg-icons/icons/add_16_regular.svg?raw';
import alert from '@fluentui/svg-icons/icons/alert_16_regular.svg?raw';
import arrowClockwise from '@fluentui/svg-icons/icons/arrow_clockwise_16_regular.svg?raw';
import arrowCollapseAll from '@fluentui/svg-icons/icons/arrow_collapse_all_16_regular.svg?raw';
import arrowDownload from '@fluentui/svg-icons/icons/arrow_download_16_regular.svg?raw';
import arrowExport from '@fluentui/svg-icons/icons/arrow_export_16_regular.svg?raw';
import arrowFit from '@fluentui/svg-icons/icons/arrow_fit_16_regular.svg?raw';
import arrowImport from '@fluentui/svg-icons/icons/arrow_import_16_regular.svg?raw';
import arrowRedo from '@fluentui/svg-icons/icons/arrow_redo_16_regular.svg?raw';
import arrowSortDownLines from '@fluentui/svg-icons/icons/arrow_sort_down_lines_16_regular.svg?raw';
import arrowUndo from '@fluentui/svg-icons/icons/arrow_undo_16_regular.svg?raw';
import arrowUpload from '@fluentui/svg-icons/icons/arrow_upload_16_regular.svg?raw';
import borderInside from '@fluentui/svg-icons/icons/border_inside_16_regular.svg?raw';
import button from '@fluentui/svg-icons/icons/button_16_regular.svg?raw';
import cardUi from '@fluentui/svg-icons/icons/card_ui_20_regular.svg?raw';
import checkmarkCircle from '@fluentui/svg-icons/icons/checkmark_circle_16_regular.svg?raw';
import chevronDown from '@fluentui/svg-icons/icons/chevron_down_16_regular.svg?raw';
import chevronRight from '@fluentui/svg-icons/icons/chevron_right_16_regular.svg?raw';
import clipboardPaste from '@fluentui/svg-icons/icons/clipboard_paste_16_regular.svg?raw';
import columnDoubleCompare from '@fluentui/svg-icons/icons/column_double_compare_20_regular.svg?raw';
import connector from '@fluentui/svg-icons/icons/connector_16_regular.svg?raw';
import darkTheme from '@fluentui/svg-icons/icons/dark_theme_20_regular.svg?raw';
import dataBarVertical from '@fluentui/svg-icons/icons/data_bar_vertical_16_regular.svg?raw';
import dataLine from '@fluentui/svg-icons/icons/data_line_16_regular.svg?raw';
import dataPie from '@fluentui/svg-icons/icons/data_pie_16_regular.svg?raw';
import database from '@fluentui/svg-icons/icons/database_16_regular.svg?raw';
import desktop from '@fluentui/svg-icons/icons/desktop_16_regular.svg?raw';
import developerBoard from '@fluentui/svg-icons/icons/developer_board_16_regular.svg?raw';
import dismiss from '@fluentui/svg-icons/icons/dismiss_16_regular.svg?raw';
import documentCheckmark from '@fluentui/svg-icons/icons/document_checkmark_16_regular.svg?raw';
import documentData from '@fluentui/svg-icons/icons/document_data_16_regular.svg?raw';
import errorCircle from '@fluentui/svg-icons/icons/error_circle_16_regular.svg?raw';
import eye from '@fluentui/svg-icons/icons/eye_16_regular.svg?raw';
import folder from '@fluentui/svg-icons/icons/folder_16_regular.svg?raw';
import gauge from '@fluentui/svg-icons/icons/gauge_16_regular.svg?raw';
import gridDots from '@fluentui/svg-icons/icons/grid_dots_16_regular.svg?raw';
import group from '@fluentui/svg-icons/icons/group_20_regular.svg?raw';
import history from '@fluentui/svg-icons/icons/history_16_regular.svg?raw';
import home from '@fluentui/svg-icons/icons/home_16_regular.svg?raw';
import info from '@fluentui/svg-icons/icons/info_16_regular.svg?raw';
import library from '@fluentui/svg-icons/icons/library_16_regular.svg?raw';
import lightbulb from '@fluentui/svg-icons/icons/lightbulb_16_regular.svg?raw';
import link from '@fluentui/svg-icons/icons/link_16_regular.svg?raw';
import lockClosed from '@fluentui/svg-icons/icons/lock_closed_16_regular.svg?raw';
import mathFormula from '@fluentui/svg-icons/icons/math_formula_16_regular.svg?raw';
import navigation from '@fluentui/svg-icons/icons/navigation_16_regular.svg?raw';
import open from '@fluentui/svg-icons/icons/open_16_regular.svg?raw';
import options from '@fluentui/svg-icons/icons/options_16_regular.svg?raw';
import panelLeft from '@fluentui/svg-icons/icons/panel_left_16_regular.svg?raw';
import people from '@fluentui/svg-icons/icons/people_16_regular.svg?raw';
import play from '@fluentui/svg-icons/icons/play_16_regular.svg?raw';
import plugConnected from '@fluentui/svg-icons/icons/plug_connected_16_regular.svg?raw';
import plugDisconnected from '@fluentui/svg-icons/icons/plug_disconnected_16_regular.svg?raw';
import pulse from '@fluentui/svg-icons/icons/pulse_20_regular.svg?raw';
import save from '@fluentui/svg-icons/icons/save_16_regular.svg?raw';
import search from '@fluentui/svg-icons/icons/search_16_regular.svg?raw';
import settings from '@fluentui/svg-icons/icons/settings_16_regular.svg?raw';
import shieldCheckmark from '@fluentui/svg-icons/icons/shield_checkmark_16_regular.svg?raw';
import square from '@fluentui/svg-icons/icons/square_16_regular.svg?raw';
import subtract from '@fluentui/svg-icons/icons/subtract_16_regular.svg?raw';
import table from '@fluentui/svg-icons/icons/table_16_regular.svg?raw';
import tag from '@fluentui/svg-icons/icons/tag_16_regular.svg?raw';
import textBulletList from '@fluentui/svg-icons/icons/text_bullet_list_16_regular.svg?raw';
import textT from '@fluentui/svg-icons/icons/text_t_16_regular.svg?raw';
import textbox from '@fluentui/svg-icons/icons/textbox_16_regular.svg?raw';
import toggleLeft from '@fluentui/svg-icons/icons/toggle_left_16_regular.svg?raw';
import toolbox from '@fluentui/svg-icons/icons/toolbox_16_regular.svg?raw';
import warning from '@fluentui/svg-icons/icons/warning_16_regular.svg?raw';
import weatherMoon from '@fluentui/svg-icons/icons/weather_moon_16_regular.svg?raw';
import weatherSunny from '@fluentui/svg-icons/icons/weather_sunny_16_regular.svg?raw';
import zoomIn from '@fluentui/svg-icons/icons/zoom_in_16_regular.svg?raw';
import zoomOut from '@fluentui/svg-icons/icons/zoom_out_16_regular.svg?raw';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tên dùng trong Studio → file Fluent (mỗi nghĩa một icon, như mockup bản 1). */
const FLUENT = {
  save,
  undo: arrowUndo,
  redo: arrowRedo,
  check: documentCheckmark,
  download: arrowDownload,
  upload: arrowUpload,
  compare: columnDoubleCompare,
  online: plugConnected,
  offline: plugDisconnected,
  play,
  search,
  project: folder,
  home,
  gear: settings,
  device: developerBoard,
  connection: connector,
  tag,
  table,
  fx: mathFormula,
  list: textBulletList,
  bell: alert,
  db: database,
  screen: desktop,
  report: documentData,
  users: people,
  library,
  'chev-r': chevronRight,
  'chev-d': chevronDown,
  x: dismiss,
  plus: add,
  minus: subtract,
  paste: clipboardPaste,
  filldown: arrowSortDownLines,
  import: arrowImport,
  export: arrowExport,
  ok: checkmarkCircle,
  warn: warning,
  err: errorCircle,
  info,
  zoomin: zoomIn,
  zoomout: zoomOut,
  fit: arrowFit,
  grid: gridDots,
  snap: borderInside,
  sun: weatherSunny,
  moon: weatherMoon,
  contrast: darkTheme,
  toolbox,
  pulse,
  lamp: lightbulb,
  gauge,
  card: cardUi,
  button,
  switch: toggleLeft,
  input: textbox,
  slider: options,
  line: dataLine,
  bar: dataBarVertical,
  pie: dataPie,
  lock: lockClosed,
  ext: open,
  refresh: arrowClockwise,
  link,
  menu: navigation,
  sidebar: panelLeft,
  shield: shieldCheckmark,
  restore: history,
  text: textT,
  group,
  shape: square,
  eye,
  collapse: arrowCollapseAll,
} as const;

/**
 * Ký hiệu công nghiệp tự vẽ (từ mockup), lưới 16, chỉ dùng nét: mỗi phần tử ghi `fill="none"` để không bị
 * tô kín bởi `fill: currentColor` của lớp `.ic`. Bộ ký hiệu đầy đủ thuộc GĐ 3b.
 */
const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const custom = (body: string) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 16 16"><g ${STROKE}>${body}</g></svg>`;
const CUSTOM = {
  pump: custom(
    '<circle fill="none" cx="7" cy="9" r="4"/><path fill="none" d="M7 5h6.6v2.6"/><path fill="none" d="M3.8 13.6h6.4"/>',
  ),
  valve: custom(
    '<path fill="none" d="M2 5.2v5.6L8 8zM14 5.2v5.6L8 8z"/><path fill="none" d="M8 8V3.6M6 3.6h4"/>',
  ),
  tank: custom(
    '<rect fill="none" x="4" y="2" width="8" height="12" rx="2"/><path fill="none" d="M4 9h8"/>',
  ),
  motor: custom(
    '<rect fill="none" x="2.4" y="4.4" width="9" height="7.2" rx="1"/><path fill="none" d="M11.4 8H14"/><path fill="none" d="M4.4 11.6v2M9.4 11.6v2"/>',
  ),
  pipe: custom(
    '<path fill="none" d="M2 5.8h7a3.2 3.2 0 0 1 3.2 3.2v5"/><path fill="none" d="M2 10.2h5a1.2 1.2 0 0 1 1.2 1.2V14"/>',
  ),
} as const;

export type IconName = keyof typeof FLUENT | keyof typeof CUSTOM;

const SOURCES: Record<IconName, string> = { ...FLUENT, ...CUSTOM };

export const ICON_NAMES = Object.keys(SOURCES) as IconName[];

export const iconHref = (name: IconName) => `#i-${name}`;

/** Dựng sprite <svg> ẩn chứa mỗi icon một <symbol id="i-tên">. Gọi một lần lúc khởi động. */
export function buildSprite(doc: Document): SVGSVGElement {
  const parser = new DOMParser();
  const sprite = doc.createElementNS(SVG_NS, 'svg');
  sprite.setAttribute('width', '0');
  sprite.setAttribute('height', '0');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('focusable', 'false');
  sprite.style.position = 'absolute';
  for (const name of ICON_NAMES) {
    const src = parser.parseFromString(SOURCES[name], 'image/svg+xml').documentElement;
    const symbol = doc.createElementNS(SVG_NS, 'symbol');
    symbol.setAttribute('id', `i-${name}`);
    symbol.setAttribute('viewBox', src.getAttribute('viewBox') ?? '0 0 16 16');
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === 1) symbol.append(doc.importNode(child, true));
    }
    sprite.append(symbol);
  }
  return sprite;
}
