// Lớp gọi API quản trị của trang web: phần dùng chung (kiểu, đọc thân, AdminApi) nằm ở @mat/admin-model (feature 027,
// Studio dùng cùng mã qua kênh Bearer); trang web đi bằng `fetchTransport` (cookie phiên + `X-MAT-CSRF`).
export * from '@mat/admin-model';
