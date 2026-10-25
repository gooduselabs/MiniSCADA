// Chuỗi giao diện của driver OPC UA client (feature 019, US5): form kênh và server, Lấy chứng chỉ, Duyệt node, Bảng Tag
// với NodeId, Chẩn đoán driver, lý do quality và lỗi của bộ kiểm tra. Gộp vào viMessages ở vi.ts; quy ước như vi.ts. Câu
// của lý do quality theo schemas/error-codes.json (viết thường đầu câu như tagReason.* khác).
export const viOpcUa = {
  // ---- Kết nối: kênh OPC UA ----
  'cn.kind.opcua': 'OPC UA',
  'cn.add.opcua': 'Thêm kênh OPC UA',
  'cn.newServer': 'Server {n}',
  'cn.f.endpointUrl': 'Endpoint',
  'cn.h.endpointUrl':
    'opc.tcp://máy:cổng[/đường dẫn], ví dụ opc.tcp://192.168.0.20:4840. Cổng mặc định của OPC UA là 4840.',
  'cn.f.securityMode': 'Chế độ bảo mật',
  'cn.h.securityMode':
    'None: không ký, không mã hóa. Sign: ký. SignAndEncrypt: ký và mã hóa (khuyến nghị khi server hỗ trợ).',
  'cn.f.securityPolicy': 'Security policy',
  'cn.h.securityPolicy':
    'None đi với chế độ None; Basic256Sha256 đi với Sign và SignAndEncrypt. Chứng chỉ client tự sinh trên thiết bị.',
  'cn.f.authMode': 'Xác thực',
  'cn.h.authMode': 'anonymous: không đăng nhập. username: tên đăng nhập và mật khẩu của server.',
  'cn.f.username': 'Tên đăng nhập',
  'cn.h.username': 'Tên tài khoản trên server OPC UA.',
  'cn.f.secretId': 'Mã bí mật (secretId)',
  'cn.h.secretId':
    'Mật khẩu không nằm trong project. Đặt trên thiết bị bằng lệnh mat-runtime --set-secret <secretId>, ví dụ opcua-ua-1.',
  'cn.f.serverCertSha256': 'Chứng chỉ server đã tin (SHA-256)',
  'cn.h.serverCertSha256':
    '64 chữ số hex. Bấm Lấy chứng chỉ rồi Tin chứng chỉ này để điền; runtime chỉ kết nối với server có đúng chứng chỉ này.',
  'cn.f.readMode': 'Cách đọc',
  'cn.h.readMode':
    'subscription: server gửi khi giá trị đổi (mặc định). poll: đọc định kỳ theo nhóm quét, cho server không hỗ trợ subscription.',
  'cn.f.sessionTimeoutMs': 'Hạn session',
  'cn.h.sessionTimeoutMs': '10000–3600000 ms. Mặc định 60000.',
  'cn.h.opcuaConnectTimeoutMs': '500–30000 ms. Mặc định 5000. Gồm mở kênh bảo mật và session.',
  'cn.h.opcuaTimeoutMs':
    '100–10000 ms. Mặc định 2000. Thời hạn của một yêu cầu đọc, ghi tới server.',
  'cn.err.endpoint': 'Endpoint dạng opc.tcp://máy:cổng, ví dụ opc.tcp://192.168.0.20:4840',
  'cn.err.secretId': 'Mã bí mật: chữ thường, số, gạch nối, tối đa 48 ký tự (ví dụ opcua-ua-1)',
  'cn.err.sha256': 'SHA-256 gồm đúng 64 chữ số hex',
  'cn.opcua.securityConflict':
    'Chế độ và policy không khớp: None đi với None; Sign, SignAndEncrypt đi với Basic256Sha256',
  'cn.opcua.needsPin':
    'Chưa tin chứng chỉ server: runtime sẽ không kết nối. Bấm Lấy chứng chỉ ở thẻ Chứng chỉ server.',
  'cn.opcua.plainPassword': 'Mật khẩu đi trên kết nối không mã hóa: nên dùng SignAndEncrypt.',
  'cn.opcua.needs11':
    'Kênh OPC UA cần project định dạng 1.1: project này chưa ở định dạng 1.1 nên chưa nạp xuống được.',
  'cn.opcua.oneDevice': 'Mỗi kênh OPC UA là một server: thêm kênh OPC UA mới cho server khác',
  'cn.opcua.secretNote':
    'Đặt mật khẩu trên thiết bị: mat-runtime --set-secret {id} (gõ mật khẩu ở dòng tiếp theo). Studio không lưu mật khẩu.',
  'cn.opcua.probeTitle': 'Thử kết nối',
  'cn.opcua.probeNote':
    'Kênh OPC UA thử kết nối bằng Lấy chứng chỉ (kết nối tới server, đọc endpoint) và Duyệt node ở trang của kênh.',

  // ---- Chứng chỉ server ----
  'cn.opcua.cert.title': 'Chứng chỉ server',
  'cn.opcua.cert.help':
    'Thiết bị kết nối tới server, đọc endpoint và chứng chỉ. Đối chiếu SHA-256 với màn hình của server trước khi tin.',
  'cn.opcua.cert.fetch': 'Lấy chứng chỉ',
  'cn.opcua.cert.fetching': 'Đang hỏi server qua thiết bị…',
  'cn.opcua.cert.sha': 'SHA-256',
  'cn.opcua.cert.subject': 'Chủ thể',
  'cn.opcua.cert.notAfter': 'Hết hạn',
  'cn.opcua.cert.uri': 'ApplicationUri',
  'cn.opcua.cert.expired': 'Chứng chỉ đã hết hạn (vẫn tin được, chẩn đoán sẽ cảnh báo).',
  'cn.opcua.cert.trust': 'Tin chứng chỉ này',
  'cn.opcua.cert.trusted': 'Đã tin chứng chỉ này',
  'cn.opcua.cert.mismatch':
    'Khác chứng chỉ đang tin trong project: server đã đổi chứng chỉ, hoặc không phải server cũ.',
  'cn.opcua.cert.none': 'Server không gửi chứng chỉ (chỉ có endpoint None).',
  'cn.opcua.cert.endpoints': 'Endpoint của server',
  'cn.opcua.cert.pinnedToast': 'Đã tin chứng chỉ server của kênh {channel}',
  'cn.opcua.fail': 'Không được: {code} · {text}',
  'cn.opcua.rate': 'Hỏi quá nhiều lần mỗi phút; thử lại sau {n} giây',

  // ---- Duyệt node ----
  'cn.opcua.browse.title': 'Duyệt node',
  'cn.opcua.browse.help':
    'Cây địa chỉ của server, đọc qua thiết bị. Chọn biến (Variable) để thêm Tag với NodeId và kiểu gợi ý.',
  'cn.opcua.browse.load': 'Duyệt từ Objects',
  'cn.opcua.browse.loading': 'Đang đọc…',
  'cn.opcua.browse.empty': 'Node này không có node con.',
  'cn.opcua.browse.col.name': 'Tên',
  'cn.opcua.browse.col.node': 'NodeId',
  'cn.opcua.browse.col.type': 'Kiểu',
  'cn.opcua.browse.add': 'Thêm Tag',
  'cn.opcua.browse.update': 'Cập nhật Tag',
  'cn.opcua.browse.addTip': 'Thêm Tag {id} đọc node {node}',
  'cn.opcua.browse.added': 'Đã thêm Tag {id}',
  'cn.opcua.browse.updated': 'Đã cập nhật kiểu của Tag {id}',
  'cn.opcua.browse.truncated': 'Node có hơn 1000 node con: chỉ hiện 1000 node đầu.',
  'cn.opcua.browse.needDevice': 'Kênh chưa có server (thiết bị trường): thêm server trước.',
  'cn.opcua.browse.writable': 'ghi được',
  'cn.opcua.browse.expand': 'Mở {name}',
  'cn.opcua.browse.collapse': 'Gập {name}',

  // ---- Mã trả lời của Lấy chứng chỉ / Duyệt node ----
  'probeCode.NOT_SUPPORTED': 'loại kênh này chưa hỗ trợ Thử kết nối',
  'probeCode.OPCUA_CERT_UNTRUSTED': 'chứng chỉ server chưa được tin hoặc khác chứng chỉ đã tin',
  'probeCode.OPCUA_SECURITY_REJECTED':
    'server từ chối kênh bảo mật (chứng chỉ client chưa được server tin, hoặc policy không hỗ trợ)',
  'probeCode.OPCUA_ENDPOINT_NOT_FOUND':
    'server không có endpoint với chế độ, policy và cách xác thực đã chọn',
  'probeCode.OPCUA_AUTH_FAILED': 'server từ chối đăng nhập',
  'probeCode.OPCUA_SECRET_MISSING':
    'chưa có mật khẩu trên thiết bị: mat-runtime --set-secret <secretId>',
  'probeCode.OPCUA_BROWSE_FAILED': 'không duyệt được node',

  // ---- Bảng Tag: NodeId ----
  'tt.err.opcuaNodeId':
    'NodeId không đúng cú pháp. Ví dụ: ns=2;s=Tank.Level, ns=3;i=1001, i=2258 (không hỗ trợ nsu=)',
  'tt.err.opcuaNodeIdRange': 'NodeId ngoài khoảng (ns 0–65535, i 0–4294967295)',
  'tt.hint.opcuaSyntax':
    'NodeId OPC UA: ns=2;s=Tank.Level, ns=3;i=1001, ns=2;g=<GUID>, ns=2;b=<base64>; hoặc dùng Duyệt node ở trang Kết nối',
  'tt.hint.opcuaNodeId': 'Namespace {ns} · id {idType}',
  'tt.opcuaIdType.i': 'số',
  'tt.opcuaIdType.s': 'chuỗi',
  'tt.opcuaIdType.g': 'GUID',
  'tt.opcuaIdType.b': 'opaque (base64)',
  'tt.err.opcuaByteOrder': 'Tag OPC UA không có thứ tự byte (server gửi giá trị theo kiểu)',

  // ---- Chẩn đoán driver ----
  'dd.kind.opcua': 'OPC UA',
  'dd.ua.endpointUrl': 'Endpoint',
  'dd.ua.securityMode': 'Chế độ bảo mật',
  'dd.ua.securityPolicy': 'Policy',
  'dd.ua.readMode': 'Cách đọc',
  'dd.ua.session': 'Session',
  'dd.ua.publishingMs': 'Chu kỳ publish (ms)',
  'dd.ua.serverCertSha256': 'Chứng chỉ server',
  'dd.ua.clientCertSha256': 'Chứng chỉ client',
  'dd.ua.lastStatus': 'StatusCode lỗi gần nhất',

  // ---- Lý do quality và lỗi kênh (schemas/error-codes.json) ----
  'tagReason.OPCUA_NODE_UNKNOWN': 'server OPC UA không có node này',
  'tagReason.OPCUA_ACCESS_DENIED': 'server OPC UA không cho đọc node này',
  'tagReason.OPCUA_TYPE_MISMATCH':
    'kiểu dữ liệu của node OPC UA không đổi được sang kiểu của Tag (hoặc giá trị ngoài khoảng)',
  'tagReason.OPCUA_BAD_STATUS': 'server OPC UA trả StatusCode Bad (tên mã ở Chẩn đoán driver)',
  'tagReason.OPCUA_UNCERTAIN': 'server OPC UA trả StatusCode Uncertain',
  'tagReason.OPCUA_CERT_UNTRUSTED':
    'chứng chỉ server OPC UA chưa được tin hoặc khác chứng chỉ đã tin',
  'tagReason.OPCUA_SECURITY_REJECTED': 'server OPC UA từ chối kênh bảo mật',
  'tagReason.OPCUA_ENDPOINT_NOT_FOUND':
    'server OPC UA không có endpoint với chế độ, policy và xác thực đã chọn',
  'tagReason.OPCUA_AUTH_FAILED': 'server OPC UA từ chối đăng nhập',
  'tagReason.OPCUA_SECRET_MISSING': 'chưa có mật khẩu của kênh OPC UA trên thiết bị',

  // ---- Lỗi của bộ kiểm tra ----
  'issue.E_DRIVER_VERSION':
    'kênh của driver mới (OPC UA, MQTT) cần project định dạng 1.1 (nâng cấp project trước khi thêm kênh)',
  'issue.E_OPCUA_SECURITY':
    'kênh OPC UA: chế độ bảo mật và policy không khớp (None với None; Sign, SignAndEncrypt với Basic256Sha256)',
  'issue.E_OPCUA_AUTH':
    'kênh OPC UA: xác thực username cần tên đăng nhập và secretId; anonymous thì bỏ cả hai',
  'issue.W_OPCUA_PLAIN_PASSWORD':
    'kênh OPC UA gửi tên đăng nhập và mật khẩu trên kết nối không mã hóa (chế độ None)',
  'issue.W_OPCUA_CERT_NOT_PINNED':
    'kênh OPC UA có mã hóa nhưng chưa tin chứng chỉ server: runtime sẽ không kết nối',
  'issue.E_ADDR_SYNTAX.opcua':
    'NodeId không đúng cú pháp (ví dụ ns=2;s=Tank.Level, ns=3;i=1001, i=2258)',
  'issue.E_ADDR_RANGE.opcua': 'NodeId ngoài khoảng (ns 0–65535, i 0–4294967295)',
  'issue.E_SCHEMA.opcuaByteOrder': 'Tag OPC UA không có thứ tự byte',
} as const;
