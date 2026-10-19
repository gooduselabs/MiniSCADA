// Điểm vào của trang `/login` (login.html). Bundle riêng, không chia sẻ chunk với trang chính (T072).
// Feature 013: chủ đề vivid (sáng) hoặc dark theo hệ thống (trang chưa biết chủ đề của project trước khi đăng nhập).
import '../../../packages/ui-components/src/styles/tokens.css';
import './login.css';
import { mountLoginPage } from './login.ts';

const dark = matchMedia('(prefers-color-scheme: dark)');
const theme = () => (document.documentElement.dataset.matTheme = dark.matches ? 'dark' : 'vivid');
theme();
dark.addEventListener('change', theme);

const root = document.getElementById('login-root');
if (root) mountLoginPage(root, { https: location.protocol === 'https:' });
