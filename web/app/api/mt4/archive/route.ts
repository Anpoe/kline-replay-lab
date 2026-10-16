import { fetchLocalData } from '../../../lib/localDataService';

async function handle(request: Request) {
  const url = new URL(request.url), origin = request.headers.get('origin'), site = request.headers.get('sec-fetch-site');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || (origin && origin !== url.origin) || (site && !['same-origin','none'].includes(site)) || (request.method === 'POST' && !origin && request.headers.get('x-kline-mt4') !== '1')) return Response.json({ error: '请从本机训练营页面读取档案' }, { status: 403 });
  const token = request.headers.get('x-kline-mt4-session') ?? '';
  if (!/^[a-f0-9]{48}$/.test(token)) return Response.json({ error: '请重新验证本机连接' }, { status: 401 });
  try {
    let body: string | undefined;
    if (request.method === 'POST') {
      if (Number(request.headers.get('content-length')) > 128 * 1024 * 1024) return Response.json({ error: '档案内容过大' }, { status: 413 });
      body = await request.text();
      if (body.length > 128 * 1024 * 1024) return Response.json({ error: '档案内容过大' }, { status: 413 });
    }
    const result = await fetchLocalData(`/mt4/archive${url.search}`, { method: request.method, headers: { 'x-kline-mt4-session': token, 'content-type': 'application/json' }, ...(body ? { body } : {}) }, 60000);
    return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  } catch { return Response.json({ error: '历史档案未能读取或保存，请重启训练营控制面板后重试；当前编辑内容请先导出' }, { status: 503 }); }
}
export const GET = handle;
export const POST = handle;
