# 黄果短剧脚本源

适配来源：用户提供的 `jinshengchan/huangguo-fongmi` 中的 `huangguo_fongmi.js`（其中注明原始解析来源为 `Yswag/xptv-extensions`）。保留原解析函数，替换蜂蜜的 assets/req/getProxy 依赖，转换为 LunaTV hook。

## 使用

1. 拉取代码、重新构建镜像并重建应用容器。
2. 服务端在没有同 key 记录时，会自动添加并启用内置「黄果短剧」。现有管理员脚本不会被覆盖。
3. 搜索页可以搜索该源；源浏览器中选择「黄果短剧」，选择首页推荐或分类。
4. 若希望手动导入，管理员在 `/admin/source-scripts` 上传 `scripts/sources/huangguo.import.json`，或者复制 `scripts/sources/huangguo.js`，源标识填写 `huangguo_fongmi`。

分类和关键词列表按站点公开的分页链接加载；首页推荐不伪造下一页。分集详情保留准确的分集网页地址和集号，播放前解析对应 `epPlaySrcs`。

## 封面

封面使用本站 `/api/source-script/huangguo-cover` 懒加载。该接口需要登录和启用对应脚本，沿用项目的目标地址及重定向验证，响应体最多 4MB。AES-CBC 参数与用户提供的脚本一致；普通图片直接返回，加密数据解密后检查图片签名。保留原封面 URL 查询参数。

## 验证范围

验证使用模拟 HTML 和加密图片样本，尚未在源站联网验证分类、封面 CDN 和实际播放。脚本返回的 Referer/User-Agent 用于网页请求及播放元数据；当前通用 `/api/source-script/play` 重定向不会转发播放请求头。如果视频 CDN 强制要求防盗链头，仍需进一步接入视频代理。网站结构或加密参数变化后需要更新适配器。
