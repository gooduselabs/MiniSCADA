// Thứ tự quét (contracts/logic-engine.md §10): một bản cài duy nhất ở @mat/project-schema (logicOrder), dùng chung
// cho validator (vòng phụ thuộc) và engine. Bản C++ cài cùng thuật toán (Kahn, chọn id nhỏ nhất khi hòa).
export { logicOrder, logicOutputs } from '@mat/project-schema';
