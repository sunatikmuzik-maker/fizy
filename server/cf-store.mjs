// FIZY Journal — адаптер Cloudflare KV под интерфейс Netlify Blobs.
// Серверное ядро (server/api-core.mjs, server/community.mjs) остаётся без изменений:
// ему нужны только get / getWithMetadata / setJSON / delete.

const pick = (env, suffix) => {
  const map = {
    '': env.FIZY_KV,
    '-rate': env.FIZY_KV_RATE || env.FIZY_KV,
    '-community': env.FIZY_KV_COMMUNITY || env.FIZY_KV
  };
  const kv = map[suffix];
  if (!kv) throw Object.assign(Error('Не привязано KV-хранилище FIZY_KV. Привяжи его в настройках Cloudflare Pages.'), {status: 503});
  return kv;
};

// В KV нет условных записей, поэтому версию (etag) держим в metadata и сверяем вручную.
const wrap = kv => ({
  async get(key) {
    return (await kv.get(key, {type: 'json'})) ?? null;
  },
  async getWithMetadata(key) {
    const r = await kv.getWithMetadata(key, {type: 'json'});
    if (r.value == null) return null;
    return {data: r.value, etag: r.metadata?.etag ?? '0'};
  },
  async setJSON(key, value, options = {}) {
    const current = await kv.getWithMetadata(key, {type: 'json'});
    const exists = current.value != null;
    if (options.onlyIfNew && exists) return {modified: false};
    if (options.onlyIfMatch) {
      const etag = exists ? current.metadata?.etag ?? '0' : null;
      if (etag !== options.onlyIfMatch) return {modified: false};
    }
    const etag = crypto.randomUUID();
    await kv.put(key, JSON.stringify(value), {metadata: {etag}});
    return {modified: true, etag};
  },
  async delete(key) { await kv.delete(key) }
});

export const createGetStore = env => name => {
  const base = env.FIZY_STORE_NAME || 'fizy-journal-v1';
  const suffix = name === base ? '' : name.slice(base.length);
  return wrap(pick(env, suffix));
};

// scrypt в Cloudflare Workers недоступен — используем PBKDF2-SHA512 через WebCrypto.
const encoder = new TextEncoder();
export async function pbkdf2Hex(password, saltValue, length = 64) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt: encoder.encode(String(saltValue)), iterations: 210000, hash: 'SHA-512'},
    key, length * 8
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
