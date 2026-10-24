// CLI của mAT OPC DA Bridge. Lệnh: run, check, export-csv, browse, service install|uninstall, service-run (SCM gọi).
use mat_opcda_bridge::{config::Config, log, map, opc::OpcClient};

const USAGE: &str = "mat-opcda-bridge <command>
  run --config <file.json>            chay o cua so console (Ctrl+C de dung)
  check --config <file.json>          kiem cau hinh, in bang anh xa
  export-csv --config <file.json> --out <map.csv>
                                      xuat bang anh xa cho Studio (Nhap anh xa OPC DA...)
  browse --prog-id <ProgID> [--path <A.B>]
                                      duyet khong gian ten cua OPC DA server cuc bo
  service install --config <file.json>
  service uninstall                   (can quyen Administrator)
  --version";

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn load(args: &[String]) -> Result<Config, String> {
    let p = arg(args, "--config").ok_or("missing --config")?;
    let t = std::fs::read_to_string(&p).map_err(|e| format!("E_CONFIG_READ: {p}: {e}"))?;
    Config::parse(&t)
}

fn real_main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("--version") => {
            println!("mat-opcda-bridge {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some("check") => {
            let c = load(&args)?;
            let m = map::Map::build(&c);
            for (i, it) in c.items.iter().enumerate() {
                println!(
                    "{:<32} {:<8} {:<8} {:<6} {}",
                    it.id,
                    it.ty.name(),
                    m.address(i),
                    m.quality_address(i),
                    it.item
                );
            }
            println!("status register: {}", m.status_address());
            println!("OK: {} items", c.items.len());
            Ok(())
        }
        Some("export-csv") => {
            let c = load(&args)?;
            let out = arg(&args, "--out").ok_or("missing --out")?;
            std::fs::write(&out, map::to_csv(&c, &map::Map::build(&c)))
                .map_err(|e| format!("{out}: {e}"))?;
            println!("wrote {out}");
            Ok(())
        }
        Some("run") => {
            let c = load(&args)?;
            log::init(c.log.file.as_deref(), c.log.debug, c.log.max_bytes)?;
            mat_opcda_bridge::start(&c, None)?.wait();
            Ok(())
        }
        Some("browse") => browse(&args),
        #[cfg(windows)]
        Some("service") => match args.get(1).map(String::as_str) {
            Some("install") => {
                let p = arg(&args, "--config").ok_or("missing --config")?;
                load(&args)?;
                mat_opcda_bridge::service::install(&p)?;
                println!(
                    "service '{}' installed (start: sc start {0})",
                    mat_opcda_bridge::service::DEFAULT_NAME
                );
                Ok(())
            }
            Some("uninstall") => {
                mat_opcda_bridge::service::uninstall()?;
                println!("service removed");
                Ok(())
            }
            _ => Err(USAGE.into()),
        },
        #[cfg(windows)]
        Some("service-run") => {
            let p = arg(&args, "--config").ok_or("missing --config")?;
            mat_opcda_bridge::service::run_dispatcher(&p)
        }
        _ => Err(USAGE.into()),
    }
}

#[cfg(windows)]
fn browse(args: &[String]) -> Result<(), String> {
    let prog = arg(args, "--prog-id").ok_or("missing --prog-id")?;
    let path = arg(args, "--path").unwrap_or_default();
    mat_opcda_bridge::com::com_init()?;
    let mut c = mat_opcda_bridge::com::ComClient::new(&prog, "mAT-browse", 1000, 0.0, false);
    c.connect()?;
    for e in c.browse(&path)? {
        println!(
            "{} {:<40} {}",
            if e.branch { "+" } else { " " },
            e.name,
            e.item_id
        );
    }
    Ok(())
}

#[cfg(not(windows))]
fn browse(_args: &[String]) -> Result<(), String> {
    Err("browse needs Windows (COM)".into())
}

fn main() {
    if let Err(e) = real_main() {
        eprintln!("{e}");
        std::process::exit(2);
    }
}
