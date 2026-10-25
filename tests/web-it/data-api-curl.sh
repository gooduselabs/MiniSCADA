#!/bin/sh
# Phần curl của kịch bản web-it `data-api` (feature 025, specs/025-data-api T042): chạy TRONG container rt (có curl và
# openssl), do tools/web-it.ps1 gọi bằng `docker exec -e MAT_IT_PW_ADMIN`. Gọi API dữ liệu đúng như tài liệu hướng dẫn
# (docs/user/data-api.md): curl với header Authorization: Bearer matk_…, khóa công khai của thiết bị được ghim
# (--pinnedpubkey, không tắt kiểm). Quản trị viên lấy token phiên Bearer, tạo một key ghi được (có mật khẩu xác nhận),
# key đọc giá trị, ghi TANK01.SP, hỏi kết quả, thu hồi, rồi bị từ chối. In đúng một dòng JSON:
#   {"scenario":"data-api-curl","checks":[{name,pass,detail}],"pass":bool}
# Mật khẩu chỉ từ môi trường; token và mật khẩu không in ra.
set -u
BASE=https://127.0.0.1:8443
CHECKS=''
ALL=true

check() { # tên, 0|1, chi tiết
  pass=false
  [ "$2" = 1 ] && pass=true
  [ "$pass" = true ] || ALL=false
  d=$(printf '%s' "$3" | tr -d '"\\\n\r' | cut -c1-200)
  item=$(printf '{"name":"%s","pass":%s,"detail":"%s"}' "$1" "$pass" "$d")
  if [ -z "$CHECKS" ]; then CHECKS=$item; else CHECKS="$CHECKS,$item"; fi
}
finish() {
  printf '{"scenario":"data-api-curl","checks":[%s],"pass":%s}\n' "$CHECKS" "$ALL"
  exit 0
}
field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" | head -1; }
num() { sed -n "s/.*\"$1\":\\([0-9][0-9]*\\).*/\\1/p" | head -1; }

[ -n "${MAT_IT_PW_ADMIN:-}" ] || { check 'có mật khẩu admin' 0 'MAT_IT_PW_ADMIN rỗng'; finish; }
command -v curl >/dev/null && command -v openssl >/dev/null || {
  check 'có curl và openssl' 0 ''
  finish
}

# Khóa công khai của thiết bị: sha256 base64 của SubjectPublicKeyInfo (dạng --pinnedpubkey của curl).
PIN=$(openssl x509 -in /data/tls/server.pem -pubkey -noout | openssl pkey -pubin -outform der |
  openssl dgst -sha256 -binary | base64)
CURL="curl -s -k --pinnedpubkey sha256//$PIN --max-time 10"
check 'ghim khóa công khai của thiết bị' "$([ -n "$PIN" ] && echo 1 || echo 0)" ''

# Token phiên của quản trị viên (Bearer): API quản trị nhận cả Bearer.
LOGIN=$(printf '{"user":"admin","password":"%s"}' "$MAT_IT_PW_ADMIN" |
  $CURL -X POST -H 'Content-Type: application/json' --data-binary @- "$BASE/api/v1/auth/login")
ADM=$(printf '%s' "$LOGIN" | field token)
check 'admin đăng nhập Bearer' "$([ -n "$ADM" ] && echo 1 || echo 0)" ''
[ -n "$ADM" ] || finish

REV=$($CURL -H "Authorization: Bearer $ADM" "$BASE/api/v1/admin/apikeys" | num rev)
MADE=$(printf '{"rev":%s,"name":"curl ghi","role":"operator","readOnly":false,"allowFrom":["127.0.0.1"],"reauth":"%s"}' \
  "${REV:-0}" "$MAT_IT_PW_ADMIN" |
  $CURL -X POST -H "Authorization: Bearer $ADM" -H 'Content-Type: application/json' --data-binary @- \
    "$BASE/api/v1/admin/apikeys")
KEY=$(printf '%s' "$MADE" | field token)
KID=$(printf '%s' "$MADE" | sed -n 's/.*"key":{[^}]*"id":"\([0-9a-f]*\)".*/\1/p')
check 'tạo key bằng curl (Bearer admin + mật khẩu)' "$(case $KEY in matk_*) echo 1 ;; *) echo 0 ;; esac)" "id=$KID"
[ -n "$KEY" ] || finish
AUTH="Authorization: Bearer $KEY"

CODE=$($CURL -o /tmp/v.json -w '%{http_code}' -H "$AUTH" "$BASE/api/v1/data/values?tags=TANK01.LEVEL")
check 'curl GET data/values: 200 và có quality' "$([ "$CODE" = 200 ] && grep -q '"quality"' /tmp/v.json && echo 1 || echo 0)" "$CODE $(cut -c1-120 /tmp/v.json)"

RID=$(cat /proc/sys/kernel/random/uuid)
CODE=$($CURL -o /tmp/w.json -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"requests\":[{\"requestId\":\"$RID\",\"tag\":\"TANK01.SP\",\"value\":33.5}]}" "$BASE/api/v1/data/write")
check 'curl POST data/write: 200 ACCEPTED' "$([ "$CODE" = 200 ] && grep -q '"ACCEPTED"' /tmp/w.json && echo 1 || echo 0)" "$CODE $(cut -c1-160 /tmp/w.json)"
STATUS=''
i=0
while [ $i -lt 40 ]; do
  STATUS=$($CURL -H "$AUTH" "$BASE/api/v1/data/write/$RID" | field status)
  [ "$STATUS" != ACCEPTED ] && [ -n "$STATUS" ] && break
  sleep 0.25
  i=$((i + 1))
done
check 'curl GET data/write/{id}: CONFIRMED' "$([ "$STATUS" = CONFIRMED ] && echo 1 || echo 0)" "$STATUS"

CODE=$($CURL -o /dev/null -w '%{http_code}' -H "$AUTH" "http://127.0.0.1:8080/api/v1/data/key" --proto-default http)
check 'curl HTTP thường: 403' "$([ "$CODE" = 403 ] && echo 1 || echo 0)" "$CODE"

REV=$($CURL -H "Authorization: Bearer $ADM" "$BASE/api/v1/admin/apikeys" | num rev)
CODE=$($CURL -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $ADM" -H 'Content-Type: application/json' \
  -d "{\"rev\":${REV:-0}}" "$BASE/api/v1/admin/apikeys/$KID/revoke")
check 'curl thu hồi key: 200' "$([ "$CODE" = 200 ] && echo 1 || echo 0)" "$CODE"
CODE=$($CURL -o /tmp/r.json -w '%{http_code}' -H "$AUTH" "$BASE/api/v1/data/values?tags=TANK01.LEVEL")
check 'key đã thu hồi: 401 APIKEY_INVALID' "$([ "$CODE" = 401 ] && grep -q APIKEY_INVALID /tmp/r.json && echo 1 || echo 0)" "$CODE"
rm -f /tmp/v.json /tmp/w.json /tmp/r.json
finish
