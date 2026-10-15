// TỆP SINH TỰ ĐỘNG bởi scripts/gen-data.mjs từ manifest.json và svg/*.svg. KHÔNG sửa tay.
export const MANIFEST_DATA = {
  schemaVersion: '1',
  license: 'CC0-1.0',
  categories: [
    {
      id: 'tank',
      name: 'Bồn',
    },
    {
      id: 'pump',
      name: 'Bơm',
    },
    {
      id: 'valve',
      name: 'Van',
    },
    {
      id: 'motor',
      name: 'Motor',
    },
    {
      id: 'pipe',
      name: 'Ống',
    },
  ],
  symbols: [
    {
      id: 'tank-vertical',
      name: 'Bồn đứng',
      category: 'tank',
      file: 'svg/tank-vertical.svg',
      viewBox: [0, 0, 100, 160],
      defaultSize: [100, 160],
      keywords: ['bồn', 'tank', 'bể', 'đứng'],
      parts: [
        {
          role: 'body',
          uid: 'el_tank_vertical_body',
          label: 'Thân bồn',
          suggest: ['fill'],
        },
        {
          role: 'liquid',
          uid: 'el_tank_vertical_liquid',
          label: 'Chất lỏng',
          suggest: ['level'],
        },
        {
          role: 'text',
          uid: 'el_tank_vertical_text',
          label: 'Giá trị mức',
          suggest: ['text'],
        },
        {
          role: 'hit',
          uid: 'el_tank_vertical_hit',
          label: 'Vùng nhấp',
          suggest: ['click'],
        },
      ],
      ports: [
        {
          id: 'top',
          x: 0.5,
          y: 0,
          dir: 'n',
          kind: 'pipe',
        },
        {
          id: 'bottom',
          x: 0.5,
          y: 1,
          dir: 's',
          kind: 'pipe',
        },
        {
          id: 'west',
          x: 0,
          y: 0.8,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'east',
          x: 1,
          y: 0.8,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'tank-horizontal',
      name: 'Bồn nằm',
      category: 'tank',
      file: 'svg/tank-horizontal.svg',
      viewBox: [0, 0, 160, 100],
      defaultSize: [160, 100],
      keywords: ['bồn', 'tank', 'bể', 'nằm'],
      parts: [
        {
          role: 'body',
          uid: 'el_tank_horizontal_body',
          label: 'Thân bồn',
          suggest: ['fill'],
        },
        {
          role: 'liquid',
          uid: 'el_tank_horizontal_liquid',
          label: 'Chất lỏng',
          suggest: ['level'],
        },
        {
          role: 'text',
          uid: 'el_tank_horizontal_text',
          label: 'Giá trị mức',
          suggest: ['text'],
        },
      ],
      ports: [
        {
          id: 'west',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'east',
          x: 1,
          y: 0.5,
          dir: 'e',
          kind: 'pipe',
        },
        {
          id: 'top',
          x: 0.5,
          y: 0,
          dir: 'n',
          kind: 'pipe',
        },
        {
          id: 'bottom',
          x: 0.5,
          y: 1,
          dir: 's',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'pump-centrifugal',
      name: 'Bơm ly tâm',
      category: 'pump',
      file: 'svg/pump-centrifugal.svg',
      viewBox: [0, 0, 100, 100],
      defaultSize: [120, 120],
      keywords: ['bơm', 'pump', 'ly tâm'],
      parts: [
        {
          role: 'body',
          uid: 'el_pump_centrifugal_body',
          label: 'Thân bơm',
          suggest: ['fill'],
        },
        {
          role: 'impeller',
          uid: 'el_pump_centrifugal_impeller',
          label: 'Cánh bơm',
          suggest: ['spin'],
        },
        {
          role: 'lamp',
          uid: 'el_pump_centrifugal_lamp',
          label: 'Đèn trạng thái',
          suggest: ['fill', 'blink'],
        },
        {
          role: 'hit',
          uid: 'el_pump_centrifugal_hit',
          label: 'Vùng nhấp',
          suggest: ['click'],
        },
      ],
      ports: [
        {
          id: 'in',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'out',
          x: 0.5,
          y: 0,
          dir: 'n',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'pump-dosing',
      name: 'Bơm định lượng',
      category: 'pump',
      file: 'svg/pump-dosing.svg',
      viewBox: [0, 0, 100, 100],
      defaultSize: [120, 120],
      keywords: ['bơm', 'pump', 'định lượng', 'dosing'],
      parts: [
        {
          role: 'body',
          uid: 'el_pump_dosing_body',
          label: 'Thân bơm',
          suggest: ['fill'],
        },
        {
          role: 'plunger',
          uid: 'el_pump_dosing_plunger',
          label: 'Piston',
          suggest: ['translateX'],
        },
        {
          role: 'lamp',
          uid: 'el_pump_dosing_lamp',
          label: 'Đèn trạng thái',
          suggest: ['fill', 'blink'],
        },
        {
          role: 'hit',
          uid: 'el_pump_dosing_hit',
          label: 'Vùng nhấp',
          suggest: ['click'],
        },
      ],
      ports: [
        {
          id: 'in',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'out',
          x: 1,
          y: 0.5,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'valve-gate',
      name: 'Van cổng',
      category: 'valve',
      file: 'svg/valve-gate.svg',
      viewBox: [0, 0, 60, 60],
      defaultSize: [60, 60],
      keywords: ['van', 'valve', 'cổng', 'gate'],
      parts: [
        {
          role: 'body',
          uid: 'el_valve_gate_body',
          label: 'Thân van',
          suggest: ['fill'],
        },
        {
          role: 'handwheel',
          uid: 'el_valve_gate_handwheel',
          label: 'Tay quay',
          suggest: ['rotate'],
        },
        {
          role: 'hit',
          uid: 'el_valve_gate_hit',
          label: 'Vùng nhấp',
          suggest: ['click'],
        },
      ],
      ports: [
        {
          id: 'in',
          x: 0,
          y: 0.75,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'out',
          x: 1,
          y: 0.75,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'valve-control',
      name: 'Van điều khiển',
      category: 'valve',
      file: 'svg/valve-control.svg',
      viewBox: [0, 0, 60, 80],
      defaultSize: [60, 80],
      keywords: ['van', 'valve', 'điều khiển', 'control'],
      parts: [
        {
          role: 'body',
          uid: 'el_valve_control_body',
          label: 'Thân van',
          suggest: ['fill'],
        },
        {
          role: 'actuator',
          uid: 'el_valve_control_actuator',
          label: 'Cơ cấu chấp hành',
          suggest: ['fill'],
        },
        {
          role: 'stem',
          uid: 'el_valve_control_stem',
          label: 'Trục van',
          suggest: ['translateY'],
        },
      ],
      ports: [
        {
          id: 'in',
          x: 0,
          y: 0.75,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'out',
          x: 1,
          y: 0.75,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'valve-check',
      name: 'Van một chiều',
      category: 'valve',
      file: 'svg/valve-check.svg',
      viewBox: [0, 0, 60, 60],
      defaultSize: [60, 60],
      keywords: ['van', 'valve', 'một chiều', 'check'],
      parts: [
        {
          role: 'body',
          uid: 'el_valve_check_body',
          label: 'Thân van',
          suggest: ['fill'],
        },
        {
          role: 'arrow',
          uid: 'el_valve_check_arrow',
          label: 'Mũi tên chiều chảy',
          suggest: ['visibility'],
        },
      ],
      ports: [
        {
          id: 'in',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'out',
          x: 1,
          y: 0.5,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'motor-ac',
      name: 'Motor AC',
      category: 'motor',
      file: 'svg/motor-ac.svg',
      viewBox: [0, 0, 120, 90],
      defaultSize: [120, 90],
      keywords: ['motor', 'động cơ', 'ac'],
      parts: [
        {
          role: 'body',
          uid: 'el_motor_ac_body',
          label: 'Thân motor',
          suggest: ['fill'],
        },
        {
          role: 'rotor',
          uid: 'el_motor_ac_rotor',
          label: 'Rô-to',
          suggest: ['spin'],
        },
        {
          role: 'lamp',
          uid: 'el_motor_ac_lamp',
          label: 'Đèn trạng thái',
          suggest: ['fill', 'blink'],
        },
        {
          role: 'text',
          uid: 'el_motor_ac_text',
          label: 'Nhãn',
          suggest: ['text'],
        },
        {
          role: 'hit',
          uid: 'el_motor_ac_hit',
          label: 'Vùng nhấp',
          suggest: ['click'],
        },
      ],
      ports: [
        {
          id: 'shaft',
          x: 1,
          y: 0.5,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'fan',
      name: 'Quạt',
      category: 'motor',
      file: 'svg/fan.svg',
      viewBox: [0, 0, 100, 100],
      defaultSize: [100, 100],
      keywords: ['quạt', 'fan', 'thông gió'],
      parts: [
        {
          role: 'body',
          uid: 'el_fan_body',
          label: 'Vỏ quạt',
          suggest: ['fill'],
        },
        {
          role: 'blades',
          uid: 'el_fan_blades',
          label: 'Cánh quạt',
          suggest: ['spin'],
        },
        {
          role: 'lamp',
          uid: 'el_fan_lamp',
          label: 'Đèn trạng thái',
          suggest: ['fill', 'blink'],
        },
      ],
      ports: [
        {
          id: 'in',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'out',
          x: 1,
          y: 0.5,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'pipe-h',
      name: 'Ống ngang',
      category: 'pipe',
      file: 'svg/pipe-h.svg',
      viewBox: [0, 0, 100, 20],
      defaultSize: [100, 20],
      keywords: ['ống', 'pipe', 'ngang'],
      parts: [
        {
          role: 'pipe',
          uid: 'el_pipe_h_pipe',
          label: 'Thân ống',
          suggest: ['fill'],
        },
        {
          role: 'flow',
          uid: 'el_pipe_h_flow',
          label: 'Dòng chảy',
          suggest: ['flow'],
        },
      ],
      ports: [
        {
          id: 'west',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'east',
          x: 1,
          y: 0.5,
          dir: 'e',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'pipe-v',
      name: 'Ống đứng',
      category: 'pipe',
      file: 'svg/pipe-v.svg',
      viewBox: [0, 0, 20, 100],
      defaultSize: [20, 100],
      keywords: ['ống', 'pipe', 'đứng'],
      parts: [
        {
          role: 'pipe',
          uid: 'el_pipe_v_pipe',
          label: 'Thân ống',
          suggest: ['fill'],
        },
        {
          role: 'flow',
          uid: 'el_pipe_v_flow',
          label: 'Dòng chảy',
          suggest: ['flow'],
        },
      ],
      ports: [
        {
          id: 'top',
          x: 0.5,
          y: 0,
          dir: 'n',
          kind: 'pipe',
        },
        {
          id: 'bottom',
          x: 0.5,
          y: 1,
          dir: 's',
          kind: 'pipe',
        },
      ],
    },
    {
      id: 'pipe-elbow',
      name: 'Cút',
      category: 'pipe',
      file: 'svg/pipe-elbow-ws.svg',
      viewBox: [0, 0, 40, 40],
      defaultSize: [40, 40],
      keywords: ['cút', 'elbow', 'ống', 'góc'],
      parts: [
        {
          role: 'pipe',
          uid: 'el_pipe_elbow_pipe',
          label: 'Thân ống',
          suggest: ['fill'],
        },
        {
          role: 'flow',
          uid: 'el_pipe_elbow_flow',
          label: 'Dòng chảy',
          suggest: ['flow'],
        },
      ],
      ports: [
        {
          id: 'west',
          x: 0,
          y: 0.5,
          dir: 'w',
          kind: 'pipe',
        },
        {
          id: 'south',
          x: 0.5,
          y: 1,
          dir: 's',
          kind: 'pipe',
        },
      ],
      variants: [
        {
          id: 'ws',
          file: 'svg/pipe-elbow-ws.svg',
          ports: [
            {
              id: 'west',
              x: 0,
              y: 0.5,
              dir: 'w',
              kind: 'pipe',
            },
            {
              id: 'south',
              x: 0.5,
              y: 1,
              dir: 's',
              kind: 'pipe',
            },
          ],
        },
        {
          id: 'wn',
          file: 'svg/pipe-elbow-wn.svg',
          ports: [
            {
              id: 'west',
              x: 0,
              y: 0.5,
              dir: 'w',
              kind: 'pipe',
            },
            {
              id: 'north',
              x: 0.5,
              y: 0,
              dir: 'n',
              kind: 'pipe',
            },
          ],
        },
        {
          id: 'es',
          file: 'svg/pipe-elbow-es.svg',
          ports: [
            {
              id: 'east',
              x: 1,
              y: 0.5,
              dir: 'e',
              kind: 'pipe',
            },
            {
              id: 'south',
              x: 0.5,
              y: 1,
              dir: 's',
              kind: 'pipe',
            },
          ],
        },
        {
          id: 'en',
          file: 'svg/pipe-elbow-en.svg',
          ports: [
            {
              id: 'east',
              x: 1,
              y: 0.5,
              dir: 'e',
              kind: 'pipe',
            },
            {
              id: 'north',
              x: 0.5,
              y: 0,
              dir: 'n',
              kind: 'pipe',
            },
          ],
        },
      ],
    },
  ],
};

export const SVG_DATA: Record<string, string> = {
  'svg/fan.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n<g>\n  <title>Quạt</title>\n  <rect x="0" y="44" width="16" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="84" y="44" width="16" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <circle data-mat-uid="el_fan_body" cx="50" cy="50" r="34" fill="#eceff1" stroke="#37474f" stroke-width="2"/>\n  <g data-mat-uid="el_fan_blades" fill="#b0bec5" stroke="#37474f" stroke-width="2" stroke-linejoin="round">\n    <path d="M50 50 Q38 30 50 18 Q62 30 50 50 Z"/>\n    <path d="M50 50 Q70 38 82 50 Q70 62 50 50 Z"/>\n    <path d="M50 50 Q62 70 50 82 Q38 70 50 50 Z"/>\n    <path d="M50 50 Q30 62 18 50 Q30 38 50 50 Z"/>\n  </g>\n  <circle data-mat-uid="el_fan_lamp" cx="88" cy="12" r="7" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n</g>\n</svg>\n',
  'svg/motor-ac.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">\n<g>\n  <title>Motor AC</title>\n  <rect x="100" y="40" width="20" height="10" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="14" y="78" width="72" height="10" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect data-mat-uid="el_motor_ac_body" x="10" y="10" width="90" height="68" rx="8" fill="#eceff1" stroke="#37474f" stroke-width="2"/>\n  <line x1="28" y1="10" x2="28" y2="78" stroke="#37474f" stroke-width="2" stroke-opacity="0.35"/>\n  <circle cx="60" cy="45" r="26" fill="#ffffff" stroke="#37474f" stroke-width="2"/>\n  <g data-mat-uid="el_motor_ac_rotor" fill="none" stroke="#37474f" stroke-width="2">\n    <line x1="60" y1="23" x2="60" y2="67"/>\n    <line x1="38" y1="45" x2="82" y2="45"/>\n  </g>\n  <text data-mat-uid="el_motor_ac_text" x="19" y="49" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#37474f">M</text>\n  <circle data-mat-uid="el_motor_ac_lamp" cx="90" cy="20" r="6" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect data-mat-uid="el_motor_ac_hit" x="10" y="10" width="90" height="68" fill="none" stroke="none"/>\n</g>\n</svg>\n',
  'svg/pipe-elbow-en.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">\n<g>\n  <title>Cút đông bắc</title>\n  <polygon data-mat-uid="el_pipe_elbow_pipe" points="40,26 14,26 14,0 26,0 26,14 40,14" fill="#b0bec5" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n  <path data-mat-uid="el_pipe_elbow_flow" d="M40 20 H20 V0" fill="none" stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 6"/>\n</g>\n</svg>\n',
  'svg/pipe-elbow-es.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">\n<g>\n  <title>Cút đông nam</title>\n  <polygon data-mat-uid="el_pipe_elbow_pipe" points="40,14 14,14 14,40 26,40 26,26 40,26" fill="#b0bec5" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n  <path data-mat-uid="el_pipe_elbow_flow" d="M40 20 H20 V40" fill="none" stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 6"/>\n</g>\n</svg>\n',
  'svg/pipe-elbow-wn.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">\n<g>\n  <title>Cút tây bắc</title>\n  <polygon data-mat-uid="el_pipe_elbow_pipe" points="0,26 26,26 26,0 14,0 14,14 0,14" fill="#b0bec5" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n  <path data-mat-uid="el_pipe_elbow_flow" d="M0 20 H20 V0" fill="none" stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 6"/>\n</g>\n</svg>\n',
  'svg/pipe-elbow-ws.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">\n<g>\n  <title>Cút tây nam</title>\n  <polygon data-mat-uid="el_pipe_elbow_pipe" points="0,14 26,14 26,40 14,40 14,26 0,26" fill="#b0bec5" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n  <path data-mat-uid="el_pipe_elbow_flow" d="M0 20 H20 V40" fill="none" stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 6"/>\n</g>\n</svg>\n',
  'svg/pipe-h.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">\n<g>\n  <title>Ống ngang</title>\n  <rect data-mat-uid="el_pipe_h_pipe" x="0" y="4" width="100" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <line data-mat-uid="el_pipe_h_flow" x1="0" y1="10" x2="100" y2="10" fill="none" stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 6"/>\n</g>\n</svg>\n',
  'svg/pipe-v.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 100">\n<g>\n  <title>Ống đứng</title>\n  <rect data-mat-uid="el_pipe_v_pipe" x="4" y="0" width="12" height="100" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <line data-mat-uid="el_pipe_v_flow" x1="10" y1="0" x2="10" y2="100" fill="none" stroke="#1e88e5" stroke-width="2" stroke-dasharray="6 6"/>\n</g>\n</svg>\n',
  'svg/pump-centrifugal.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n<g>\n  <title>Bơm ly tâm</title>\n  <rect x="0" y="44" width="22" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="44" y="0" width="12" height="24" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="30" y="80" width="40" height="8" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <circle data-mat-uid="el_pump_centrifugal_body" cx="50" cy="50" r="30" fill="#eceff1" stroke="#37474f" stroke-width="2"/>\n  <g data-mat-uid="el_pump_centrifugal_impeller" fill="none" stroke="#37474f" stroke-width="2" stroke-linecap="round">\n    <circle cx="50" cy="50" r="20" stroke-opacity="0.35"/>\n    <path d="M50 50 Q60 38 50 30"/>\n    <path d="M50 50 Q44 36 32 42"/>\n    <path d="M50 50 Q36 56 36 66"/>\n    <path d="M50 50 Q54 64 66 64"/>\n    <path d="M50 50 Q66 52 68 40"/>\n    <circle cx="50" cy="50" r="4" fill="#37474f"/>\n  </g>\n  <circle data-mat-uid="el_pump_centrifugal_lamp" cx="84" cy="16" r="7" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <circle data-mat-uid="el_pump_centrifugal_hit" cx="50" cy="50" r="32" fill="none" stroke="none"/>\n</g>\n</svg>\n',
  'svg/pump-dosing.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n<g>\n  <title>Bơm định lượng</title>\n  <rect x="0" y="44" width="20" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="80" y="44" width="20" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="20" y="80" width="60" height="8" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect data-mat-uid="el_pump_dosing_body" x="20" y="30" width="60" height="50" rx="6" fill="#eceff1" stroke="#37474f" stroke-width="2"/>\n  <rect x="26" y="14" width="30" height="16" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <g data-mat-uid="el_pump_dosing_plunger" stroke="#37474f" stroke-width="2">\n    <rect x="30" y="38" width="30" height="24" fill="#b0bec5"/>\n    <line x1="60" y1="50" x2="72" y2="50"/>\n  </g>\n  <circle data-mat-uid="el_pump_dosing_lamp" cx="84" cy="16" r="7" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect data-mat-uid="el_pump_dosing_hit" x="20" y="30" width="60" height="50" fill="none" stroke="none"/>\n</g>\n</svg>\n',
  'svg/tank-horizontal.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">\n<g>\n  <title>Bồn nằm</title>\n  <rect x="0" y="44" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="148" y="44" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="74" y="0" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="74" y="88" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="30" y="86" width="10" height="14" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="120" y="86" width="10" height="14" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect data-mat-uid="el_tank_horizontal_body" x="10" y="10" width="140" height="80" rx="20" fill="#eceff1" stroke="none"/>\n  <rect data-mat-uid="el_tank_horizontal_liquid" x="12" y="12" width="136" height="76" rx="18" fill="#1e88e5" stroke="none"/>\n  <rect x="10" y="10" width="140" height="80" rx="20" fill="none" stroke="#37474f" stroke-width="2"/>\n  <line x1="40" y1="10" x2="40" y2="90" stroke="#37474f" stroke-width="2" stroke-opacity="0.35"/>\n  <line x1="120" y1="10" x2="120" y2="90" stroke="#37474f" stroke-width="2" stroke-opacity="0.35"/>\n  <text data-mat-uid="el_tank_horizontal_text" x="80" y="56" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#37474f">0 %</text>\n</g>\n</svg>\n',
  'svg/tank-vertical.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 160">\n<g>\n  <title>Bồn đứng</title>\n  <rect x="44" y="0" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="44" y="148" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="0" y="122" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect x="88" y="122" width="12" height="12" fill="#b0bec5" stroke="#37474f" stroke-width="2"/>\n  <rect data-mat-uid="el_tank_vertical_body" x="10" y="10" width="80" height="140" rx="12" fill="#eceff1" stroke="none"/>\n  <rect data-mat-uid="el_tank_vertical_liquid" x="12" y="12" width="76" height="136" rx="10" fill="#1e88e5" stroke="none"/>\n  <rect x="10" y="10" width="80" height="140" rx="12" fill="none" stroke="#37474f" stroke-width="2"/>\n  <line x1="10" y1="40" x2="90" y2="40" stroke="#37474f" stroke-width="2" stroke-opacity="0.35"/>\n  <line x1="10" y1="120" x2="90" y2="120" stroke="#37474f" stroke-width="2" stroke-opacity="0.35"/>\n  <text data-mat-uid="el_tank_vertical_text" x="50" y="85" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#37474f">0 %</text>\n  <rect data-mat-uid="el_tank_vertical_hit" x="10" y="10" width="80" height="140" rx="12" fill="none" stroke="none"/>\n</g>\n</svg>\n',
  'svg/valve-check.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">\n<g>\n  <title>Van một chiều</title>\n  <path data-mat-uid="el_valve_check_body" d="M0 15 L30 30 L0 45 Z M60 15 L30 30 L60 45 Z" fill="#eceff1" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n  <polygon data-mat-uid="el_valve_check_arrow" points="16,30 36,22 36,38" fill="#37474f" stroke="none"/>\n</g>\n</svg>\n',
  'svg/valve-control.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80">\n<g>\n  <title>Van điều khiển</title>\n  <line data-mat-uid="el_valve_control_stem" x1="30" y1="60" x2="30" y2="28" stroke="#37474f" stroke-width="2"/>\n  <path data-mat-uid="el_valve_control_actuator" d="M10 28 A20 20 0 0 1 50 28 Z" fill="#eceff1" stroke="#37474f" stroke-width="2"/>\n  <path data-mat-uid="el_valve_control_body" d="M0 47 L30 60 L0 73 Z M60 47 L30 60 L60 73 Z" fill="#eceff1" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n</g>\n</svg>\n',
  'svg/valve-gate.svg':
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60">\n<g>\n  <title>Van cổng</title>\n  <line x1="30" y1="45" x2="30" y2="20" stroke="#37474f" stroke-width="2"/>\n  <g data-mat-uid="el_valve_gate_handwheel" stroke="#37474f" stroke-width="2">\n    <ellipse cx="30" cy="14" rx="14" ry="6" fill="#eceff1"/>\n    <line x1="30" y1="8" x2="30" y2="20"/>\n  </g>\n  <path data-mat-uid="el_valve_gate_body" d="M0 32 L30 45 L0 58 Z M60 32 L30 45 L60 58 Z" fill="#eceff1" stroke="#37474f" stroke-width="2" stroke-linejoin="round"/>\n  <rect data-mat-uid="el_valve_gate_hit" x="0" y="6" width="60" height="52" fill="none" stroke="none"/>\n</g>\n</svg>\n',
};
