#!/usr/bin/env bash
# Run on the SSH host only, after the new container is healthy on 127.0.0.1:3000.
set -Eeuo pipefail
release=${1:?Provide the staged release id}
case "$release" in *[!a-zA-Z0-9_-]*) echo 'Invalid release id' >&2; exit 1;; esac
app="/opt/fram/releases/$release"
backup="/opt/fram/backups/before-$release"
test -f "$app/deploy/fram.nginx.conf"
test -f /etc/nginx/sites-available/mosaique
test ! -e /etc/nginx/sites-enabled/fram
test ! -e /etc/nginx/sites-available/fram
test ! -e /etc/nginx/conf.d/fram_ratelimit.conf
test ! -e /opt/fram/current
test ! -e "$backup"
test -z "$(ss -H -ltn 'sport = :8081')"
test "$(docker inspect --format '{{.State.Health.Status}}' fram-voyage)" = healthy

install -d -m 700 "$backup"
cp -a /etc/nginx/sites-available/mosaique "$backup/mosaique.original"
systemctl show mosaique --property MainPID --value > "$backup/mosaique.pid"
docker inspect --format '{{.Id}}' crux > "$backup/crux.id"
curl -fsS http://127.0.0.1/ > "$backup/mosaique.html"

rollback() {
    trap - ERR
    set +e
    cp -a "$backup/mosaique.original" /etc/nginx/sites-available/mosaique
    if test -L /etc/nginx/sites-enabled/fram; then unlink /etc/nginx/sites-enabled/fram; fi
    rm -f /etc/nginx/sites-available/fram /etc/nginx/conf.d/fram_ratelimit.conf
    if nginx -t; then systemctl reload nginx; fi
    echo "Bascule annulée ; configuration précédente restaurée depuis $backup" >&2
    exit 1
}
trap rollback ERR

python3 - <<'PY'
from pathlib import Path
p=Path('/etc/nginx/sites-available/mosaique')
s=p.read_text()
assert s.count('listen 80 default_server;')==1
assert s.count('listen [::]:80 default_server;')==1
s=s.replace('listen 80 default_server;', 'listen 8081;').replace('listen [::]:80 default_server;', 'listen [::]:8081;')
p.write_text(s)
PY
install -m 644 "$app/deploy/fram.nginx.conf" /etc/nginx/sites-available/fram
install -m 644 "$app/deploy/fram-ratelimit.nginx.conf" /etc/nginx/conf.d/fram_ratelimit.conf
ln -s /etc/nginx/sites-available/fram /etc/nginx/sites-enabled/fram
nginx -t
systemctl reload nginx

python3 - "$backup" <<'PY'
from pathlib import Path
from urllib.request import urlopen
import sys, time, subprocess
b=Path(sys.argv[1])
for attempt in range(15):
    try:
        with urlopen('http://127.0.0.1/',timeout=5) as r: new=r.read()
        with urlopen('http://127.0.0.1:8081/',timeout=5) as r: old=r.read()
        assert b'<title>FRAM' in new
        assert old == (b/'mosaique.html').read_bytes(), 'The old site must be identical.'
        break
    except Exception:
        if attempt==14: raise
        time.sleep(.25)
assert subprocess.check_output(['systemctl','show','mosaique','--property','MainPID','--value']).strip()==(b/'mosaique.pid').read_bytes().strip()
assert subprocess.check_output(['docker','inspect','--format','{{.Id}}','crux']).strip()==(b/'crux.id').read_bytes().strip()
print('FRAM sur :80 ; mosaïque identique sur :8081 ; processus existants conservés.')
PY
ln -s "$app" /opt/fram/current
printf '%s\n' "$release" > /opt/fram/current-release
trap - ERR
echo "BACKUP=$backup"
