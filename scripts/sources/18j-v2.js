// Administrator source script: compiled by LunaTV's source-script engine.
const site = 'https://18j.tv';
const requestHeaders = ctx => ({ 'User-Agent': ctx.utils.randomUA(), Referer: site + '/' });
const absolute = (ctx, value) => value ? ctx.utils.joinUrl(site, String(value)) : '';
async function fetchListPage(ctx, url, page) {
  const response = await ctx.fetch({ url, headers: requestHeaders(ctx) });
  if (!response.ok) throw new Error('列表页请求失败: ' + response.status);
  const $ = ctx.html.load(await response.text());
  const cards = new Map();
  $('a[href]').each((_, el) => {
    const a = $(el);
    const match = (a.attr('href') || '').match(/\/v\/(\d+)-1-1(?:\/|$)/);
    if (!match) return;
    const img = a.find('img').first();
    const title = (a.attr('title') || a.find('h3.title').text() || a.text() || img.attr('alt') || '').trim();
    const poster = absolute(ctx, img.attr('data-original') || img.attr('data-src') || img.attr('src'));
    const previous = cards.get(match[1]);
    if (previous) {
      if (!previous.title && title) previous.title = title;
      if (!previous.poster && poster) previous.poster = poster;
    } else {
      cards.set(match[1], { id: match[1], title, poster, year: '', desc: '', type_name: '', douban_id: 0, vod_remarks: '' });
    }
  });
  let pageCount = page;
  const basePath = new URL(url).pathname.replace(/page\/\d+\/$/, '');
  $('a[href]').each((_, el) => {
    try {
      const link = new URL($(el).attr('href'), url);
      const match = link.pathname.match(/\/page\/(\d+)\/$/);
      if (link.origin === site && match && link.pathname.replace(/page\/\d+\/$/, '') === basePath) {
        pageCount = Math.max(pageCount, Number(match[1]));
      }
    } catch {}
  });
  const list = [...cards.values()].filter(item => item.title);
  // total describes this page, not an invented full-site count.
  return { list, page, pageCount, total: list.length };
}

return {
  meta: { name: '18J', author: 'admin', site, version: '2.0' },
  async getSources() {
    return [
      { id: 'latest', name: '最新收录' },
      { id: 'cat_1', name: '国产' },
      { id: 'cat_2', name: '日韩' },
      { id: 'cat_3', name: '欧美' },
      { id: 'cat_4', name: '伦理' },
      { id: 'cat_5', name: '动漫' },
      { id: 'cat_6', name: '另类' }
    ];
  },
  async search(ctx, { keyword, page = 1, sourceId }) {
    page = Math.max(1, parseInt(page, 10) || 1);
    const sid = !sourceId || sourceId === 'default' ? 'latest' : String(sourceId);
    if (!String(keyword || '').trim()) {
      let path;
      if (sid === 'latest') path = '/label/hot/by/time/';
      else if (/^cat_[1-6]$/.test(sid)) path = '/t/' + sid.slice(4) + '/';
      else throw new Error('分类不存在');
      return fetchListPage(ctx, site + path + (page > 1 ? 'page/' + page + '/' : ''), page);
    }
    if (sid !== 'latest') return { list: [], page, pageCount: 1, total: 0 };
    const empty = { list: [], page, pageCount: 1, total: 0 };
    // The suggest endpoint is not paginated; do not repeat page one indefinitely.
    if (page > 1 || !String(keyword || '').trim()) return empty;
    const url = ctx.utils.buildUrl(site + '/index.php/ajax/suggest', {
      mid: 1, wd: String(keyword).trim(),
    });
    const data = await ctx.request.getJson(url, { headers: requestHeaders(ctx) });
    const raw = Array.isArray(data?.list) ? data.list : [];
    const list = raw.filter(item => /^\d+$/.test(String(item.id))).map(item => ({
      id: String(item.id), title: String(item.name || ''),
      poster: absolute(ctx, item.pic), year: '', desc: '',
      type_name: '', douban_id: 0, vod_remarks: '',
    }));
    return { list, page: 1, pageCount: 1, total: list.length };
  },
  async recommend(ctx, { page = 1 }) {
    page = Math.max(1, parseInt(page, 10) || 1);
    return fetchListPage(ctx, site + '/label/hot/by/time/' + (page > 1 ? 'page/' + page + '/' : ''), page);
  },
  async detail(ctx, { id, sourceId }) {
    if (!/^\d+$/.test(String(id))) throw new Error('视频 ID 必须为数字');
    const pageUrl = site + '/v/' + id + '-1-1/';
    const response = await ctx.fetch({ url: pageUrl, headers: requestHeaders(ctx) });
    if (!response.ok) throw new Error('播放页请求失败: ' + response.status);
    const html = await response.text();
    const $ = ctx.html.load(html);
    let playUrl = '';
    const match = html.match(/const\s+source\s*=\s*['"]([^'"]+)['"]/);
    if (match) playUrl = match[1];
    if (!playUrl) {
      const findVideo = value => {
        if (!value || typeof value !== 'object') return '';
        if (Array.isArray(value)) {
          for (const item of value) { const found = findVideo(item); if (found) return found; }
          return '';
        }
        const types = [].concat(value['@type'] || []);
        if (types.includes('VideoObject') && typeof value.contentUrl === 'string') return value.contentUrl;
        return findVideo(value['@graph']);
      };
      $('script[type="application/ld+json"]').each((_, el) => {
        try { playUrl = findVideo(JSON.parse($(el).text())); } catch {}
        return !playUrl;
      });
    }
    if (!playUrl) playUrl = $('meta[property="og:video"]').attr('content')
      || $('meta[property="og:video:url"]').attr('content')
      || $('video source').attr('src') || $('video').attr('src') || '';
    if (!playUrl) playUrl = html.match(/https?:\/\/[^"'<>\s]+\.m3u8[^"'<>\s]*/)?.[0] || '';
    playUrl = playUrl.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (!playUrl) throw new Error('未解析到播放地址，可能页面结构变化或被拦截');
    playUrl = ctx.utils.joinUrl(pageUrl, playUrl);
    if (!/^https?:\/\//i.test(playUrl)) throw new Error('播放地址协议不支持');
    return { id: String(id),
      title: ($('h1.play-title').first().text() || $('meta[property="og:title"]').attr('content') || '').trim(),
      poster: absolute(ctx, $('meta[property="og:image"]').attr('content')),
      year: '', desc: ($('meta[name="description"]').attr('content') || '').trim(),
      playbacks: [{ sourceId: sourceId || 'default', sourceName: '主站',
        episodes: [playUrl], episodes_titles: ['正片'] }] };
  },
  async resolvePlayUrl(ctx, { playUrl }) {
    return { url: playUrl, type: 'auto', headers: requestHeaders(ctx) };
  },
};
