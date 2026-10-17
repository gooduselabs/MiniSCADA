//! Trợ giúp (feature 011, T178; FR-133): mở tài liệu HTML đi kèm bộ cài (`docs-html/` trong tài nguyên, dựng bởi
//! tools/build-docs.mjs, `bundle.resources` của tauri.conf.json) đúng trang và mục. Giao diện chỉ gửi tên trang và neo
//! (bảng ở `src/app/help-topics.json`); đường dẫn dựng ở đây, luôn nằm trong thư mục tài nguyên cố định. Mở trong cửa sổ
//! "help" riêng của Studio (WebView hiển thị `file://…#neo`, giữ neo, không có quyền IPC vì capability chỉ cấp cho "main");
//! không mở được cửa sổ thì mở tệp bằng trình xem mặc định (mất neo).
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// Thư mục tài liệu trong tài nguyên của bản cài.
pub const DOCS_DIR: &str = "docs-html";

fn simple(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// Đường dẫn tệp và neo đã kiểm: `page` dạng `<thư mục>/<tên>.html`, neo chỉ chữ thường, số, gạch (có thể rỗng).
pub fn help_file(resources: &Path, page: &str, anchor: &str) -> Result<PathBuf, String> {
    let (dir, file) = page.split_once('/').ok_or("bad-page")?;
    let name = file.strip_suffix(".html").ok_or("bad-page")?;
    if !simple(dir) || !simple(name) {
        return Err("bad-page".into());
    }
    if !anchor.is_empty() && !simple(anchor) {
        return Err("bad-anchor".into());
    }
    let path = resources.join(DOCS_DIR).join(dir).join(file);
    if !path.is_file() {
        return Err("not-found".into());
    }
    Ok(path)
}

/// URL `file://` của trang kèm neo.
pub fn help_url(path: &Path, anchor: &str) -> Result<Url, String> {
    let mut url = Url::from_file_path(path).map_err(|_| "bad-path".to_string())?;
    if !anchor.is_empty() {
        url.set_fragment(Some(anchor));
    }
    Ok(url)
}

#[tauri::command]
pub fn open_help(app: AppHandle, page: String, anchor: String) -> Result<(), String> {
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let path = help_file(&resources, &page, &anchor)?;
    let url = help_url(&path, &anchor)?;
    if let Some(win) = app.get_webview_window("help") {
        win.navigate(url).map_err(|e| e.to_string())?;
        let _ = win.unminimize();
        return win.set_focus().map_err(|e| e.to_string());
    }
    let built = WebviewWindowBuilder::new(&app, "help", WebviewUrl::External(url))
        .title("Trợ giúp mAT Studio")
        .inner_size(1000.0, 760.0)
        .build();
    match built {
        Ok(_) => Ok(()),
        Err(e) => {
            eprintln!("open_help: {e}");
            tauri_plugin_opener::open_path(&path, None::<&str>).map_err(|e| e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("mat-help-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(d.join("docs-html/user")).unwrap();
        fs::write(d.join("docs-html/user/engineer-guide.html"), "<h1>x</h1>").unwrap();
        d
    }

    #[test]
    fn tep_co_that_trong_docs_html() {
        let d = tmp();
        let p = help_file(&d, "user/engineer-guide.html", "help-logic").unwrap();
        assert_eq!(p, d.join("docs-html/user/engineer-guide.html"));
        let url = help_url(&p, "help-logic").unwrap();
        assert_eq!(url.scheme(), "file");
        assert_eq!(url.fragment(), Some("help-logic"));
        assert!(help_url(&p, "").unwrap().fragment().is_none());
        fs::remove_dir_all(d).unwrap();
    }

    #[test]
    fn tu_choi_duong_dan_la() {
        let d = tmp();
        for page in [
            "../secret.html",
            "user/../../x.html",
            "user/engineer-guide.md",
            "/etc/passwd",
            "user\\x.html",
            "User/engineer-guide.html",
            "engineer-guide.html",
            "user/sub/x.html",
            "",
        ] {
            assert_eq!(help_file(&d, page, "").unwrap_err(), "bad-page", "{page}");
        }
        for anchor in ["a b", "x\"onload", "#x", "../y", "Help"] {
            assert_eq!(
                help_file(&d, "user/engineer-guide.html", anchor).unwrap_err(),
                "bad-anchor",
                "{anchor}"
            );
        }
        assert_eq!(
            help_file(&d, "user/admin-guide.html", "").unwrap_err(),
            "not-found"
        );
        fs::remove_dir_all(d).unwrap();
    }
}
