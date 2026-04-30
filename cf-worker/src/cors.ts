import type { Env } from './types';
import { isOriginAllowed } from './auth';

/**
 * CORS ヘッダーを付与. yobuho.com とサブドメインのみ許可 (ALLOWED_ORIGINS env var).
 *
 * 不一致 origin の場合は Access-Control-Allow-Origin ヘッダ自体を付けない.
 * (旧実装は 'null' を返していたが、'null' は valid origin として
 *  sandbox iframe 等から通ってしまうため allowlist の意図と矛盾していた)
 */
export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && isOriginAllowed(origin, env)) {
    base['Access-Control-Allow-Origin'] = origin;
  }
  return base;
}

export function corsPreflight(req: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req, env) });
}

export function jsonResponse(
  data: unknown,
  req: Request,
  env: Env,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(req, env),
    },
  });
}
