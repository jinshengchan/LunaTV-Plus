/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import dns from 'node:dns/promises';
import net from 'node:net';

import { DEFAULT_USER_AGENT } from '@/lib/user-agent';

export const dynamic = 'force-dynamic';

/** 是否为内网/回环/保留 IP（SSRF 防护） */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    );
  }
  if (net.isIPv6(ip)) {
    const n = ip.toLowerCase();
    return (
      n === '::1' ||
      n.startsWith('fc') ||
      n.startsWith('fd') ||
      n.startsWith('fe80')
    );
  }
  return true;
}

/**
 * GET /api/probe-video?url=<m3u8地址>
 * 服务端真实请求 m3u8 前 4KB，校验是否为有效播放列表。
 * 用于自动换源前的可播放性测速：只有这里返回 ok 的源才会被选中。
 */
export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url') || '';

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-url' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ ok: false, reason: 'bad-scheme' });
  }

  // SSRF 防护：解析域名，拒绝内网 IP
  try {
    const addrs = await dns.lookup(parsed.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
      return NextResponse.json({ ok: false, reason: 'private-ip' });
    }
  } catch {
    return NextResponse.json({ ok: false, reason: 'dns-fail' });
  }

  const t0 = Date.now();
  try {
    const res = await fetch(rawUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Accept: '*/*',
        Range: 'bytes=0-4095',
        'Accept-Encoding': 'identity',
      },
      signal: AbortSignal.timeout(8000),
    });
    const latency = Date.now() - t0;
    if (!res.ok && res.status !== 206) {
      return NextResponse.json({
        ok: false,
        reason: `http-${res.status}`,
        latency,
      });
    }
    const head = (await res.text()).replace(/^\uFEFF/, '').trimStart();
    const ok = head.startsWith('#EXTM3U');
    return NextResponse.json({
      ok,
      reason: ok ? undefined : 'not-m3u8',
      latency,
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : 'fetch-fail',
      latency: Date.now() - t0,
    });
  }
}
