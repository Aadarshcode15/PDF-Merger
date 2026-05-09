const CACHE_NAME = 'pdf-merger-v2';

const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/script.js',
    './manifest.json',
    './pdflogo.png',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Install — cache all static assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate — delete old caches from previous versions
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', event => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request)
            .then(cached => {
                if (cached) return cached;

                // Not in cache — fetch from network and cache it
                return fetch(event.request)
                    .then(response => {
                        // Only cache valid responses
                        if (!response || response.status !== 200 || response.type === 'error') {
                            return response;
                        }
                        const toCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(event.request, toCache));
                        return response;
                    })
                    .catch(() => {
                        // Offline fallback for HTML navigation requests
                        if (event.request.destination === 'document') {
                            return caches.match('./index.html');
                        }
                    });
            })
    );
});