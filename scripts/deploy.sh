#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd -- "$project_dir"
deployment_mode="${1:-}"
if [[ $# -gt 1 || ( -n "$deployment_mode" && "$deployment_mode" != '--nginx' ) ]]; then
  printf '用法：bash scripts/deploy.sh [--nginx]\n--nginx 使用宿主机已有的 Nginx，应用只监听 127.0.0.1:3000。\n'; exit 1
fi
command -v docker >/dev/null || { printf '请先安装 Docker Engine 与 Compose 插件，见 README.md。\n'; exit 1; }
docker compose version >/dev/null
if ! docker info >/dev/null; then
  printf '\n无法连接 Docker 服务，或当前账号没有访问权限。\n'
  printf 'Ubuntu 可先运行：sudo systemctl enable --now docker\n'
  printf '然后确认：sudo docker info；需要时使用 sudo bash scripts/deploy.sh --nginx\n'
  printf '启动失败时查看：sudo journalctl -u docker -n 60 --no-pager\n'
  exit 1
fi
if [[ -n "${COMPOSE_FILE:-}" ]]; then
  printf '请先 unset COMPOSE_FILE，部署模式由项目 .env 保存。\n'; exit 1
fi
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
if [[ "$deployment_mode" == '--nginx' ]]; then
  if grep -q '^COMPOSE_FILE=' .env; then
    sed -i 's/^COMPOSE_FILE=.*/COMPOSE_FILE=compose.nginx.yaml/' .env
  else
    printf '\nCOMPOSE_FILE=compose.nginx.yaml\n' >> .env
  fi
fi
nginx_mode=0
if grep -qx 'COMPOSE_FILE=compose.nginx.yaml' .env; then nginx_mode=1; fi
docker compose config --quiet
if [[ "$nginx_mode" == 1 ]]; then
  printf '使用已有 Nginx；本次只启动应用和数据库，应用地址为 127.0.0.1:3000。\n'
fi
printf '正在构建并启动，首次运行需要下载镜像和 npm 依赖。\n'
docker compose up -d --build --wait --wait-timeout 240
if [[ "$nginx_mode" == 1 ]] && [[ -n "$(docker compose -f compose.yaml ps --status running -q caddy)" ]]; then
  printf '应用已就绪，停止本项目原有的 Caddy。\n'
  docker compose -f compose.yaml stop caddy
fi
printf '\n服务已启动。首次部署请创建管理员；已有账号时选择 n。\n'
read -r -p '现在创建管理员？[Y/n] ' create_admin
if [[ ! "$create_admin" =~ ^[Nn]$ ]]; then
  docker compose exec app pnpm admin create
fi
if [[ "$nginx_mode" == 1 ]]; then
  printf '\n应用已启动。请将 Nginx 反向代理到 http://127.0.0.1:3000，并为域名配置 HTTPS 后登录。\n'
  printf '配置示例：deploy/nginx.conf.example；完整步骤见 README.md 的“已有反向代理”。\n'
  printf '运行状态：docker compose ps；日志：docker compose logs --tail=100 app db\n'
else
  printf '\n部署完成。请使用 .env 中 DOMAIN 对应的 https:// 域名登录。\n'
  printf '运行状态：docker compose ps；日志：docker compose logs --tail=100 app caddy\n'
fi
