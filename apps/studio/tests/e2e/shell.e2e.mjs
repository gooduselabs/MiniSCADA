// E2E khung Studio (feature 004, T042, US1, quickstart §4 bước 1–4, 18): tab Bắt đầu; mở project giả;
// cây; mở 3 tab; Ctrl+Shift+P "bang tag" Enter; theme tối; tải lại trang giữ bố cục; bàn phím (F6);
// menu với lệnh bị khóa; axe-core 0 vi phạm critical/serious; cửa sổ nhỏ nhất 960 × 600.

const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const activeTab = (page) => text(page, 'mat-tabs [role="tab"][aria-selected="true"] .tab-title');
const tabCount = (page) => page.$$eval('mat-tabs [role="tab"]', (els) => els.length);

async function clickTreeItem(page, label) {
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('mat-tree [role="treeitem"]')].find(
      (e) => e.querySelector('.lbl')?.textContent.trim() === l,
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục cây "${label}"`);
}

export default async function shell({ page, url, check, shot, axe }) {
  // 1. Mở lần đầu: tab Bắt đầu, lệnh cần project bị khóa kèm lý do (US1-1)
  await page.waitForSelector('mat-start-page .start-hero');
  check('mở tới tab Bắt đầu', (await activeTab(page)) === 'Bắt đầu');
  const save = await page.$eval('mat-toolbar [data-cmd="project.save"]', (b) => ({
    disabled: b.getAttribute('aria-disabled'),
    title: b.title,
  }));
  check(
    'Lưu bị khóa khi chưa mở project, tooltip nói lý do',
    save.disabled === 'true' && /Chưa mở project/.test(save.title),
    save.title,
  );
  await shot('1-bat-dau');
  await axe('tab Bắt đầu, chưa mở project');

  // 2. Mở project (lớp giả nạp projects/tank-demo) (US1-2)
  await page.click('mat-start-page .start-hero .btn.primary');
  await page.waitForSelector('mat-tree [role="treeitem"]');
  const root = await text(page, 'mat-tree [role="treeitem"] .lbl');
  check('cây có tên project', root === 'Trạm bơm nước (demo Sprint 1)', root);
  const labels = await page.$$eval('mat-tree [role="treeitem"] .lbl', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  for (const l of ['Thiết lập project', 'Bảng Tag mặc định', 'Lưu trữ', 'Bồn nước + bơm', 'Alarm'])
    check(`cây có mục "${l}"`, labels.includes(l), labels.join(', '));
  const alarmPhase = await page.evaluate(
    () =>
      [...document.querySelectorAll('mat-tree [role="treeitem"]')]
        .find((e) => e.querySelector('.lbl')?.textContent.trim() === 'Báo cáo')
        ?.querySelector('.phase')?.textContent,
  );
  check('mục giai đoạn sau có nhãn giai đoạn', alarmPhase === 'GĐ 5', alarmPhase);
  const title = await page.title();
  check('tiêu đề cửa sổ có tên project', title.includes('Trạm bơm nước'), title);

  // 3. Mở 3 tab từ cây, mở lại không trùng (US1-3)
  await clickTreeItem(page, 'Thiết lập project');
  await clickTreeItem(page, 'Bảng Tag mặc định');
  await clickTreeItem(page, 'Báo cáo');
  await clickTreeItem(page, 'Thiết lập project');
  check('mở 3 tab, không trùng', (await tabCount(page)) === 4, await tabCount(page));
  check(
    'chọn lại mục đã mở thì chuyển tới tab đó',
    (await activeTab(page)) === 'Thiết lập project',
  );
  await shot('2-ba-tab');

  // 4. Bảng lệnh: "bang tag" (không dấu) → Enter (US1-5)
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyP');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await page.waitForSelector('mat-palette input');
  await page.keyboard.type('bang tag');
  const first = await text(page, 'mat-palette [role="option"][aria-selected="true"] .pal-label');
  check('bảng lệnh tìm không dấu', first === 'Mở Bảng Tag mặc định', first);
  await shot('3-bang-lenh');
  await page.keyboard.press('Enter');
  check('Enter mở đúng tab', (await activeTab(page)) === 'Bảng Tag mặc định');

  // 5. Menu: lệnh của feature 005 hiện nhưng khóa, có lý do; Esc đóng
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  const download = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.menu-pop [role="menuitem"]')].find((e) =>
      e.textContent.includes('Nạp xuống'),
    );
    return b ? { disabled: b.getAttribute('aria-disabled'), text: b.textContent } : null;
  });
  check(
    'menu Online: Nạp xuống bị khóa, ghi "Cần Online và đăng nhập thiết bị"',
    download?.disabled === 'true' && /Cần Online và đăng nhập thiết bị/.test(download.text),
    JSON.stringify(download),
  );
  await shot('4-menu-online');
  await page.keyboard.press('Escape');
  check('Esc đóng menu', (await page.$('.menu-pop')) === null);

  // 6. Thông tin: nhấp số lỗi trên thanh trạng thái mở tab Thông tin
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-statusbar button')]
      .find((b) => b.textContent.includes('lỗi'))
      ?.click(),
  );
  const insp = await text(page, 'mat-inspector [role="tab"][aria-selected="true"]');
  check('nhấp số lỗi mở tab Thông tin', insp.startsWith('Thông tin'), insp);
  await axe('project mở, Bảng Tag, tab Thông tin');

  // 7. Bàn phím: F6 vòng qua các vùng (US1-7)
  await page.focus('mat-tree');
  const regions = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('F6');
    regions.push(
      await page.evaluate(() => document.activeElement?.closest('[data-region]')?.dataset.region),
    );
  }
  check(
    'F6 vòng qua sáu vùng',
    regions.join(',') === 'details,editor,inspector,taskcards,statusbar,tree',
    regions.join(','),
  );

  // 8. Theme tối, đổi cỡ cây bằng phím, tải lại trang giữ bố cục (US1-4, US1-6)
  const themeButton = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('mat-statusbar button')]
        .find((x) => /Theo hệ thống|Sáng|Tối/.test(x.textContent))
        ?.click(),
    );
  await themeButton();
  check(
    'theme sáng áp ngay',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light',
  );
  await shot('5a-sang');
  await axe('theme sáng');
  await themeButton();
  check(
    'theme tối áp ngay',
    (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
  );
  await page.focus('[data-split="left"]');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const width = await page.$eval('.win', (w) => w.style.getPropertyValue('--left-w'));
  check('phím mũi tên trên thanh kéo đổi độ rộng cây', width === '312px', width);
  await shot('5-toi');
  await axe('theme tối');
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('mat-start-page .start-hero');
  const after = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    left: document.querySelector('.win')?.style.getPropertyValue('--left-w'),
  }));
  check(
    'tải lại: giữ theme và bố cục',
    after.theme === 'dark' && after.left === '312px',
    JSON.stringify(after),
  );

  // 9. Cửa sổ nhỏ nhất 960 × 600: không vùng nào tràn ngang
  await page.setViewport({ width: 960, height: 600 });
  // < 1180 px: task card nổi đè lên vùng editor (mockup); nhấp nút qua DOM để không trúng task card.
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
  await page.waitForSelector('mat-tree [role="treeitem"]');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  check('960 × 600: không tràn ngang', !overflow);
  await shot('6-960x600');
  await page.setViewport({ width: 1400, height: 860 });
}
