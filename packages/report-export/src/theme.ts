// Bảng màu báo cáo theo chủ đề (feature 012, FR-038, contracts/ui-theme.md). Giá trị chép từ khối sáng của
// packages/ui-components/src/styles/themes/*.css (theme.test.ts kiểm khớp) để gói này không phụ thuộc ui-components.
// Báo cáo luôn in trên giấy trắng: chủ đề `dark` dùng bảng màu vivid (nền tối tốn mực và khó đọc khi in).

import type { ReportTheme } from './types.ts';

export type { ReportTheme };

export interface ReportPalette {
  /** Dải tiêu đề, hàng tiêu đề bảng. */
  accent: string;
  /** Chữ trên nền accent. */
  accentInk: string;
  text: string;
  muted: string;
  border: string;
  /** Nền hàng xen kẽ và thẻ số liệu. */
  zebra: string;
  /** 12 màu nét chuỗi và 12 màu nền nhạt tương ứng. */
  chart: string[];
  chartSoft: string[];
}

const vivid: ReportPalette = {
  accent: '#3e63dd',
  accentInk: '#ffffff',
  text: '#1c2024',
  muted: '#60646c',
  border: '#d9d9e0',
  zebra: '#f0f0f3',
  chart: [
    '#0090ff',
    '#12a594',
    '#30a46c',
    '#ab6400',
    '#ef5f00',
    '#e5484d',
    '#e93d82',
    '#d6409f',
    '#6e56cf',
    '#3e63dd',
    '#00a2c7',
    '#5c7c2f',
  ],
  chartSoft: [
    '#e6f4fe',
    '#e0f8f3',
    '#e6f6eb',
    '#fff7c2',
    '#ffefd6',
    '#feebec',
    '#ffe9f0',
    '#fee9f5',
    '#f4f0fe',
    '#edf2fe',
    '#def7f9',
    '#eef6d6',
  ],
};

const industrial: ReportPalette = {
  accent: '#0b7285',
  accentInk: '#ffffff',
  text: '#1a2225',
  muted: '#56646a',
  border: '#d2d9dc',
  zebra: '#f5f7f8',
  chart: [
    '#0b7285',
    '#c2410c',
    '#6f42c1',
    '#15703a',
    '#b4234a',
    '#1c64c4',
    '#8f5e00',
    '#56646a',
    '#3a5bc7',
    '#815e46',
    '#953ea3',
    '#5c7c2f',
  ],
  chartSoft: [
    '#ddebee',
    '#f6e4dd',
    '#ebe5f6',
    '#deebe3',
    '#f5e0e6',
    '#dfe9f7',
    '#efe8db',
    '#e7e9ea',
    '#e3e8f7',
    '#ede8e5',
    '#f0e4f2',
    '#e8ede2',
  ],
};

export const REPORT_PALETTES: Record<'vivid' | 'industrial', ReportPalette> = { vivid, industrial };

/** Bảng màu của chủ đề; không đặt hoặc lạ thì vivid (mẫu mới, mặc định của project mới). */
export function reportPalette(theme: ReportTheme | undefined): ReportPalette {
  return theme === 'industrial' ? industrial : vivid;
}
