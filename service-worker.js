const SHARE_CACHE = 'starlink-share-target-v1';
const META_URL = new URL('./share-target-metadata.json', self.registration.scope).href;
const FILE_URL = new URL('./share-target-file', self.registration.scope).href;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const isShareTarget = event.request.method === 'POST' &&
    requestUrl.origin === self.location.origin &&
    requestUrl.pathname.endsWith('/share-target.html');

  if (!isShareTarget) return;

  event.respondWith(handleShareTarget(event.request));
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const files = formData.getAll('comprobante').filter((item) => item && typeof item === 'object' && 'name' in item);
  const file = files[0] || null;
  const cache = await caches.open(SHARE_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.map((key) => cache.delete(key)));

  const metadata = {
    title: String(formData.get('title') || ''),
    text: String(formData.get('text') || ''),
    url: String(formData.get('url') || ''),
    receivedAt: new Date().toISOString(),
    file: file ? {
      name: file.name || 'comprobante',
      type: file.type || 'application/octet-stream',
      size: file.size || 0
    } : null
  };

  await cache.put(META_URL, new Response(JSON.stringify(metadata), {
    headers: { 'Content-Type': 'application/json' }
  }));

  if (file) {
    await cache.put(FILE_URL, new Response(file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream'
      }
    }));
  }

  return Response.redirect(new URL('./share-target.html?shared=1', self.registration.scope).href, 303);
}
