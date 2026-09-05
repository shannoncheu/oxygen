#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
backup_name="${1:-}"
if [[ ! "$backup_name" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+$ ]]; then
  printf '用法：bash scripts/restore.sh 20260905T120000Z-12345\n仅接受当前项目 backups/ 下的备份目录名。\n'; exit 1
fi
backup_dir="$project_dir/backups/$backup_name"
[[ -d "$backup_dir" && ! -L "$backup_dir" ]] || { printf '备份目录不存在或是符号链接。\n'; exit 1; }
[[ "$(cd -- "$backup_dir" && pwd -P)" == "$backup_dir" ]] || { printf '备份路径不在预期目录。\n'; exit 1; }
for file in database.dump uploads.tar.gz manifest.txt SHA256SUMS; do
  [[ -f "$backup_dir/$file" && ! -L "$backup_dir/$file" ]] || { printf '备份文件缺失或非法：%s\n' "$file"; exit 1; }
done
grep -qx 'renew-server-backup-v1' "$backup_dir/manifest.txt" || { printf '备份版本不兼容。\n'; exit 1; }
# Validate expected checksum file names before passing the manifest to sha256sum.
[[ "$(wc -l < "$backup_dir/SHA256SUMS")" -eq 3 ]] || { printf '校验文件异常。\n'; exit 1; }
grep -Eq '^[0-9a-f]{64}  database\.dump$' "$backup_dir/SHA256SUMS"
grep -Eq '^[0-9a-f]{64}  uploads\.tar\.gz$' "$backup_dir/SHA256SUMS"
grep -Eq '^[0-9a-f]{64}  manifest\.txt$' "$backup_dir/SHA256SUMS"
(cd -- "$backup_dir" && sha256sum --check SHA256SUMS)
# Uploaded images are stored flat. Reject nested paths, links and special files.
tar -tzf "$backup_dir/uploads.tar.gz" | while IFS= read -r entry; do
  [[ "$entry" == './' || "$entry" =~ ^\./[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg)$ ]] || { printf '非法图片归档路径：%s\n' "$entry"; exit 1; }
done
tar -tvzf "$backup_dir/uploads.tar.gz" | while IFS= read -r entry; do
  [[ "$entry" == -* || "$entry" == d* ]] || { printf '图片归档包含链接或特殊文件。\n'; exit 1; }
done
printf '将使用 %s 覆盖数据库（包括账号）和全部上传图片。\n' "$backup_name"
printf '仅恢复自己保存且可信的备份；校验和用于检测损坏，不代表来源可信。\n'
read -r -p '输入 RESTORE 确认覆盖：' confirmation
[[ "$confirmation" == RESTORE ]] || { printf '已取消，没有改动数据。\n'; exit 0; }
printf '先创建恢复前的安全备份。\n'
bash scripts/backup.sh
mkdir .operation-lock 2>/dev/null || { printf '已有备份/恢复进行中。\n'; exit 1; }
restore_complete=0
cleanup() {
  result=$?
  trap - EXIT
  rmdir -- "$project_dir/.operation-lock"
  if [[ "$restore_complete" != 1 ]]; then
    printf '\n恢复未完成；应用保持停止，避免写入不完整数据。请修复错误或使用刚生成的安全备份重试。\n'
  fi
  exit "$result"
}
trap cleanup EXIT
docker compose stop app >/dev/null
docker compose exec -T db dropdb -U renew --if-exists renew
docker compose exec -T db createdb -U renew -O renew renew
docker compose exec -T db pg_restore -U renew -d renew --no-owner --no-acl --single-transaction < "$backup_dir/database.dump"
docker compose exec -T db psql -U renew -d renew -v ON_ERROR_STOP=1 -c 'DELETE FROM sessions' >/dev/null
# Empty only this named volume's upload directory, never a computed host path.
docker compose run --rm --no-deps -T --entrypoint node app -e 'const fs=require("node:fs"); const p="/app/data/uploads"; for(const n of fs.readdirSync(p)){ if(!/^[a-zA-Z0-9_-]+\.(webp|png|jpg|jpeg)$/.test(n)) throw new Error("Unexpected upload filename"); fs.unlinkSync(p+"/"+n); }'
docker compose run --rm --no-deps -T --entrypoint tar app -C /app/data/uploads --no-same-owner --no-same-permissions -xzf - < "$backup_dir/uploads.tar.gz"
docker compose up -d app
restore_complete=1
printf '恢复完成。业务数据、图片和账号已恢复。请重新登录并抽查订阅与历史账期。\n'
