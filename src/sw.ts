/**
 * Service worker (SPEC §8): the app shell, fonts and sprites are precached; data files live in
 * versioned caches filled by the app itself and are served cache-first here.
 */
/// <reference lib="webworker" />
import { type PrecacheEntry, cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// A new shell takes over at the next launch; data caches are untouched (the app switches them itself).
self.addEventListener('install', () => {
  void self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const DATA_PATH = new URL('data/', self.registration.scope).pathname;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(DATA_PATH)) return;
  if (url.pathname.endsWith('/manifest.json')) return; // always network: tells whether an update exists
  // Data URLs carry ?v=<version>, so an exact match never mixes versions.
  event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));
});
