// OPC DA client qua COM cục bộ (Windows). Giao diện khai báo theo IDL công khai opcda.idl 2.05a của OPC Foundation (IID,
// thứ tự phương thức); không dùng SDK OPC thương mại. Chỉ CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER: không DCOM.
#![allow(
    non_snake_case,
    clippy::too_many_arguments,
    clippy::upper_case_acronyms,
    clippy::type_complexity
)]

use crate::config::ItemType;
use crate::opc::{BrowseEntry, ItemSpec, OpcClient, Update, Value};
use std::ffi::c_void;
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows::core::{
    implement, interface, IUnknown, IUnknown_Vtbl, Interface, BOOL, GUID, HRESULT, PCWSTR, PWSTR,
};
use windows::Win32::Foundation::VARIANT_BOOL;
use windows::Win32::Foundation::{FILETIME, S_FALSE, S_OK};
use windows::Win32::System::Com::{
    CLSIDFromProgID, CoCreateInstance, CoInitializeEx, CoInitializeSecurity, CoTaskMemFree,
    IConnectionPoint, IConnectionPointContainer, IEnumString, CLSCTX_INPROC_SERVER,
    CLSCTX_LOCAL_SERVER, COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_NONE,
    RPC_C_IMP_LEVEL_IDENTIFY,
};
use windows::Win32::System::Variant::{
    VariantClear, VariantToDouble, VARENUM, VARIANT, VT_BOOL, VT_I2, VT_I4, VT_R4, VT_UI2, VT_UI4,
};

#[repr(C)]
struct OPCITEMDEF {
    szAccessPath: PWSTR,
    szItemID: PWSTR,
    bActive: BOOL,
    hClient: u32,
    dwBlobSize: u32,
    pBlob: *mut u8,
    vtRequestedDataType: u16,
    wReserved: u16,
}

#[repr(C)]
struct OPCITEMRESULT {
    hServer: u32,
    vtCanonicalDataType: u16,
    wReserved: u16,
    dwAccessRights: u32,
    dwBlobSize: u32,
    pBlob: *mut u8,
}

#[repr(C)]
struct OPCITEMSTATE {
    hClient: u32,
    ftTimeStamp: FILETIME,
    wQuality: u16,
    wReserved: u16,
    vDataValue: VARIANT,
}

#[repr(C)]
struct OPCSERVERSTATUS {
    ftStartTime: FILETIME,
    ftCurrentTime: FILETIME,
    ftLastUpdateTime: FILETIME,
    dwServerState: i32,
    dwGroupCount: u32,
    dwBandWidth: u32,
    wMajorVersion: u16,
    wMinorVersion: u16,
    wBuildNumber: u16,
    wReserved: u16,
    szVendorInfo: PWSTR,
}

const OPC_DS_CACHE: i32 = 1;
const OPC_NS_FLAT: i32 = 2;
const OPC_BROWSE_UP: i32 = 1;
const OPC_BROWSE_DOWN: i32 = 2;
const OPC_BROWSE_TO: i32 = 3;
const OPC_BRANCH: i32 = 1;
const OPC_LEAF: i32 = 2;
const OPC_FLAT: i32 = 3;
const OPC_STATUS_RUNNING: i32 = 1;

#[interface("39c13a4d-011e-11d0-9675-0020afd8adb3")]
unsafe trait IOPCServer: IUnknown {
    fn AddGroup(
        &self,
        name: PCWSTR,
        active: BOOL,
        rate: u32,
        hclient: u32,
        timebias: *const i32,
        deadband: *const f32,
        lcid: u32,
        hserver: *mut u32,
        revised: *mut u32,
        riid: *const GUID,
        ppunk: *mut *mut c_void,
    ) -> HRESULT;
    fn GetErrorString(&self, err: HRESULT, locale: u32, s: *mut PWSTR) -> HRESULT;
    fn GetGroupByName(&self, name: PCWSTR, riid: *const GUID, ppunk: *mut *mut c_void) -> HRESULT;
    fn GetStatus(&self, status: *mut *mut OPCSERVERSTATUS) -> HRESULT;
    fn RemoveGroup(&self, hserver: u32, force: BOOL) -> HRESULT;
    fn CreateGroupEnumerator(
        &self,
        scope: i32,
        riid: *const GUID,
        ppunk: *mut *mut c_void,
    ) -> HRESULT;
}

#[interface("39c13a54-011e-11d0-9675-0020afd8adb3")]
unsafe trait IOPCItemMgt: IUnknown {
    fn AddItems(
        &self,
        count: u32,
        defs: *const OPCITEMDEF,
        results: *mut *mut OPCITEMRESULT,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
    fn ValidateItems(
        &self,
        count: u32,
        defs: *const OPCITEMDEF,
        blob: BOOL,
        results: *mut *mut OPCITEMRESULT,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
    fn RemoveItems(&self, count: u32, hserver: *const u32, errors: *mut *mut HRESULT) -> HRESULT;
    fn SetActiveState(
        &self,
        count: u32,
        hserver: *const u32,
        active: BOOL,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
    fn SetClientHandles(
        &self,
        count: u32,
        hserver: *const u32,
        hclient: *const u32,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
    fn SetDatatypes(
        &self,
        count: u32,
        hserver: *const u32,
        vt: *const u16,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
    fn CreateEnumerator(&self, riid: *const GUID, ppunk: *mut *mut c_void) -> HRESULT;
}

#[interface("39c13a52-011e-11d0-9675-0020afd8adb3")]
unsafe trait IOPCSyncIO: IUnknown {
    fn Read(
        &self,
        source: i32,
        count: u32,
        hserver: *const u32,
        values: *mut *mut OPCITEMSTATE,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
    fn Write(
        &self,
        count: u32,
        hserver: *const u32,
        values: *const VARIANT,
        errors: *mut *mut HRESULT,
    ) -> HRESULT;
}

#[interface("39c13a4f-011e-11d0-9675-0020afd8adb3")]
unsafe trait IOPCBrowseServerAddressSpace: IUnknown {
    fn QueryOrganization(&self, ns: *mut i32) -> HRESULT;
    fn ChangeBrowsePosition(&self, dir: i32, s: PCWSTR) -> HRESULT;
    fn BrowseOPCItemIDs(
        &self,
        ty: i32,
        filter: PCWSTR,
        vt: u16,
        rights: u32,
        e: *mut *mut c_void,
    ) -> HRESULT;
    fn GetItemID(&self, data: PCWSTR, id: *mut PWSTR) -> HRESULT;
    fn BrowseAccessPaths(&self, id: PCWSTR, e: *mut *mut c_void) -> HRESULT;
}

#[interface("39c13a70-011e-11d0-9675-0020afd8adb3")]
unsafe trait IOPCDataCallback: IUnknown {
    fn OnDataChange(
        &self,
        transid: u32,
        hgroup: u32,
        hrmasterquality: HRESULT,
        hrmastererror: HRESULT,
        count: u32,
        hclient: *const u32,
        values: *const VARIANT,
        qualities: *const u16,
        timestamps: *const FILETIME,
        errors: *const HRESULT,
    ) -> HRESULT;
    fn OnReadComplete(
        &self,
        transid: u32,
        hgroup: u32,
        hrmasterquality: HRESULT,
        hrmastererror: HRESULT,
        count: u32,
        hclient: *const u32,
        values: *const VARIANT,
        qualities: *const u16,
        timestamps: *const FILETIME,
        errors: *const HRESULT,
    ) -> HRESULT;
    fn OnWriteComplete(
        &self,
        transid: u32,
        hgroup: u32,
        hrmastererr: HRESULT,
        count: u32,
        hclient: *const u32,
        errors: *const HRESULT,
    ) -> HRESULT;
    fn OnCancelComplete(&self, transid: u32, hgroup: u32) -> HRESULT;
}

fn hr_text(hr: HRESULT) -> String {
    format!("0x{:08X} {}", hr.0 as u32, hr.message())
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn filetime(ft: &FILETIME) -> u64 {
    ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
}

/// VARIANT → giá trị theo kiểu item; None nếu không đổi được (chuỗi không phải số, mảng…).
fn to_value(ty: ItemType, v: &VARIANT) -> Option<Value> {
    unsafe { VariantToDouble(v).ok() }.map(|d| num_value(ty, d))
}

fn num_value(ty: ItemType, d: f64) -> Value {
    if ty == ItemType::Bool {
        Value::Bool(d != 0.0)
    } else {
        Value::Num(d)
    }
}

fn to_variant(ty: ItemType, v: Value) -> VARIANT {
    let x = v.as_f64();
    let mut out = VARIANT::default();
    // Chỉ kiểu giá trị (không BSTR/con trỏ): không cần VariantClear.
    unsafe {
        let inner = &mut *out.Anonymous.Anonymous;
        let (vt, u): (VARENUM, _) = (
            match ty {
                ItemType::Bool => VT_BOOL,
                ItemType::Int16 => VT_I2,
                ItemType::Uint16 => VT_UI2,
                ItemType::Int32 => VT_I4,
                ItemType::Uint32 => VT_UI4,
                ItemType::Float32 => VT_R4,
            },
            &mut inner.Anonymous,
        );
        inner.vt = vt;
        match ty {
            ItemType::Bool => u.boolVal = VARIANT_BOOL(if x != 0.0 { -1 } else { 0 }),
            ItemType::Int16 => u.iVal = x as i16,
            ItemType::Uint16 => u.uiVal = x as u16,
            ItemType::Int32 => u.lVal = x as i32,
            ItemType::Uint32 => u.ulVal = x as u32,
            ItemType::Float32 => u.fltVal = x as f32,
        }
    }
    out
}

#[implement(IOPCDataCallback)]
struct Callback {
    tx: Mutex<Sender<Vec<(u32, Option<f64>, u16, u64)>>>,
}

impl IOPCDataCallback_Impl for Callback_Impl {
    unsafe fn OnDataChange(
        &self,
        _transid: u32,
        _hgroup: u32,
        _mq: HRESULT,
        _me: HRESULT,
        count: u32,
        hclient: *const u32,
        values: *const VARIANT,
        qualities: *const u16,
        timestamps: *const FILETIME,
        errors: *const HRESULT,
    ) -> HRESULT {
        if hclient.is_null()
            || values.is_null()
            || qualities.is_null()
            || timestamps.is_null()
            || errors.is_null()
        {
            return S_OK;
        }
        let n = count.min(100_000) as usize;
        let mut batch = Vec::with_capacity(n);
        for i in 0..n {
            let ok = (*errors.add(i)).is_ok();
            let v = if ok {
                VariantToDouble(values.add(i)).ok()
            } else {
                None
            };
            batch.push((
                *hclient.add(i),
                v,
                *qualities.add(i),
                filetime(&*timestamps.add(i)),
            ));
        }
        let _ = self.tx.lock().unwrap().send(batch);
        S_OK
    }
    unsafe fn OnReadComplete(
        &self,
        _t: u32,
        _g: u32,
        _mq: HRESULT,
        _me: HRESULT,
        _c: u32,
        _h: *const u32,
        _v: *const VARIANT,
        _q: *const u16,
        _ts: *const FILETIME,
        _e: *const HRESULT,
    ) -> HRESULT {
        S_OK
    }
    unsafe fn OnWriteComplete(
        &self,
        _t: u32,
        _g: u32,
        _m: HRESULT,
        _c: u32,
        _h: *const u32,
        _e: *const HRESULT,
    ) -> HRESULT {
        S_OK
    }
    unsafe fn OnCancelComplete(&self, _t: u32, _g: u32) -> HRESULT {
        S_OK
    }
}

/// Khởi tạo COM cho luồng hiện tại (MTA) và bảo mật tiến trình một lần: mức xác thực NONE để server chạy dưới tài khoản
/// khác vẫn gọi lại được IOPCDataCallback (chỉ cục bộ, không DCOM).
pub fn com_init() -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx: {e}"))?;
        let _ = CoInitializeSecurity(
            None,
            -1,
            None,
            None,
            RPC_C_AUTHN_LEVEL_NONE,
            RPC_C_IMP_LEVEL_IDENTIFY,
            None,
            EOAC_NONE,
            None,
        );
    }
    Ok(())
}

struct Group {
    server: IOPCServer,
    h_group: u32,
    mgt: IOPCItemMgt,
    sync: IOPCSyncIO,
    cp: Option<(IConnectionPoint, u32)>,
}

pub struct ComClient {
    prog_id: String,
    group_name: String,
    rate: u32,
    deadband: f32,
    want_subscription: bool,
    server: Option<IOPCServer>,
    group: Option<Group>,
    items: Vec<ItemSpec>,
    /// hServer theo chỉ số item; None nếu AddItems lỗi.
    handles: Vec<Option<u32>>,
    rx: Option<Receiver<Vec<(u32, Option<f64>, u16, u64)>>>,
    next_status: Instant,
    next_read: Instant,
}

impl ComClient {
    pub fn new(
        prog_id: &str,
        group_name: &str,
        rate: u32,
        deadband: f32,
        subscription: bool,
    ) -> ComClient {
        ComClient {
            prog_id: prog_id.into(),
            group_name: group_name.into(),
            rate,
            deadband,
            want_subscription: subscription,
            server: None,
            group: None,
            items: vec![],
            handles: vec![],
            rx: None,
            next_status: Instant::now(),
            next_read: Instant::now(),
        }
    }

    fn server(&self) -> Result<&IOPCServer, String> {
        self.server
            .as_ref()
            .ok_or_else(|| "not connected".to_string())
    }

    fn check_status(&self) -> Result<(), String> {
        unsafe {
            let mut p: *mut OPCSERVERSTATUS = std::ptr::null_mut();
            let hr = self.server()?.GetStatus(&mut p);
            if hr.is_err() {
                return Err(format!("GetStatus: {}", hr_text(hr)));
            }
            if p.is_null() {
                return Err("GetStatus: null".into());
            }
            let state = (*p).dwServerState;
            if !(*p).szVendorInfo.is_null() {
                CoTaskMemFree(Some((*p).szVendorInfo.0 as *const c_void));
            }
            CoTaskMemFree(Some(p as *const c_void));
            if state != OPC_STATUS_RUNNING {
                return Err(format!("server state {state} (not running)"));
            }
        }
        Ok(())
    }

    fn sync_read(&mut self) -> Result<Vec<Update>, String> {
        let g = self.group.as_ref().ok_or("no group")?;
        let idx: Vec<usize> = (0..self.handles.len())
            .filter(|&i| self.handles[i].is_some())
            .collect();
        if idx.is_empty() {
            return Ok(vec![]);
        }
        let hs: Vec<u32> = idx.iter().map(|&i| self.handles[i].unwrap()).collect();
        let mut out = Vec::with_capacity(idx.len());
        unsafe {
            let mut states: *mut OPCITEMSTATE = std::ptr::null_mut();
            let mut errs: *mut HRESULT = std::ptr::null_mut();
            let hr = g.sync.Read(
                OPC_DS_CACHE,
                hs.len() as u32,
                hs.as_ptr(),
                &mut states,
                &mut errs,
            );
            if hr.is_err() {
                return Err(format!("SyncIO.Read: {}", hr_text(hr)));
            }
            for (k, &i) in idx.iter().enumerate() {
                if states.is_null() || errs.is_null() {
                    break;
                }
                let st = &mut *states.add(k);
                let ok = (*errs.add(k)).is_ok();
                let value = if ok {
                    to_value(self.items[i].ty, &st.vDataValue)
                } else {
                    None
                };
                out.push(Update {
                    index: i,
                    value,
                    quality: if ok { st.wQuality } else { 0 },
                    timestamp: filetime(&st.ftTimeStamp),
                });
                let _ = VariantClear(&mut st.vDataValue);
            }
            if !states.is_null() {
                CoTaskMemFree(Some(states as *const c_void));
            }
            if !errs.is_null() {
                CoTaskMemFree(Some(errs as *const c_void));
            }
        }
        Ok(out)
    }

    fn subscribe(&mut self) -> Result<(), String> {
        let g = self.group.as_mut().ok_or("no group")?;
        let (tx, rx) = mpsc::channel();
        let cb: IOPCDataCallback = Callback { tx: Mutex::new(tx) }.into();
        unsafe {
            let cpc: IConnectionPointContainer = g
                .mgt
                .cast()
                .map_err(|e| format!("IConnectionPointContainer: {e}"))?;
            let cp = cpc
                .FindConnectionPoint(&IOPCDataCallback::IID)
                .map_err(|e| format!("FindConnectionPoint: {e}"))?;
            let cookie = cp
                .Advise(&cb.cast::<IUnknown>().map_err(|e| e.to_string())?)
                .map_err(|e| format!("Advise: {e}"))?;
            g.cp = Some((cp, cookie));
        }
        self.rx = Some(rx);
        Ok(())
    }
}

impl OpcClient for ComClient {
    fn connect(&mut self) -> Result<(), String> {
        unsafe {
            let w = wide(&self.prog_id);
            let clsid = CLSIDFromProgID(PCWSTR(w.as_ptr()))
                .map_err(|e| format!("ProgID '{}': {e}", self.prog_id))?;
            let unk: IUnknown =
                CoCreateInstance(&clsid, None, CLSCTX_LOCAL_SERVER | CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("CoCreateInstance '{}': {e}", self.prog_id))?;
            let srv: IOPCServer = unk.cast().map_err(|e| format!("IOPCServer: {e}"))?;
            self.server = Some(srv);
        }
        self.check_status()
    }

    fn add_items(&mut self, items: &[ItemSpec]) -> Result<Vec<Result<(), String>>, String> {
        let srv = self.server()?.clone();
        self.items = items.to_vec();
        self.handles = vec![None; items.len()];
        let mut results = vec![];
        unsafe {
            let name = wide(&self.group_name);
            let (mut hg, mut revised) = (0u32, 0u32);
            let mut p: *mut c_void = std::ptr::null_mut();
            let hr = srv.AddGroup(
                PCWSTR(name.as_ptr()),
                BOOL(1),
                self.rate,
                1,
                std::ptr::null(),
                &self.deadband,
                0x0409,
                &mut hg,
                &mut revised,
                &IOPCItemMgt::IID,
                &mut p,
            );
            if hr.is_err() || p.is_null() {
                return Err(format!("AddGroup: {}", hr_text(hr)));
            }
            let mgt = IOPCItemMgt::from_raw(p);
            let sync: IOPCSyncIO = mgt.cast().map_err(|e| format!("IOPCSyncIO: {e}"))?;
            self.group = Some(Group {
                server: srv.clone(),
                h_group: hg,
                mgt,
                sync,
                cp: None,
            });
            let g = self.group.as_ref().unwrap();

            let mut ids: Vec<Vec<u16>> = items.iter().map(|i| wide(&i.item)).collect();
            let mut empty = wide("");
            let defs: Vec<OPCITEMDEF> = ids
                .iter_mut()
                .enumerate()
                .map(|(i, id)| OPCITEMDEF {
                    szAccessPath: PWSTR(empty.as_mut_ptr()),
                    szItemID: PWSTR(id.as_mut_ptr()),
                    bActive: BOOL(1),
                    hClient: i as u32,
                    dwBlobSize: 0,
                    pBlob: std::ptr::null_mut(),
                    vtRequestedDataType: 0, // VT_EMPTY: kiểu chuẩn của server, đổi khi đọc
                    wReserved: 0,
                })
                .collect();
            let mut res: *mut OPCITEMRESULT = std::ptr::null_mut();
            let mut errs: *mut HRESULT = std::ptr::null_mut();
            let hr = g
                .mgt
                .AddItems(defs.len() as u32, defs.as_ptr(), &mut res, &mut errs);
            if hr.is_err() {
                return Err(format!("AddItems: {}", hr_text(hr)));
            }
            for i in 0..items.len() {
                let e = if errs.is_null() { S_OK } else { *errs.add(i) };
                if e.is_ok() && !res.is_null() {
                    let r = &*res.add(i);
                    self.handles[i] = Some(r.hServer);
                    if !r.pBlob.is_null() {
                        CoTaskMemFree(Some(r.pBlob as *const c_void));
                    }
                    results.push(Ok(()));
                } else {
                    results.push(Err(hr_text(e)));
                }
            }
            if !res.is_null() {
                CoTaskMemFree(Some(res as *const c_void));
            }
            if !errs.is_null() {
                CoTaskMemFree(Some(errs as *const c_void));
            }
        }
        if self.want_subscription {
            if let Err(e) = self.subscribe() {
                crate::log::warn(&format!(
                    "OPC_SUBSCRIBE: {e}; falling back to cache polling"
                ));
            }
        }
        self.next_read = Instant::now();
        self.next_status = Instant::now() + Duration::from_secs(5);
        Ok(results)
    }

    fn poll(&mut self, wait: Duration) -> Result<Vec<Update>, String> {
        if Instant::now() >= self.next_status {
            self.check_status()?;
            self.next_status = Instant::now() + Duration::from_secs(5);
        }
        if let Some(rx) = &self.rx {
            let mut out = vec![];
            let push = |batch: Vec<(u32, Option<f64>, u16, u64)>, out: &mut Vec<Update>| {
                for (h, v, q, ts) in batch {
                    let i = h as usize;
                    let Some(spec) = self.items.get(i) else {
                        continue;
                    };
                    let value = v.map(|d| num_value(spec.ty, d));
                    out.push(Update {
                        index: i,
                        value,
                        quality: if v.is_some() { q } else { 0 },
                        timestamp: ts,
                    });
                }
            };
            if let Ok(b) = rx.recv_timeout(wait) {
                push(b, &mut out);
                while let Ok(b) = rx.try_recv() {
                    push(b, &mut out);
                }
            }
            return Ok(out);
        }
        let now = Instant::now();
        if now < self.next_read {
            std::thread::sleep((self.next_read - now).min(wait));
            return Ok(vec![]);
        }
        self.next_read = now + Duration::from_millis(self.rate as u64);
        self.sync_read()
    }

    fn write(&mut self, index: usize, value: Value) -> Result<(), String> {
        let g = self.group.as_ref().ok_or("no group")?;
        let h = self
            .handles
            .get(index)
            .copied()
            .flatten()
            .ok_or("item not added")?;
        let v = to_variant(self.items[index].ty, value);
        unsafe {
            let mut errs: *mut HRESULT = std::ptr::null_mut();
            let hr = g.sync.Write(1, &h, &v, &mut errs);
            let item_hr = if errs.is_null() { hr } else { *errs };
            if !errs.is_null() {
                CoTaskMemFree(Some(errs as *const c_void));
            }
            if hr.is_err() {
                return Err(format!("SyncIO.Write: {}", hr_text(hr)));
            }
            if item_hr.is_err() || hr == S_FALSE {
                return Err(format!("SyncIO.Write item: {}", hr_text(item_hr)));
            }
        }
        Ok(())
    }

    fn disconnect(&mut self) {
        if let Some(g) = self.group.take() {
            unsafe {
                if let Some((cp, cookie)) = &g.cp {
                    let _ = cp.Unadvise(*cookie);
                }
                let _ = g.server.RemoveGroup(g.h_group, BOOL(1));
            }
        }
        self.rx = None;
        self.server = None;
    }

    fn browse(&mut self, path: &str) -> Result<Vec<BrowseEntry>, String> {
        let b: IOPCBrowseServerAddressSpace = self
            .server()?
            .cast()
            .map_err(|e| format!("server does not support browsing: {e}"))?;
        unsafe {
            let mut ns = 0i32;
            let _ = b.QueryOrganization(&mut ns);
            let list = |ty: i32| -> Result<Vec<String>, String> {
                let mut p: *mut c_void = std::ptr::null_mut();
                let empty = wide("");
                let hr = b.BrowseOPCItemIDs(ty, PCWSTR(empty.as_ptr()), 0, 0, &mut p);
                if hr.is_err() {
                    return Err(format!("BrowseOPCItemIDs: {}", hr_text(hr)));
                }
                if p.is_null() || hr == S_FALSE {
                    return Ok(vec![]);
                }
                let en = IEnumString::from_raw(p);
                let mut out = vec![];
                loop {
                    let mut buf = [PWSTR::null(); 64];
                    let mut got = 0u32;
                    let hr = en.Next(&mut buf, Some(&mut got));
                    for s in buf.iter().take(got as usize) {
                        out.push(s.to_string().unwrap_or_default());
                        CoTaskMemFree(Some(s.0 as *const c_void));
                    }
                    if hr != S_OK || got == 0 || out.len() > 100_000 {
                        break;
                    }
                }
                Ok(out)
            };
            if ns == OPC_NS_FLAT {
                return Ok(list(OPC_FLAT)?
                    .into_iter()
                    .filter(|s| s.starts_with(path))
                    .map(|s| BrowseEntry {
                        name: s.clone(),
                        item_id: s,
                        branch: false,
                    })
                    .collect());
            }
            // Về gốc rồi xuống theo đường dẫn (BROWSE_TO không phải server nào cũng có).
            let empty = wide("");
            if b.ChangeBrowsePosition(OPC_BROWSE_TO, PCWSTR(empty.as_ptr()))
                .is_err()
            {
                for _ in 0..64 {
                    if b.ChangeBrowsePosition(OPC_BROWSE_UP, PCWSTR(empty.as_ptr()))
                        .is_err()
                    {
                        break;
                    }
                }
            }
            if !path.is_empty() {
                let w = wide(path);
                if b.ChangeBrowsePosition(OPC_BROWSE_TO, PCWSTR(w.as_ptr()))
                    .is_err()
                {
                    for seg in path.split('.') {
                        let w = wide(seg);
                        let hr = b.ChangeBrowsePosition(OPC_BROWSE_DOWN, PCWSTR(w.as_ptr()));
                        if hr.is_err() {
                            return Err(format!("branch '{seg}': {}", hr_text(hr)));
                        }
                    }
                }
            }
            let mut out = vec![];
            for (ty, branch) in [(OPC_BRANCH, true), (OPC_LEAF, false)] {
                for name in list(ty)? {
                    let w = wide(&name);
                    let mut id = PWSTR::null();
                    let item_id =
                        if b.GetItemID(PCWSTR(w.as_ptr()), &mut id).is_ok() && !id.is_null() {
                            let s = id.to_string().unwrap_or_default();
                            CoTaskMemFree(Some(id.0 as *const c_void));
                            s
                        } else if path.is_empty() {
                            name.clone()
                        } else {
                            format!("{path}.{name}")
                        };
                    out.push(BrowseEntry {
                        name,
                        item_id,
                        branch,
                    });
                }
            }
            Ok(out)
        }
    }
}

impl Drop for ComClient {
    fn drop(&mut self) {
        self.disconnect();
    }
}
