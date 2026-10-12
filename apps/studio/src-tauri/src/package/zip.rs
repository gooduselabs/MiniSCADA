//! Tập con ZIP của gói `.matscada` (contracts/matscada-package.md §2, §7, §8a): bộ đọc đi qua
//! central directory với luật của từng entry, giải nén đếm byte thật; bộ ghi tất định. Bản Rust của
//! `core/package/zip_reader.cpp` và `zip_writer.cpp`: cùng thứ tự kiểm, cùng mã lỗi (bộ vector
//! `tests/package-vectors/`).

use super::rules::{
    MANIFEST_NAME, MAX_ENTRIES, MAX_PACKAGE_BYTES, MAX_PATH_BYTES, PackageError, display_name,
    path_key, path_rule_error, path_type_error,
};
use flate2::{Compress, Compression, Crc, Decompress, FlushCompress, FlushDecompress, Status};
use std::collections::HashSet;

const SIG_LOCAL: u32 = 0x0403_4b50;
const SIG_CENTRAL: u32 = 0x0201_4b50;
const SIG_EOCD: u32 = 0x0605_4b50;
const LOCAL_HEADER: usize = 30;
const CENTRAL_HEADER: usize = 46;
const EOCD: usize = 22;
const FLAG_UTF8: u16 = 0x0800;
const FLAGS_DEFLATE_OPTIONS: u16 = 0x0006;
const MAX_VERSION_NEEDED: u16 = 20;
const HOST_MSDOS: u8 = 0;
const HOST_UNIX: u8 = 3;
const UNIX_TYPE_MASK: u32 = 0o170_000;
const UNIX_REGULAR: u32 = 0o100_000;
const UNIX_DIRECTORY: u32 = 0o040_000;
const UNIX_SYMLINK: u32 = 0o120_000;
const DOS_DIRECTORY: u32 = 0x10;
/// Giờ DOS `00:00:00`, ngày DOS `1980-01-01` (§7).
const DOS_TIME: u16 = 0x0000;
const DOS_DATE: u16 = 0x0021;
const VERSION: u16 = 20;

fn le16(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}

fn le32(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

fn format_at(path: &str, message: &str) -> PackageError {
    PackageError::at("E_PKG_FORMAT", path, message)
}

fn layout(message: &str) -> PackageError {
    PackageError::whole("E_PKG_FORMAT", message)
}

fn io_error(path: Option<&str>) -> PackageError {
    PackageError::new("STORE_IO", path, "Không đọc được gói (lỗi vào/ra)")
}

/// Một entry của central directory đã qua luật của giai đoạn 3.
#[derive(Debug, Clone)]
pub struct ZipEntry {
    pub name: String,
    /// 0 stored, 8 deflate.
    pub method: u16,
    pub crc32: u32,
    pub compressed_size: u32,
    /// Kích thước sau giải nén theo khai báo.
    pub size: u32,
    pub data_offset: u64,
}

/// `n` byte tại `offset`; `None` khi vượt cuối gói.
fn slice(bytes: &[u8], offset: u64, n: usize) -> Option<&[u8]> {
    let start = usize::try_from(offset).ok()?;
    let end = start.checked_add(n)?;
    bytes.get(start..end)
}

/// Luật của một bản ghi central directory không cần header cục bộ (giai đoạn 3).
fn record_error(h: &[u8], name: &str) -> Option<PackageError> {
    let made_by = le16(&h[4..]);
    let needed = le16(&h[6..]);
    let flags = le16(&h[8..]);
    let method = le16(&h[10..]);
    if needed > MAX_VERSION_NEEDED {
        return Some(format_at(
            name,
            "Version needed lớn hơn 2.0 (ZIP64 hoặc tính năng không hỗ trợ)",
        ));
    }
    if method != 0 && method != 8 {
        return Some(format_at(
            name,
            "Phương thức nén không hỗ trợ (chỉ stored và deflate)",
        ));
    }
    let allowed = FLAG_UTF8
        | if method == 8 {
            FLAGS_DEFLATE_OPTIONS
        } else {
            0
        };
    if flags & !allowed != 0 {
        return Some(format_at(
            name,
            "Cờ không hỗ trợ (mã hóa, data descriptor, patch…)",
        ));
    }
    if le16(&h[30..]) != 0 {
        return Some(format_at(name, "Entry có extra field"));
    }
    if le16(&h[32..]) != 0 {
        return Some(format_at(name, "Entry có comment"));
    }
    if le16(&h[34..]) != 0 {
        return Some(format_at(name, "Entry nằm trên đĩa khác"));
    }
    let host = (made_by >> 8) as u8;
    let attrs = le32(&h[38..]);
    if host != HOST_MSDOS && host != HOST_UNIX {
        return Some(format_at(
            name,
            "Hệ tạo gói không hỗ trợ (chỉ MS-DOS và Unix)",
        ));
    }
    if host == HOST_UNIX {
        let kind = (attrs >> 16) & UNIX_TYPE_MASK;
        if kind == UNIX_SYMLINK {
            return Some(PackageError::at("E_PKG_PATH", name, "Entry là symlink"));
        }
        if kind == UNIX_DIRECTORY {
            return Some(PackageError::at("E_PKG_PATH", name, "Entry là thư mục"));
        }
        if kind != 0 && kind != UNIX_REGULAR {
            return Some(format_at(
                name,
                "Entry không phải file thường (FIFO, thiết bị, socket…)",
            ));
        }
    }
    if attrs & DOS_DIRECTORY != 0 {
        return Some(PackageError::at("E_PKG_PATH", name, "Entry là thư mục"));
    }
    None
}

/// Giai đoạn 1–3 của thứ tự kiểm (§8a), lỗi đầu tiên thắng: kích thước gói; EOCD, số entry, central
/// directory liền trước EOCD; từng entry theo thứ tự central directory. Trả mọi entry (entry đầu
/// chưa được kiểm là manifest ở đây).
pub fn read_directory(bytes: &[u8]) -> Result<Vec<ZipEntry>, PackageError> {
    let size = bytes.len() as u64;
    // 1. Kích thước, trước khi đọc gì.
    if size > MAX_PACKAGE_BYTES {
        return Err(PackageError::whole(
            "E_PKG_TOO_LARGE",
            "Gói lớn hơn 50 MiB (52.428.800 byte)",
        ));
    }
    // 2. Bản ghi kết thúc.
    if bytes.len() < EOCD {
        return Err(layout("Không phải gói ZIP: ngắn hơn bản ghi kết thúc"));
    }
    let eocd_pos = bytes.len() - EOCD;
    let e = &bytes[eocd_pos..];
    if le32(e) != SIG_EOCD {
        return Err(layout(
            "Bản ghi kết thúc (EOCD) không nằm đúng 22 byte cuối: dữ liệu thừa sau gói hoặc comment",
        ));
    }
    if le16(&e[20..]) != 0 {
        return Err(layout("Gói có comment"));
    }
    let total = le16(&e[10..]);
    if le16(&e[4..]) != 0 || le16(&e[6..]) != 0 || le16(&e[8..]) != total {
        return Err(layout("Gói chia nhiều đĩa"));
    }
    if total == 0 || usize::from(total) > MAX_ENTRIES {
        return Err(PackageError::whole(
            "E_PKG_ENTRIES",
            "Gói phải có 1–1024 entry (gồm manifest)",
        ));
    }
    let cd_size = u64::from(le32(&e[12..]));
    let cd_offset = u64::from(le32(&e[16..]));
    let eocd_pos = eocd_pos as u64;
    if cd_offset + cd_size != eocd_pos {
        return Err(layout(
            "Central directory không nằm liền trước bản ghi kết thúc (ZIP64?)",
        ));
    }

    // 3. Từng entry theo thứ tự central directory.
    let mut entries = Vec::with_capacity(usize::from(total));
    let mut keys = HashSet::new();
    let mut p = cd_offset;
    let mut expected = 0u64; // chỗ header cục bộ kế tiếp phải bắt đầu
    for i in 0..total {
        if p + CENTRAL_HEADER as u64 > eocd_pos {
            return Err(layout("Central directory bị cắt"));
        }
        let h = slice(bytes, p, CENTRAL_HEADER).ok_or_else(|| io_error(None))?;
        if le32(h) != SIG_CENTRAL {
            return Err(layout("Central directory hỏng"));
        }
        let name_len = usize::from(le16(&h[28..]));
        let next = p
            + CENTRAL_HEADER as u64
            + name_len as u64
            + u64::from(le16(&h[30..]))
            + u64::from(le16(&h[32..]));
        if next > eocd_pos {
            return Err(layout("Central directory bị cắt"));
        }

        // Tên: 1–128 byte UTF-8; tên dài hơn đọc tới 129 byte, đủ để hiện.
        let shown = name_len.min(MAX_PATH_BYTES + 1);
        let raw = slice(bytes, p + CENTRAL_HEADER as u64, shown).ok_or_else(|| io_error(None))?;
        if name_len == 0 {
            return Err(PackageError::new("E_PKG_PATH", None, "Entry không có tên"));
        }
        if name_len > MAX_PATH_BYTES {
            return Err(PackageError::at(
                "E_PKG_PATH",
                &display_name(raw),
                "Tên entry dài hơn 128 byte",
            ));
        }
        let Ok(name) = std::str::from_utf8(raw) else {
            return Err(PackageError::at(
                "E_PKG_PATH",
                &display_name(raw),
                "Tên entry không phải UTF-8 hợp lệ",
            ));
        };
        let name = name.to_string();

        if let Some(err) = record_error(h, &name) {
            return Err(err);
        }

        // Luật đường dẫn 1–5, 8, 7, rồi 6 (§8a).
        if let Some(err) = path_rule_error(&name) {
            return Err(err);
        }
        if i > 0 && name == MANIFEST_NAME {
            return Err(PackageError::at(
                "E_PKG_PATH",
                &name,
                "Chỉ manifest (entry đầu) được tên matscada.json",
            ));
        }
        if !keys.insert(path_key(&name)) {
            return Err(PackageError::at(
                "E_PKG_PATH",
                &name,
                "Trùng tên với entry khác khi không phân biệt hoa thường",
            ));
        }
        if let Some(err) = path_type_error(&name) {
            return Err(err);
        }

        // Bố cục: các entry nối nhau từ offset 0, không khoảng trống, không chồng.
        let offset = u64::from(le32(&h[42..]));
        if offset != expected {
            return Err(layout(
                "Entry không liền nhau (khoảng trống, chồng lấn hoặc dữ liệu thừa ở đầu)",
            ));
        }
        if offset + LOCAL_HEADER as u64 + name_len as u64 > cd_offset {
            return Err(layout("Header cục bộ chồng lên central directory"));
        }
        let l = slice(bytes, offset, LOCAL_HEADER).ok_or_else(|| io_error(Some(&name)))?;
        if le32(l) != SIG_LOCAL {
            return Err(format_at(&name, "Header cục bộ hỏng"));
        }
        if le16(&l[4..]) != le16(&h[6..])
            || le16(&l[6..]) != le16(&h[8..])
            || le16(&l[8..]) != le16(&h[10..])
            || le32(&l[14..]) != le32(&h[16..])
            || le32(&l[18..]) != le32(&h[20..])
            || le32(&l[22..]) != le32(&h[24..])
            || usize::from(le16(&l[26..])) != name_len
            || le16(&l[28..]) != 0
        {
            return Err(format_at(&name, "Header cục bộ khác central directory"));
        }
        let local_name = slice(bytes, offset + LOCAL_HEADER as u64, name_len)
            .ok_or_else(|| io_error(Some(&name)))?;
        if local_name != name.as_bytes() {
            return Err(format_at(
                &name,
                "Tên ở header cục bộ khác central directory",
            ));
        }

        let entry = ZipEntry {
            method: le16(&h[10..]),
            crc32: le32(&h[16..]),
            compressed_size: le32(&h[20..]),
            size: le32(&h[24..]),
            data_offset: offset + LOCAL_HEADER as u64 + name_len as u64,
            name,
        };
        if entry.data_offset + u64::from(entry.compressed_size) > cd_offset {
            return Err(layout("Dữ liệu entry chồng lên central directory"));
        }
        if entry.method == 0 && entry.compressed_size != entry.size {
            return Err(format_at(
                &entry.name,
                "Entry stored có kích thước nén khác kích thước gốc",
            ));
        }
        expected = entry.data_offset + u64::from(entry.compressed_size);
        entries.push(entry);
        p = next;
    }
    if p != eocd_pos {
        return Err(layout("Central directory có dữ liệu thừa"));
    }
    if expected != cd_offset {
        return Err(layout("Dữ liệu thừa giữa entry cuối và central directory"));
    }
    Ok(entries)
}

/// Deflate thô vào bộ đệm đúng `size` byte: dừng ngay khi dữ liệu vượt kích thước khai báo, phải hết
/// đúng dữ liệu nén và đúng kích thước.
fn inflate_exact(name: &str, comp: &[u8], size: usize) -> Result<Vec<u8>, PackageError> {
    let corrupt = || format_at(name, "Dữ liệu deflate hỏng");
    let mut d = Decompress::new(false);
    let mut out = vec![0u8; size];
    let first = d
        .decompress(comp, &mut out, FlushDecompress::Finish)
        .map_err(|_| corrupt())?;
    let mut status = first;
    if status != Status::StreamEnd && d.total_out() as usize == size {
        // Bộ đệm đầy mà dòng chưa kết thúc: còn byte nào nữa thì dài hơn khai báo.
        let mut one = [0u8; 1];
        let from = d.total_in() as usize;
        status = d
            .decompress(&comp[from..], &mut one, FlushDecompress::Finish)
            .map_err(|_| corrupt())?;
        if d.total_out() as usize > size {
            return Err(format_at(
                name,
                "Dữ liệu giải nén dài hơn kích thước khai báo",
            ));
        }
    }
    if status != Status::StreamEnd {
        return Err(corrupt());
    }
    if d.total_in() as usize != comp.len() {
        return Err(format_at(
            name,
            "Dòng deflate kết thúc trước khi hết dữ liệu nén",
        ));
    }
    if d.total_out() as usize != size {
        return Err(format_at(
            name,
            "Dữ liệu giải nén ngắn hơn kích thước khai báo",
        ));
    }
    Ok(out)
}

/// Byte của một entry: stored nguyên dạng, deflate qua bộ giải nén vào bộ đệm đúng kích thước khai
/// báo. Người gọi đã kiểm `entry.size` với giới hạn §6 (bộ đệm theo kích thước đó).
pub fn read_entry(bytes: &[u8], entry: &ZipEntry) -> Result<Vec<u8>, PackageError> {
    let comp = slice(bytes, entry.data_offset, entry.compressed_size as usize)
        .ok_or_else(|| io_error(Some(&entry.name)))?;
    if entry.method == 0 {
        return Ok(comp.to_vec());
    }
    inflate_exact(&entry.name, comp, entry.size as usize)
}

/// CRC-32 (IEEE) của các byte.
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut c = Crc::new();
    c.update(bytes);
    c.sum()
}

// ---- Bộ ghi tất định (§7) ----

/// Một file sẽ vào gói: đường dẫn và nội dung; `deflate` cho phép nén (manifest luôn stored).
pub struct WriteItem<'a> {
    pub path: &'a str,
    pub data: &'a [u8],
    pub deflate: bool,
}

struct Written {
    path: String,
    method: u16,
    crc: u32,
    size: u32,
    comp_size: u32,
    offset: u32,
}

fn put(out: &mut Vec<u8>, v: u32, bytes: usize) {
    out.extend_from_slice(&v.to_le_bytes()[..bytes]);
}

/// Deflate mức 6, thô (không header zlib).
fn deflate6(data: &[u8]) -> Vec<u8> {
    let mut c = Compress::new(Compression::new(6), false);
    let mut out = Vec::with_capacity(data.len() / 2 + 64);
    loop {
        let before_in = c.total_in() as usize;
        let status = c
            .compress_vec(&data[before_in..], &mut out, FlushCompress::Finish)
            .expect("nén vào Vec không lỗi");
        if status == Status::StreamEnd {
            return out;
        }
        out.reserve(out.capacity().max(1024));
    }
}

/// Ghi gói theo thứ tự `items` (manifest đứng đầu, người gọi sắp sẵn): giờ DOS `0x0000`, ngày DOS
/// `0x0021`, cờ bit 11, "version made by" và "version needed" 20, thuộc tính 0, không extra field,
/// comment hay data descriptor. Deflate mức 6 trừ khi bản nén không nhỏ hơn bản gốc thì stored.
pub fn write_zip(items: &[WriteItem<'_>]) -> Result<Vec<u8>, PackageError> {
    let mut out: Vec<u8> = Vec::new();
    let mut written = Vec::with_capacity(items.len());
    for it in items {
        let too_big = || PackageError::at("E_PKG_TOO_LARGE", it.path, "File quá lớn để đóng gói");
        let size = u32::try_from(it.data.len()).map_err(|_| too_big())?;
        let packed = if it.deflate && !it.data.is_empty() {
            let d = deflate6(it.data);
            (d.len() < it.data.len()).then_some(d)
        } else {
            None
        };
        let (method, body): (u16, &[u8]) = match &packed {
            Some(d) => (8, d),
            None => (0, it.data),
        };
        let comp_size = u32::try_from(body.len()).map_err(|_| too_big())?;
        let offset = u32::try_from(out.len()).map_err(|_| too_big())?;
        let w = Written {
            path: it.path.to_string(),
            method,
            crc: crc32(it.data),
            size,
            comp_size,
            offset,
        };
        put(&mut out, SIG_LOCAL, 4);
        put(&mut out, u32::from(VERSION), 2);
        put(&mut out, u32::from(FLAG_UTF8), 2);
        put(&mut out, u32::from(method), 2);
        put(&mut out, u32::from(DOS_TIME), 2);
        put(&mut out, u32::from(DOS_DATE), 2);
        put(&mut out, w.crc, 4);
        put(&mut out, comp_size, 4);
        put(&mut out, size, 4);
        put(&mut out, w.path.len() as u32, 2);
        put(&mut out, 0, 2);
        out.extend_from_slice(w.path.as_bytes());
        out.extend_from_slice(body);
        written.push(w);
    }
    let cd_offset = u32::try_from(out.len())
        .map_err(|_| PackageError::whole("E_PKG_TOO_LARGE", "Gói quá lớn"))?;
    for w in &written {
        put(&mut out, SIG_CENTRAL, 4);
        put(&mut out, u32::from(VERSION), 2); // made by: MS-DOS (0), 2.0
        put(&mut out, u32::from(VERSION), 2);
        put(&mut out, u32::from(FLAG_UTF8), 2);
        put(&mut out, u32::from(w.method), 2);
        put(&mut out, u32::from(DOS_TIME), 2);
        put(&mut out, u32::from(DOS_DATE), 2);
        put(&mut out, w.crc, 4);
        put(&mut out, w.comp_size, 4);
        put(&mut out, w.size, 4);
        put(&mut out, w.path.len() as u32, 2);
        put(&mut out, 0, 2); // extra
        put(&mut out, 0, 2); // comment
        put(&mut out, 0, 2); // disk number start
        put(&mut out, 0, 2); // internal attributes
        put(&mut out, 0, 4); // external attributes
        put(&mut out, w.offset, 4);
        out.extend_from_slice(w.path.as_bytes());
    }
    let cd_size = out.len() as u32 - cd_offset;
    put(&mut out, SIG_EOCD, 4);
    put(&mut out, 0, 2);
    put(&mut out, 0, 2);
    put(&mut out, written.len() as u32, 2);
    put(&mut out, written.len() as u32, 2);
    put(&mut out, cd_size, 4);
    put(&mut out, cd_offset, 4);
    put(&mut out, 0, 2); // comment
    Ok(out)
}
