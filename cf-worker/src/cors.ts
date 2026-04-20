import type { Env } from './types';

/**
 * CORS ヘッダーを付与. yobuho.com とサブドメインのみ許可 (ALLOWED_ORIGINS env var).
 */
export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
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
