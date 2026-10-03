// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/admin/xiaoya/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.

import { NextRequest, NextResponse } from 'next/server';

import { ensureAdmin } from '@/lib/admin-auth';
import { clearConfigCache, getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { normalizeApiBaseUrl, XiaoyaClient } from '@/lib/xiaoya.client';

export const runtime = 'nodejs';

/**
 * POST /api/admin/xiaoya
 * 管理小雅配置（仅管理员）
 * body: { action: 'test' | 'save', Enabled, ServerURL, Token, Username, Password, DisableVideoPreview }
 *
 * 适配说明：MoonTVPlus 用 `getAuthInfoFromCookie` + role 校验；LunaTV 管理路由统一用
 * `ensureAdmin`（见 src/app/api/admin/download-config/route.ts）。
 */
export async function POST(request: NextRequest) {
  // 权限检查
  try {
    await ensureAdmin(request);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '无权限' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { action, ...configData } = body;

    if (action === 'test') {
      // 测试连接
      try {
        const client = new XiaoyaClient(
          normalizeApiBaseUrl(configData.ServerURL),
          configData.Username,
          configData.Password,
          configData.Token
        );

        // 尝试列出根目录
        await client.listDirectory('/');

        return NextResponse.json({ success: true, message: '连接成功' });
      } catch (error) {
        return NextResponse.json(
          { success: false, message: (error as Error).message },
          { status: 400 }
        );
      }
    }

    if (action === 'save') {
      // 保存配置
      const config = await getConfig();

      config.XiaoyaConfig = {
        Enabled: configData.Enabled || false,
        ServerURL: normalizeApiBaseUrl(configData.ServerURL),
        Token: configData.Token,
        Username: configData.Username,
        Password: configData.Password,
        DisableVideoPreview: configData.DisableVideoPreview || false,
      };

      await db.saveAdminConfig(config);

      // 清除配置缓存
      clearConfigCache();

      return NextResponse.json({ success: true, message: '保存成功' });
    }

    return NextResponse.json({ error: '无效的操作' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
