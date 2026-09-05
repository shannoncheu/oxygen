# oxygen

部署在自己服务器上的订阅管理工具。记录订阅价格和续费日期，查看每月开销，也可以管理家庭组成员、分摊费用和交费情况。手机和电脑登录同一个网站，数据保存在自己的数据库里。

- 订阅管理：月付、年付、自定义周期、试用、暂停和归档。
- 费用统计：月度支出、续费日历、不同币种分别汇总。
- 家庭组：成员、席位、均摊或自定义分摊，按账期记录交费。
- 数据导出：JSON 备份与恢复、CSV 表格、ICS 日历。
- 单管理员账号，关闭公开注册，没有默认密码。

## 部署

下面以一台新的 **Ubuntu 24.04** 服务器为例，使用 Docker Compose 部署。建议 2 核 CPU、4 GB 内存，首次安装会在服务器上构建应用。服务器需要能访问 GitHub、Docker 镜像源和 npm。

只需要服务器和域名。不用另外购买数据库，也不用安装 Node.js、PostgreSQL 或 Nginx；数据库和 HTTPS 服务都在 Compose 里。

### 1. 解析域名

在域名服务商的 DNS 控制台添加一条 A 记录。例如，要用 `sub.example.com` 访问：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | sub | 服务器的公网 IPv4 地址 |

没有配置 IPv6 就不要添加 AAAA 记录。首次部署建议先关闭 CDN 代理，让域名直接指向服务器。

在服务器厂商的安全组中放行 **TCP 80、TCP 443**，系统防火墙也要允许这两个端口。保留现有 SSH 端口；UDP 443 可选，用于 HTTP/3。默认配置由 Caddy 占用 80 和 443，已有网站的服务器请先看[已有反向代理](#已有反向代理)。

### 2. 安装 Docker

通过 SSH 登录服务器。以下部署和维护命令使用 root 执行；如果登录的是普通账号，先运行 `sudo -i`。

已安装 Docker Engine 和 Compose 插件的服务器可以跳过安装，用 `docker compose version` 确认即可。新的 Ubuntu 24.04 服务器按下面的命令安装，使用的是 [Docker 官方软件源](https://docs.docker.com/engine/install/ubuntu/#install-using-the-apt-repository)：

```bash
apt update
apt install -y ca-certificates curl git
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
```

其他系统请按对应教程安装 Docker，例如 [Debian](https://docs.docker.com/engine/install/debian/)。上面的软件源配置只适用于 Ubuntu 24.04。

### 3. 下载并启动

如果前面跳过了安装步骤，请先确认服务器有 Git。Ubuntu 可以运行 `apt update && apt install -y git`。

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/shannoncheu/oxygen.git
cd oxygen
bash scripts/deploy.sh
```

按提示操作：

1. 输入已经解析好的域名，例如 `sub.example.com`，不要带 `https://`、端口或路径。
2. 等待镜像下载和应用构建。脚本会生成数据库密码，写入 `.env`，然后启动数据库、应用和 Caddy。
3. 出现“现在创建管理员？”时按回车，设置账号和密码。密码至少 12 个字符，输入时不会显示。

完成后在浏览器打开 `https://sub.example.com`，使用刚创建的账号登录。Caddy 会自动申请和续期 HTTPS 证书，不需要手动上传证书。

第一次登录没有示例数据，可以直接添加自己的订阅。如果跳过了创建管理员，在项目目录补执行：

```bash
docker compose exec app pnpm admin create
```

### 4. 检查运行状态

下面的命令都在项目目录执行：

```bash
cd /opt/oxygen
docker compose ps
docker compose logs --tail=100 app caddy
```

正常情况下 `app`、`db`、`caddy` 都处于运行状态，`app` 和 `db` 显示 healthy。首次启动可能需要多等一会儿。三个服务都配置了自动重启，服务器重启后会随 Docker 启动。

## API 和外部服务

日常使用**不需要任何第三方 API Key**。订阅信息手动录入，头像在本地生成，内置图标随源码提供，数据库运行在自己的服务器上。

需要联网的地方有两处：安装和更新时下载源码、依赖及镜像；Caddy 申请和续期证书时访问证书机构。这些都不用申请 API Key，也不用提供 DNS 服务商的令牌。

续费提醒显示在站内，需要打开网站查看。也可以导出 ICS 文件导入自己的日历，但它不会自动更新。目前没有邮件、短信或浏览器推送，也不会连接订阅平台同步账单或自动扣费。

## 更新

在原来的项目目录执行。先备份，再拉取代码并重新构建：

```bash
cd /opt/oxygen
bash scripts/backup.sh
git pull --ff-only
docker compose pull db caddy
docker compose up -d --build --wait --wait-timeout 240
```

保留原有 `.env` 和 Docker 数据卷。应用启动时会执行数据库迁移，不需要重新创建账号。已有部署继续使用原目录即可，仓库改名不要求搬动文件或修改 Compose 项目名。

如果按后文移除了 Caddy 服务，将更新命令中的 `docker compose pull db caddy` 改为 `docker compose pull db`。

不要运行 `docker compose down -v`，它会删除数据卷。数据库当前使用 PostgreSQL 17，升级应用时不要自行修改数据库镜像的大版本号。

## 备份与恢复

### 服务器备份

```bash
cd /opt/oxygen
bash scripts/backup.sh
```

备份时网站会短暂停止服务，完成后恢复运行。文件保存在 `backups/时间戳-随机数/`，包含数据库、上传图片和校验文件。

把整个备份目录复制到另一台设备，并单独保存 `.env`。服务器备份包含账号信息和私人数据，不要放进公开仓库。

恢复时，把备份目录放回本项目的 `backups/` 下，然后执行：

```bash
bash scripts/restore.sh 20260905T120000Z-12345
```

把示例名称换成实际目录名。脚本会校验文件，要求输入 `RESTORE`，再备份当前数据并执行覆盖。恢复完成后需要重新登录。若恢复失败，应用会保持停止，请根据报错修复后重试。

### 网页导出

设置页可以导出和恢复 JSON，包含业务数据及使用中的自定义图片，不包含账号密码和会话。CSV 适合用表格查看订阅，不能用来完整恢复网站。

网页导出上限为 49 MiB、导入上限为 50 MiB，图片原始数据合计上限为 32 MiB。数据量超过限制时使用服务器备份。

## 忘记密码

登录服务器，在项目目录执行：

```bash
docker compose exec app pnpm admin reset
```

按提示输入新密码。重置后所有已登录设备都需要重新登录，不需要邮箱或短信验证。

## 已有反向代理

如果服务器已经用 Nginx 或 Caddy 管理网站，可以编辑 `compose.yaml`，移除其中的整个 `caddy` 服务，并在 `app` 服务下添加端口映射。下面的方式适用于直接运行在宿主机上的反向代理：

```yaml
    ports:
      - "127.0.0.1:3000:3000"
```

让现有反向代理转发到 `127.0.0.1:3000`，由它配置域名和 HTTPS。`.env` 中的 `DOMAIN` 填这个域名，Compose 会据此设置 `APP_URL`。

如果反向代理也运行在 Docker 容器里，需要把它与应用接入同一个 Docker 网络，再通过应用的服务名访问；不要填写代理容器自己的 `127.0.0.1`。

代理需要正确设置 `X-Forwarded-Proto`，并覆盖客户端传入的 `X-Forwarded-For`。不要缓存本站页面或 API。应用端口 3000 只监听回环地址，数据库端口 5432 不对公网开放。

## 常见问题

### 域名打不开或证书申请失败

检查 A 记录是否指向当前服务器、是否有错误的 AAAA 记录、安全组和防火墙是否允许 80/443，以及端口是否被其他程序占用。Caddy 日志可以单独查看：

```bash
docker compose logs --tail=100 caddy
```

### 登录后又回到登录页

通过 HTTPS 域名访问，不要用服务器 IP 的 HTTP 地址。确认 `.env` 中的 `DOMAIN` 与浏览器访问的域名一致；修改后运行 `docker compose up -d`。

### 修改数据库密码后启动失败

`.env` 里的数据库密码只在首次初始化数据库时生效，直接修改这个值不会同时更改已有数据库的密码。如果只是误改，恢复原值再启动即可。

### 构建被 killed，或下载一直失败

构建被终止时先检查内存和磁盘空间，内存不足可以升级服务器配置，或在同架构的另一台机器上构建镜像。下载失败则检查服务器到 GitHub、Docker 镜像源和 npm 的网络连接。

## 使用说明

- 月度预计支出按当月计划账期计算，年付订阅在扣费月计入全年金额；月均折算单独显示。
- 不同币种分别统计，不做自动汇率换算。
- 订阅付款和成员交费都需要手动确认，日期到了不会自动标记为已支付。
- 家庭套餐总费用只计算一次，成员退出会释放未来席位，已经生成的账期保留分摊记录。
- 修改计费日期或周期时，旧账期保留，新规则最早从明天生效。暂不支持按天折算。
- 家庭组成员是管理用的档案，没有独立登录账号。网站目前只支持一个管理员。

## 本地开发

使用 Node.js 24 和 pnpm 11.19.0。开发环境可以使用 PGlite 文件数据库，不用单独安装 PostgreSQL。

```bash
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
```

在项目根目录创建 `.env.local`：

```dotenv
APP_URL=http://localhost:3000
PGLITE_DATA_DIR=./data/dev-db
UPLOAD_DIR=./data/uploads
```

然后初始化数据库和账号，再启动开发服务器：

```bash
pnpm migrate
pnpm admin create
pnpm dev
```

打开 `http://localhost:3000`。PGlite 同一时间只能由一个进程打开，执行密码重置或数据库维护命令前，先停止开发服务器。生产环境的 PostgreSQL 没有这个限制。

```bash
pnpm test
pnpm build
```

浏览器测试使用 `pnpm test:e2e`，首次运行前执行 `pnpm exec playwright install chromium`。测试使用端口 3100 和隔离数据库。

测试记录见 [TESTING.md](TESTING.md)，依赖说明见 [DEPENDENCIES.md](DEPENDENCIES.md)，品牌图标来源见 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。
