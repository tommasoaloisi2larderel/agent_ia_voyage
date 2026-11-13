#!/usr/bin/env bash
# Update FRAM only. The existing Nginx configuration and other applications are retained.
set -Eeuo pipefail
release=${1:?Provide the staged release id}
case "$release" in *[!a-zA-Z0-9_-]*) echo 'Invalid release id' >&2; exit 1;; esac
app="/opt/fram/releases/$release"
previous=$(cat /opt/fram/current-release)
previous_app=$(readlink -f /opt/fram/current)
backup="/opt/fram/backups/update-$release"
check_name="fram-check-$release"
test "$release" != "$previous"
test -f "$app/deploy/compose.production.yaml"
test -f "$previous_app/deploy/compose.production.yaml"
test ! -e "$backup"
test -z "$(ss -H -ltn 'sport = :3001')"
docker image inspect "fram-voyage:$release" >/dev/null
install -d -m 700 "$backup"
printf '%s\n' "$previous" > "$backup/previous-release"
printf '%s\n' "$previous_app" > "$backup/previous-path"
recreated=0

cleanup_check() { docker rm -f "$check_name" >/dev/null 2>&1 || true; }
rollback() {
    trap - ERR
    set +e
    cleanup_check
    if test "$recreated" = 1; then
        FRAM_RELEASE="$previous" docker compose -p fram -f "$previous_app/deploy/compose.production.yaml" up -d --no-build --wait --wait-timeout 90
        ln -sfn "$previous_app" /opt/fram/current
        printf '%s\n' "$previous" > /opt/fram/current-release
    fi
    echo "Mise à jour interrompue ; version précédente : $previous" >&2
    exit 1
}
trap rollback ERR

# Verify the new image on a loopback port before recreating the public container.
docker run -d --name "$check_name" --restart no --read-only \
    --memory 512m --cpus 1 --pids-limit 96 --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --env-file /opt/fram/shared/.env -e HOST=0.0.0.0 -e PORT=3000 \
    -v /opt/fram/shared/cache:/app/.cache:ro \
    -p 127.0.0.1:3001:3000 "fram-voyage:$release" >/dev/null
python3 - <<'PY'
import json, time
from urllib.request import urlopen
for attempt in range(30):
    try:
        with urlopen('http://127.0.0.1:3001/api/bootstrap',timeout=3) as r: data=json.load(r)
        assert data['configured'] and data['hotels']==300
        break
    except Exception:
        if attempt==29: raise
        time.sleep(.3)
print('Staged image healthy on loopback :3001.')
PY
cleanup_check
recreated=1
FRAM_RELEASE="$release" docker compose -p fram -f "$app/deploy/compose.production.yaml" up -d --no-build --wait --wait-timeout 90

python3 - "$app" <<'PY'
import json, sys
from pathlib import Path
from urllib.request import urlopen
with urlopen('http://127.0.0.1/api/bootstrap',timeout=5) as r: data=json.load(r)
assert data['configured'] and data['hotels']==300
for path in ['app.js','style.css','index.html']:
    with urlopen('http://127.0.0.1/'+path,timeout=5) as r: actual=r.read()
    assert actual==(Path(sys.argv[1])/'public'/path).read_bytes(), 'Public asset differs: '+path
print('Public routes and versioned assets verified.')
PY
ln -s "$app" "/opt/fram/.current-$release"
mv -Tf "/opt/fram/.current-$release" /opt/fram/current
printf '%s\n' "$release" > "/opt/fram/.release-$release"
mv -f "/opt/fram/.release-$release" /opt/fram/current-release
trap - ERR
echo "FRAM_UPDATED=$release PREVIOUS=$previous BACKUP=$backup"
