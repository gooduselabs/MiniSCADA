// Chuỗi giao diện của driver MQTT client (feature 022): form kênh và broker, Bảng Tag với topic và đường dẫn JSON, Chẩn
// đoán driver, lý do quality và lỗi của bộ kiểm tra. Gộp vào viMessages ở vi.ts; quy ước như vi.ts. Câu của lý do quality
// theo schemas/error-codes.json (viết thường đầu câu như tagReason.* khác).
export const viMqtt = {
  // ---- Kết nối: kênh MQTT ----
  'cn.kind.mqtt': 'MQTT',
  'cn.add.mqtt': 'Thêm kênh MQTT',
  'cn.newBroker': 'Broker {n}',
  'cn.h.mqttHost': 'Tên hoặc IP của broker MQTT, ví dụ 192.0.2.30 hoặc broker.nha-may.local.',
  'cn.h.mqttPort': '1–65535. Mặc định 1883; 8883 khi bật TLS và để trống ô này.',
  'cn.f.mqttClientId': 'Client id',
  'cn.h.mqttClientId':
    'Chữ, số, _ . -, tối đa 64 ký tự; mỗi client trên broker phải khác nhau. Trống: mat-<id kênh>.',
  'cn.f.mqttTls': 'TLS',
  'cn.h.mqttTls':
    'Mã hóa kết nối (TLS 1.2/1.3). Cần ghim chứng chỉ broker (SHA-256) hoặc CA trong tệp: không có thì runtime không kết nối.',
  'cn.f.mqttCertSha256': 'Chứng chỉ broker (SHA-256)',
  'cn.h.mqttCertSha256':
    '64 chữ số hex, SHA-256 của chứng chỉ broker (DER), ví dụ từ openssl x509 -noout -fingerprint -sha256. Runtime chỉ kết nối broker có đúng chứng chỉ này.',
  'cn.f.mqttServerName': 'Tên máy (SNI)',
  'cn.h.mqttServerName':
    'Tên gửi trong bắt tay TLS và đối chiếu với chứng chỉ khi dùng CA. Trống: host của kênh.',
  'cn.f.mqttUsername': 'Tên đăng nhập',
  'cn.h.mqttUsername': 'Tài khoản trên broker MQTT; cần cùng mã bí mật.',
  'cn.f.mqttSecretId': 'Mã bí mật (secretId)',
  'cn.h.mqttSecretId':
    'Mật khẩu không nằm trong project. Đặt trên thiết bị bằng lệnh mat-runtime --set-secret <secretId>, ví dụ mqtt-mqtt1.',
  'cn.f.mqttKeepAliveS': 'Keepalive',
  'cn.h.mqttKeepAliveS':
    '5–3600 s. Mặc định 30. Runtime gửi PINGREQ khi không có gì để gửi; broker im quá 1,5 lần thì kết nối lại.',
  'cn.f.mqttCleanSession': 'Clean session',
  'cn.h.mqttCleanSession':
    'Bật (mặc định): broker không giữ subscription và tin QoS 1 khi runtime mất kết nối.',
  'cn.f.mqttWillTopic': 'Topic di chúc (LWT)',
  'cn.h.mqttWillTopic':
    'Broker gửi tin này khi runtime mất kết nối bất thường, ví dụ mat/tram1/status. Không có + hay #.',
  'cn.f.mqttWillPayload': 'Nội dung di chúc',
  'cn.h.mqttWillPayload': 'Tối đa 1024 ký tự, ví dụ offline.',
  'cn.f.mqttWillQos': 'QoS di chúc',
  'cn.h.mqttWillQos': '0 hoặc 1.',
  'cn.f.mqttWillRetain': 'Giữ di chúc (retain)',
  'cn.h.mqttWillRetain': 'Broker giữ tin di chúc cho client subscribe sau.',
  'cn.f.mqttMaxPublishPerS': 'Giới hạn publish',
  'cn.h.mqttMaxPublishPerS':
    '1–1000 tin mỗi giây cho mọi publish của kênh (ghi Tag và nhóm). Mặc định 20.',
  'cn.h.mqttConnectTimeoutMs': '500–30000 ms. Mặc định 5000. Gồm TCP và bắt tay TLS.',
  'cn.f.mqttStaleAfterMs': 'Quá hạn dữ liệu',
  'cn.h.mqttStaleAfterMs':
    '0–86400000 ms. Không có tin mới cho Tag quá thời gian này thì Tag UNCERTAIN (giữ giá trị cuối). 0: không xét.',
  'cn.h.mqttTimeoutMs': '100–10000 ms. Mặc định 2000. Thời hạn chờ CONNACK, SUBACK, PUBACK.',
  'cn.err.mqttHost': 'Host: chữ, số, dấu chấm, gạch nối, hai chấm (IPv6)',
  'cn.err.mqttClientId': 'Client id: chữ, số, _ . -, 1–64 ký tự',
  'cn.err.mqttTopic': 'Topic publish không được có + hay #',
  'cn.mqtt.oneDevice': 'Mỗi kênh MQTT là một broker: thêm kênh MQTT mới cho broker khác',
  'cn.mqtt.needsPin':
    'TLS bật mà chưa ghim chứng chỉ broker: runtime sẽ không kết nối. Điền SHA-256 của chứng chỉ broker.',
  'cn.mqtt.plainPassword': 'Mật khẩu đi trên kết nối không mã hóa: nên bật TLS.',
  'cn.mqtt.secretNote':
    'Đặt mật khẩu trên thiết bị: mat-runtime --set-secret {id} (gõ mật khẩu ở dòng tiếp theo). Studio không lưu mật khẩu.',
  'cn.mqtt.probeNote':
    'Kênh MQTT không có Thử kết nối: nạp xuống rồi xem Chẩn đoán driver (trạng thái broker, số tin vào/ra).',
  'cn.mqtt.groupsNote':
    'Nhóm publish (publishGroups: đẩy nhiều Tag thành một tin JSON theo chu kỳ hoặc khi đổi) và CA (tls.caCertPem) sửa trong tệp connections.json; xem hướng dẫn kỹ sư §4.',

  // ---- Bảng Tag: topic ----
  'tt.err.mqttAddress':
    'Địa chỉ MQTT: [sub:|pub:|both:]topic[|$.đường.dẫn][;qos=0|1][;retain]. + chiếm trọn một cấp, # chỉ ở cuối; pub/both không có wildcard',
  'tt.err.mqttQos': 'QoS chỉ 0 hoặc 1',
  'tt.hint.mqttSyntax':
    'Topic MQTT: plant/tank1/level, sensors/+/data|$.temp, pub:plant/cmd/sp;qos=1, both:plant/mode;retain',
  'tt.hint.mqttAddress': '{dir} · topic {topic}{path} · QoS {qos}',
  'tt.mqttDir.sub': 'nhận',
  'tt.mqttDir.pub': 'gửi khi ghi',
  'tt.mqttDir.both': 'nhận và gửi',
  'tt.mqttPath': '· trường {path}',
  'tt.err.mqttByteOrder': 'Tag MQTT không có thứ tự byte (giá trị là chữ hoặc JSON)',

  // ---- Chẩn đoán driver ----
  'dd.kind.mqtt': 'MQTT',
  'dd.mqtt.broker': 'Broker',
  'dd.mqtt.tls': 'TLS',
  'dd.mqtt.clientId': 'Client id',
  'dd.mqtt.subscriptions': 'Số subscription',
  'dd.mqtt.groups': 'Số nhóm publish',
  'dd.mqtt.messagesIn': 'Tin nhận',
  'dd.mqtt.messagesOut': 'Tin gửi',
  'dd.mqtt.dropped': 'Tin bỏ (quá lớn hoặc hỏng)',
  'dd.mqtt.serverCertSha256': 'Chứng chỉ broker',

  // ---- Lý do quality và lỗi kênh (schemas/error-codes.json) ----
  'tagReason.MQTT_STALE': 'quá hạn không có tin MQTT mới (giữ giá trị cuối)',
  'tagReason.MQTT_PAYLOAD':
    'tin MQTT không đổi được thành giá trị của Tag (không phải số, ngoài miền, JSON hỏng hoặc thiếu trường)',
  'tagReason.MQTT_SUBSCRIBE_REFUSED': 'broker MQTT từ chối subscribe topic này (ACL)',
  'tagReason.MQTT_AUTH_FAILED': 'broker MQTT từ chối đăng nhập',
  'tagReason.MQTT_CONNECT_REFUSED': 'broker MQTT từ chối kết nối',
  'tagReason.MQTT_CERT_UNTRUSTED': 'chứng chỉ broker MQTT khác chứng chỉ đã ghim hoặc chưa ghim',
  'tagReason.MQTT_TLS_FAILED': 'bắt tay TLS với broker MQTT thất bại',
  'tagReason.MQTT_SECRET_MISSING': 'chưa có mật khẩu của kênh MQTT trên thiết bị',

  // ---- Lỗi của bộ kiểm tra ----
  'issue.E_MQTT_TLS':
    'kênh MQTT: chứng chỉ ghim, CA hay tên máy chỉ dùng khi bật TLS (tls.enabled true)',
  'issue.E_MQTT_DIRECTION':
    'Tag MQTT: Tag ghi được cần pub: hoặc both: ở đầu địa chỉ; Tag pub: cần quyền RW',
  'issue.E_MQTT_GROUP_TAG': 'nhóm publish MQTT có Tag không tồn tại',
  'issue.W_MQTT_TLS_NOT_PINNED':
    'kênh MQTT bật TLS nhưng chưa ghim chứng chỉ broker hay CA: runtime sẽ không kết nối',
  'issue.W_MQTT_PLAIN_PASSWORD': 'kênh MQTT gửi tài khoản và mật khẩu trên kết nối không TLS',
  'issue.E_ADDR_SYNTAX.mqtt':
    'địa chỉ MQTT không đúng cú pháp (ví dụ plant/+/level, sensors/t1|$.data.temp, pub:plant/cmd/sp)',
  'issue.E_ADDR_RANGE.mqtt': 'QoS của địa chỉ MQTT chỉ 0 hoặc 1',
  'issue.E_SCHEMA.mqttByteOrder': 'Tag MQTT không có thứ tự byte',
} as const;
