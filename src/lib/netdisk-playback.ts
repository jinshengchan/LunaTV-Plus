import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  NetDiskAccount,
  NetDiskProvider,
  NetDiskShareClient,
  SharedDiskFile,
} from '@/lib/netdisk-share';

const TTL = 6 * 60 * 60;
interface ShareSession {
  id: string;
  owner: string;
  provider: NetDiskProvider;
  shareId: string;
  shareToken: string;
  title: string;
  accountVersion: string;
  expiresAt: number;
  files: Record<string, SharedDiskFile>;
  saved: Record<string, string>;
}

const sessions = new Map<string, ShareSession>();
const clients = new Map<
  NetDiskProvider,
  { version: string; client: NetDiskShareClient }
>();
const saves = new Map<string, Promise<string>>();

export async function netDiskAccount(provider: NetDiskProvider) {
  if (provider !== 'quark' && provider !== 'uc')
    throw new Error('暂不支持此网盘播放');
  const config = (await getConfig()).NetDiskConfig;
  const account = config?.playback?.[provider];
  if (
    !config?.enabled ||
    !config.playback?.enabled ||
    !account?.cookie?.trim()
  ) {
    throw new Error('请在管理后台的网盘搜索配置中启用在线播放并配置该网盘账号');
  }
  const version = createHash('sha256').update(account.cookie).digest('hex');
  if (clients.get(provider)?.version !== version) {
    clients.set(provider, {
      version,
      client: new NetDiskShareClient(provider, account),
    });
  }
  return { account, version, client: clients.get(provider)!.client };
}

export async function netDiskCapabilities() {
  const config = (await getConfig()).NetDiskConfig;
  return Object.fromEntries(
    (['quark', 'uc'] as const).map((provider) => [
      provider,
      Boolean(
        config?.enabled &&
        config.playback?.enabled &&
        config.playback[provider]?.cookie?.trim(),
      ),
    ]),
  );
}

async function persist(session: ShareSession) {
  for (const [key, value] of sessions)
    if (value.expiresAt <= Date.now()) sessions.delete(key);
  if (!sessions.has(session.id) && sessions.size >= 200)
    sessions.delete(sessions.keys().next().value);
  sessions.set(session.id, session);
  // Redis-backed sessions survive restarts; memory supports a single local instance.
  try {
    await db.setCache(
      `netdisk-play:${session.id}`,
      session,
      Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000)),
    );
  } catch {
    /* localstorage has no server cache */
  }
}

export async function createNetDiskSession(
  owner: string,
  provider: NetDiskProvider,
  shareId: string,
  password: string,
  title: string,
) {
  const { version, client } = await netDiskAccount(provider);
  const shareToken = await client.shareToken(shareId, password);
  const session: ShareSession = {
    id: nanoid(32),
    owner,
    provider,
    shareId,
    shareToken,
    accountVersion: version,
    title: title.slice(0, 200) || '网盘视频',
    expiresAt: Date.now() + TTL * 1000,
    files: {},
    saved: {},
  };
  await persist(session);
  return session;
}

export async function getNetDiskSession(id: string, owner: string) {
  if (!/^[a-zA-Z0-9_-]{32}$/.test(id))
    throw new Error('播放会话不存在，请重新选择搜索结果');
  let session = sessions.get(id);
  if (!session) {
    try {
      session = (await db.getCache(`netdisk-play:${id}`)) || undefined;
    } catch {
      /* no persistent cache */
    }
  }
  if (!session || session.owner !== owner || session.expiresAt <= Date.now()) {
    throw new Error('播放会话已过期或无权访问，请重新选择搜索结果');
  }
  const access = await netDiskAccount(session.provider);
  if (session.accountVersion !== access.version)
    throw new Error('网盘账号已更新，请重新选择搜索结果');
  return { session, ...access };
}

export async function listNetDiskFiles(
  id: string,
  owner: string,
  folderId: string,
  page: number,
) {
  const { session, client } = await getNetDiskSession(id, owner);
  if (folderId !== '0' && !session.files[folderId]?.directory)
    throw new Error('目录不在当前分享中');
  const result = await client.list(
    session.shareId,
    session.shareToken,
    folderId,
    page,
  );
  if (Object.keys(session.files).length + result.files.length > 5000)
    throw new Error('分享目录过大，请重新打开资源');
  for (const file of result.files) session.files[file.id] = file;
  await persist(session);
  return {
    sessionId: id,
    title: session.title,
    provider: session.provider,
    folderId,
    page,
    hasMore: result.hasMore,
    files: result.files
      .filter((file) => file.directory || file.video)
      .map(({ shareFileToken: _token, ...file }) => file),
  };
}

export async function prepareNetDiskVideo(
  id: string,
  owner: string,
  fileId: string,
) {
  const { session, account, client } = await getNetDiskSession(id, owner);
  const file = session.files[fileId];
  if (!file?.video || file.directory)
    throw new Error('请选择当前分享中的视频文件');
  if (!session.saved[fileId]) {
    const key = `${session.provider}:${session.accountVersion}:${session.shareId}:${fileId}`;
    let pending = saves.get(key);
    if (!pending) {
      pending = client.save(
        session.shareId,
        session.shareToken,
        file,
        account.folderName || 'MoonTV在线播放',
      );
      saves.set(key, pending);
    }
    try {
      session.saved[fileId] = await pending;
    } finally {
      if (saves.get(key) === pending) saves.delete(key);
    }
    await persist(session);
  }
  return {
    name: file.name,
    url: `/api/netdisk/stream?session=${encodeURIComponent(id)}&file=${encodeURIComponent(fileId)}`,
  };
}

export function validateNetDiskAccount(value: unknown): NetDiskAccount {
  const account = value as NetDiskAccount;
  if (
    !account ||
    typeof account.cookie !== 'string' ||
    account.cookie.length > 20000 ||
    /[\r\n]/.test(account.cookie)
  ) {
    throw new Error('网盘 Cookie 格式不正确');
  }
  if (
    account.folderName !== undefined &&
    typeof account.folderName !== 'string'
  )
    throw new Error('转存目录名称不正确');
  const folderName = account.folderName?.trim() || 'MoonTV在线播放';
  if (
    typeof folderName !== 'string' ||
    folderName.length > 80 ||
    folderName === '.' ||
    folderName === '..' ||
    /[\\/\r\n]/.test(folderName)
  ) {
    throw new Error('转存目录名称不正确');
  }
  return { cookie: account.cookie.trim(), folderName };
}
