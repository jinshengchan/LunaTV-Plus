// Adapted from jinshengchan/huangguo-fongmi; original parsing helpers retained.
const SITE = 'https://huangguoai.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': SITE + '/'
};

const CLASSES = [
  { type_id: 'ai-duanju',  type_name: 'AI成人短剧' },
  { type_id: 'ai-manju',   type_name: 'AI成人漫剧' },
  { type_id: 'ai-huanlian', type_name: 'AI换脸' },
  { type_id: 'ai-mogai',   type_name: 'AI魔改' },
  { type_id: 'ranks/hot',  type_name: '排行榜' }
];

function fix(u) {
  if (!u) return '';
  u = String(u).replace(/&amp;/g, '&');
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (u.indexOf('/') === 0) return SITE + u;
  return u;
}

function coverUrl(u) {
  u = fix(u);
  if (!/^https?:\/\//i.test(u)) return '';
  return '/api/source-script/huangguo-cover?url=' + encodeURIComponent(u);
}

function stripTags(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function getHtml(ctx, url, referer) {
  const r = await ctx.fetch({ url, headers: { ...HEADERS, Referer: referer || SITE + '/' }, timeoutMs: 15000 });
  if (!r.ok) throw new Error('网站请求失败: ' + r.status);
  return await r.text();
}

function gridSlices(html, allGrids) {
  const re = /<div\s+class="[^"]*\bhg-card-grid\b[^"]*"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = re.exec(html)) !== null) starts.push(m.index + m[0].length);
  if (!starts.length) return [html];
  const slices = [];
  const n = allGrids ? starts.length : 1;
  for (let i = 0; i < n; i++) {
    const to = i + 1 < starts.length ? starts[i + 1] : html.length;
    slices.push(html.slice(starts[i], to));
  }
  return slices;
}

function cardBlocks(slice) {
  const re = /<div\s+class="[^"]*\bhg-drama-card\b[^"]*"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = re.exec(slice)) !== null) starts.push(m.index + m[0].length);
  const blocks = [];
  for (let i = 0; i < starts.length; i++) {
    const to = i + 1 < starts.length ? starts[i + 1] : slice.length;
    blocks.push(slice.slice(starts[i], to));
  }
  return blocks;
}

function parseCardBlock(block) {
  // New site uses /video/ID/ ; old source used /detail/ID/
  const a = block.match(/href="[^"]*\/(?:detail|video)\/(\d+)\/[^"]*"/);
  if (!a) return null;
  const vid = a[1];

  const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
  let title = '';

  const t = block.match(/hg-drama-card__title[^>]*>([\s\S]*?)<\/a>/);
  if (t) title = stripTags(t[1]);

  if (!title) {
    const tt = block.match(/<a[^>]+href="[^"]*\/(?:detail|video)\/\d+\/[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    if (tt) title = stripTags(tt[1]);
  }
  if (!title) return null;

  const ep = block.match(/hg-drama-card__episode[^>]*>([\s\S]*?)<\/span>/);
  const score = block.match(/hg-drama-card__score[^>]*>([\s\S]*?)<\/span>/);
  const rem = ep ? stripTags(ep[1]) : '';
  const sc = score ? stripTags(score[1]) : '';

  return {
    vod_id: vid,
    vod_name: title,
    vod_pic: coverUrl(imgM ? imgM[1] : ''),
    vod_remarks: rem && sc ? rem + ' · ' + sc : (rem || sc)
  };
}

function parseGridCards(html, allGrids) {
  if (!html) return [];
  const list = [];
  const seen = {};
  const slices = gridSlices(html, allGrids);

  for (let si = 0; si < slices.length; si++) {
    const blocks = cardBlocks(slices[si]);
    for (let bi = 0; bi < blocks.length; bi++) {
      try {
        const item = parseCardBlock(blocks[bi]);
        if (!item || seen[item.vod_id]) continue;
        seen[item.vod_id] = true;
        list.push(item);
      } catch (e) {}
    }
  }

  // Fallback for site layout changes: parse links around /video/ID/
  if (!list.length) {
    const re = /<a\b[^>]*href="([^"]*\/video\/(\d+)\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const id = m[2];
      if (seen[id]) continue;
      let name = stripTags(m[3]);
      name = name.replace(/全集在线观看\s*$/g, '').trim();
      if (!name || /^\d+$/.test(name)) continue;
      seen[id] = true;
      list.push({ vod_id: id, vod_name: name, vod_pic: '', vod_remarks: '' });
    }
  }

  return list;
}

function parseRanks(html) {
  if (!html) return [];
  const list = [];
  const seen = {};

  const listM = html.match(/<div\s+class="[^"]*\bhg-rank-list\b[^"]*"[^>]*>/);
  const slice = html.slice(listM ? listM.index + listM[0].length : 0);
  const re = /<div\s+class="[^"]*\bhg-rank-item\b[^"]*"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = re.exec(slice)) !== null) starts.push(m.index + m[0].length);

  for (let i = 0; i < starts.length; i++) {
    const to = i + 1 < starts.length ? starts[i + 1] : slice.length;
    const block = slice.slice(starts[i], to);
    const a = block.match(/href="[^"]*\/(?:detail|video)\/(\d+)\/[^"]*"/);
    if (!a || seen[a[1]]) continue;

    const id = a[1];
    const imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/);
    let title = '';
    const t = block.match(/hg-rank-item__title[^>]*>([\s\S]*?)<\/h2>/);
    if (t) title = stripTags(t[1]);
    if (!title) {
      const tt = block.match(/<a[^>]+href="[^"]*\/(?:detail|video)\/\d+\/[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (tt) title = stripTags(tt[1]);
    }
    if (!title) continue;

    const tags = block.match(/hg-rank-item__tags[^>]*>([\s\S]*?)<\/div>/);
    seen[id] = true;
    list.push({
      vod_id: id,
      vod_name: title,
      vod_pic: coverUrl(imgM ? imgM[1] : ''),
      vod_remarks: tags ? stripTags(tags[1]) : ''
    });
  }

  return list.length ? list : parseGridCards(html, true);
}

function parseTitle(html, fallback) {
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripTags(title[1]).replace(/\s*[-|｜].*$/, '').trim();
  return fallback || '';
}

function parsePic(html) {
  const data = html.match(/id=["']videoInitialData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (data) {
    try {
      const pic = JSON.parse(data[1]).coverSrc;
      if (pic) return coverUrl(pic);
    } catch (e) {}
  }
  const og = html.match(/<meta\b[^>]*(?:property|name)="og:image"[^>]*content="([^"]+)"[^>]*>/i) ||
             html.match(/<meta\b[^>]*content="([^"]+)"[^>]*(?:property|name)="og:image"[^>]*>/i);
  if (og) return coverUrl(og[1]);
  const pic = html.match(/<img\b[^>]*(?:class="[^"]*hg-web-detail[^\"]*"[^>]*)?(?:data-src|src)="([^"]+)"/i);
  return coverUrl(pic ? pic[1] : '');
}

function parseEpisodes(html, id) {
  const eps = [];
  const seen = {};

  // First try the dedicated episode grid used by the original site source.
  const gridM = html.match(/<div\s+class="[^"]*\bhg-web-detail__ep-grid\b[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const scope = gridM ? gridM[1] : html;
  const are = /<a\b[^>]*>[\s\S]*?<\/a>/g;
  let m;
  while ((m = are.exec(scope)) !== null) {
    const tag = m[0];
    const hrefM = tag.match(/href="([^"]+)"/);
    if (!hrefM) continue;
    const href = fix(hrefM[1]);
    if (href.indexOf('/video/' + id + '/') === -1 && href.indexOf('/detail/' + id + '/') === -1) continue;

    let ep = '';
    const eidM = tag.match(/data-ep-id="([^"]*)"/);
    if (eidM && eidM[1]) ep = eidM[1];
    if (!ep) {
      const p = href.match(/\/ep-(\d+)\/?/);
      if (p) ep = p[1];
    }
    if (!ep) {
      const tx = stripTags(tag).match(/(\d+)/);
      if (tx) ep = String(parseInt(tx[1], 10));
    }
    if (!ep) ep = '1';
    if (seen[ep]) continue;
    seen[ep] = true;
    eps.push({ ep: ep, url: href });
  }

  // If the grid selector changed, search the full page for /video/ID/ep-N/ links.
  const vre = new RegExp('href="([^"]*/video/' + id + '/(?:ep-(\\d+)/)?)"', 'g');
  while ((m = vre.exec(html)) !== null) {
    const ep = m[2] || '1';
    if (seen[ep]) continue;
    seen[ep] = true;
    eps.push({ ep: ep, url: fix(m[1]) });
  }

  if (!eps.length) eps.push({ ep: '1', url: SITE + '/video/' + id + '/' });
  eps.sort(function (a, b) { return parseInt(a.ep, 10) - parseInt(b.ep, 10); });
  return eps;
}

function normalizePlayUrl(u) {
  if (!u) return '';
  u = String(u)
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
  if (u.indexOf('//') === 0) u = 'https:' + u;
  if (u.indexOf('/') === 0) u = SITE + u;
  return u;
}

function extractPlay(html, ep) {
  let play = '';
  const m = html.match(/id=["']videoInitialData["'][^>]*>([\s\S]*?)<\/script>/i);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const srcs = data && data.epPlaySrcs ? data.epPlaySrcs : {};
      play = srcs[String(ep || '1')] || (data && data.videoSrc) || '';
    } catch (e) {}
  }

  play = normalizePlayUrl(play);

  if (!/^https?:\/\//i.test(play)) {
    const direct = html.match(/https?:\\?\/\\?\/[^"]+?\.m3u8(?:\?[^"'<>\s]*)?/i) ||
                   html.match(/https?:\/\/[^"'<>\s]+?\.m3u8(?:\?[^"'<>\s]*)?/i);
    if (direct) play = normalizePlayUrl(direct[0]);
  }
  return play;
}

function browseUrl(sourceId, page) {
  const sid = sourceId || 'home';
  if (sid === 'home') return SITE + '/';
  if (!CLASSES.some(item => item.type_id === sid)) throw new Error('分类不存在');
  return SITE + '/' + sid + '/' + (page > 1 ? page + '/' : '');
}
function pageCount(ctx, html, url, page) {
  const $ = ctx.html.load(html);
  const base = new URL(url).pathname.replace(/\d+\/$/, '');
  let max = page;
  $('a[href]').each((_, el) => {
    try {
      const link = new URL($(el).attr('href'), url);
      const match = link.pathname.match(/\/(\d+)\/$/);
      if (link.origin === SITE && match && link.pathname.replace(/\d+\/$/, '') === base) max = Math.max(max, Number(match[1]));
    } catch {}
  });
  return max;
}
function normalizeList(list) {
  return list.map(item => ({ id: item.vod_id, title: item.vod_name,
    poster: item.vod_pic, year: '', desc: '', type_name: '', douban_id: 0,
    vod_remarks: item.vod_remarks || '' }));
}
return {
  meta: { name: '黄果短剧', author: 'admin', site: SITE, version: '1.0',
    note: 'Adapted from jinshengchan/huangguo-fongmi and Yswag/xptv-extensions' },
  async getSources() {
    return [{ id: 'home', name: '首页推荐' }, ...CLASSES.map(item => ({ id: item.type_id, name: item.type_name }))];
  },
  async search(ctx, { keyword, page = 1, sourceId }) {
    page = Math.max(1, parseInt(page, 10) || 1);
    if (page > 10000) throw new Error('页码过大');
    const sid = sourceId && sourceId !== 'default' ? String(sourceId) : 'home';
    let url;
    if (String(keyword || '').trim()) {
      if (sid !== 'home') return { list: [], page, pageCount: page, total: 0 };
      url = SITE + '/search/video/' + encodeURIComponent(String(keyword).trim()) + '/' + (page > 1 ? page + '/' : '');
    } else {
      if (sid === 'home' && page > 1) return { list: [], page, pageCount: page, total: 0 };
      url = browseUrl(sid, page);
    }
    const html = await getHtml(ctx, url);
    const raw = sid.includes('rank') ? parseRanks(html) : parseGridCards(html, sid === 'home' && !keyword);
    const list = normalizeList(raw);
    return { list, page, pageCount: pageCount(ctx, html, url, page), total: list.length };
  },
  async recommend(ctx, { page = 1 }) {
    if (Number(page) > 1) return { list: [], page: Number(page), pageCount: Number(page), total: 0 };
    const html = await getHtml(ctx, SITE + '/');
    const list = normalizeList(parseGridCards(html, true));
    return { list, page: 1, pageCount: 1, total: list.length };
  },
  async detail(ctx, { id, sourceId }) {
    if (!/^\d+$/.test(String(id))) throw new Error('视频 ID 必须为数字');
    const html = await getHtml(ctx, SITE + '/video/' + id + '/');
    const eps = parseEpisodes(html, String(id));
    return { id: String(id), title: parseTitle(html, String(id)), poster: parsePic(html), year: '', desc: '',
      playbacks: [{ sourceId: sourceId || 'home', sourceName: '黄果',
        episodes: eps.map(ep => ep.url + '|||' + ep.ep),
        episodes_titles: eps.map(ep => '第' + ep.ep + '集') }] };
  },
  async resolvePlayUrl(ctx, { playUrl }) {
    const [pageUrl, ep = '1'] = String(playUrl || '').split('|||');
    const parsed = new URL(pageUrl);
    if (parsed.origin !== SITE || !/^\/video\/\d+\/(?:ep-\d+\/)?$/.test(parsed.pathname)) throw new Error('无效的分集地址');
    const html = await getHtml(ctx, parsed.href);
    const url = extractPlay(html, ep);
    if (!/^https?:\/\//i.test(url)) throw new Error('未解析到播放地址');
    return { url, type: 'auto', headers: { 'User-Agent': UA, Referer: SITE + '/' } };
  }
};
