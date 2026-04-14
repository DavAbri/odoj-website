// ── ODOJ Service Worker ───────────────────────────────────────
const CACHE   = 'odoj-v3';

// Statische Assets cachen (nur Dateien die tatsächlich existieren)
const PRECACHE = [
  '/', '/index.html', '/jobs.html', '/login.html',
  '/shared.css', '/auth.js', '/manifest.json'
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // Einzeln cachen damit ein fehlender Asset nicht alles blockiert
      Promise.allSettled(PRECACHE.map(url => c.add(url)))
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH (Network-first, Cache-fallback) ────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('supabase.co')) return; // API nie cachen

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ── BADGE VOM MAIN-THREAD SETZEN ────────────────────────────
// Die Seite schickt per postMessage den aktuellen Badge-Count.
self.addEventListener('message', e => {
  if (e.data?.type === 'SET_BADGE') {
    const count = e.data.count || 0;
    if ('setAppBadge' in self.navigator) {
      count > 0
        ? self.navigator.setAppBadge(count).catch(() => {})
        : self.navigator.clearAppBadge().catch(() => {});
    }
  }
});

// ── PERIODIC BACKGROUND SYNC ─────────────────────────────────
// Alle ~15 Minuten im Hintergrund Badge aktualisieren.
// Benötigt: navigator.permissions 'periodic-background-sync'
self.addEventListener('periodicsync', e => {
  if (e.tag === 'odoj-badge-sync') {
    e.waitUntil(syncBadgeInBackground());
  }
});

async function syncBadgeInBackground() {
  try {
    // Hole gespeicherten Auth-Token aus IndexedDB
    const token = await getStoredToken();
    if (!token) { clearBadge(); return; }

    // Direkt Supabase REST aufrufen (kein JS-Client nötig)
    const SUPABASE_URL = 'https://vixarulzbsfwnbfucbih.supabase.co';
    const ANON_KEY     = 'sb_publishable_uSI5RFn7x4OSdbZa2qt7Cg_8bhguUE9';

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?read=eq.false&select=id`,
      {
        headers: {
          'apikey':        ANON_KEY,
          'Authorization': `Bearer ${token}`,
          'Prefer':        'count=exact'
        }
      }
    );

    if (!res.ok) { clearBadge(); return; }

    const count = parseInt(res.headers.get('content-range')?.split('/')[1] || '0', 10);
    setBadge(count);

    // Alle offenen Clients benachrichtigen
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'BADGE_UPDATED', count }));

  } catch (_) { /* offline – Badge unverändert lassen */ }
}

function setBadge(count) {
  if (!('setAppBadge' in self.navigator)) return;
  count > 0
    ? self.navigator.setAppBadge(count).catch(() => {})
    : self.navigator.clearAppBadge().catch(() => {});
}
function clearBadge() { setBadge(0); }

// ── AUTH-TOKEN AUS INDEXEDDB LESEN ───────────────────────────
function getStoredToken() {
  return new Promise(resolve => {
    const req = indexedDB.open('odoj-auth', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('tokens')) { resolve(null); return; }
      const tx  = db.transaction('tokens', 'readonly');
      const get = tx.objectStore('tokens').get('access_token');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror   = () => resolve(null);
    };
    req.onerror = () => resolve(null);
    // Falls IDB noch nicht existiert
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('tokens');
    };
  });
}
