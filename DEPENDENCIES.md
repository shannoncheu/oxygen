# 依赖兼容性记录

核实日期：2026-09-05。以下版本通过官方 npm registry 发布元数据及项目文档核实；确切传递依赖由 `pnpm-lock.yaml` 锁定。交付的 `package.json` 均为精确版本，不使用 `latest` 或版本范围。

| 依赖 | 固定版本 / 系列 | 兼容依据 |
| --- | --- | --- |
| Node.js | 24 LTS | [官方维护周期](https://github.com/nodejs/Release)：24 为 Active LTS；容器采用 Debian bookworm |
| pnpm | 11.19.0 | [该版本元数据](https://registry.npmjs.org/pnpm/11.19.0)：Node >=22.13，Node 24 满足 |
| Next.js | 16.3.4 | [该版本元数据](https://registry.npmjs.org/next/16.3.4)：Node >=20.9，React ^19.0.0 在接受范围 |
| React / React DOM | 19.2.8 | 与 Next.js 的 peerDependencies 匹配；[React 包](https://registry.npmjs.org/react/19.2.8) |
| Drizzle ORM | 0.45.2 | [该版本元数据](https://registry.npmjs.org/drizzle-orm/0.45.2)接受 pg >=8；[官方 PostgreSQL 接入](https://orm.drizzle.team/docs/get-started/postgresql-new)采用 node-postgres 驱动 |
| PostgreSQL | 17 | [官方镜像文档](https://hub.docker.com/_/postgres)；17 的持久化目录为 `/var/lib/postgresql/data` |
| @node-rs/argon2 | 2.2.0 | [官方源码](https://github.com/napi-rs/node-rs/tree/main/packages/argon2)；使用 Argon2id，Debian 镜像使用对应 Linux 原生包 |
| DiceBear core / thumbs | 9.4.2 / 9.4.2 | 同一发行版本，使用成熟的 `createAvatar` API；Thumbs 图形 CC0，详见 ATTRIBUTIONS |
| Simple Icons（资源提取） | 16.29.0 | 只将验证存在的图标拷入 `public/brands/`；运行时无需安装或调用图标服务 |
| Caddy | 2 | [官方 HTTPS 文档](https://caddyserver.com/docs/automatic-https)：域名正确解析，80/443 可达，证书自动签发和续期 |

Node、PostgreSQL、Caddy 的镜像固定主版本并接收同系列安全补丁；这与 npm 精确锁版本的策略不同。更新镜像前先备份，使用 `docker compose pull` 与重新构建。更严格的生产复现可将测试过的镜像改为 `image@sha256:...`；此处不编造未实际拉取验证的镜像摘要。

浏览器最低基线跟随 [Next.js 官方要求](https://nextjs.org/docs/app/getting-started/installation)。无跨设备本地数据副本，服务端数据库是权威来源。
