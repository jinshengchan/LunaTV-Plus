import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';
import { listEnabledSourceScripts } from '@/lib/source-script';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const availableSites = await getAvailableApiSites(authInfo.username);
    const sources = availableSites
      .filter((s) => Boolean(s.api?.trim()))
      .map((s) => ({ key: s.key, name: s.name, api: s.api }));

    const scripts = (await listEnabledSourceScripts()).map((item) => ({
      key: `script:${item.key}`,
      name: item.name,
      api: '',
    }));
    return NextResponse.json({ sources: [...sources, ...scripts] });
  } catch (error) {
    return NextResponse.json({ error: '获取源列表失败' }, { status: 500 });
  }
}
