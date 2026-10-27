// Điểm vào của trang `/login` (login.html). Bundle riêng, không chia sẻ chunk với trang chính (T072).
// Feature 029: giao diện atscada duy nhất (không còn chọn chủ đề theo hệ thống).
import '../../../packages/ui-components/src/styles/tokens.css';
import './login.css';
import { mountLoginPage } from './login.ts';

const root = document.getElementById('login-root');
if (root) mountLoginPage(root, { https: location.protocol === 'https:' });
