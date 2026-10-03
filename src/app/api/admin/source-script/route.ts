// Ported from mtvpls/MoonTVPlus (MIT License) — original: src/app/api/admin/source-script/route.ts
// Adapted for LunaTV (CC BY-NC-SA 4.0). Original authors: mtvpls and contributors.
// EXPERIMENTAL: this engine executes admin-provided JavaScript on the server (sandboxed via new Function).


import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  deleteSourceScript,
  getDefaultSourceScriptTemplate,
  importSourceScripts,
  listSourceScripts,
  saveSourceScript,
  testSourceScript,
  toggleSourceScriptEnabled,
} from '@/lib/source-script';

export const runtime = 'nodejs';

// 管理员身份校验（与 src/app/api/admin/source/route.ts 同一模式）
async function assertAdmin(request: NextRequest): Promise<string | null> {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  if (storageType === 'localstorage') {
    return null;
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.username) {
    return null;
  }
  const username = authInfo.username;

  if (username === process.env.USERNAME) {
    return username;
  }

  const adminConfig = await getConfig();
  const userEntry = adminConfig.UserConfig.Users.find(
    (u) => u.username === username
  );
  if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
    return null;
  }

  return username;
}

export async function GET(request: NextRequest) {
  try {
    const username = await assertAdmin(request);
    if (!username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const items = await listSourceScripts();
    return NextResponse.json(
      {
        items,
        template: getDefaultSourceScriptTemplate(),
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || '获取脚本列表失败' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = await assertAdmin(request);
    if (!username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, any>;
    const action = body.action as string;

    switch (action) {
      case 'save': {
        const saved = await saveSourceScript({
          id: body.id,
          key: body.key,
          name: body.name,
          description: body.description,
          code: body.code,
          enabled: body.enabled,
        });
        return NextResponse.json(
          { ok: true, item: saved },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          }
        );
      }
      case 'delete': {
        await deleteSourceScript(body.id);
        return NextResponse.json(
          { ok: true },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          }
        );
      }
      case 'toggle_enabled': {
        const item = await toggleSourceScriptEnabled(body.id);
        return NextResponse.json(
          { ok: true, item },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          }
        );
      }
      case 'test': {
        const result = await testSourceScript({
          code: body.code,
          hook: body.hook,
          payload: body.payload || {},
          name: body.name,
          key: body.key,
          configValues: body.configValues,
        });

        if (!result.ok) {
          return NextResponse.json(result, { status: 400 });
        }

        return NextResponse.json(result, {
          headers: {
            'Cache-Control': 'no-store',
          },
        });
      }
      case 'import': {
        const imported = await importSourceScripts(
          Array.isArray(body.items) ? body.items : []
        );
        return NextResponse.json(
          { ok: true, items: imported },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          }
        );
      }
      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: (error as Error).message || '脚本操作失败',
      },
      { status: 500 }
    );
  }
}
