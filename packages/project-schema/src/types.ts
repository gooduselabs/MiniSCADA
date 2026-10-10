// Kiểu TS khớp schemas/*.schema.json (schema v0). Nguồn chuẩn là file schema.

export type TagDataType =
  | 'BOOL'
  | 'INT16'
  | 'UINT16'
  | 'INT32'
  | 'UINT32'
  | 'INT64'
  | 'UINT64'
  | 'FLOAT32'
  | 'FLOAT64'
  | 'STRING';

export type Scalar = boolean | number | string;

export interface Project {
  format: 'matscada-project';
  schemaVersion: string;
  projectId: string;
  projectName: string;
  projectVersion: string;
  minRuntimeVersion: string;
  entryScreen: string;
  screens: string[];
  tagFile: string;
  maxClients: number;
  supportedBrowsers?: Array<{ engine: 'chromium'; minVersion: number }>;
}

export interface TagDefinition {
  id: string;
  type: TagDataType;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  source: { kind: 'mock'; signal: string };
}

export interface TagList {
  schemaVersion: string;
  tags: TagDefinition[];
}

export interface ElementRef {
  elementUid: string;
  name?: string;
  kind?: 'shape' | 'group' | 'text';
}

export interface Screen {
  schemaVersion: string;
  id: string;
  name: string;
  svgFile: string;
  viewBox: [number, number, number, number];
  fitMode: 'contain' | 'cover' | 'stretch';
  background?: string;
  bindingFile: string;
  elements: ElementRef[];
}

export const SUPPORTED_TARGETS = [
  'style.fill',
  'style.stroke',
  'style.opacity',
  'style.visibility',
  'text.content',
  'transform.rotate',
  'geometry.levelPercent',
] as const;
export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];
export type BindingTarget =
  | SupportedTarget
  | 'transform.translateX'
  | 'transform.translateY'
  | 'transform.scale'
  | 'component.state';

export type Transform =
  | { kind: 'direct' }
  | { kind: 'discreteMap'; cases: Array<{ equals: Scalar; value: Scalar }>; default?: Scalar }
  | {
      kind: 'linearScale';
      inMin: number;
      inMax: number;
      outMin: number;
      outMax: number;
      clamp?: boolean;
    };

export interface Binding {
  id: string;
  target: BindingTarget;
  source: { type: 'tag'; tagId: string };
  transform: Transform;
  onBadQuality?: { mode: 'hold' | 'override'; value?: Scalar };
  animation?: 'spin';
  direction?: 'up' | 'down' | 'left' | 'right';
  format?: { decimals?: number; suffix?: string };
}

export interface ElementBindings {
  elementUid: string;
  bindings: Binding[];
}

export interface BindingSet {
  schemaVersion: string;
  screenId: string;
  elements: ElementBindings[];
}

export interface LoadedScreen {
  screen: Screen;
  bindings: BindingSet;
}

export interface LoadedProject {
  project: Project;
  tags: TagList;
  screens: Record<string, LoadedScreen>;
}
