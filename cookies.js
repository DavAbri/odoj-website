// ══════════════════════════════════════════════════════════
//  ODOJ Cookie Consent System
//  DSGVO / österr. DSG / ePrivacy-Richtlinie konform
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const STORAGE_KEY  = 'odoj_cookie_consent';
  const EXPIRY_DAYS  = 365;
  const VERSION      = '1.0';

  // ── Consent laden ──────────────────────────────────────
  function loadConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (c.date) {
        const diffDays = (Date.now() - new Date(c.date)) / 86400000;
        if (diffDays > EXPIRY_DAYS) return null; // abgelaufen → neu abfragen
      }
      return c;
    } catch (_) { return null; }
  }

  // ── Consent speichern ──────────────────────────────────
  function saveConsent(c) {
    c.necessary = true; // immer aktiv
    c.date      = new Date().toISOString();
    c.version   = VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  }

  // ── Consent anwenden ───────────────────────────────────
  function applyConsent(c) {
    // Funktionale Cookies: localStorage-Rolle ist erlaubt wenn c.functional
    // Analyse: Platzhalter für zukünftige Tools
    window.dispatchEvent(new CustomEvent('odoj-consent-changed', { detail: c }));
  }

  // ── Aktionen ───────────────────────────────────────────
  function acceptAll() {
    const c = { necessary: true, functional: true, analytics: true };
    saveConsent(c); applyConsent(c);
  }
  function acceptNecessaryOnly() {
    const c = { necessary: true, functional: false, analytics: false };
    saveConsent(c); applyConsent(c);
  }

  // ── CSS injizieren ─────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('odoj-ck-style')) return;
    const s = document.createElement('style');
    s.id = 'odoj-ck-style';
    s.textContent = `
/* ─── BANNER ─── */
#odoj-ck-banner {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%);
  z-index: 9998;
  width: min(700px, calc(100vw - 32px));
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 8px 48px rgba(11,31,58,.20), 0 2px 8px rgba(11,31,58,.10);
  padding: 22px 26px 20px;
  font-family: 'Plus Jakarta Sans', sans-serif;
  animation: ckBannerIn .38s cubic-bezier(.34,1.3,.64,1);
}
@keyframes ckBannerIn {
  from { opacity:0; transform: translateX(-50%) translateY(28px); }
  to   { opacity:1; transform: translateX(-50%) translateY(0); }
}
.ck-b-top { display:flex; gap:14px; margin-bottom:14px; align-items:flex-start; }
.ck-b-icon { font-size:26px; line-height:1; flex-shrink:0; margin-top:2px; }
.ck-b-title {
  font-family: 'Plus Jakarta Sans', sans-serif; font-size:16px;
  font-weight:800; color:#0B1F3A; margin-bottom:5px;
}
.ck-b-text { font-size:13px; color:#7A8FA8; line-height:1.65; font-weight:300; }
.ck-b-text a { color:#E8A020; text-decoration:none; font-weight:500; }
.ck-b-text a:hover { text-decoration:underline; }
.ck-b-btns { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }

/* Banner-Buttons */
.ck-btn-accept {
  background:#E8A020; color:#0B1F3A;
  font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700;
  padding:10px 22px; border-radius:8px; border:none;
  cursor:pointer; transition:background .2s, transform .15s; white-space:nowrap;
}
.ck-btn-accept:hover { background:#F5BE5A; transform:translateY(-1px); }
.ck-btn-necessary {
  background:transparent; color:#0B1F3A;
  font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700;
  padding:10px 22px; border-radius:8px; border:1.5px solid #E8EDF5;
  cursor:pointer; transition:all .2s; white-space:nowrap;
}
.ck-btn-necessary:hover { border-color:#0B1F3A; background:#F4F7FB; }
.ck-btn-settings-link {
  background:none; border:none; color:#8A9AB5;
  font-family:'Plus Jakarta Sans',sans-serif; font-size:13px; font-weight:500;
  cursor:pointer; padding:8px 2px; text-decoration:underline;
  transition:color .2s; white-space:nowrap;
}
.ck-btn-settings-link:hover { color:#0B1F3A; }

/* ─── FAB (schwebender Button) ─── */
#odoj-ck-fab {
  position:fixed; bottom:24px; left:24px; z-index:999;
  width:48px; height:48px; border-radius:50%;
  background:#0B1F3A; border:none; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
  font-size:22px; line-height:1;
  box-shadow:0 4px 20px rgba(11,31,58,.30);
  transition:background .2s, transform .2s;
}
#odoj-ck-fab:hover { background:#E8A020; transform:scale(1.09); }
#odoj-ck-fab-tip {
  position:fixed; bottom:80px; left:24px;
  background:#0B1F3A; color:#fff;
  font-family:'Plus Jakarta Sans',sans-serif; font-size:12px; font-weight:500;
  padding:6px 12px; border-radius:6px; white-space:nowrap;
  opacity:0; pointer-events:none; transition:opacity .2s; z-index:999;
}
#odoj-ck-fab:hover ~ #odoj-ck-fab-tip { opacity:1; }

/* ─── MODAL OVERLAY ─── */
#odoj-ck-overlay {
  position:fixed; inset:0; z-index:10000;
  background:rgba(11,31,58,.55);
  backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
  display:none; align-items:center; justify-content:center; padding:20px;
}
#odoj-ck-overlay.open { display:flex; }
#odoj-ck-modal {
  background:#fff; border-radius:20px;
  width:min(580px,100%); max-height:90vh; overflow-y:auto;
  box-shadow:0 24px 80px rgba(11,31,58,.32);
  animation:ckModalIn .3s cubic-bezier(.34,1.15,.64,1);
}
@keyframes ckModalIn {
  from { opacity:0; transform:scale(.95) translateY(16px); }
  to   { opacity:1; transform:scale(1) translateY(0); }
}
.ck-m-head {
  background:#0B1F3A; padding:22px 28px;
  display:flex; justify-content:space-between; align-items:center;
  border-radius:20px 20px 0 0; gap:16px;
}
.ck-m-head-title {
  font-family:'Plus Jakarta Sans',sans-serif; font-size:18px;
  font-weight:800; color:#fff;
}
.ck-m-close {
  background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.2);
  color:rgba(255,255,255,.8); width:34px; height:34px;
  border-radius:50%; cursor:pointer; font-size:16px;
  display:flex; align-items:center; justify-content:center;
  transition:background .2s; flex-shrink:0;
}
.ck-m-close:hover { background:rgba(255,255,255,.22); }
.ck-m-body { padding:22px 28px; }
.ck-m-intro {
  font-size:13px; color:#7A8FA8; line-height:1.65;
  font-weight:300; margin-bottom:18px;
  padding-bottom:14px; border-bottom:1px solid #E8EDF5;
}
.ck-m-intro a { color:#E8A020; text-decoration:none; font-weight:500; }
.ck-m-intro a:hover { text-decoration:underline; }

/* Kategorie-Zeile */
.ck-cat {
  border:1.5px solid #E8EDF5; border-radius:12px;
  padding:15px 17px; margin-bottom:11px; transition:border-color .2s;
}
.ck-cat:hover { border-color:#A8CBE5; }
.ck-cat-hd {
  display:flex; justify-content:space-between; align-items:center;
  gap:12px; margin-bottom:7px;
}
.ck-cat-name {
  font-family:'Plus Jakarta Sans',sans-serif; font-size:13px; font-weight:700;
  color:#0B1F3A; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
}
.ck-always-badge {
  font-size:10px; font-weight:700;
  background:#E6F5EE; color:#1A7A50;
  padding:2px 8px; border-radius:100px;
  text-transform:uppercase; letter-spacing:.4px;
}
.ck-cat-desc {
  font-size:12px; color:#8A9AB5; line-height:1.6; font-weight:300;
}

/* Toggle Switch */
.ck-toggle { position:relative; width:44px; height:24px; flex-shrink:0; }
.ck-toggle input { opacity:0; width:0; height:0; position:absolute; }
.ck-toggle-track {
  position:absolute; inset:0;
  background:#D0D8E5; border-radius:12px;
  cursor:pointer; transition:background .25s;
}
.ck-toggle input:checked + .ck-toggle-track { background:#0B1F3A; }
.ck-toggle input:disabled + .ck-toggle-track { opacity:.55; cursor:not-allowed; }
.ck-toggle-track::after {
  content:''; position:absolute;
  top:3px; left:3px;
  width:18px; height:18px;
  background:#fff; border-radius:50%;
  transition:transform .25s;
  box-shadow:0 1px 4px rgba(0,0,0,.18);
}
.ck-toggle input:checked + .ck-toggle-track::after { transform:translateX(20px); }

/* Modal-Footer */
.ck-m-footer {
  padding:14px 28px 22px;
  display:flex; gap:10px; flex-wrap:wrap;
  border-top:1px solid #E8EDF5;
}
.ck-btn-save {
  background:#0B1F3A; color:#fff;
  font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700;
  padding:11px 24px; border-radius:8px; border:none;
  cursor:pointer; transition:background .2s, transform .15s;
}
.ck-btn-save:hover { background:#243F6E; transform:translateY(-1px); }
.ck-btn-accept-all-m {
  background:#E8A020; color:#0B1F3A;
  font-family:'Plus Jakarta Sans',sans-serif; font-size:14px; font-weight:700;
  padding:11px 24px; border-radius:8px; border:none;
  cursor:pointer; transition:background .2s, transform .15s;
}
.ck-btn-accept-all-m:hover { background:#F5BE5A; transform:translateY(-1px); }

/* ─── Responsive ─── */
@media (max-width:600px) {
  #odoj-ck-banner { padding:16px 18px 16px; bottom:12px; }
  .ck-btn-accept, .ck-btn-necessary { padding:10px 16px; font-size:13px; }
  .ck-m-body, .ck-m-footer { padding-left:18px; padding-right:18px; }
  .ck-m-head { padding:18px 18px; }
}
    `;
    document.head.appendChild(s);
  }

  // ── Banner ─────────────────────────────────────────────
  function showBanner() {
    if (document.getElementById('odoj-ck-banner')) return;
    const el = document.createElement('div');
    el.id = 'odoj-ck-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie-Einwilligung');
    el.innerHTML = `
      <div class="ck-b-top">
        <span class="ck-b-icon">🍪</span>
        <div>
          <div class="ck-b-title">Wir verwenden Cookies 🍪</div>
          <p class="ck-b-text">
            Wir verwenden Cookies um dir die beste Erfahrung auf unserer Webseite zu bieten.
            Einige sind notwendig, andere helfen uns die Seite zu verbessern.
            Mehr dazu in unserer <a href="datenschutz.html">Datenschutzerklärung</a>.
          </p>
        </div>
      </div>
      <div class="ck-b-btns">
        <button class="ck-btn-accept" id="ck-b-accept">Alle akzeptieren</button>
        <button class="ck-btn-necessary" id="ck-b-necessary">Nur notwendige</button>
        <button class="ck-btn-settings-link" id="ck-b-settings">Einstellungen</button>
      </div>`;
    document.body.appendChild(el);

    document.getElementById('ck-b-accept').addEventListener('click', () => {
      acceptAll(); hideBanner();
    });
    document.getElementById('ck-b-necessary').addEventListener('click', () => {
      acceptNecessaryOnly(); hideBanner();
    });
    document.getElementById('ck-b-settings').addEventListener('click', () => {
      hideBanner(); openModal();
    });
  }

  function hideBanner() {
    const el = document.getElementById('odoj-ck-banner');
    if (!el) return;
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(28px)';
    setTimeout(() => el.remove(), 320);
  }

  // ── FAB ────────────────────────────────────────────────
  function createFAB() {
    if (document.getElementById('odoj-ck-fab')) return;
    const btn = document.createElement('button');
    btn.id = 'odoj-ck-fab';
    btn.setAttribute('aria-label', 'Cookie-Einstellungen öffnen');
    btn.textContent = '🍪';
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);

    const tip = document.createElement('div');
    tip.id = 'odoj-ck-fab-tip';
    tip.textContent = 'Cookie-Einstellungen';
    document.body.appendChild(tip);

    // Tooltip via JS (damit hover-Trick mit ~ funktioniert)
    btn.addEventListener('mouseenter', () => { tip.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });
  }

  // ── Modal ──────────────────────────────────────────────
  function buildModal() {
    const consent = loadConsent() || { necessary: true, functional: false, analytics: false };
    const overlay = document.createElement('div');
    overlay.id = 'odoj-ck-overlay';

    overlay.innerHTML = `
      <div id="odoj-ck-modal" role="dialog" aria-modal="true" aria-label="Cookie-Einstellungen">
        <div class="ck-m-head">
          <span class="ck-m-head-title">Cookie-Einstellungen</span>
          <button class="ck-m-close" id="ck-m-close-btn" aria-label="Schließen">✕</button>
        </div>
        <div class="ck-m-body">
          <p class="ck-m-intro">
            Hier kannst du deine Cookie-Einstellungen verwalten. Notwendige Cookies können nicht
            deaktiviert werden. Deine Einwilligung kannst du jederzeit widerrufen – genauso einfach
            wie du sie gegeben hast. Einwilligungen werden mit Datum gespeichert und laufen nach
            ${EXPIRY_DAYS} Tagen ab. Mehr Infos in unserer
            <a href="datenschutz.html">Datenschutzerklärung</a>.
          </p>

          <div class="ck-cat">
            <div class="ck-cat-hd">
              <div class="ck-cat-name">
                🔒 Notwendige Cookies
                <span class="ck-always-badge">Immer aktiv</span>
              </div>
              <label class="ck-toggle" aria-label="Notwendige Cookies – immer aktiv">
                <input type="checkbox" id="ck-necessary" checked disabled>
                <span class="ck-toggle-track"></span>
              </label>
            </div>
            <p class="ck-cat-desc">Diese Cookies sind für die grundlegende Funktionalität der Webseite notwendig und können nicht deaktiviert werden. Sie umfassen die Login-Session (Supabase Auth) und die Cookie-Einstellungen selbst. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO.</p>
          </div>

          <div class="ck-cat">
            <div class="ck-cat-hd">
              <div class="ck-cat-name">⚙️ Funktionale Cookies</div>
              <label class="ck-toggle" aria-label="Funktionale Cookies">
                <input type="checkbox" id="ck-functional" ${consent.functional ? 'checked' : ''}>
                <span class="ck-toggle-track"></span>
              </label>
            </div>
            <p class="ck-cat-desc">Diese Cookies ermöglichen erweiterte Funktionen wie das Speichern deiner Benutzerrolle (Jobber / Arbeitgeber) und Präferenzen im Browser. Ohne diese Cookies musst du dich bei jedem Besuch neu einloggen. Speicherdauer: bis zu 1 Jahr.</p>
          </div>

          <div class="ck-cat">
            <div class="ck-cat-hd">
              <div class="ck-cat-name">📊 Analyse Cookies</div>
              <label class="ck-toggle" aria-label="Analyse Cookies">
                <input type="checkbox" id="ck-analytics" ${consent.analytics ? 'checked' : ''}>
                <span class="ck-toggle-track"></span>
              </label>
            </div>
            <p class="ck-cat-desc">Diese Cookies helfen uns zu verstehen, wie Besucher die Webseite nutzen, um sie kontinuierlich zu verbessern. Aktuell werden keine Analyse-Tools eingesetzt. Diese Einstellung gilt für zukünftige Implementierungen. Rechtsgrundlage: Art. 6 Abs. 1 lit. a DSGVO.</p>
          </div>
        </div>
        <div class="ck-m-footer">
          <button class="ck-btn-save" id="ck-m-save">Auswahl speichern</button>
          <button class="ck-btn-accept-all-m" id="ck-m-accept-all">Alle akzeptieren</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Events
    document.getElementById('ck-m-close-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    document.getElementById('ck-m-save').addEventListener('click', () => {
      const c = {
        necessary:  true,
        functional: document.getElementById('ck-functional').checked,
        analytics:  document.getElementById('ck-analytics').checked
      };
      saveConsent(c); applyConsent(c); closeModal(); hideBanner();
    });
    document.getElementById('ck-m-accept-all').addEventListener('click', () => {
      acceptAll(); closeModal(); hideBanner();
    });
  }

  function openModal() {
    const existing = document.getElementById('odoj-ck-overlay');
    if (!existing) {
      buildModal();
    } else {
      // Toggles auf aktuellen Stand bringen
      const c = loadConsent() || { functional: false, analytics: false };
      const fEl = document.getElementById('ck-functional');
      const aEl = document.getElementById('ck-analytics');
      if (fEl) fEl.checked = !!c.functional;
      if (aEl) aEl.checked = !!c.analytics;
    }
    requestAnimationFrame(() => {
      document.getElementById('odoj-ck-overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
    });
  }

  function closeModal() {
    const overlay = document.getElementById('odoj-ck-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── Init ───────────────────────────────────────────────
  function init() {
    injectStyles();

    const run = () => {
      createFAB();
      const saved = loadConsent();
      if (saved) {
        applyConsent(saved);
      } else {
        setTimeout(showBanner, 700);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run);
    } else {
      run();
    }
  }

  // ── Öffentliche API ────────────────────────────────────
  window.odojCookies = {
    openSettings:       openModal,
    getConsent:         loadConsent,
    acceptAll:          acceptAll,
    acceptNecessaryOnly: acceptNecessaryOnly
  };

  init();

}());
