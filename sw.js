/**
 * Treasure Trail — Service Worker
 *
 * Caches the app shell for offline access.
 * Uses a versioned cache key so old caches are cleaned on activation.
 * Does NOT cache map tiles — those require network.
 */

const CACHE_NAME = 'treasure-trail-v1';

const APP_SHELL = [
	'./',
	'./index.html',
	'./style.css',
	'./app.js',
	'./manifest.webmanifest',
	'./icons/icon-192.svg',
	'./icons/icon-512.svg'
];

// Install: precache the app shell
self.addEventListener('install', function (event) {
	event.waitUntil(
		caches.open(CACHE_NAME).then(function (cache) {
			return cache.addAll(APP_SHELL);
		}).then(function () {
			return self.skipWaiting();
		})
	);
});

// Activate: clean old caches
self.addEventListener('activate', function (event) {
	event.waitUntil(
		caches.keys().then(function (cacheNames) {
			return Promise.all(
				cacheNames.map(function (name) {
					if (name !== CACHE_NAME) {
						return caches.delete(name);
					}
				})
			);
		}).then(function () {
			return self.clients.claim();
		})
	);
});

// Fetch: cache-first for app shell, network-only for everything else (map tiles, etc.)
self.addEventListener('fetch', function (event) {
	// Skip non-GET requests
	if (event.request.method !== 'GET') {
		return;
	}

	// Skip browser extensions and chrome-extension URLs
	var url = new URL(event.request.url);
	if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') {
		return;
	}

	event.respondWith(
		caches.match(event.request).then(function (cached) {
			if (cached) {
				return cached;
			}
			// Network fallback — do NOT cache map tiles
			return fetch(event.request).then(function (response) {
				// Only cache same-origin app shell resources
				if (url.origin === self.location.origin && !url.pathname.includes('tile')) {
					var clone = response.clone();
					caches.open(CACHE_NAME).then(function (cache) {
						cache.put(event.request, clone);
					});
				}
				return response;
			}).catch(function () {
				// Offline fallback for navigation requests
				if (event.request.mode === 'navigate') {
					return caches.match('./index.html');
				}
				// For other resources, just fail
				return new Response('Offline — resource not cached.', {
					status: 503,
					statusText: 'Service Unavailable'
				});
			});
		})
	);
});
