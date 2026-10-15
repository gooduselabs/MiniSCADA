// Đếm phần tử hiệu dụng sau mở `use`: cài đặt nằm ở @mat/svg-renderer (T112) để trang vận hành và bộ kiểm project
// dùng chung; module này giữ tên cũ cho bộ nhập.
export {
  countEffective,
  useLimitProblem,
  MAX_USE_EXPANSION,
  MAX_USE_WORK,
  MAX_USE_DEPTH,
} from '@mat/svg-renderer';
export type { UseCount } from '@mat/svg-renderer';
