<!--
Ported from mtvpls/MoonTVPlus (MIT License) — original: SOURCE_SCRIPT.md
Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
EXPERIMENTAL: this engine executes admin-provided JavaScript on the server (sandboxed via new Function).
-->

# 视频源脚本编写教程（实验性功能）

> ⚠️ **安全提示**：脚本由管理员提供、在服务端执行。请只从可信来源导入脚本。
> 引擎通过 `new Function('require', code)` 沙箱执行脚本，每次 hook 调用有 20 秒超时。
> 目前脚本引擎尚未接入 LunaTV 的搜索/详情页面（`script:` 前缀的源暂时不会出现在搜索结果中）。
> 管理员接口暂无前端页面，需通过以下 API 直接调用：
>
> - `GET /api/admin/source-script` — 列出脚本 + 获取模板（管理员登录）
> - `POST /api/admin/source-script` — `action` 可选 `save` / `delete` / `toggle_enabled` / `test` / `import`（管理员登录）

## 最小模板

```js
return {
  meta: {
    name: '示例脚本',
    author: 'admin'
  },

  async getSources(ctx) {
    return [{ id: 'default', name: '默认源' }];
  },

  async search(ctx, { keyword, page, sourceId }) {
    return {
      list: [],
      page,
      pageCount: 1,
      total: 0
    };
  },

  async recommend(ctx, { page }) {
    return {
      list: [],
      page: page || 1,
      pageCount: 1,
      total: 0
    };
  },

  async detail(ctx, { id, sourceId }) {
    return {
      id,
      title: '',
      poster: '',
      year: '',
      desc: '',
      playbacks: [
        {
          sourceId,
          sourceName: '默认源',
          episodes: [],
          episodes_titles: []
        }
      ]
    };
  },

  async resolvePlayUrl(ctx, { playUrl, sourceId, episodeIndex }) {
    return {
      url: playUrl,
      type: 'auto',
      headers: {}
    };
  }
};
```

## 支持的 hook

1. `getSources()`
   返回脚本管理的子源列表
2. `search({ keyword, page, sourceId })`
   搜索
3. `recommend({ page })`
   推荐
4. `detail({ id, sourceId })`
   详情
5. `resolvePlayUrl({ playUrl, sourceId, episodeIndex })`
   播放前解析最终地址

## `ctx` 里能用什么

1. `ctx.fetch(...)`
   发请求
2. `ctx.request.get/getJson/getHtml/post`
   快捷请求
3. `ctx.html.load(html)`
   `cheerio` 风格解析
4. `ctx.cache.get/set/del`
   脚本缓存
5. `ctx.log.info/warn/error`
   输出测试日志
6. `ctx.utils.buildUrl/joinUrl/randomUA/sleep/base64Encode/base64Decode/now`
   常用工具
7. `ctx.config.get/require/all`
   读脚本配置
8. `ctx.runtime`
   当前脚本信息

## `search` 返回格式

```js
{
  list: [
    {
      id: '123',
      title: '凡人修仙传',
      poster: 'https://...',
      year: '2025',
      desc: '简介',
      type_name: '动漫',
      douban_id: 0,
      vod_remarks: '更新至10集'
    }
  ],
  page: 1,
  pageCount: 1,
  total: 1
}
```

## `detail` 返回格式

```js
{
  id: '123',
  title: '凡人修仙传',
  poster: 'https://...',
  year: '2025',
  desc: '简介',
  playbacks: [
    {
      sourceId: 'default',
      sourceName: '默认源',
      episodes: [
        'https://example.com/play/1',
        {
          playUrl: 'https://example.com/play/2',
          needResolve: false
        }
      ],
      episodes_titles: ['第1集', '第2集']
    }
  ]
}
```

说明：

- `episodes` 可以是字符串，默认等价于 `{ playUrl: '...', needResolve: true }`
- `needResolve` 默认为 `true`
- 显式写 `needResolve: false` 时，播放页会直接使用该地址，不再调用 `resolvePlayUrl`

## `resolvePlayUrl` 返回格式

```js
{
  url: 'https://real-url.m3u8',
  type: 'auto',
  headers: {}
}
```

## 最简单的搜索例子

```js
async search(ctx, { keyword, page, sourceId }) {
  const data = await ctx.request.getJson('https://example.com/api/search', {
    query: { wd: keyword, pg: page }
  });

  return {
    list: (data.list || []).map((item) => ({
      id: String(item.id),
      title: item.title,
      poster: item.pic || '',
      year: item.year || '',
      desc: item.desc || ''
    })),
    page,
    pageCount: data.pagecount || 1,
    total: data.total || 0
  };
}
```

## 最简单的播放解析例子

```js
async resolvePlayUrl(ctx, { playUrl }) {
  return {
    url: playUrl,
    type: 'auto',
    headers: {}
  };
}
```

## 导入格式

```json
{
  "key": "demo",
  "name": "演示脚本",
  "description": "test",
  "enabled": true,
  "code": "return { ... }"
}
```

## 管理员 API 调用示例

获取脚本列表与模板：

```bash
curl -b cookies.txt http://localhost:3000/api/admin/source-script
```

测试一段脚本（不保存）：

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/source-script \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "test",
    "code": "return { async search(ctx, { keyword }) { return { list: [], page: 1, pageCount: 1, total: 0 }; } };",
    "hook": "search",
    "payload": { "keyword": "凡人修仙传", "page": 1, "sourceId": "default" }
  }'
```

保存脚本：

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/source-script \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "save",
    "key": "demo",
    "name": "演示脚本",
    "code": "return { meta: { name: \"演示脚本\" }, async search(ctx, { keyword }) { return { list: [], page: 1, pageCount: 1, total: 0 }; } };",
    "enabled": true
  }'
```

批量导入脚本：

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/source-script \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "import",
    "items": [
      { "key": "demo", "name": "演示脚本", "enabled": true, "code": "return { ... }" }
    ]
  }'
```
