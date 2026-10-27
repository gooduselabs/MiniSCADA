// Bảng màu báo cáo (feature 012 FR-038; feature 029: một giao diện duy nhất atscada). Giá trị chép từ
// packages/ui-components/src/styles/themes/atscada.css (theme.test.ts kiểm khớp) để gói này không phụ thuộc ui-components.
// Trường `theme` cũ của meta vẫn nhận nhưng bị bỏ qua.

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

const atscada: ReportPalette = {
  accent: '#007272',
  accentInk: '#ffffff',
  text: '#2d353c',
  muted: '#56616b',
  border: '#d5dbe0',
  zebra: '#f2f3f4',
  chart: [
    '#348fe2',
    '#00a5a5',
    '#d08416',
    '#ff5b57',
    '#727cb6',
    '#709e3a',
    '#3d9bb5',
    '#8753de',
    '#2d353c',
    '#fb5597',
    '#8a6d3b',
    '#b29100',
  ],
  chartSoft: [
    '#e3effb',
    '#dbf3f3',
    '#fef1df',
    '#ffe8e7',
    '#ebedf5',
    '#eff8e6',
    '#e6f5f9',
    '#eee7fa',
    '#e2e3e4',
    '#fee7f0',
    '#efebe4',
    '#f7f2db',
  ],
};

export const REPORT_PALETTES: Record<'atscada', ReportPalette> = { atscada };

/** Bảng màu báo cáo: luôn là atscada; tham số chủ đề cũ bị bỏ qua (feature 029). */
export function reportPalette(theme?: ReportTheme): ReportPalette {
  void theme;
  return atscada;
}

/** Màu nền thẻ chỉ số (feature 014/015): cùng giá trị `--mat-tile-*`, chữ trắng ≥ 4,5:1. */
export const TILE_HEX: Record<string, string> = {
  teal: '#008181',
  blue: '#2c7ac0',
  rose: '#c84845',
  violet: '#6972a8',
  olive: '#5c8130',
  indigo: '#8753de',
  orange: '#a36810',
  cyan: '#337f94',
  green: '#268426',
  slate: '#2d353c',
};
