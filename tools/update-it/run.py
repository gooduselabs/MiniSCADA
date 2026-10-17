#!/usr/bin/env python3
"""OTA lab on x64 (feature 011 T120; SC-020, SC-021, SC-022; contracts/update-package.md §4, §6).

Runs inside the toolchain container (mat-armhf, Python 3 of Ubuntu 20.04, standard library only), started by
tools/update-it.ps1. A real mat-runtime (the build of the container's architecture) runs from a fake tree
(MAT_OPT_ROOT) with update.enabled; deployment/device/mat-updater.sh does the root side with a fake systemctl
that really starts and stops that runtime; a watcher plays mat-updater.path (runs mat-updater when request.json
appears). Packages: node tools/release/make-update.mjs --it <pkgs> --bin <mat-runtime> --arch <arch> --count 64 --test.

Scenarios: ok (20 updates: downtime <= 30 s, whole <= 120 s), bad (the bad packages of contract §6 over HTTPS),
kill (5 points x S1..S8 = 40: kill -9 / power cut then recover: old or new tree, complete, healthy), health
(a version that does not start: back to .prev <= 90 s), busy, keyset, downgrade, manual-rollback, auth (rights).
Writes the JSON report given by --report. Lab only: MAT_RATE_S=0 (one update per 5 min is off).
"""
import argparse
import json
import os
import secrets
import signal
import ssl
import string
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

SRC = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTTP, HTTPS = 18080, 18443
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


class Lab:
    def __init__(self, work, bin_path, pkgs, verify):
        self.w = work
        self.bin = bin_path
        self.pkgs = pkgs
        self.verify = verify
        self.r = os.path.join(work, 'root')
        self.root = self.r + '/opt/mat-runtime'
        self.data = self.r + '/var/lib/mat-runtime'
        self.upd = self.data + '/update'
        self.etc = self.r + '/etc/mat-runtime'
        self.state = self.r + '/var/lib/mat-updater'
        self.svc = os.path.join(work, 'svc')
        self.pw = {}
        self.next_seq = 11
        self.watch_stop = False
        self.watch_pause = False
        self.kill_at = ''
        self.updater_runs = 0

    # ------------------------------------------------------------ the tree, the fake systemctl
    def sh(self, cmd, check=True, env=None, timeout=600):
        e = dict(os.environ)
        if env:
            e.update(env)
        p = subprocess.run(cmd, shell=True, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout, universal_newlines=True)
        if check and p.returncode != 0:
            raise RuntimeError('%s: %s' % (cmd, p.stdout[-800:]))
        return p

    def setup(self):
        self.sh('rm -rf %s && mkdir -p %s' % (self.w, self.w))
        for d in (self.root + '/bin', self.root + '/web', self.data, self.etc + '/trusted-keys', self.svc,
                  self.state, self.root + '/deployment'):
            os.makedirs(d, exist_ok=True)
        self.sh('cp %s %s/bin/mat-runtime && cp -r %s/schemas %s/schemas && cp -r %s/projects/tank-demo %s/project'
                % (self.bin, self.root, SRC, self.root, SRC, self.root))
        with open(self.root + '/build-info.json', 'w') as f:
            json.dump({'version': '1.0.0', 'releaseSeq': 10}, f)
        with open(self.root + '/web/index.html', 'w') as f:
            f.write('<!doctype html><title>mAT 10</title>\n')
        self.sh('cp %s/tests/update-vectors/keys-trusted/test-ec-p256.pem %s/trusted-keys/release-primary.pem'
                % (SRC, self.etc))
        cfg = {
            'port': HTTP, 'httpsPort': HTTPS, 'dataDir': self.data, 'docroot': self.root + '/web',
            'projectDir': self.root + '/project', 'schemasDir': self.root + '/schemas',
            'maxConcurrentLogins': 2, 'simLoad': True, 'usersFile': self.etc + '/users.json',
            'update': {'enabled': True, 'maxPackageMiB': 64, 'trustedKeysDir': self.etc + '/trusted-keys'},
        }
        with open(self.etc + '/runtime.json', 'w') as f:
            json.dump(cfg, f)
        # accounts: random passwords, only in this process and on the stdin of --user-add
        alphabet = string.ascii_letters + string.digits
        for user, role in (('admin', 'administrator'), ('kysu', 'engineer'), ('vanhanh', 'operator'),
                           ('xem', 'viewer')):
            self.pw[user] = ''.join(secrets.choice(alphabet) for _ in range(24))
            p = subprocess.run([self.root + '/bin/mat-runtime', '--config', self.etc + '/runtime.json',
                                '--user-add', user, '--role', role, '--password-stdin'],
                               input=self.pw[user] + '\n', universal_newlines=True,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            if p.returncode != 0:
                raise RuntimeError('--user-add %s: %s' % (user, p.stdout))
        # the fake systemctl: starts and stops the real runtime of the tree
        sysctl = os.path.join(self.w, 'systemctl')
        with open(sysctl, 'w') as f:
            f.write('''#!/bin/sh
S=%(svc)s
now() { date +%%s%%3N; }
alive() { [ -f "$S/pid" ] && kill -0 "$(cat "$S/pid")" 2>/dev/null; }
# --no-block start mat-updater (queued by recover): the lab runs it itself right after the boot
[ "$1" = --no-block ] && { echo "queued $*" >> "$S/log"; exit 0; }
case "$1" in
stop)
    echo "stop $(now)" >> "$S/log"
    if alive; then p=$(cat "$S/pid"); kill -TERM "$p"; i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; kill -KILL "$p" 2>/dev/null; fi
    rm -f "$S/pid" ;;
start)
    echo "start $(now)" >> "$S/log"
    alive && exit 0
    [ -x %(root)s/bin/mat-runtime ] || exit 1
    nohup %(root)s/bin/mat-runtime --config %(etc)s/runtime.json >> %(w)s/runtime.log 2>&1 &
    echo $! > "$S/pid" ;;
is-active) alive ;;
*) exit 0 ;;
esac
''' % {'svc': self.svc, 'w': self.w, 'root': self.root, 'etc': self.etc})
        os.chmod(sysctl, 0o755)
        # one run of mat-updater, as mat-updater.service runs it
        with open(os.path.join(self.w, 'updater-run.sh'), 'w') as f:
            f.write('''#!/bin/sh
export MAT_OPT_ROOT=%(r)s MAT_SYSTEMCTL=%(w)s/systemctl MAT_VERIFY=%(verify)s MAT_RUNUSER="" \\
    MAT_FETCH="curl -sk --max-time 2" MAT_RATE_S=0 MAT_TEST_KILL="$(cat %(w)s/killat 2>/dev/null)"
exec sh %(src)s/deployment/device/mat-updater.sh "$@" >> %(w)s/updater.log 2>&1
''' % {'r': self.r, 'w': self.w, 'verify': self.verify, 'src': SRC})

    def systemctl(self, *args):
        return self.sh(' '.join([os.path.join(self.w, 'systemctl')] + list(args)), check=False)

    def boot(self):
        """A power cut and a boot: the runtime and mat-updater die, recover runs, then the runtime starts."""
        self.sh('pkill -9 -f "%s/bin/mat-runtime" || true; pkill -9 -f mat-updater.sh || true' % self.root, check=False)
        self.sh('rm -f %s/pid %s/killat' % (self.svc, self.w))
        self.sh('sh %s/updater-run.sh --recover' % self.w, check=False)
        self.systemctl('start', 'mat-runtime')
        resumed = os.path.exists(self.state + '/resume')
        if resumed:
            self.sh('sh %s/updater-run.sh' % self.w, check=False)
        return resumed

    # ------------------------------------------------------------ the watcher (mat-updater.path)
    def watcher(self):
        while not self.watch_stop:
            if not self.watch_pause and os.path.exists(self.upd + '/request.json'):
                self.updater_runs += 1
                self.sh('sh %s/updater-run.sh' % self.w, check=False, timeout=900)
            time.sleep(0.2)

    # ------------------------------------------------------------ HTTP
    def req(self, method, path, body=None, token=None, ctype='application/json', https=True, timeout=180):
        url = ('https://127.0.0.1:%d' if https else 'http://127.0.0.1:%d') % (HTTPS if https else HTTP) + path
        data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
        r = urllib.request.Request(url, data=data, method=method)
        if data is not None:
            r.add_header('Content-Type', ctype)
        if token:
            r.add_header('Authorization', 'Bearer ' + token)
        try:
            with urllib.request.urlopen(r, context=CTX if https else None, timeout=timeout) as resp:
                raw = resp.read()
                return resp.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, {}
        except Exception as e:  # connection refused, reset, timeout
            return 0, {'exception': str(e)}

    def login(self, user='admin', wait_s=60):
        end = time.time() + wait_s
        while time.time() < end:
            s, b = self.req('POST', '/api/v1/auth/login', {'user': user, 'password': self.pw[user]})
            if s == 200:
                return b['token']
            time.sleep(0.3)
        raise RuntimeError('login %s failed: %s %s' % (user, s, b))

    def info(self):
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/api/v1/system/info' % HTTP, timeout=1) as r:
                return json.loads(r.read())
        except Exception:
            return None

    def wait_up(self, t=60):
        end = time.time() + t
        while time.time() < end:
            if self.info():
                return True
            time.sleep(0.2)
        return False

    def tree(self):
        try:
            with open(self.root + '/build-info.json') as f:
                return json.load(f)
        except Exception:
            return {}

    def upload(self, name, token):
        with open(os.path.join(self.pkgs, name), 'rb') as f:
            data = f.read()
        return self.req('POST', '/api/v1/system/update', data, token, 'application/octet-stream')

    def take_seq(self):
        s = self.next_seq
        self.next_seq += 1
        return s

    def update(self, seq):
        """One whole update; returns the measures."""
        t0 = time.time()
        token = self.login()
        s, b = self.upload('ok-%d.matupdate' % seq, token)
        if s != 201:
            return {'seq': seq, 'ok': False, 'why': 'upload %s %s' % (s, b)}
        uid = b['updateId']
        # the downtime as a client sees it: system/info over HTTP every 100 ms
        down = {'first': None, 'back': None}
        stop = threading.Event()

        def probe():
            while not stop.is_set():
                ok = self.info() is not None
                now = time.time()
                if not ok and down['first'] is None:
                    down['first'] = now
                if ok and down['first'] is not None and down['back'] is None:
                    down['back'] = now
                time.sleep(0.1)
        th = threading.Thread(target=probe)
        th.start()
        s, b = self.req('POST', '/api/v1/system/update/apply', {'updateId': uid, 'password': self.pw['admin']}, token)
        if s != 202:
            stop.set()
            th.join()
            return {'seq': seq, 'ok': False, 'why': 'apply %s %s' % (s, b)}
        result = None
        end = time.time() + 180
        while time.time() < end:
            time.sleep(0.5)
            last = self.read_last()
            if last.get('updateId') == uid and last.get('result'):
                result = last['result']
                break
        self.wait_up(30)
        stop.set()
        th.join()
        total = time.time() - t0
        downtime = (down['back'] - down['first']) if down['first'] and down['back'] else None
        info = self.info() or {}
        ok = (result == 'committed' and self.tree().get('releaseSeq') == seq and info.get('releaseSeq') == seq)
        return {'seq': seq, 'ok': ok, 'result': result, 'downtimeS': round(downtime, 2) if downtime else None,
                'totalS': round(total, 2)}

    def read_last(self):
        try:
            with open(self.upd + '/last.json') as f:
                return json.load(f)
        except Exception:
            return {}

    def clean(self):
        bad = []
        for d in ('incoming', 'ready'):
            p = os.path.join(self.upd, d)
            if os.path.isdir(p) and os.listdir(p):
                bad.append('%s: %s' % (d, os.listdir(p)))
        if os.path.exists(self.upd + '/request.json'):
            bad.append('request.json')
        if os.path.exists(self.root + '.new'):
            bad.append('/opt/mat-runtime.new')
        return bad


# ---------------------------------------------------------------- scenarios

def sc_ok(lab, n=int(os.environ.get('UIT_OK_N', '20'))):
    rows = [lab.update(lab.take_seq()) for _ in range(n)]
    good = [r for r in rows if r['ok']]
    dts = [r['downtimeS'] for r in good if r['downtimeS'] is not None]
    tot = [r['totalS'] for r in good]
    return {
        'passed': len(good) == n and all(d <= 30 for d in dts) and all(t <= 120 for t in tot),
        'updates': n, 'committed': len(good),
        'downtimeS': {'max': max(dts) if dts else None, 'mean': round(sum(dts) / len(dts), 2) if dts else None},
        'totalS': {'max': max(tot) if tot else None, 'mean': round(sum(tot) / len(tot), 2) if tot else None},
        'rows': rows,
    }


def sc_bad(lab):
    with open(os.path.join(lab.pkgs, 'cases.json')) as f:
        cases = json.load(f)
    before = lab.tree()
    token = lab.login()
    rows = []
    for c in cases:
        s, b = lab.upload(c['file'], token)
        e = c['expect']
        ok = s == e['http'] and b.get('error') == e['code'] and (
            'detailCode' not in e or (b.get('detail') or {}).get('code') == e['detailCode'])
        rows.append({'id': c['id'], 'name': c['name'], 'ok': ok, 'status': s, 'code': b.get('error'),
                     'detail': (b.get('detail') or {}).get('code')})
        if s == 201:  # accepted by mistake: drop it, so the next cases are not DEVICE_BUSY
            lab.req('POST', '/api/v1/system/update/cancel', {'updateId': b.get('updateId')}, token)
    unchanged = lab.tree() == before and not lab.clean()
    return {'passed': all(r['ok'] for r in rows) and unchanged, 'cases': len(rows),
            'refusedRight': sum(r['ok'] for r in rows), 'treeUnchanged': unchanged, 'rows': rows}


def sc_downgrade(lab):
    token = lab.login()
    s1, b1 = lab.upload('downgrade.matupdate', token)
    # the release that runs now, sent again (run after `ok`: releaseSeq 30)
    cur = lab.tree().get('releaseSeq')
    s2, b2 = lab.upload('ok-%d.matupdate' % max(cur, 11), token)
    for s, b in ((s1, b1), (s2, b2)):
        if s == 201:
            lab.req('POST', '/api/v1/system/update/cancel', {'updateId': b.get('updateId')}, token)
    ok = s1 == 409 and b1.get('error') == 'UPDATE_DOWNGRADE' and s2 == 409 and b2.get('error') == 'UPDATE_DOWNGRADE'
    return {'passed': ok, 'releaseSeq5': [s1, b1.get('error')], 'sameReleaseSeq': [cur, s2, b2.get('error')]}


def sc_busy(lab):
    token = lab.login()
    lab.watch_pause = True
    seq = lab.take_seq()
    s, b = lab.upload('ok-%d.matupdate' % seq, token)
    uid = b.get('updateId')
    # a second upload while one is verified: refused before its body is read (a short body, so the
    # client reads the answer instead of a broken pipe)
    head = open(os.path.join(lab.pkgs, 'ok-%d.matupdate' % seq), 'rb').read()[:512]
    s2, b2 = lab.req('POST', '/api/v1/system/update', head, token, 'application/octet-stream')
    a1, _ = lab.req('POST', '/api/v1/system/update/apply', {'updateId': uid, 'password': lab.pw['admin']}, token)
    a2, c2 = lab.req('POST', '/api/v1/system/update/apply', {'updateId': uid, 'password': lab.pw['admin']}, token)
    lab.watch_pause = False
    end = time.time() + 120
    while time.time() < end and lab.read_last().get('updateId') != uid:
        time.sleep(0.5)
    lab.wait_up(30)
    ok = (s == 201 and s2 == 409 and b2.get('error') == 'DEVICE_BUSY' and a1 == 202 and a2 == 409
          and c2.get('error') == 'DEVICE_BUSY' and lab.read_last().get('result') == 'committed')
    return {'passed': ok, 'secondUpload': [s2, b2.get('error')], 'applyTwice': [a1, a2, c2.get('error')]}


def sc_health(lab):
    before = lab.tree().get('releaseSeq')
    token = lab.login()
    t0 = time.time()
    s, b = lab.upload('broken.matupdate', token)
    uid = b.get('updateId')
    a, _ = lab.req('POST', '/api/v1/system/update/apply', {'updateId': uid, 'password': lab.pw['admin']}, token)
    end = time.time() + 200
    while time.time() < end and lab.read_last().get('updateId') != uid:
        time.sleep(0.5)
    lab.wait_up(30)
    took = time.time() - t0
    last = lab.read_last()
    ok = (s == 201 and a == 202 and last.get('result') == 'rolled-back' and lab.tree().get('releaseSeq') == before
          and took <= 90 and (lab.info() or {}).get('releaseSeq') == before)
    return {'passed': ok, 'result': last.get('result'), 'reason': last.get('reason'), 'secondsToBack': round(took, 1),
            'failedKept': os.path.exists(lab.root + '.failed')}


def sc_keyset(lab):
    token = lab.login()
    s, b = lab.upload('keyset.matupdate', token)
    uid = b.get('updateId')
    a, _ = lab.req('POST', '/api/v1/system/update/apply', {'updateId': uid, 'password': lab.pw['admin']}, token)
    end = time.time() + 60
    while time.time() < end and lab.read_last().get('updateId') != uid:
        time.sleep(0.5)
    keys = sorted(os.listdir(lab.etc + '/trusted-keys'))
    ok = s == 201 and a == 202 and lab.read_last().get('result') == 'committed' and len(keys) == 2
    # a keyset is not a release: back to one key for the next scenarios (as root would, --trust-key remove)
    for k in keys:
        if k != 'release-primary.pem':
            os.unlink(os.path.join(lab.etc + '/trusted-keys', k))
    return {'passed': ok, 'upload': [s, b.get('error'), (b.get('detail') or {}).get('code')], 'apply': a,
            'last': lab.read_last(), 'keysAfter': len(keys), 'plan': b.get('plan', {}).get('kind')}


def sc_manual_rollback(lab):
    cur = lab.tree().get('releaseSeq')
    token = lab.login()
    s, b = lab.req('POST', '/api/v1/system/update/rollback', {'password': 'sai-mat-khau-0000'}, token)
    s2, b2 = lab.req('POST', '/api/v1/system/update/rollback', {'password': lab.pw['admin']}, token)
    uid = b2.get('updateId')
    end = time.time() + 120
    while time.time() < end and lab.read_last().get('updateId') != uid:
        time.sleep(0.5)
    lab.wait_up(30)
    after = lab.tree().get('releaseSeq')
    ok = (s == 403 and b.get('error') == 'REAUTH_FAILED' and s2 == 202 and lab.read_last().get('result') == 'committed'
          and after != cur and (lab.info() or {}).get('releaseSeq') == after)
    # forward again for the next scenarios
    if ok:
        r = lab.update(lab.take_seq())
        ok = ok and r['ok']
    return {'passed': ok, 'wrongPassword': [s, b.get('error')], 'rollback': [s2, b2], 'last': lab.read_last(),
            'from': cur, 'to': after}


def sc_auth(lab):
    rows = []
    admin = lab.login()
    # a small body: a refusal comes before the body is read and the connection closes
    pkg = open(os.path.join(lab.pkgs, 'ok-11.matupdate'), 'rb').read()[:512]

    def check(name, status, code, want_status, want_code):
        rows.append({'case': name, 'ok': status == want_status and code == want_code, 'status': status, 'code': code})
    s, b = lab.req('POST', '/api/v1/system/update', pkg, None, 'application/octet-stream')
    check('no session', s, b.get('error'), 401, 'AUTH_REQUIRED')
    for u in ('xem', 'vanhanh', 'kysu'):
        t = lab.login(u)
        s, b = lab.req('POST', '/api/v1/system/update', pkg, t, 'application/octet-stream')
        check(u, s, b.get('error'), 403, 'FORBIDDEN')
        s, b = lab.req('GET', '/api/v1/system/update', None, t)
        check(u + ' GET', s, b.get('error'), 403, 'FORBIDDEN')
    s, b = lab.req('POST', '/api/v1/system/update', pkg, admin, 'application/octet-stream', https=False)
    check('http', s, b.get('error'), 403, 'HTTPS_REQUIRED')
    s, b = lab.req('POST', '/api/v1/system/update/apply', {'updateId': 'upd_0000000000000000', 'password': 'x' * 20},
                   admin)
    check('apply wrong password', s, b.get('error'), 403, 'REAUTH_FAILED')
    s, b = lab.req('POST', '/api/v1/system/update/apply', {'updateId': 'upd_0000000000000000'}, admin)
    check('apply no password', s, b.get('error'), 403, 'REAUTH_FAILED')
    # the audit has the refusals (read by the administrator)
    s, b = lab.req('GET', '/api/v1/audit?limit=200', None, admin)
    actions = [r.get('action') for r in b.get('records', [])] if s == 200 else []
    audited = 'access.denied' in actions and 'auth.reauth' in actions
    return {'passed': all(r['ok'] for r in rows) and audited and not lab.clean(), 'audited': audited, 'rows': rows}


def sc_kill(lab, per_step=5):
    rows = []
    for step in ('S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'):
        for n in range(1, per_step + 1):
            seq = lab.take_seq()
            old = lab.tree().get('releaseSeq')
            token = lab.login()
            name = 'ok-%d.matupdate' % seq
            lab.watch_pause = True
            if step == 'S1':  # the runtime dies while it receives
                path = os.path.join(lab.pkgs, name)
                p = subprocess.Popen(['curl', '-sk', '--limit-rate', '%dk' % (200 * n), '-H', 'Authorization: Bearer ' + token,
                                      '-H', 'Content-Type: application/octet-stream', '--data-binary', '@' + path,
                                      'https://127.0.0.1:%d/api/v1/system/update' % HTTPS],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(0.5 + 0.3 * n)
                lab.boot()
                p.kill()
            elif step == 'S2':  # verified, then the runtime dies
                s, b = lab.upload(name, token)
                lab.boot()
            elif step == 'S3':  # apply written, the power goes before mat-updater runs
                s, b = lab.upload(name, token)
                lab.req('POST', '/api/v1/system/update/apply', {'updateId': b.get('updateId'), 'password': lab.pw['admin']},
                        token)
                lab.boot()
            else:  # mat-updater killed at point n of the step, then a power cut
                with open(os.path.join(lab.w, 'killat'), 'w') as f:
                    f.write('%s:%d' % (step, n))
                if '%s:%d' % (step, n) in ('S7:3', 'S7:5'):  # points of the rollback: a version that fails
                    name, seq = 'broken.matupdate', 900
                s, b = lab.upload(name, token)
                lab.req('POST', '/api/v1/system/update/apply', {'updateId': b.get('updateId'), 'password': lab.pw['admin']},
                        token)
                lab.sh('sh %s/updater-run.sh' % lab.w, check=False, timeout=600)
                lab.boot()
            lab.watch_pause = False
            up = lab.wait_up(90)
            now = lab.tree().get('releaseSeq')
            info = lab.info() or {}
            complete = os.path.exists(lab.root + '/bin/mat-runtime') and not os.path.exists(lab.root + '.new')
            ok = up and now in (old, seq) and info.get('releaseSeq') == now and complete and not lab.clean()
            rows.append({'point': '%s:%d' % (step, n), 'ok': ok, 'from': old, 'to': seq, 'running': now,
                         'leftovers': lab.clean()})
            if not ok:
                print('kill %s:%d: %s' % (step, n, rows[-1]), flush=True)
    return {'passed': all(r['ok'] for r in rows), 'cases': len(rows), 'good': sum(r['ok'] for r in rows),
            'newVersion': sum(1 for r in rows if r['running'] == r['to']), 'rows': rows}


SCENARIOS = {'ok': sc_ok, 'bad': sc_bad, 'downgrade': sc_downgrade, 'busy': sc_busy, 'health': sc_health,
             'keyset': sc_keyset, 'manual-rollback': sc_manual_rollback, 'auth': sc_auth, 'kill': sc_kill}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenario', default='ok,bad,downgrade,busy,manual-rollback,health,keyset,auth,kill')
    ap.add_argument('--bin', required=True)
    ap.add_argument('--pkgs', required=True)
    ap.add_argument('--verify', required=True)
    ap.add_argument('--work', default='/tmp/update-it')
    ap.add_argument('--report', required=True)
    a = ap.parse_args()
    lab = Lab(a.work, a.bin, a.pkgs, a.verify)
    lab.setup()
    lab.systemctl('start', 'mat-runtime')
    if not lab.wait_up(60):
        print(open(os.path.join(a.work, 'runtime.log')).read()[-3000:])
        sys.exit('runtime did not start')
    w = threading.Thread(target=lab.watcher, daemon=True)
    w.start()
    report = {'feature': '011', 'task': 'T120', 'date': time.strftime('%Y-%m-%dT%H:%M:%S'),
              'machine': 'Docker mat-armhf (%s), real mat-runtime of that architecture, fake systemctl' % os.uname().machine,
              'note': 'lab: MAT_RATE_S=0; health check 60 s, stable 5 s as on the device', 'scenarios': {}}
    for name in a.scenario.split(','):
        t0 = time.time()
        print('== %s' % name, flush=True)
        try:
            r = SCENARIOS[name](lab)
        except Exception as e:  # a scenario that breaks is a failure, the others still run
            r = {'passed': False, 'error': str(e)}
        r['seconds'] = round(time.time() - t0, 1)
        report['scenarios'][name] = r
        print('%s: %s (%s s)' % (name, 'PASS' if r['passed'] else 'FAIL', r['seconds']), flush=True)
    lab.watch_stop = True
    lab.systemctl('stop', 'mat-runtime')
    report['passed'] = all(r['passed'] for r in report['scenarios'].values())
    with open(a.report, 'w') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('update-it: %s -> %s' % ('PASS' if report['passed'] else 'FAIL', a.report))
    sys.exit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
