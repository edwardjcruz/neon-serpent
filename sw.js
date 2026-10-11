// Neon Serpent service worker: shows Neon Cue "your turn" push notifications and opens the room when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const title = data.title || 'Neon Cue', options = { body: data.body || 'Something happened at your table.', tag: data.tag || 'pool', renotify: true, icon: 'pool-icon-192.png', badge: 'pool-icon-192.png', data: { url: data.url || '/' } };
  event.waitUntil((async () => {
    // Browsers require every push to show a notification. If the player is already looking at the game,
    // show it silently and clear it straight away — the page itself plays the turn sound.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const watching = windows.some((client) => client.visibilityState === 'visible' && client.focused);
    await self.registration.showNotification(title, watching ? { ...options, silent: true, renotify: false } : options);
    if (watching) (await self.registration.getNotifications({ tag: options.tag })).forEach((notification) => notification.close());
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => client.url === target) || windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) { await open.focus(); if (open.url !== target && 'navigate' in open) await open.navigate(target); return; }
    await self.clients.openWindow(target);
  })());
});
