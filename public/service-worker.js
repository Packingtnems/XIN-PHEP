const CACHE_NAME = 'leave-app-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Khi cài đặt Service Worker
self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching resources...');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// Khi kích hoạt Service Worker
self.addEventListener('activate', event => {
  console.log('✅ Service Worker activated');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Khi request tài nguyên
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

// Khi nhận được push notification từ server
self.addEventListener('push', event => {
  console.log('📲 Push notification received:', event);
  
  if (!event.data) {
    console.log('Empty push data');
    return;
  }
  
  try {
    const data = event.data.json();
    console.log('Push data:', data);
    
    const options = {
      body: data.body || 'Có thông báo mới',
      icon: data.icon || '/icon-192x192.png',
      badge: data.badge || '/icon-192x192.png',
      data: data.data || {},
      tag: data.tag || 'leave-notification',
      requireInteraction: true,
      vibrate: [200, 100, 200],
      actions: [
        {
          action: 'open',
          title: 'Mở ứng dụng'
        },
        {
          action: 'close',
          title: 'Đóng'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title || 'Thông báo', options)
    );
    
  } catch (error) {
    console.error('Error parsing push data:', error);
    
    // Fallback cho text notification
    const options = {
      body: event.data.text(),
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png'
    };
    
    event.waitUntil(
      self.registration.showNotification('Thông báo', options)
    );
  }
});

// Khi người dùng click vào notification
self.addEventListener('notificationclick', event => {
  console.log('👆 Notification clicked:', event.notification.tag);
  
  const notification = event.notification;
  const action = event.action;
  
  notification.close();
  
  if (action === 'close') {
    return;
  }
  
  // Mở hoặc focus ứng dụng
  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(clientList => {
      // Nếu app đang mở, focus vào
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) {
          console.log('Focusing existing window');
          return client.focus();
        }
      }
      // Nếu không, mở tab mới
      if (clients.openWindow) {
        console.log('Opening new window');
        return clients.openWindow('/');
      }
    })
  );
});

// Khi notification bị đóng
self.addEventListener('notificationclose', event => {
  console.log('📪 Notification closed:', event.notification.tag);
});