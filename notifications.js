// ── ODOJ Notifications & Badge ───────────────────────────────
// Wird auf allen Seiten nach auth.js eingebunden.
// Voraussetzung: window.odojSb aus auth.js

(function () {
  'use strict';

  // ── IndexedDB: Token speichern damit SW darauf zugreifen kann ──
  function _openIDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('odoj-auth', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('tokens');
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = () => reject();
    });
  }

  async function saveTokenToIDB(token) {
    try {
      const db = await _openIDB();
      const tx = db.transaction('tokens', 'readwrite');
      tx.objectStore('tokens').put(token, 'access_token');
    } catch (_) {}
  }

  async function clearTokenFromIDB() {
    try {
      const db = await _openIDB();
      const tx = db.transaction('tokens', 'readwrite');
      tx.objectStore('tokens').delete('access_token');
    } catch (_) {}
  }

  // ── Badge API ────────────────────────────────────────────────
  function setBadge(count) {
    // 1. Badge API direkt (Seite im Vordergrund)
    if ('setAppBadge' in navigator) {
      count > 0
        ? navigator.setAppBadge(count).catch(() => {})
        : navigator.clearAppBadge().catch(() => {});
    }
    // 2. Service Worker informieren (für Hintergrund)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SET_BADGE', count });
    }
  }

  // ── Ungelesene Notifications zählen ─────────────────────────
  async function countUnread(userId) {
    try {
      const { count } = await odojSb
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);
      return count || 0;
    } catch (_) { return 0; }
  }

  // ── Alle Notifications als gelesen markieren ─────────────────
  async function markAllRead(userId) {
    try {
      await odojSb
        .from('notifications')
        .update({ read: true })
        .eq('user_id', userId)
        .eq('read', false);
      setBadge(0);
    } catch (_) {}
  }

  // ── Neue Notification einfügen (vom System aufgerufen) ───────
  async function createNotification(userId, type, message, link) {
    try {
      await odojSb.from('notifications').insert({ user_id: userId, type, message, link });
    } catch (_) {}
  }

  // ── Periodic Background Sync registrieren ────────────────────
  async function registerPeriodicSync() {
    if (!('serviceWorker' in navigator) || !('periodicSync' in ServiceWorkerRegistration.prototype)) return;
    try {
      const reg    = await navigator.serviceWorker.ready;
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state === 'granted') {
        await reg.periodicSync.register('odoj-badge-sync', { minInterval: 15 * 60 * 1000 });
      }
    } catch (_) {}
  }

  // ── Supabase Realtime Subscription ───────────────────────────
  let _realtimeChannel = null;

  function subscribeRealtime(userId, onNewNotification) {
    if (_realtimeChannel) odojSb.removeChannel(_realtimeChannel);

    _realtimeChannel = odojSb
      .channel('notifications:' + userId)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'notifications',
          filter: `user_id=eq.${userId}`
        },
        payload => {
          if (onNewNotification) onNewNotification(payload.new);
        }
      )
      .subscribe();
  }

  // ── SW-Nachrichten vom Hintergrund empfangen ─────────────────
  function listenToSW(onUpdate) {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'BADGE_UPDATED') {
        setBadge(e.data.count);
        if (onUpdate) onUpdate(e.data.count);
      }
    });
  }

  // ── Haupt-Initialisierung ─────────────────────────────────────
  async function initNotifications(session) {
    if (!session) { clearTokenFromIDB(); setBadge(0); return; }

    const userId = session.user.id;

    // Token in IDB für SW speichern
    await saveTokenToIDB(session.access_token);

    // Initialen Badge-Count setzen
    const count = await countUnread(userId);
    setBadge(count);

    // Realtime: bei neuer Notification Badge sofort erhöhen
    subscribeRealtime(userId, async () => {
      const newCount = await countUnread(userId);
      setBadge(newCount);
    });

    // SW-Nachrichten empfangen
    listenToSW(null);

    // Periodic Sync registrieren
    await registerPeriodicSync();
  }

  // ── Öffentliche API ──────────────────────────────────────────
  window.odojNotifications = {
    init:               initNotifications,
    countUnread,
    markAllRead,
    createNotification,
    setBadge,
  };

})();
