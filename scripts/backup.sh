#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
[[ -f .env ]] || { printf '没有 .env，请先完成部署。\n'; exit 1; }
mkdir .operation-lock 2>/dev/null || { printf '已有备份/恢复操作进行中（.operation-lock）。\n'; exit 1; }
app_was_running=0
cleanup() {
  result=$?
  trap - EXIT
  if [[ "$app_was_running" == 1 ]]; then docker compose start app >/dev/null || true; fi
  rmdir -- "$project_dir/.operation-lock"
  exit "$result"
}
trap cleanup EXIT
if [[ -n "$(docker compose ps --status running -q app)" ]]; then app_was_running=1; fi
backup_name="$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
backup_dir="$project_dir/backups/$backup_name"
mkdir -p -- "$backup_dir"
printf '短暂停止应用写入，以同时备份数据库和图片。\n'
docker compose stop app >/dev/null
docker compose exec -T db pg_dump -U renew -d renew --format=custom --no-owner --no-acl > "$backup_dir/database.dump"
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/data/uploads -czf - . > "$backup_dir/uploads.tar.gz"
printf 'renew-server-backup-v1\ncreated_utc=%s\npostgres_major=17\n' "$backup_name" > "$backup_dir/manifest.txt"
(cd -- "$backup_dir" && sha256sum database.dump uploads.tar.gz manifest.txt > SHA256SUMS)
printf '备份完成：%s\n' "$backup_dir"
printf '请将整个目录复制到另一台设备，并另外安全保存 .env。此备份包含私密数据和管理员密码哈希。\n'
