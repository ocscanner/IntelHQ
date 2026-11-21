// IntelHQ moved to hq.ocscanner.media. This replaces the old offline cache at this address:
// it deletes everything the old app saved here and removes itself, so phones stop showing
// the old copy and load the "moved" page instead.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    await self.registration.unregister();
    const wins = await self.clients.matchAll({ type: 'window' });
    wins.forEach(w => { try { w.navigate(w.url); } catch (e) {} });
  })());
});
