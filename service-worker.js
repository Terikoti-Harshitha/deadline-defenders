// service-worker.js — Web Push & PWA Service Worker for Deadline Defenders

const CACHE_NAME = 'deadline-defenders-v1';
const STATIC_ASSETS = [
  '/',
  '/mobile.html',
  '/login.html',
  '/signup.html',
  '/push-notification-client.js'
];

// Install: Cache essential assets
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[Service Worker] Non-fatal asset caching error:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activated');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Push Event: Handle incoming web push notifications
self.addEventListener('push', event => {
  console.log('[Service Worker] Push event received');

  let data = {
    title: '⚡ Deadline Defender Alert',
    body: 'You have an upcoming deadline!',
    icon: 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
    data: { url: '/mobile.html' }
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
      if (!data.data) {
        data.data = { url: '/mobile.html' };
      }
    } catch (e) {
      data.body = event.data.text() || data.body;
    }
  }

  const notificationOptions = {
    body: data.body,
    icon: data.icon || 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
    badge: data.badge || 'https://cdn-icons-png.flaticon.com/512/1827/1827349.png',
    vibrate: [200, 100, 200],
    data: data.data || { url: '/mobile.html' },
    tag: data.tag || 'deadline-alert',
    renotify: true,
    requireInteraction: true,
    actions: [
      { action: 'open', title: '👀 View Details' },
      { action: 'close', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, notificationOptions)
  );
});

// Notification Click: Open the app and focus
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/mobile.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          if (client.url.includes(targetUrl) || client.url.includes('mobile.html')) {
            return client.focus();
          }
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});