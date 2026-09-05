#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
command -v docker >/dev/null || { printf '请先安装 Docker Engine 与 Compose 插件，见 README.md。\n'; exit 1; }
docker compose version >/dev/null
if [[ ! -f .env ]]; then
  read -r -p '请输入解析到这台服务器的域名（例如 sub.example.com）：' site_domain
  if [[ ! "$site_domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$ ]] || [[ "$site_domain" == *..* ]]; then
    printf '域名格式无效。请填写域名，不要带 https://、端口或路径。\n'; exit 1
  fi
  db_secret="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  [[ ${#db_secret} -eq 64 ]] || { printf '无法生成数据库密码。\n'; exit 1; }
  printf 'DOMAIN=%s\nPOSTGRES_PASSWORD=%s\n' "$site_domain" "$db_secret" > .env
  unset db_secret
fi
chmod 600 .env
if ! grep -Eq '^POSTGRES_PASSWORD=[0-9a-f]{64}$' .env; then
  printf '.env 中 POSTGRES_PASSWORD 必须为随机的 64 位小写十六进制值。可使用 openssl rand -hex 32 生成。\n'; exit 1
fi
docker compose config --quiet
printf '正在构建并启动，首次运行需要下载镜像和 npm 依赖。\n'
docker compose up -d --build --wait --wait-timeout 240
printf '\n服务已启动。首次部署请创建管理员；已有账号时选择 n。\n'
read -r -p '现在创建管理员？[Y/n] ' create_admin
if [[ ! "$create_admin" =~ ^[Nn]$ ]]; then
  docker compose exec app pnpm admin create
fi
printf '\n部署完成。请使用 .env 中 DOMAIN 对应的 https:// 域名登录。\n'
printf '运行状态：docker compose ps；日志：docker compose logs --tail=100 app caddy\n'
