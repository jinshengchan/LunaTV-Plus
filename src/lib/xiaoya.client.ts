// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/lib/xiaoya.client.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.

import type { AdminConfig } from '@/lib/admin.types';

// 与 src/lib/admin.types.ts 中的 XiaoyaConfig 保持一致。
export interface XiaoyaConfigShape {
  Enabled: boolean; // 是否启用
  ServerURL: string; // Alist 服务器地址
  Token?: string; // Token 认证（推荐）
  Username?: string; // 用户名认证（备选）
  Password?: string; // 密码认证（备选）
  DisableVideoPreview?: boolean; // 禁用预览视频，直接返回直连链接
}

/**
 * 从 AdminConfig 中读取小雅配置。
 */
export function getXiaoyaConfig(adminConfig: AdminConfig): XiaoyaConfigShape | undefined {
  const cfg = adminConfig?.XiaoyaConfig as XiaoyaConfigShape | undefined;
  if (!cfg || !cfg.Enabled || !cfg.ServerURL) return undefined;
  return cfg;
}

/**
 * 规范化 API Base URL：trim 并去除末尾斜杠，避免拼接路径时出现双斜杠。
 * （MoonTVPlus 的 `@/lib/url` 中 `normalizeApiBaseUrl` 的内联移植；LunaTV 暂无等价函数。）
 */
export function normalizeApiBaseUrl(url: string | undefined | null): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

// Token 内存缓存
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface XiaoyaFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
}

export interface XiaoyaListResponse {
  content: XiaoyaFile[];
  total: number;
}

export class XiaoyaClient {
  private token = '';
  private baseURL: string;

  constructor(
    baseURL: string,
    private username?: string,
    private password?: string,
    private configToken?: string
  ) {
    this.baseURL = normalizeApiBaseUrl(baseURL);
  }

  /**
   * 使用账号密码登录获取Token
   */
  static async login(
    baseURL: string,
    username: string,
    password: string
  ): Promise<string> {
    const normalizedBaseURL = normalizeApiBaseUrl(baseURL);
    const response = await fetch(`${normalizedBaseURL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        password,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅登录失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200 || !data.data?.token) {
      throw new Error('小雅登录失败: 未获取到Token');
    }

    return data.data.token;
  }

  /**
   * 获取缓存的 Token 或重新登录
   */
  async getToken(): Promise<string> {
    // 如果配置了 Token，直接使用
    if (this.configToken) {
      return this.configToken;
    }

    // 如果没有配置用户名密码，返回空字符串（guest 模式）
    if (!this.username || !this.password) {
      return '';
    }

    const cacheKey = `${this.baseURL}:${this.username}`;
    const cached = tokenCache.get(cacheKey);

    // 如果有缓存且未过期，直接返回
    if (cached && cached.expiresAt > Date.now()) {
      this.token = cached.token;
      return this.token;
    }

    // 否则重新登录
    this.token = await XiaoyaClient.login(
      this.baseURL,
      this.username,
      this.password
    );

    // 缓存 Token，设置 1 小时过期
    tokenCache.set(cacheKey, {
      token: this.token,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    return this.token;
  }

  /**
   * 获取基础 URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }

  /**
   * 列出目录内容
   */
  async listDirectory(path: string, page = 1, perPage = 100, refresh = false): Promise<XiaoyaListResponse> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseURL}/api/fs/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify({
        path,
        page,
        per_page: perPage,
        refresh,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅列表获取失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`小雅列表获取失败: ${data.message}`);
    }

    return {
      content: data.data.content || [],
      total: data.data.total || 0,
    };
  }

  /**
   * 搜索文件
   */
  async search(keyword: string, page = 1, perPage = 100): Promise<XiaoyaListResponse> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseURL}/api/fs/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify({
        parent: '/',
        keywords: keyword,
        scope: 1, // 递归搜索
        page,
        per_page: perPage,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅搜索失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`小雅搜索失败: ${data.message}`);
    }

    return {
      content: data.data.content || [],
      total: data.data.total || 0,
    };
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(path: string): Promise<XiaoyaFile> {
    const token = await this.getToken();

    const response = await fetch(`${this.baseURL}/api/fs/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token,
      },
      body: JSON.stringify({
        path,
      }),
    });

    if (!response.ok) {
      throw new Error(`小雅文件信息获取失败: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`小雅文件信息获取失败: ${data.message}`);
    }

    return data.data;
  }

  /**
   * 获取文件下载链接
   */
  async getDownloadUrl(path: string): Promise<string> {
    // Alist 的直接下载链接格式
    return `${this.baseURL}/d${path}`;
  }

  /**
   * 获取文件内容（用于读取 NFO 等文本文件）
   */
  async getFileContent(path: string): Promise<string> {
    const downloadUrl = await this.getDownloadUrl(path);

    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`文件读取失败: ${response.status}`);
    }

    return await response.text();
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(path: string): Promise<boolean> {
    try {
      await this.getFileInfo(path);
      return true;
    } catch {
      return false;
    }
  }
}
