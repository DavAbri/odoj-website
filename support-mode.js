// ── ODOJ Support-Modus ──────────────────────────────────────────────────
// Wird auf meine-inserate.html und profil.html geladen (nach auth.js).
// Reine Komfort-/Anzeige-Schicht: der Browser-Zustand (sessionStorage) wird
// nirgends als Berechtigungsnachweis verwendet - jede tatsächliche Aktion
// wird in den support-*-Edge-Functions serverseitig erneut geprüft (Admin +
// aktive, nicht abgelaufene Session). Ein manipulierter sessionStorage-Wert
// kann daher höchstens die Anzeige durcheinanderbringen, nie eine Aktion
// freischalten.

const ODOJ_SUPPORT_KEY = 'odoj_support_session';
const ODOJ_SUPPORT_MINUTES = 30;

function odojSupportGet() {
  try {
    const raw = sessionStorage.getItem(ODOJ_SUPPORT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const ageMin = (Date.now() - new Date(data.gestartetAm).getTime()) / 60000;
    if (ageMin > ODOJ_SUPPORT_MINUTES) { sessionStorage.removeItem(ODOJ_SUPPORT_KEY); return null; }
    return data;
  } catch (_) { return null; }
}

function odojSupportSet(data) {
  try { sessionStorage.setItem(ODOJ_SUPPORT_KEY, JSON.stringify(data)); } catch (_) {}
}

function odojSupportClear() {
  try { sessionStorage.removeItem(ODOJ_SUPPORT_KEY); } catch (_) {}
}

// Globaler Zugriffspunkt für die Seiten: window.ODOJ_SUPPORT.active prüfen,
// window.ODOJ_SUPPORT.targetUserId statt der eigenen Session-ID verwenden.
window.ODOJ_SUPPORT = (function () {
  const data = odojSupportGet();
  return {
    active: !!data,
    sessionId: data?.sessionId || null,
    targetUserId: data?.targetUserId || null,
    targetName: data?.targetName || null,
    gestartetAm: data?.gestartetAm || null,
  };
})();

async function odojSupportEnd(redirect) {
  const data = odojSupportGet();
  odojSupportClear();
  if (data?.sessionId) {
    try { await odojSb.functions.invoke('support-session-end', { body: { sessionId: data.sessionId } }); } catch (_) {}
  }
  if (redirect !== false) window.location.href = '/admin/index.html';
}

function odojSupportRenderBanner() {
  if (!window.ODOJ_SUPPORT.active) return;
  if (document.getElementById('odoj-support-banner')) return;

  // Auf Staging gibt es zusätzlich das fixe "TESTUMGEBUNG"-Banner (auth.js,
  // z-index 99999) - unser Banner muss darunter einrasten, sonst überlappen
  // sich beide und der "Beenden"-Button ist nicht mehr klickbar.
  const testBanner = document.getElementById('odoj-test-banner');
  const topOffset = testBanner ? testBanner.getBoundingClientRect().height : 0;

  const bar = document.createElement('div');
  bar.id = 'odoj-support-banner';
  bar.style.cssText = 'position:fixed;top:' + topOffset + 'px;left:0;right:0;z-index:99998;background:#0B1F3A;color:#fff;padding:10px 16px;font-family:\'Plus Jakarta Sans\',Arial,sans-serif;font-size:13px;display:flex;align-items:center;justify-content:center;gap:14px;flex-wrap:wrap;box-shadow:0 2px 10px rgba(0,0,0,.2)';
  bar.innerHTML =
    '🛟 <strong>Support-Modus:</strong> Du handelst im Namen von <strong>' +
    String(window.ODOJ_SUPPORT.targetName || '').replace(/</g, '&lt;') +
    '</strong> &nbsp;·&nbsp; <span id="odoj-support-countdown"></span> ' +
    '<button id="odoj-support-end-btn" style="background:#E8A020;color:#0B1F3A;border:none;border-radius:6px;padding:6px 14px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">Beenden</button>';
  document.body.prepend(bar);
  document.getElementById('odoj-support-end-btn').addEventListener('click', () => odojSupportEnd());

  const countdownEl = document.getElementById('odoj-support-countdown');
  const started = new Date(window.ODOJ_SUPPORT.gestartetAm).getTime();
  const tick = () => {
    const remainingMs = started + ODOJ_SUPPORT_MINUTES * 60000 - Date.now();
    if (remainingMs <= 0) {
      countdownEl.textContent = 'Zeit abgelaufen';
      odojSupportEnd();
      return;
    }
    const m = Math.floor(remainingMs / 60000);
    const s = Math.floor((remainingMs % 60000) / 1000);
    countdownEl.textContent = 'noch ' + m + ':' + String(s).padStart(2, '0') + ' Min.';
  };
  tick();
  setInterval(tick, 1000);
}

if (window.ODOJ_SUPPORT.active) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', odojSupportRenderBanner);
  } else {
    odojSupportRenderBanner();
  }
}
