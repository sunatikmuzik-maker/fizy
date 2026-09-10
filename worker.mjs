// FIZY Journal — точка входа для Cloudflare Workers (статика + API в одном проекте).
// Файлы из public/ раздаёт сам Cloudflare (биндинг ASSETS), а сюда попадают только /api/*.
import {createHandler} from './server/api-core.mjs';
import {createGetStore, pbkdf2Hex} from './server/cf-store.mjs';

let handler = null;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // не наш маршрут — отдаём статику сайта
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', {status: 404});
    }
    handler ??= createHandler({
      getStore: createGetStore(env),
      env,
      passwordHasher: pbkdf2Hex
    });
    return handler(request, {ip: request.headers.get('CF-Connecting-IP') || 'unknown'});
  }
};
