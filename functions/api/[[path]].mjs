// FIZY Journal — точка входа для Cloudflare Pages Functions.
// Все запросы /api/* приходят сюда и идут в то же самое ядро, что и на Netlify.
import {createHandler} from '../../server/api-core.mjs';
import {createGetStore, pbkdf2Hex} from '../../server/cf-store.mjs';

export async function onRequest(context) {
  const {request, env} = context;
  const handler = createHandler({
    getStore: createGetStore(env),
    env,
    passwordHasher: pbkdf2Hex
  });
  return handler(request, {ip: request.headers.get('CF-Connecting-IP') || 'unknown'});
}
