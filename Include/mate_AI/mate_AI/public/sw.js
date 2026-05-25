// Mate AI — Service Worker for PWA
const CACHE_NAME = 'mate-ai-v6';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/style.css?v=4',
    '/app.js?v=5',
    '/icon.svg',
    '/manifest.json'
];

// Install — cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(
                names
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch — network-first for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never cache API calls or uploads — always go to network
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
        return;
    }

    // Always fetch latest HTML/navigation first so UI updates show up quickly.
    if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
                    }
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // For static assets: try cache first, fall back to network
    event.respondWith(
        caches.match(event.request).then((cached) => {
            return cached || fetch(event.request).then((response) => {
                // Cache successful responses
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            });
        })
    );
});
