# 品牌资源与头像来源

核实日期：2026-09-05。所有品牌图片随项目本地提供，显示图片不调用 Logo API。服务名称和商标归各自权利人所有，仅用于识别用户记录的第三方订阅；本项目不代表与这些服务存在合作关系。

## 软件图标

14 个 SVG 来自实际下载并检查的 **Simple Icons 16.29.0** npm 发布包：Spotify、Apple Music、YouTube、Netflix、iCloud、Notion、网易云音乐、哔哩哔哩、YouTube Music、Apple TV、Dropbox、Figma、GitHub、1Password。保留原矢量路径，只为独立 SVG 设置目录中的品牌填充色。

- [Simple Icons 项目](https://github.com/simple-icons/simple-icons)
- [准确版本发布包](https://registry.npmjs.org/simple-icons/-/simple-icons-16.29.0.tgz)
- [许可证与商标说明](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)
- 包附带的 CC0 文本：`public/brands/SIMPLE-ICONS-LICENSE.txt`
- 每个图标的原始来源、使用规范和上游许可字段：`public/brands/sources.json`

Simple Icons 项目以 CC0 发布，但这不替代各品牌的商标权或独立许可。所用条目没有单独的 license 字段，不将“未列明”描述为“所有品牌均已授予 CC0”。

另外三项直接来自官方页面公开使用的资源，未重画图形：

| 服务     | 本地文件            | 官方来源                                                                                                                                                                     |
| -------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QQ音乐   | `qq-music.png`      | [QQ音乐首页](https://y.qq.com/) 中的 [Logo PNG](https://y.qq.com/mediastyle/yqq/img/logo.png?max_age=2592000)                                                                |
| 腾讯视频 | `tencent-video.svg` | [腾讯视频首页](https://v.qq.com/) 中的 [Logo SVG](https://vfiles.gtimg.cn/tvideo2/channel-vue/assets/logo-Ckf4UreJ.svg)                                                      |
| 爱奇艺   | `iqiyi.png`         | [官方 Logo 使用规范](https://www.iqiyi.com/common/biaozhiguifan.html) 中的 [PNG 资源包](https://static-s.iqiyi.com/ext/common/20200924-png/PNG-logo.zip)，使用线上标准色版本 |

QQ音乐、爱奇艺使用官方较宽的文字组合标识，保留原始资源和留白；其小尺寸显示密度低于独立品牌符号。

## 明确的文字占位

Microsoft 365、百度网盘、阿里云盘目前使用本项目制作的 M365 / BD / ALI 文字方块，并在目录标记 `logoType: "placeholder"`。这些不是官方 Logo。没有把 QQ 图标冒充 QQ音乐，也没有把百度搜索图标冒充百度网盘。

当前 Simple Icons 没有这些产品图标；Microsoft 的[品牌规范](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks)要求产品图标另获授权，因此没有捆绑其图形。百度网盘、阿里云盘未找到适合本地分发的可核实资源，采用明确的文字替代。用户可在编辑订阅时上传自己可使用的图片覆盖。

## AI 应用图标与在线查找

新增 Claude、Gemini、Perplexity、Cursor、GitHub Copilot、DeepSeek、Hugging Face、v0、Replit、Suno、ElevenLabs，使用同一版本 Simple Icons 的原始矢量路径。来源、品牌规范和上游许可字段记录在 `public/brands/sources.json`；黑色图标使用中性灰，适配深色背景。

ChatGPT 使用 [OpenAI 在 App Store 的官方应用](https://apps.apple.com/us/app/chatgpt/id6448311069)发布的 512 像素图标。通过 [Apple 官方查询接口](https://itunes.apple.com/lookup?id=6448311069&country=us)核对名称 `ChatGPT` 与发行方 `OpenAI OpCo, LLC` 后下载，转换为本地 PNG。图标权利归 OpenAI 所有。

内置目录之外的名称通过 [Apple iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html)查找 App Store 图标，会向 Apple 发送查询名称；返回结果标明商店和发行方，名称不明确时要求提供官网。输入官网时，服务器读取该站点公开声明的 favicon 或 touch icon。两种查找都无需 API Key，得到的图片转换为静态 PNG 后保存在本机上传目录。在线图片不属于预先捆绑的品牌资源，使用权取决于对应权利人。

## 默认成员头像

统一使用 DiceBear **Thumbs**，`@dicebear/core` 和 `@dicebear/thumbs` 都锁定 **9.4.2**。头像在项目内部由持久化 seed 生成，不发送昵称、邮箱或 seed 到外部服务。

- 作者：DiceBear。
- 图形作品许可：[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。下载包 `lib/index.js` 的 `meta.license` 已核对。
- JavaScript 代码许可：MIT；[上游代码](https://github.com/dicebear/dicebear)。
- [Thumbs 风格说明](https://www.dicebear.com/styles/thumbs/)。

版本信息与 seed 一同保存；将来升级头像库需保留旧版本或明确迁移，避免存量头像静默变化。
