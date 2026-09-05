# Oxygen

部署在自己服务器上的订阅管理工具。记录订阅价格和续费日期，查看每月开销，也可以管理家庭组成员、分摊费用和交费情况。手机和电脑登录同一个网站，数据保存在自己的数据库里。

- 订阅管理：月付、年付、自定义周期、试用、暂停和归档。
- 费用统计：月度支出、续费日历，多种货币换算后合计，默认显示人民币。
- 服务图标：内置 32 项常用服务，可按 App 名称查找，或从官网提取 Logo。
- 个人头像：上传图片、随机生成或恢复默认头像。
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

**不需要申请任何 API Key，也不需要 OpenAI 或 Claude 的 API Key。** 订阅价格和付款记录由你填写，数据库、头像和保存后的图标都在自己的服务器上。

自动汇率和在线查找图标会用到以下公共来源：

| 功能 | 访问地址 | 何时访问 |
| --- | --- | --- |
| 自动汇率 | `open.er-api.com` | 打开网站时检查每日汇率，使用缓存，更新失败保留上次结果 |
| 按 App 名称查找 | `itunes.apple.com` | 内置目录没有匹配项、点击在线查找时，向 Apple 发送 App 名称 |
| App Store 图标 | `*.mzstatic.com` | 下载匹配结果的图标，保存为本地 PNG |
| 从官网提取图标 | 你填写的官网，以及该页面声明的图标地址 | 读取公开页面的 favicon 或 touch icon，下载后保存到本地 |

汇率采用 [ExchangeRate-API 的免密钥接口](https://www.exchangerate-api.com/docs/free)，每日更新，页面标明来源。名称搜索使用 [Apple iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)。这些请求不会发送你的订阅账单、账号密码或头像。

自动汇率可以在设置中关闭，改用手动值。内置服务和手动上传图标不需要在线查找；外部服务不可用时仍可管理订阅。安装和更新需要下载源码、依赖及镜像，HTTPS 证书申请和续期需要访问证书机构，不需要 DNS 服务商令牌。

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

使用下文的 Nginx 部署方式时，将更新命令中的 `docker compose pull db caddy` 改为 `docker compose pull db`。

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

设置页可以导出和恢复 JSON，包含业务数据、汇率设置、使用中的自定义头像和订阅图标，不包含账号密码和会话。CSV 适合用表格查看订阅，不能用来完整恢复网站。

网页导出上限为 49 MiB、导入上限为 50 MiB，图片原始数据合计上限为 32 MiB。数据量超过限制时使用服务器备份。

## 忘记密码

登录服务器，在项目目录执行：

```bash
docker compose exec app pnpm admin reset
```

按提示输入新密码。重置后所有已登录设备都需要重新登录，不需要邮箱或短信验证。

## 已有反向代理

下面适用于直接安装在 Ubuntu 上的 Nginx。先确认 Docker 正常运行，再从项目目录启动：

```bash
sudo systemctl enable --now docker
sudo docker info
cd /opt/oxygen
git pull --ff-only
sudo bash scripts/deploy.sh --nginx
```

脚本只启动应用和数据库，应用监听 `127.0.0.1:3000`。已有 `.env` 中的域名和数据库密码会保留；模式写入 `.env`，之后的备份、恢复、账号管理命令照常使用。若此前运行过本项目的 Caddy，脚本会在应用启动成功后停止它。

按提示创建管理员，然后配置 Nginx。以下命令使用 root 执行，把 `oxygen.example.com` 换成自己的域名。如果该域名已经有站点配置，请编辑现有文件，不要重复创建。

```bash
cd /opt/oxygen
site_domain=oxygen.example.com
sed "s/oxygen.example.com/$site_domain/g" deploy/nginx.conf.example \
  > "/etc/nginx/sites-available/$site_domain"
ln -s "/etc/nginx/sites-available/$site_domain" "/etc/nginx/sites-enabled/$site_domain"
nginx -t && systemctl reload nginx
```

模板将请求转发到应用，设置必要的请求头，并允许备份文件上传。已有 HTTPS 站点可以将模板里的 `location /` 配置放进自己的 HTTPS `server` 块，替换原有的同名 `location`，同时设置 `client_max_body_size 60m`。证书配置继续使用原来的。

新站点可以使用 Certbot 申请证书：

```bash
apt update
apt install -y certbot python3-certbot-nginx
certbot --nginx -d oxygen.example.com --redirect
systemctl enable --now certbot.timer
certbot renew --dry-run
```

证书签发需要域名正确解析，并允许访问 80/443。按照 Certbot 提示填写邮箱并确认服务条款，完成后通过 HTTPS 域名登录。生产环境的登录 Cookie 只在 HTTPS 下生效，HTTP 页面可用于检查连通性，但不能正常保持登录。

排查应用和 Nginx 的连接时，可以运行 `curl -I http://127.0.0.1:3000/login`，正常应返回 HTTP 200。不要在安全组开放 3000 或 5432。

如果 Nginx 运行在另一个 Docker 容器里，需要将它与应用接入同一个 Docker 网络，通过应用的服务名访问；不能使用代理容器自己的 `127.0.0.1`。有 CDN 时也不要缓存本站页面或 API。

## 常见问题

### Cannot connect to the Docker daemon

这是 Docker 服务未启动，或当前账号无法访问 Docker，与使用哪种反向代理无关。Ubuntu 上先运行：

```bash
sudo systemctl enable --now docker
sudo docker info
```

如果启动失败，运行 `sudo journalctl -u docker -n 60 --no-pager` 查看原因。若只有加 `sudo` 才能访问 Docker，部署脚本也使用 `sudo bash scripts/deploy.sh`；Nginx 模式则加上 `--nginx`。

### 域名打不开或证书申请失败

检查 A 记录是否指向当前服务器、是否有错误的 AAAA 记录、安全组和防火墙是否允许 80/443，以及端口是否被其他程序占用。Caddy 日志可以单独查看：

```bash
docker compose logs --tail=100 caddy
```

Nginx 部署查看 `sudo journalctl -u nginx -n 60 --no-pager`，以及 `docker compose logs --tail=100 app db`。

### 登录后又回到登录页

通过 HTTPS 域名访问，不要用服务器 IP 的 HTTP 地址。确认 `.env` 中的 `DOMAIN` 与浏览器访问的域名一致；修改后运行 `docker compose up -d`。

### 上传头像后提示服务器错误

旧版本在 PostgreSQL 中保存上传图片引用时存在参数绑定问题，会导致头像和自定义订阅图标保存失败。更新代码并重新构建应用后，再上传一次即可。

如果新版本提示上传目录不可写、目录配置异常或存储空间不足，按提示检查服务器；上传日志会记录失败环节与错误代码。

### 修改数据库密码后启动失败

`.env` 里的数据库密码只在首次初始化数据库时生效，直接修改这个值不会同时更改已有数据库的密码。如果只是误改，恢复原值再启动即可。

### 构建被 killed，或下载一直失败

构建被终止时先检查内存和磁盘空间，内存不足可以升级服务器配置，或在同架构的另一台机器上构建镜像。下载失败则检查服务器到 GitHub、Docker 镜像源和 npm 的网络连接。

## 使用说明

### 添加订阅和图标

内置目录有 32 项服务，包括 ChatGPT、Claude、Gemini、Cursor、Perplexity、GitHub Copilot、DeepSeek 等。搜索 `GPT` 能找到 ChatGPT，输入 `CLAUDED` 也能找到 Claude。

目录里没有的 App，可以输入名称后在线查找；也可以直接粘贴官网地址，读取网站图标。找到的结果会显示来源，确认后再填写价格和周期。搜索结果不明确、没有上架 App Store，或者官网禁止抓取时，换用官网地址或手动上传图片即可。官网必须能从公网访问，本机和内网地址会被拒绝。

想用自己的 Logo，在添加或编辑订阅时，点击表单顶部的「上传 Logo」。支持 2 MB 以内的 PNG、JPG 和 WebP，上传后可以预览，再保存订阅。已有 Logo 可以重新上传替换，也可以点击「移除 Logo」恢复文字占位；这些图片会随 JSON 备份一起导出，无需外部 API。

### 多种货币合计

默认将美元、人民币等订阅换算为 **CNY** 后显示总金额，订阅原来的金额和币种保留。可以在「设置 → 总额显示货币」切换合计币种。

开启自动更新后，打开网站时会检查每日汇率。需要自行指定汇率时，在「设置 → 汇率 → 手动汇率」填写，例如 `1 USD = 7.20 CNY`，然后保存设置。手动值优先使用，清空该项后恢复自动汇率。

换算金额带 `≈`，用于估算支出，实际扣款以付款账单为准。更新失败时继续使用上次汇率并标明状态；从未取得某个币种的汇率时会提示补齐，不会把缺失的金额当成零，也不会直接把美元和人民币相加。

### 头像与手机使用

在「设置 → 账号与安全」上传自己的头像，支持 2 MB 以内的 PNG、JPEG、WebP。也可以随机生成新头像或恢复默认，保存后侧栏同步显示，JSON 备份会带上使用中的头像。

手机上打开添加订阅窗口时不会自动聚焦输入框，避免一打开就弹出键盘；输入字号至少为 16 px，页面保留双指缩放。

### 计费规则

- 月度预计支出按当月计划账期计算，年付订阅在扣费月计入全年金额；月均折算单独显示。
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
