# Gia cố thiết bị BL335 chạy `mat-runtime` (bản 1.0)

Hướng dẫn cho người cài đặt và quản trị hệ thống của khách hàng: các bước ở tầng hệ điều hành và mạng mà runtime **không tự làm**. Nguồn: FR-033 của [spec 011](../../specs/011-pilot-hardening/spec.md), research R10, R12, [ADR-036](../adr/036-security-hardening.md), [mô hình mối đe dọa](../architecture/threat-model.md). Cấu hình runtime: [mat-runtime.md](mat-runtime.md) mục 5h.

> **Cảnh báo.** Đổi `sshd`, tường lửa và địa chỉ mạng có thể làm **mất truy cập** vào thiết bị. Luôn giữ một phiên SSH đang mở trong suốt lúc đổi, thử phiên mới trước khi đóng phiên cũ, và có đường vào dự phòng (cổng console, người đứng cạnh thiết bị). Thử toàn bộ trên một BL335 ở bàn thử trước khi làm trên thiết bị ở nhà máy. Trên BL335 của dự án, việc này là task T064 ⚠️🔌: chỉ làm khi người dùng đồng ý và có mặt; mọi thay đổi ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác.

Trong tài liệu này `<IP-LAN>` là địa chỉ của BL335 trong mạng nhà máy, `<IP-công-cộng>` là địa chỉ WAN của router, `<cổng-ngoài>` là cổng router đang chuyển tiếp. Đừng ghi giá trị thật của một khách hàng vào tài liệu hay kho mã công khai.

## 0. Tóm tắt (danh sách kiểm)

| # | Việc | Ai | Kiểm lại |
|---|---|---|---|
| 1 | Đóng mọi port-forward tới BL335 (HTTP 9080→8080, SSH 22, cả 8443) | quản trị router | quét từ ngoài: cổng đóng (mục 2) |
| 2 | Truy cập từ xa chỉ qua VPN | quản trị mạng | mục 3 |
| 3 | SSH chỉ khóa công khai, `PermitRootLogin prohibit-password` | root trên BL335 | `sshd -T`; cảnh báo `SSH_ROOT_PASSWORD` mất (mục 4) |
| 4 | Giới hạn kết nối theo nguồn ở tầng mạng (`nft`, `ct count`) | root | `nft list table inet mat_guard` (mục 5) |
| 5 | `viewerLogin: required` khi có người xem ngoài LAN | kỹ sư | trang hỏi đăng nhập (mục 6) |
| 6 | IP tĩnh (hoặc giữ IP ở DHCP của router) | quản trị mạng | IP không đổi sau khởi động lại (mục 7) |
| 7 | Đồng bộ giờ NTP | root | `timedatectl`; không có `TIME_NOT_SYNCED` (mục 8) |
| 8 | Quyền tập tin đúng | root | lệnh kiểm ở mục 9 |

Runtime hỗ trợ việc kiểm: `GET /api/v1/system/info` (mục `warnings`) báo `SSH_ROOT_PASSWORD`, `HOST_CHECK_OFF`, `TIME_NOT_SYNCED`, `VIEWER_PUBLIC`, `TLS_SAN_MISMATCH`; Studio hiện các cảnh báo này ở trang Thiết bị.

## 1. Mô hình mạng nên có

- BL335 nằm trong **mạng OT** (LAN của máy, PLC, máy trạm vận hành), không nằm trên Internet. Máy kỹ sư chạy Studio ở cùng LAN hoặc vào qua VPN.
- **Không** chuyển cổng (port-forward) từ router ra Internet tới BL335. Runtime có HTTPS, khóa đăng nhập theo cặp (tên, IP), kiểm `Host` và giới hạn kết nối theo nguồn, nhưng không được thiết kế để đứng trực tiếp trước Internet (botnet nhiều IP, quét mật khẩu SSH, khai thác lỗ chưa biết của CivetWeb/Mbed TLS).
- Cổng runtime dùng: **8080/TCP** (HTTP, trang vận hành, live), **8443/TCP** (HTTPS, Studio, đăng nhập, nạp xuống), **8446/UDP** (tìm thiết bị, chỉ cần trong LAN). SSH: **22/TCP**, chỉ cho LAN quản trị hoặc VPN.

## 2. Đóng port-forward 9080 và 22

Trên router (giao diện quản trị của router, mục NAT/Port Forwarding/Virtual Server): xóa mọi luật chuyển tới `<IP-LAN>`, đặc biệt:

- `<cổng-ngoài>` → `<IP-LAN>:8080` (thường đặt cổng ngoài 9080): HTTP **không mã hóa**: ai nghe được đường truyền đọc được dữ liệu xem, và nếu `viewerLogin` đang `off` thì ai biết địa chỉ cũng xem được trang.
- `<cổng-ngoài>` → `<IP-LAN>:22`: SSH root ra Internet là mục tiêu quét mật khẩu liên tục.
- Nếu có `<cổng-ngoài>` → `<IP-LAN>:8443`: cũng đóng (dùng VPN, mục 3).

Kiểm từ một máy **ngoài** mạng nhà máy (mạng di động, không VPN):

```sh
nc -vz -w 5 <IP-công-cộng> <cổng-ngoài>     # mong đợi: timed out hoặc refused, cho từng cổng đã xóa
```

Một số router 4G (và modem Quectel trên chính BL335) có thể có NAT riêng: kiểm cả `iptables -t nat -S` và `nft list ruleset` trên BL335, không chỉ router. Đóng port-forward làm mất đường vào từ xa mà dự án đang dùng: **chỉ làm sau khi VPN (mục 3) chạy được**, và sau khi cập nhật runtime không cần SSH mật khẩu (OTA đạt kiểm, T122).

## 3. VPN cho truy cập từ xa

- Dùng VPN ở router của nhà máy (WireGuard, OpenVPN hoặc IPsec, tùy router) hoặc một cổng VPN riêng; máy kỹ sư vào LAN qua VPN rồi dùng Studio như ở LAN. Không cài VPN trên BL335 nếu router làm được (thêm tiến trình, thêm bề mặt).
- Mỗi người một khóa/tài khoản VPN, thu hồi được; không chia sẻ một cấu hình chung.
- Mạng con của VPN nên nằm trong `10.0.0.0/8`, `172.16.0.0/12` hoặc `192.168.0.0/16` để bộ lọc nguồn của trang (`viewerAccess: private`, ADR-018) coi nó là mạng riêng. Router làm SNAT cho VPN thì mọi người dùng VPN có **cùng một IP nguồn** trên BL335: xem giới hạn theo nguồn ở mục 5.
- Kiểm: từ máy qua VPN, `https://<IP-LAN>:8443` (Studio thêm thiết bị bằng IP) và trang `http://<IP-LAN>:8080` mở được; từ ngoài không VPN thì không.

## 4. SSH: chỉ khóa công khai, root không đăng nhập bằng mật khẩu

BL335 chạy Ubuntu 20.04 (OpenSSH 8.2), `sshd_config` gốc có `Include /etc/ssh/sshd_config.d/*.conf` ở **đầu** tệp và sshd dùng giá trị **đầu tiên** gặp: một tệp trong `sshd_config.d` thắng các dòng sau trong `sshd_config`. Runtime đọc theo đúng luật này (mục 5h của [mat-runtime.md](mat-runtime.md)).

1. **Trên máy kỹ sư** (Windows 10/11 có OpenSSH sẵn), tạo khóa nếu chưa có:

   ```powershell
   ssh-keygen -t ed25519 -C "ten-ky-su@cong-ty"
   type $env:USERPROFILE\.ssh\id_ed25519.pub
   ```

   Đặt passphrase cho khóa. Mỗi người một khóa.
2. **Trên BL335** (phiên SSH đang mở, root): thêm khóa công khai.

   ```sh
   install -d -m 700 /root/.ssh
   printf '%s\n' 'ssh-ed25519 AAAA... ten-ky-su@cong-ty' >> /root/.ssh/authorized_keys
   chmod 600 /root/.ssh/authorized_keys
   ```

3. **Thử đăng nhập bằng khóa ở một cửa sổ mới**, giữ nguyên phiên cũ: `ssh -o PreferredAuthentications=publickey root@<IP-LAN>`. Chỉ đi tiếp khi vào được.
4. Tạo `/etc/ssh/sshd_config.d/10-mat-hardening.conf`:

   ```text
   # mAT SCADA: SSH chỉ bằng khóa (docs/deployment/hardening.md mục 4)
   PermitRootLogin prohibit-password
   PasswordAuthentication no
   ChallengeResponseAuthentication no
   PubkeyAuthentication yes
   PermitEmptyPasswords no
   MaxAuthTries 3
   LoginGraceTime 30
   X11Forwarding no
   ```

   (`ChallengeResponseAuthentication` là tên của OpenSSH 8.2; bản từ 8.7 gọi là `KbdInteractiveAuthentication`.) Kiểm cú pháp và giá trị hiệu lực rồi nạp lại (không khởi động lại, phiên đang mở không bị cắt):

   ```sh
   sshd -t && sshd -T | grep -E '^(permitrootlogin|passwordauthentication|challengeresponseauthentication) '
   systemctl reload ssh
   ```

   Mong đợi: `permitrootlogin without-password` (tên cũ của `prohibit-password`), `passwordauthentication no`.
5. Thử lại bằng khóa ở cửa sổ mới; thử bằng mật khẩu phải bị từ chối: `ssh -o PubkeyAuthentication=no root@<IP-LAN>` → `Permission denied (publickey)`.
6. Runtime đọc lại cấu hình SSH 10 phút một lần: cảnh báo `SSH_ROOT_PASSWORD` trong `system/info.warnings` mất sau tối đa 10 phút (hoặc ngay sau `systemctl restart mat-runtime`).

**Hoàn tác:** `rm /etc/ssh/sshd_config.d/10-mat-hardening.conf && sshd -t && systemctl reload ssh` (từ phiên còn mở, hoặc từ console).

Ghi chú: cảnh báo của runtime chỉ xét `PermitRootLogin` và `PasswordAuthentication` ngoài khối `Match`; khối `Match User root` hoặc `KbdInteractiveAuthentication` không được xét (giới hạn ghi ở T049). Nên tránh `Match` cho root.

## 5. Giới hạn kết nối theo nguồn ở tầng mạng (`nft`, `ct count`)

Runtime đã tự giới hạn: `maxConnPerSource` (mặc định **48**, 4–64) kết nối đồng thời mỗi IP nguồn, đếm chung HTTP, HTTPS và WebSocket ngay lúc `accept()`, trước bắt tay TLS; giá trị áp dụng không quá **75 %** `httpsThreads` (mặc định **64**), nên một nguồn luôn để lại 16 worker cho nguồn khác. Mặc định trước đây (24 trên 40 worker, trần 60 %) làm hỏng trường hợp 10 trang cùng nằm sau một địa chỉ (NAT, VPN có SNAT) bấm F5 cùng lúc: đỉnh 41 kết nối từ một IP. Số đo và đánh đổi (khoảng 24 luồng thêm, RSS ước dưới 2 MB, chưa đo trên BL335): [ADR-010](../adr/010-device-discovery-https.md), mục "Worker HTTPS 40 → 64".

Luật `nft` là lớp thứ hai, ở kernel: chặn trước khi tới tiến trình (cả cổng SSH), và vẫn chặn khi runtime bị cấu hình sai. Ngưỡng ở tầng mạng phải **cao hơn** `maxConnPerSource` một chút, để runtime (đóng sạch, có đếm) xử lý trường hợp thường và `nft` chỉ chặn lũ: mẫu dưới dùng 56 (= 48 + 8). Nếu đổi `maxConnPerSource`, đổi ngưỡng này theo.

Điều kiện: kernel BL335 (5.4) có `nf_conncount`; gói `nftables` có thể chưa cài (`apt-get install nftables` cần mạng). Kiểm trước: `nft --version` và `modprobe nf_conncount && lsmod | grep nf_conncount`. Không có thì bỏ qua mục này (runtime vẫn tự giới hạn).

Tệp mẫu `/etc/mat-runtime/nft-guard.nft` (bảng riêng `inet mat_guard`, không đụng luật khác; chính sách mặc định `accept` để một luật sai không khóa SSH):

```text
#!/usr/sbin/nft -f
# mAT SCADA: giới hạn kết nối theo nguồn (docs/deployment/hardening.md mục 5)
table inet mat_guard
delete table inet mat_guard

table inet mat_guard {
    # mạng được vào SSH và tìm thiết bị: sửa theo LAN quản trị và mạng VPN của nhà máy
    set mgmt_v4 {
        type ipv4_addr; flags interval
        elements = { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 }
    }
    set web_conn_v4 { type ipv4_addr; size 4096; flags dynamic; }
    set web_conn_v6 { type ipv6_addr; size 4096; flags dynamic; }
    set ssh_conn_v4 { type ipv4_addr; size 1024; flags dynamic; }

    chain input {
        type filter hook input priority 0; policy accept;
        iif "lo" accept
        ct state established,related accept

        # web (8080 HTTP, 8443 HTTPS): tối đa 56 kết nối đồng thời mỗi IP nguồn
        tcp dport { 8080, 8443 } ct state new add @web_conn_v4 { ip saddr ct count over 56 } reject with tcp reset
        tcp dport { 8080, 8443 } ct state new add @web_conn_v6 { ip6 saddr ct count over 56 } reject with tcp reset

        # SSH: chỉ từ mạng quản trị, tối đa 4 kết nối đồng thời mỗi IP
        tcp dport 22 ip saddr != @mgmt_v4 drop
        tcp dport 22 ct state new add @ssh_conn_v4 { ip saddr ct count over 4 } reject with tcp reset

        # tìm thiết bị (UDP 8446): chỉ trong LAN
        udp dport 8446 ip saddr != @mgmt_v4 drop
    }
}
```

Áp dụng **có lưới an toàn** (tự gỡ sau 3 phút nếu bạn bị khóa ngoài):

```sh
nft -c -f /etc/mat-runtime/nft-guard.nft               # chỉ kiểm cú pháp
systemd-run --on-active=180 --unit=mat-nft-undo nft delete table inet mat_guard
nft -f /etc/mat-runtime/nft-guard.nft
# trong 3 phút: mở SSH mới, mở Studio và trang vận hành; tất cả đạt thì hủy lệnh tự gỡ:
systemctl stop mat-nft-undo.timer
nft list table inet mat_guard
```

Giữ qua khởi động lại: tạo `/etc/systemd/system/mat-nft-guard.service` (oneshot, `ExecStart=/usr/sbin/nft -f /etc/mat-runtime/nft-guard.nft`, `After=network-pre.target`, `WantedBy=multi-user.target`) rồi `systemctl enable mat-nft-guard`. **Không** sửa `/etc/nftables.conf` mặc định của Ubuntu: nó bắt đầu bằng `flush ruleset` và sẽ xóa luật của thành phần khác (modem, NAT). Kiểm số kết nối đang đếm: `nft list set inet mat_guard web_conn_v4`.

**Hoàn tác:** `nft delete table inet mat_guard`, `systemctl disable --now mat-nft-guard`, xóa hai tệp.

Lưu ý: IPv6 của SSH không có luật trong mẫu (BL335 thường không có IPv6 toàn cầu); nếu có, thêm `set mgmt_v6` tương tự. Luật không lọc lưu lượng ra (Modbus TCP tới PLC, DB ngoài).

## 6. `viewerLogin: required` khi ra ngoài LAN

Mặc định `viewerLogin: off`: ai trong mạng riêng (`viewerAccess: private`) mở được trang vận hành và xem dữ liệu không cần đăng nhập. Khi bất kỳ người xem nào ở ngoài LAN (VPN của nhà thầu, mạng văn phòng nối vào, port-forward chưa đóng):

```json
{ "viewerLogin": "required", "viewerAccess": "private", "hostCheck": "strict" }
```

trong `/etc/mat-runtime/runtime.json`, rồi `systemctl restart mat-runtime`; tạo tài khoản `viewer` cho người xem (`--user-add`, mục 5b của [mat-runtime.md](mat-runtime.md)). Kiểm: mở trang từ trình duyệt mới thì bị chuyển tới `/login`; `system/info.warnings` không có `VIEWER_PUBLIC`.

- Giữ `hostCheck: "strict"` (mặc định). Nếu người dùng mở trang bằng **tên** (DNS nội bộ) thay vì IP, khai tên đó ở `allowedHosts` (mục 5h của [mat-runtime.md](mat-runtime.md)); không tắt kiểm `Host`.
- Không đặt `viewerAccess: "any"` khi thiết bị nhìn thấy được từ ngoài.

## 7. IP tĩnh

Chứng chỉ HTTPS tự sinh có SAN là IP của các card lúc sinh; Studio lưu thiết bị theo địa chỉ; người vận hành đánh dấu trang. IP đổi thì Chrome báo lỗi chứng chỉ (`TLS_SAN_MISMATCH`) và Studio mất thiết bị. Chọn một trong hai:

- **Giữ IP ở DHCP của router** (DHCP reservation theo địa chỉ MAC của BL335): không đổi gì trên thiết bị, dễ hoàn tác. Nên dùng khi router của nhà máy cho phép.
- **IP tĩnh trên BL335**: xem công cụ mạng đang dùng (`ls /etc/netplan/`, `nmcli general status`, `cat /etc/network/interfaces`) và đặt theo công cụ đó; làm từ console hoặc với lưới an toàn như mục 5, vì đặt sai là mất kết nối. Ví dụ netplan (`/etc/netplan/60-mat-static.yaml`, giá trị là chỗ giữ chỗ):

  ```yaml
  network:
    version: 2
    ethernets:
      eth0:
        dhcp4: false
        addresses: [<IP-LAN>/24]
        gateway4: <IP-router>
        nameservers: { addresses: [<IP-DNS>] }
  ```

  `netplan try` (tự quay về sau 120 s nếu không xác nhận), rồi `netplan apply`.

Sau khi đổi IP: `mat-runtime --regen-cert` (Studio phải ghim lại fingerprint mới) hoặc dùng chứng chỉ của CA khách hàng (mục 5d của [mat-runtime.md](mat-runtime.md)).

## 8. Đồng bộ giờ (NTP)

Giờ sai làm sai dấu thời gian lịch sử, alarm, audit, lịch của logic và hạn phiên. BL335 không có pin RTC trên bản đã kiểm, nên sau mất điện giờ chỉ đúng khi có NTP.

- Ubuntu 20.04 dùng `systemd-timesyncd`. Đặt máy chủ NTP nội bộ của nhà máy (hoặc của router) trong `/etc/systemd/timesyncd.conf`, mục `[Time]`: `NTP=<IP-máy-chủ-NTP>`; rồi `systemctl restart systemd-timesyncd`. Mạng OT không ra Internet thì phải có NTP nội bộ.
- Kiểm: `timedatectl` cho `System clock synchronized: yes`; `system/info.timeSynced` là `true`, không có cảnh báo `TIME_NOT_SYNCED` (runtime kiểm mỗi phút).
- Múi giờ của lịch logic là `tzOffsetMin` trong `runtime.json` (mặc định 420, UTC+7), không phụ thuộc múi giờ hệ thống.

## 9. Quyền tập tin

`deploy.sh` đặt đúng các quyền dưới đây; kiểm lại sau khi sửa tay hoặc chép tệp:

| Đường dẫn | Chủ | Quyền | Ghi chú |
|---|---|---|---|
| `/opt/mat-runtime/` | `root:root` | thư mục 755, tệp 644, `bin/mat-runtime` 755 | runtime không ghi được mã của chính nó |
| `/etc/mat-runtime/` | `root:root` | 755 | `ReadOnlyPaths` trong unit |
| `/etc/mat-runtime/runtime.json` | `root:root` | 644 | không chứa bí mật |
| `/etc/mat-runtime/users.json` | `root:matscada` | 640 | runtime từ chối khi nhóm ghi được hoặc chủ không phải root |
| `/etc/mat-runtime/secrets.json` | `root:matscada` | 640 | mật khẩu DB ngoài |
| `/var/lib/mat-runtime/` | `matscada:matscada` | 700 | `StateDirectoryMode=0700`; dữ liệu, `tls/server.pem` (600), `pulse.journal` (600), `retain/` |
| `/root/.ssh/authorized_keys` | `root:root` | 600 | thư mục `/root/.ssh` 700 |

Kiểm nhanh:

```sh
stat -c '%U:%G %a %n' /etc/mat-runtime/* /var/lib/mat-runtime /var/lib/mat-runtime/tls/server.pem
find /opt/mat-runtime /etc/mat-runtime -perm -o+w      # mong đợi: không in gì
find /var/lib/mat-runtime ! -user matscada              # mong đợi: không in gì
```

Không thêm tài khoản `matscada` vào nhóm `sudo`; không chạy runtime bằng root. Unit systemd (`deployment/systemd/mat-runtime.service`) đã có sandbox (`ProtectSystem=strict`, `NoNewPrivileges`, `CapabilityBoundingSet=` rỗng, `DevicePolicy=closed`): không sửa các dòng đó; cần thêm cổng serial thì dùng drop-in riêng.

## 10. Khuyến nghị bàn thử

- Làm toàn bộ mục 2–9 trên một BL335 ở bàn thử trước, ghi lại lệnh đã chạy và thời gian; thử khởi động lại thiết bị và mất điện một lần để chắc luật `nft`, IP tĩnh, NTP và SSH còn đúng sau khi lên lại.
- Sau mỗi bước, chạy kiểm của bước đó và xem `system/info.warnings`.
- Trên thiết bị ở nhà máy: làm vào giờ dừng máy, có người cạnh thiết bị (console), một phiên SSH mở suốt quá trình.
- Lưu cách hoàn tác của từng bước cạnh nhật ký thay đổi của thiết bị.
