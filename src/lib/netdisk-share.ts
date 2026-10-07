export type NetDiskProvider = 'quark' | 'uc';

export interface NetDiskAccount {
  cookie: string;
  folderName?: string;
}

export interface NetDiskPlaybackConfig {
  enabled: boolean;
  quark?: NetDiskAccount;
  uc?: NetDiskAccount;
}

export interface SharedDiskFile {
  id: string;
  name: string;
  directory: boolean;
  video: boolean;
  size: number;
  parentId: string;
  shareFileToken: string;
}

const PROVIDERS = {
  quark: {
    api: 'https://drive-pc.quark.cn/1/clouddrive',
    referer: 'https://pan.quark.cn/',
    pr: 'ucpro',
    name: '夸克',
  },
  uc: {
    api: 'https://pc-api.uc.cn/1/clouddrive',
    referer: 'https://drive.uc.cn/',
    pr: 'UCBrowser',
    name: 'UC',
  },
};

export const NETDISK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function parseNetDiskShare(raw: string, password = '') {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('分享链接格式不正确');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  ) {
    throw new Error('请使用网盘官方 HTTPS 分享链接');
  }
  const provider: NetDiskProvider =
    url.hostname === 'pan.quark.cn'
      ? 'quark'
      : url.hostname === 'drive.uc.cn'
        ? 'uc'
        : null;
  const shareId = url.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
  if (!provider || !shareId) throw new Error('首批支持夸克和 UC 分享链接');
  return {
    provider,
    shareId,
    password:
      password.trim() ||
      url.searchParams.get('pwd') ||
      url.searchParams.get('passcode') ||
      '',
  };
}

export function canSendNetDiskCookie(
  provider: NetDiskProvider,
  url: string,
): boolean {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' ||
    (parsed.port && parsed.port !== '443') ||
    parsed.username ||
    parsed.password
  )
    return false;
  const domains = provider === 'quark' ? ['quark.cn'] : ['uc.cn', 'ucweb.com'];
  return domains.some(
    (domain) =>
      parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
  );
}

// The share and account endpoints are fixed; user input never chooses an API host.
export class NetDiskShareClient {
  cookie: string;
  readonly provider: NetDiskProvider;
  private fetcher: typeof fetch;
  private pause: (ms: number) => Promise<void>;
  constructor(
    provider: NetDiskProvider,
    account: NetDiskAccount,
    fetcher: typeof fetch = fetch,
    pause: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.provider = provider;
    this.fetcher = fetcher;
    this.pause = pause;
    this.cookie = account.cookie;
    if (!this.cookie.trim() || /[\r\n]/.test(this.cookie))
      throw new Error('请在管理后台配置有效的网盘账号 Cookie');
  }

  get referer() {
    return PROVIDERS[this.provider].referer;
  }

  private async request(
    path: string,
    params: Record<string, string> = {},
    body?: Record<string, unknown>,
  ) {
    const cfg = PROVIDERS[this.provider];
    const url = new URL(cfg.api + path);
    url.search = new URLSearchParams({
      pr: cfg.pr,
      fr: 'pc',
      ...params,
    }).toString();
    const response = await this.fetcher(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Cookie: this.cookie,
        Referer: cfg.referer,
        'User-Agent': NETDISK_USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      if (name && /^[a-zA-Z0-9_]+$/.test(name)) {
        this.cookie = [
          ...this.cookie
            .split(';')
            .map((v) => v.trim())
            .filter((v) => !v.startsWith(`${name}=`)),
          pair,
        ].join('; ');
      }
    }
    // Never echo upstream responses: they can contain account or share tokens.
    if (!response.ok)
      throw new Error(`${cfg.name}接口请求失败，请检查账号授权或网络`);
    const data = await response.json();
    if (data.code !== 0 || (data.status && data.status !== 200)) {
      throw new Error(
        `${cfg.name}请求被拒绝，请检查 Cookie、提取码、分享有效性及账号容量`,
      );
    }
    return data;
  }

  async shareToken(shareId: string, password: string): Promise<string> {
    const result = await this.request(
      '/share/sharepage/token',
      {},
      { pwd_id: shareId, passcode: password },
    );
    if (!result.data?.stoken) throw new Error('分享链接已失效或提取码不正确');
    return result.data.stoken;
  }

  async list(shareId: string, token: string, folderId = '0', page = 1) {
    const result = await this.request('/share/sharepage/detail', {
      pwd_id: shareId,
      stoken: token,
      pdir_fid: folderId,
      _page: String(page),
      _size: '50',
      _fetch_total: '1',
      _fetch_share: '1',
      _fetch_banner: '0',
      ver: '2',
      _sort: 'file_type:asc,file_name:asc',
      force: '0',
    });
    const files: SharedDiskFile[] = (result.data?.list || []).map(
      (item: Record<string, unknown>) => ({
        id: String(item.fid),
        name: String(item.file_name || ''),
        directory: Boolean(item.dir),
        video:
          !item.dir &&
          /\.(mp4|mkv|webm|mov|m4v|avi|ts|m2ts|flv)$/i.test(
            String(item.file_name),
          ),
        size: Number(item.size) || 0,
        parentId: folderId,
        shareFileToken: String(item.share_fid_token || ''),
      }),
    );
    return {
      files,
      hasMore:
        result.metadata?._total !== undefined
          ? page * 50 < Number(result.metadata._total)
          : files.length === 50,
    };
  }

  async save(
    shareId: string,
    token: string,
    file: SharedDiskFile,
    folderName = 'MoonTV在线播放',
  ): Promise<string> {
    if (file.directory || !file.video || !file.shareFileToken)
      throw new Error('请选择可播放的视频文件');
    if (
      !/^[a-zA-Z0-9_-]+$/.test(shareId) ||
      !/^[a-zA-Z0-9_-]+$/.test(file.parentId) ||
      /[\\/\r\n]/.test(folderName)
    ) {
      throw new Error('转存目录参数不正确');
    }
    const path = `/${folderName}/${shareId}/${file.parentId}`;
    const existing = await this.request(
      '/file/info/path_list',
      {},
      { file_path: [path], namespace: '0' },
    );
    let folderId = existing.data?.[0]?.fid;
    if (!folderId) {
      const folder = await this.request(
        '/file',
        {},
        { pdir_fid: '0', file_name: '', dir_path: path, dir_init_lock: false },
      );
      folderId = folder.data?.fid;
    }
    if (!folderId) throw new Error('无法创建在线播放转存目录');
    // Reuse files from this exact share and directory; never delete account files.
    for (let page = 1; page <= 100; page++) {
      const listing = await this.request('/file/sort', {
        pdir_fid: String(folderId),
        _page: String(page),
        _size: '100',
      });
      const match = listing.data?.list?.find(
        (item: Record<string, unknown>) =>
          !item.dir &&
          item.file_name === file.name &&
          Number(item.size) === file.size,
      );
      if (match) return String(match.fid);
      if (!listing.data?.list || listing.data.list.length < 100) break;
      if (page === 100) throw new Error('转存目录文件过多，请更换目录名称');
    }
    const saved = await this.request(
      '/share/sharepage/save',
      {},
      {
        fid_list: [file.id],
        fid_token_list: [file.shareFileToken],
        to_pdir_fid: String(folderId),
        pwd_id: shareId,
        stoken: token,
        pdir_fid: file.parentId,
        scene: 'link',
      },
    );
    if (!saved.data?.task_id) throw new Error('网盘未返回转存任务');
    for (let retry = 0; retry < 20; retry++) {
      const task = await this.request('/task', {
        task_id: String(saved.data.task_id),
        retry_index: String(retry),
      });
      const fid = task.data?.save_as?.save_as_top_fids?.[0];
      if (fid) return String(fid);
      if (task.data?.status === 2)
        throw new Error('转存任务完成但未返回视频文件');
      await this.pause(500);
    }
    throw new Error('转存仍在处理中，请稍后重新选择视频');
  }

  async download(fileId: string): Promise<string> {
    const response = await this.request(
      '/file/download',
      {},
      { fids: [fileId] },
    );
    const url = response.data?.[0]?.download_url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url))
      throw new Error('未取得视频播放地址');
    return url;
  }
}
