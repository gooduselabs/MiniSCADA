// Bộ phận của các hình ký hiệu mẫu cũ trong `graphics/symbols/` (feature 008) để giữ Gắn nhanh cho project đã có. Studio
// không còn thư viện ký hiệu (ADR-055): đây chỉ là dữ liệu tra cứu, chép từ tools/symbol-data/manifest.json (`parts`; UID
// cố định). Đặt trong i18n vì có nhãn tiếng Việt (như svg-suggest-keywords.ts). Hình trong project là SVG thường.

export interface SymbolPart {
  uid: string;
  role: string;
  label: string;
  /** Mục động hóa gợi ý theo thứ tự (`click` là sự kiện nhấp). */
  suggest: readonly string[];
}

export const SYMBOL_DIR = 'graphics/symbols/';

const P = (uid: string, role: string, label: string, ...suggest: string[]): SymbolPart => ({
  uid,
  role,
  label,
  suggest,
});

/** Tên tệp trong `graphics/symbols/` → bộ phận. */
const PARTS: Readonly<Record<string, readonly SymbolPart[]>> = {
  'tank-vertical.svg': [
    P('el_tank_vertical_body', 'body', 'Thân bồn', 'fill'),
    P('el_tank_vertical_liquid', 'liquid', 'Chất lỏng', 'level'),
    P('el_tank_vertical_text', 'text', 'Giá trị mức', 'text'),
    P('el_tank_vertical_hit', 'hit', 'Vùng nhấp', 'click'),
  ],
  'tank-horizontal.svg': [
    P('el_tank_horizontal_body', 'body', 'Thân bồn', 'fill'),
    P('el_tank_horizontal_liquid', 'liquid', 'Chất lỏng', 'level'),
    P('el_tank_horizontal_text', 'text', 'Giá trị mức', 'text'),
  ],
  'pump-centrifugal.svg': [
    P('el_pump_centrifugal_body', 'body', 'Thân bơm', 'fill'),
    P('el_pump_centrifugal_impeller', 'impeller', 'Cánh bơm', 'spin'),
    P('el_pump_centrifugal_lamp', 'lamp', 'Đèn trạng thái', 'fill', 'blink'),
    P('el_pump_centrifugal_hit', 'hit', 'Vùng nhấp', 'click'),
  ],
  'pump-dosing.svg': [
    P('el_pump_dosing_body', 'body', 'Thân bơm', 'fill'),
    P('el_pump_dosing_plunger', 'plunger', 'Piston', 'translateX'),
    P('el_pump_dosing_lamp', 'lamp', 'Đèn trạng thái', 'fill', 'blink'),
    P('el_pump_dosing_hit', 'hit', 'Vùng nhấp', 'click'),
  ],
  'valve-gate.svg': [
    P('el_valve_gate_body', 'body', 'Thân van', 'fill'),
    P('el_valve_gate_handwheel', 'handwheel', 'Tay quay', 'rotate'),
    P('el_valve_gate_hit', 'hit', 'Vùng nhấp', 'click'),
  ],
  'valve-control.svg': [
    P('el_valve_control_body', 'body', 'Thân van', 'fill'),
    P('el_valve_control_actuator', 'actuator', 'Cơ cấu chấp hành', 'fill'),
    P('el_valve_control_stem', 'stem', 'Trục van', 'translateY'),
  ],
  'valve-check.svg': [
    P('el_valve_check_body', 'body', 'Thân van', 'fill'),
    P('el_valve_check_arrow', 'arrow', 'Mũi tên chiều chảy', 'visibility'),
  ],
  'motor-ac.svg': [
    P('el_motor_ac_body', 'body', 'Thân motor', 'fill'),
    P('el_motor_ac_rotor', 'rotor', 'Rô-to', 'spin'),
    P('el_motor_ac_lamp', 'lamp', 'Đèn trạng thái', 'fill', 'blink'),
    P('el_motor_ac_text', 'text', 'Nhãn', 'text'),
    P('el_motor_ac_hit', 'hit', 'Vùng nhấp', 'click'),
  ],
  'fan.svg': [
    P('el_fan_body', 'body', 'Vỏ quạt', 'fill'),
    P('el_fan_blades', 'blades', 'Cánh quạt', 'spin'),
    P('el_fan_lamp', 'lamp', 'Đèn trạng thái', 'fill', 'blink'),
  ],
  'pipe-h.svg': [
    P('el_pipe_h_pipe', 'pipe', 'Thân ống', 'fill'),
    P('el_pipe_h_flow', 'flow', 'Dòng chảy', 'flow'),
  ],
  'pipe-v.svg': [
    P('el_pipe_v_pipe', 'pipe', 'Thân ống', 'fill'),
    P('el_pipe_v_flow', 'flow', 'Dòng chảy', 'flow'),
  ],
  'pipe-elbow-ws.svg': [
    P('el_pipe_elbow_pipe', 'pipe', 'Thân ống', 'fill'),
    P('el_pipe_elbow_flow', 'flow', 'Dòng chảy', 'flow'),
  ],
  'pipe-elbow-wn.svg': [
    P('el_pipe_elbow_pipe', 'pipe', 'Thân ống', 'fill'),
    P('el_pipe_elbow_flow', 'flow', 'Dòng chảy', 'flow'),
  ],
  'pipe-elbow-es.svg': [
    P('el_pipe_elbow_pipe', 'pipe', 'Thân ống', 'fill'),
    P('el_pipe_elbow_flow', 'flow', 'Dòng chảy', 'flow'),
  ],
  'pipe-elbow-en.svg': [
    P('el_pipe_elbow_pipe', 'pipe', 'Thân ống', 'fill'),
    P('el_pipe_elbow_flow', 'flow', 'Dòng chảy', 'flow'),
  ],
};

/** Bộ phận của tệp ký hiệu mẫu `svgFile` (đường dẫn trong project); `undefined` khi không phải tệp ký hiệu mẫu. */
export function symbolPartsOf(svgFile: string): readonly SymbolPart[] | undefined {
  if (!svgFile.startsWith(SYMBOL_DIR)) return undefined;
  const name = svgFile.slice(SYMBOL_DIR.length);
  return Object.prototype.hasOwnProperty.call(PARTS, name) ? PARTS[name] : undefined;
}
