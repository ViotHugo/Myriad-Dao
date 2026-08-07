// Service worker: precache the whole game, then serve it from disk.
//
// The app is a fixed set of files with no runtime downloads, so a plain
// cache-first strategy is both correct and the fastest possible boot. Bump
// CACHE when shipping.

const CACHE = 'myriad-dao-v0.13.0';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './vendor/three.module.min.js',
  './vendor/three-addons/postprocessing/EffectComposer.js',
  './vendor/three-addons/postprocessing/RenderPass.js',
  './vendor/three-addons/postprocessing/ShaderPass.js',
  './vendor/three-addons/postprocessing/MaskPass.js',
  './vendor/three-addons/postprocessing/Pass.js',
  './vendor/three-addons/postprocessing/UnrealBloomPass.js',
  './vendor/three-addons/shaders/CopyShader.js',
  './vendor/three-addons/shaders/LuminosityHighPassShader.js',
  './js/main.js',
  './js/engine.js',
  './js/data.js',
  './js/rng.js',
  './js/format.js',
  './js/ui.js',
  './js/audio.js',
  './js/view3d/index.js',
  './js/view3d/shaders.js',
  './js/view3d/lighting.js',
  './js/view3d/post.js',
  './js/view3d/palette.js',
  './js/view3d/time-of-day.js',
  './js/view3d/quality.js',
  './js/view3d/world.js',
  './js/view3d/cloud-sea.js',
  './js/view3d/cloud-plan.js',
  './js/view3d/avatar.js',
  './js/view3d/sect.js',
  './js/view3d/scenery.js',
  './js/view3d/progress.js',
  './js/view3d/effects.js',
  './js/view3d/camera.js',
  './js/view3d/camera-config.js',
  './js/view3d/dev-flag.js',
  './js/view3d/framing.js',
  './js/view3d/rock.js',
  './js/view3d/props.js',
  './js/view3d/trees.js',
  './js/view3d/platform-plan.js',
  './js/view3d/plum-plan.js',
  './js/view3d/noise.js',
  './js/view3d/peaks.js',
  './js/view3d/peak-plan.js',
  './js/view3d/terrain-plan.js',
  // js/view3d/debug.js is deliberately absent: it is dev-only, imported
  // dynamically, and a shipped install should never carry it.
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is atomic: one bad entry would leave the player with no game.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline and unseen: a navigation still gets the shell.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504, statusText: 'Offline' });
        });
    }),
  );
});
