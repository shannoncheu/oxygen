# 续订 · Renew

一个可以部署到自己服务器的私人订阅追踪工具。订阅、家庭组、成员和账期保存在服务端；手机和电脑登录同一站点读取同一份数据。正式账号从空数据开始，关闭公开注册，没有默认管理员密码。

**日常使用不需要任何第三方 API Key，也不需要邮箱、短信、付费云平台、Spotify 开发者账号或 Logo API。** 家庭组用于记录成员与费用分摊，不代扣费、不自动加入第三方家庭套餐，不收集第三方服务密码。

## 最短部署路线

准备一台 Linux 服务器和一个域名。建议 Ubuntu 24.04 / Debian 12、2 核 CPU、至少 2 GB 内存；在本机执行 Next.js 构建时建议 4 GB，低内存机器可先在其他机器构建镜像。服务器须能下载 Docker 镜像和 npm 依赖。

1. 在域名服务商处添加 A 记录，例如 `sub.example.com → 服务器公网 IPv4`。仅在服务器已配置 IPv6 时添加 AAAA 记录。
2. 安装 Docker Engine 与 Compose 插件：[Ubuntu 官方步骤](https://docs.docker.com/engine/install/ubuntu/)、[Debian 官方步骤](https://docs.docker.com/engine/install/debian/)。不需要单独安装 Node.js、PostgreSQL 或 Nginx。
3. 在服务器安全组及防火墙放行 TCP 80、TCP 443；UDP 443 可选，用于 HTTP/3。已有 Nginx 或 Caddy 占用这些端口时，先参见后文“已有反向代理”。
4. 从 GitHub 下载源码，或上传并解压完整项目到例如 `/opt/renew`。使用 Git 下载：

```bash
git clone https://github.com/shannoncheu/renew-subscription-tracker.git renew
cd renew
```

进入项目目录后运行：

```bash
bash scripts/deploy.sh
```

脚本询问域名，自动生成数据库强密码并保存到仅当前用户可读的 `.env`，构建并启动 PostgreSQL、应用和 Caddy。首次选择创建管理员，按提示设置账号和密码；密码通过终端隐藏输入，不放在命令参数中。已存在管理员时无需再次创建。

打开 `https://sub.example.com` 登录。Caddy 会自动申请和续期 HTTPS 证书。首次启动需要等待镜像下载、构建和证书签发。

```bash
docker compose ps
docker compose logs --tail=100 app caddy
```

## 到底需要哪些 API 或外部服务

| 项目 | 是否需要 | 说明 |
| --- | --- | --- |
| 订阅平台 API | 不需要 | 名称、价格、套餐及续费日期由用户确认和记录，不冒充实时价格 |
| 邮箱、短信、OAuth | 不需要 | 服务器命令创建/重置管理员，本站账号密码登录 |
| 头像、Logo API | 不需要 | DiceBear 在本地生成头像，品牌资源随项目提供 |
| 数据库 SaaS | 不需要 | PostgreSQL 在自己的 Docker 容器内运行 |
| 汇率 API | 不需要 | 不同币种分别汇总，不虚构汇率 |
| HTTPS 证书机构 ACME | 自动使用、无需 Key | Caddy 需要访问证书机构并接受域名验证，默认配置无需 DNS API 令牌 |
| Docker / npm 下载源 | 安装、升级时需要 | 下载开源依赖和基础镜像；日常业务读取不依赖它们 |

提醒是**站内提醒**，需要打开网站才能看见。`.ics` 可导入自己的日历；导出的日历是当时的快照，不是自动更新的订阅地址。邮件通知、浏览器推送、真实收款、第三方平台同步、家庭成员登录没有实现。

## 初始化、密码恢复与升级

首次管理员初始化只能在服务器终端执行，公开网页没有抢注入口：

```bash
docker compose exec app pnpm admin create
```

忘记密码时，无需邮箱，登录服务器后执行：

```bash
docker compose exec app pnpm admin reset
```

重置后重新登录。不要把真实密码写进脚本、环境变量示例、聊天记录或 shell 参数。

升级应用前先备份，然后上传新源码（保留现有 `.env` 与 Docker 数据卷）并运行：

```bash
bash scripts/backup.sh
docker compose pull
docker compose up -d --build --wait --wait-timeout 240
```

应用启动时执行幂等数据库迁移。PostgreSQL 的大版本升级需要单独安排导出/导入，不能直接将已有 17 数据卷挂载到 18 容器。不要执行 `docker compose down -v`，`-v` 会删除持久化数据卷。

## 备份与恢复

设置页的 JSON 导出用于业务数据迁移与恢复，不包含密码哈希、会话或部署密钥；包括业务记录引用的自定义图片。网页导出上限为 49 MiB、导入请求上限为 50 MiB，图片原始数据合计上限 32 MiB；超过限制时请使用下面的服务器备份脚本。CSV 用于表格查看订阅，不是完整恢复文件。

服务器备份覆盖**PostgreSQL 全库与上传图片**：

```bash
bash scripts/backup.sh
```

脚本短暂停止应用写入，输出 `backups/时间戳-随机数/`，包含数据库、图片归档、版本清单与 SHA-256 校验值；失败也会尝试恢复原有应用运行状态。请将整个备份目录复制到另一台设备，并将 `.env` 另外安全保存。服务器全库备份含管理员密码哈希及其他私密数据，不要上传公开仓库。

恢复已存在于本项目 `backups/` 的备份：

```bash
bash scripts/restore.sh 20260905T120000Z-12345
```

换成实际目录名。脚本先校验，再要求输入 `RESTORE`；确认后自动创建恢复前安全备份，覆盖数据库与图片，清空恢复后的会话，要求重新登录。恢复失败时保留应用停止状态，避免写入不完整数据。不要恢复来源不可信的数据库备份。

建议定期执行备份，并实际做一次恢复演练。Caddy 证书使用独立持久化卷，服务器迁移可让 Caddy 重新签发；频繁重建证书可能触发证书机构限流。

## 本地开发

推荐 Node.js 24 LTS、pnpm 11.19.0，实际依赖已锁定在 `pnpm-lock.yaml`。开发可使用本地 PGlite 文件数据库以减少安装步骤；生产 Compose 使用 PostgreSQL 17。

创建 `.env.local`：

```dotenv
APP_URL=http://localhost:3000
PGLITE_DATA_DIR=./data/dev-db
UPLOAD_DIR=./data/uploads
```

然后运行：

```bash
pnpm install --frozen-lockfile
pnpm migrate
pnpm admin create
pnpm dev
```

打开 `http://localhost:3000`。若选择本地 PostgreSQL，配置 `DATABASE_URL` 替代 PGlite。开发数据库、图片目录、`.env*` 均不得提交。PGlite 只能由单一进程打开，所以必须先创建管理员再启动开发服务器；执行本地管理员重置、迁移或其他数据库维护命令前，先停止 `pnpm dev`。生产 PostgreSQL 不受此限制，可以在网站运行时执行管理员命令。

```bash
pnpm test
pnpm build
```

浏览器验收可运行 `pnpm test:e2e`。首次先运行 `pnpm exec playwright install chromium`；也可设置 `CHROME_PATH` 使用已安装的 Chrome。测试仅在 `test-results/e2e-database` 创建隔离数据库和测试账号，通过端口 3100 启动测试网站，不会往正式数据库写入示例数据。

`pnpm build` 使用 `next build --webpack`。正式开发与部署验证结果以交付的测试记录为准；能构建源码不等于已在真实域名签发证书。

## 已有反向代理

默认 Compose 的 Caddy 占用主机 80/443。如果已有 Nginx/Caddy，可以移除 `caddy` 服务，在 `app` 中添加仅回环监听的 `ports: ["127.0.0.1:3000:3000"]`，让现有反向代理转发至该端口并负责 HTTPS。

保持 `APP_URL=https://你的域名`，将 `X-Forwarded-Proto` 设置为 HTTPS，并覆盖客户端传入的 `X-Forwarded-For`，不要把应用 3000 或数据库 5432 直接开放到公网。反向代理不要缓存私人页面或 API。若有 CDN，关闭该站点的 HTML/API 缓存。

## 数据口径与当前边界

- 月度预计支出按当月实际计划账期汇总；年付仅在扣费月计入全年金额。月均折算有独立标识。
- 金额使用币种最小单位整数；CNY/USD 两位、JPY/KRW 零位、KWD 三位，按币种分别展示。
- 订阅付款与家庭成员交费分别手动确认；日期到达不会自动标为已支付。家庭套餐总支出只计一次。
- 成员退出释放未来席位，已生成账期的分摊保存快照。第一版不自动处理按天折算。
- 编辑日期或计费周期时，先冻结截至今天的旧账期，新规则最早从明日生效。暂停后恢复可以明确指定今天或之后的首次扣费日。
- 已生成账期的付款和成员交费可手动调整；成员金额改变后，相关交费状态会回到待确认。历史账期不会因修改当前成员档案而自动改名或换头像。
- 核心字段存储在有归属校验的 PostgreSQL 实体表中，业务字段使用 JSONB；每次修改持有管理员行锁并校验版本，适合私人站点规模。没有离线编辑或实时 WebSocket 推送。
- 修改后其他设备重新读取同一份服务端数据；没有实时推送通知。
- 家庭组成员档案不是网站账号；第一版只有一个网站管理员。
- 20 项服务目录中 17 项提供真实本地品牌资源；Microsoft 365、百度网盘、阿里云盘为明确的文字占位，可上传图片覆盖。详细来源与限制见 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。
- 依赖核对与兼容依据见 [DEPENDENCIES.md](DEPENDENCIES.md)。

## 常见问题

**HTTPS 还没有成功？** 检查域名解析、是否有错误 AAAA 记录、80/443 安全组、防火墙以及其他程序占用端口，再查看 Caddy 日志。普通公网域名流程不需要向 DNS 服务商申请 API Key。

**登录总是回到登录页？** 生产只通过 HTTPS 域名访问；`APP_URL` 必须与浏览器地址完全一致。生产 Cookie 带 `Secure`，不能用服务器 IP 的 HTTP 地址测试。

**修改 `.env` 的数据库密码后连不上？** PostgreSQL 初始化变量只在首次建立空数据卷时生效。不要随意修改已部署密码；应先在数据库内执行受控的密码变更，再同步 `.env`。

**构建退出或被 killed？** 优先检查服务器内存和磁盘。小内存服务器可在另一台机器构建同架构镜像后上传，或增加可用内存。

**镜像或 npm 包下载失败？** 检查服务器出站网络。可配置自己信任的 Docker/npm 镜像源；本项目没有偷偷替换下载源。
