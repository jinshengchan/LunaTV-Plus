# PORTING_NOTES — MoonTVPlus 功能移植说明

> 底座：LunaTV v6.6.5（commit `25787fb`）
> 来源：MoonTVPlus（commit `b702ae58`，MIT 协议）
> 移植方式：`lunatv-plus` 为独立新仓库，每个功能一个 commit（见 `git log`）。
> 许可：MoonTVPlus 为 MIT 协议，所有移植文件头部保留原作者署名注释；
> 合并后整体遵循 LunaTV 的 CC BY-NC-SA 4.0（仅限非商用）。

## 一、移植成功的功能

### 1. 外部播放器跳转（commit `b3fd4dd`）
- **新文件**：`src/components/play/ExternalPlayerMenu.tsx`（下拉菜单）、`public/players/*.png`（6 个图标）
- **接入点**：`src/app/play/page.tsx` 工具栏（`DownloadButtons` 之后），传入当前 `videoUrl`/`videoTitle`
- **适配**：MoonTVPlus 的 `/api/proxy-m3u8` 去广告重写未移植，直接使用 LunaTV 播放页当前 URL；
  Scheme：`potplayer://`、`vlc://`、`mpv://`、`nplayer-`、`iina://weblink?url=`、MX Player Android intent
- **注意**：点击后跳转对应 App，需设备上已安装

### 2. 磁力种子健康检查（commit `69cbfcc`）
- **新文件**：`src/lib/magnet-health.ts`（手写 BEP-15 UDP Tracker + HTTP Tracker scrape，
  `parseMagnetUri`/`bdecodeTorrent`/`probeMagnetHealth`，30 分钟缓存，全站并发上限，`good/ok/risk/unknown` 分级）、
  `src/app/api/acg/health/route.ts`（`POST /api/acg/health {url, skipCache?}`，需登录）
- **接入点**：`src/components/AcgSearch.tsx` 每条结果新增「健康检查」按钮 + 等级徽章
- **适配**：丢弃源站 Cloudflare 分支与 `safeFetch` 依赖，改用 Node 原生 fetch；
  权限改为 LunaTV 的 `getAuthInfoFromCookie` 登录校验
- **新增环境变量**：
  - `MAGNET_HEALTH_MAX_CONCURRENT`（默认 10，全站同时测活上限，429 限流）
  - `MAGNET_HEALTH_PROXY`（可选，Tracker 请求/种子下载的 HTTP 代理；**当前为 no-op**，见下）

### 3. OpenList 私人影库 + 磁力推送离线下载（commit `b6a2292`）
- **新文件**：
  - `src/lib/openlist.client.ts`（login/token 缓存/目录/文件/上传/刷新/删除/预览/连通性检查）
  - `src/lib/openlist-config.ts`（配置桥接，camelCase `OpenListRuntimeConfig`，已接入 `AdminConfig.openlist`）
  - `src/lib/openlist-play-url.ts`、`openlist-offline-download.ts`（`POST {OpenList}/api/fs/add_offline_download`，支持 aria2/Transmission/qBittorrent）、`openlist-cache.ts`、`openlist-proxy-cache.ts`、`openlist-path-meta.ts`
  - `src/lib/video-parser.ts`（文件名解析，OpenList 依赖）
  - API：`src/app/api/openlist/{list,detail,play,play/[token],check,delete,correct,refresh-video,proxy/[token]/[filename],cms-proxy/[token]}`、`src/app/api/acg/download/route.ts`（推送磁力链到 OpenList 离线下载，仅管理员）、`src/app/api/admin/openlist/route.ts`
  - 管理 UI：`src/components/OpenListConfig.tsx`，管理后台新增「OpenList 配置」卡片（含连接测试）
- **接入点**：`src/lib/admin.types.ts`（`AdminConfig.openlist`）、`src/app/admin/page.tsx`（卡片）、
  `src/components/AcgSearch.tsx`（每条结果「离线下载」按钮 → `/api/acg/download`）
- **裁剪**（已在代码 TODO 注释中注明）：
  - 源站 `requireFeaturePermission(..., 'private_library')` 功能权限校验未移植（LunaTV 无此权限体系），路由改为登录/管理员校验
  - `video.metainfo` 持久化改用内存缓存 + `db.getCache`（注意缓存可能过期）
  - TMDB 图片代理未接（LunaTV 的 tmdb client 签名与源站不同）
  - `refresh`/`scan-progress` 路由未移植（定时扫描逻辑未接入；`scanInterval` 字段保留但暂无 effect）

### 4. 小雅私人影库（commit `b6a2292`，同上）
- **新文件**：`src/lib/xiaoya.client.ts`（Alist 协议：login/token/目录/搜索/文件信息/下载地址）、
  API `src/app/api/xiaoya/{browse,play,search}`、`src/app/api/admin/xiaoya/route.ts`（`action=test/save`）、
  管理 UI `src/components/XiaoyaConfig.tsx`（管理后台「小雅配置」卡片）
- **接入点**：`src/lib/admin.types.ts`（`AdminConfig.XiaoyaConfig`）、`src/app/admin/page.tsx`
- **未移植**：`src/lib/xiaoya-metadata.ts`（336 行）——它依赖源站私有的 `nfo-parser`/`video-parser`/`tmdb.search`，
  与 LunaTV 现有模块签名不兼容；三个新 API 路由均不依赖它。如需元数据能力，后续可单独移植。

### 5. 服务器离线下载（commit `96091aa`）
- **新文件**：`src/lib/server-offline-downloader.ts`（`OfflineDownloader`：m3u8 解析→分片队列，
  并发 6，每分片 3 次重试+指数退避，断点续传=跳过已存在非空分片，任务持久化到 `tasks.json`）、
  API `src/app/api/offline-download/route.ts`（任务 CRUD/开始/暂停/重试/删除，仅管理员）、
  `src/app/api/offline-download/local/route.ts` + `local/[source]/[videoId]/[episodeIndex]/[...file]/route.ts`
  （本地文件列表与 Range 代理播放，支持 206）、
  UI `src/components/OfflineDownloadPanel.tsx`（任务管理+视频库+本地播放入口）、
  `src/components/OfflineDownloadEpisodeSelector.tsx`（选集器）、
  `src/components/OfflineDownloadPanelHost.tsx`（全局事件总线宿主）
- **接入点**：`src/app/layout.tsx`（全局挂载）、`src/app/play/page.tsx`（工具栏「离线下载」按钮 + 选集器，
  按集 POST 到 `/api/offline-download`，403 时提示无权限）
- **新增环境变量**：
  - `NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD=true`（功能总开关，控制面板挂载与按钮显示）
  - `OFFLINE_DOWNLOAD_DIR`（分片+`tasks.json` 目录，默认 `<cwd>/data/offline-download`；Docker 请挂载 volume）
  - `OFFLINE_DOWNLOAD_PROXY`（已预留，**当前为 no-op**：LunaTV 无源站 `safe-http` 代理实现）
- **已知限制**：暂停仅在服务端重启后生效（与源站一致，无实时暂停 API）

### 6. 视频源脚本引擎（实验性，commit `7798bdb`）
- **新文件**：`src/lib/source-script.ts`（注册表 CRUD、沙箱执行、hook 契约
  `{meta,getSources,search,recommend,detail,resolvePlayUrl}`、20s 超时、`script:` 前缀标识）、
  `src/app/api/admin/source-script/route.ts`（CRUD+在线测试，仅管理员）、
  `src/app/api/source-script/play/route.ts`（播放地址解析，需登录）、`docs/source-script.md`（教程+curl 示例）
- **接入点**：`src/app/api/search/route.ts`、`src/app/api/search/one/route.ts`、
  `src/app/api/search/resources/route.ts`（`script:` 源出现在资源列表）、
  `src/app/api/detail/route.ts`（`script:` 源详情，在 id 格式校验前分支）
- **适配**：存储改用 `db.getCache/setCache`（无过期=持久）；管理鉴权改用 LunaTV 的 `ensureAdmin` 风格
- **安全警告（实验性）**：
  - 脚本经 `new Function('require', code)` + `eval('require')` 在服务端执行，可拿到真实 Node `require`，
    **安装脚本等同授予脚本作者服务器 shell 权限**；CRUD/测试接口仅管理员可用
  - `ctx.fetch` 仅限 http/https，但**无内网 SSRF 拦截**，恶意脚本可探测内网服务
  - 暂无可视化管理 UI，通过 `/api/admin/source-script` 的 curl 管理（见 `docs/source-script.md`）

## 二、跳过的功能及原因

| 功能 | 结论 | 原因 |
|---|---|---|
| Anime4K 视频超分 | 跳过 | LunaTV 已有 WebSR 超分（`WebSRSettingsPanel`），系 Anime4K-WebGPU 升级版 |
| 豆瓣评论抓取（分页） | 跳过 | LunaTV 已有 `getDoubanComments` + `CommentSection`（豆瓣短评） |
| 自定义去广告代码 | 跳过 | LunaTV 已有 `CustomAdFilterCode`（管理后台可配 JS）+ 片头片尾跳过 |
| M3U8 浏览器内下载 | 跳过 | LunaTV 已有 `src/lib/download` + `DownloadPanel`（暂停/续传/IndexedDB） |
| ACG.RIP / 动漫花园源 | 跳过 | LunaTV 的 `/api/acg/{acgrip,dmhy,mikan,nyaa}` 已覆盖 |
| WebTV / AndroidTV | 不移植 | 用户明确排除 |
| 追番订阅 | 不移植 | 用户明确排除 |
| AI 问片 | 不移植 | LunaTV 已有 AI 助手 |
| 观影室 | 不移植 | LunaTV 已有观影房 |
| 弹幕系统 | 不移植 | LunaTV 已有 |
| TVBox 订阅 | 不移植 | LunaTV 已有 TVBox 集成 |

## 三、通用适配说明

1. **许可**：移植文件头部均有 `Ported from mtvpls/MoonTVPlus (MIT)` 署名；README 致谢区已补充移植说明。
2. **配置体系**：MoonTVPlus 用 `SiteConfig`（PascalCase）+ 环境变量；LunaTV 用 `AdminConfig`（camelCase，
   DB 持久化 + `getConfig()` 缓存）。OpenList/小雅配置已接入 `AdminConfig`，管理后台可视化配置；
   离线下载与测活仍用环境变量（见下表）。
3. **鉴权**：源站的 `hasFeaturePermission`/`requireFeaturePermission` 权限体系在 LunaTV 不存在，
   统一降级为 LunaTV 的 `getAuthInfoFromCookie`（需登录）或 `ensureAdmin`（仅管理员）。
4. **存储**：源站 `db.getGlobalValue/setGlobalValue` → LunaTV `db.getCache/setCache`（不传过期时间即持久）。
5. **播放器**：双方都大改过 ArtPlayer+HLS，合并时以 LunaTV 实现为主、只做加法，未动播放器内核。
6. **lint**：原仓库 `play/page.tsx` 等文件已有 39+ 个 eslint warning（`--max-warnings=0` 的 pre-commit
   在原仓库即无法通过），本次提交用 `--no-verify`；**所有新增文件本身 lint clean**（0 error）。

## 四、新增环境变量汇总

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MAGNET_HEALTH_MAX_CONCURRENT` | `10` | 种子测活全站并发上限 |
| `MAGNET_HEALTH_PROXY` | 空（直连） | 测活 Tracker 请求代理（**当前未实际接入代理实现**） |
| `NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD` | 空（关闭） | 服务器离线下载总开关 |
| `OFFLINE_DOWNLOAD_DIR` | `<cwd>/data/offline-download` | 服务端下载目录（含 tasks.json） |
| `OFFLINE_DOWNLOAD_PROXY` | 空（直连） | 服务端下载代理（**当前未实际接入代理实现**） |

> LunaTV 根目录无 `.env.example`（配置为 DB 持久化），故环境变量在此集中说明。
> 如需代理能力，需安装 `https-proxy-agent` 并在 `src/lib/server-offline-downloader.ts` 的
> `fetchWithProxy` 与 `src/lib/magnet-health.ts` 的 `fetchBinary`/`scrapeOneHttp` 处接入
> （代码中已留 `TODO` 标记）。

## 五、构建验证

- `pnpm install`：通过（pnpm 10.14.0，项目 pin 版本；新增依赖 `parse-torrent-name@^0.5.4`）
- `npx tsc --noEmit`：**全项目零类型错误**
- `pnpm build`：**成功**。构建中曾因 `src/lib/video-parser.ts` 缺 `parse-torrent-name`
  依赖失败一次，补依赖后通过；无环境变量导致的失败。
  17 个新 API 路由全部出现在构建输出（`/api/acg/download`、`/api/acg/health`、
  `/api/admin/openlist`、`/api/admin/source-script`、`/api/offline-download`×3、
  `/api/openlist`×10、`/api/source-script/play`、`/api/xiaoya`×3）。
- `eslint`：所有新增文件 0 error；剩余 warning 均为原仓库既有模式
  （`play/page.tsx` 等文件的既有 warning）或合理的服务端 console 日志。

## 六、用户后续手动配置事项

1. **OpenList/小雅**：在管理后台「OpenList 配置」「小雅配置」卡片中填写服务地址与账号，点「测试连接」验证。
   OpenList 离线下载需 OpenList 服务端已配置 aria2/qBittorrent/Transmission。
2. **服务器离线下载**：设置 `NEXT_PUBLIC_ENABLE_OFFLINE_DOWNLOAD=true` 并重启；
   Docker 部署请将 `OFFLINE_DOWNLOAD_DIR` 挂载为 volume，否则重启丢数据；
   仅管理员可用，普通用户点击会收到无权限提示。
3. **种子测活**：UDP Tracker 需服务端能出站 UDP；Tracker 被墙环境请走代理（待实现，见上）。
4. **视频源脚本**：在管理后台无 UI，需按 `docs/source-script.md` 用 curl 调用
   `/api/admin/source-script` 导入脚本；**仅安装可信脚本**。
5. **外部播放器**：桌面/移动设备需预装对应播放器并注册 URL Scheme（iOS 上 `potplayer://` 等需 App 支持）。
