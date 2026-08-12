// ── ODOJ Auth – Supabase v2 ──────────────────────────
// Supabase CDN muss VOR diesem Script geladen sein.
window.odojSb = supabase.createClient(
  'https://vixarulzbsfwnbfucbih.supabase.co',
  'sb_publishable_uSI5RFn7x4OSdbZa2qt7Cg_8bhguUE9'
);

async function odojGetSession() {
  const { data } = await odojSb.auth.getSession();
  return data.session;
}

function odojSaveRolle(rolle) {
  if (rolle) localStorage.setItem('odoj_rolle', rolle);
}

async function odojGetProfile(userId) {
  try {
    const { data } = await odojSb
      .from('Profile')
      .select('vorname, nachname, firmenname, rolle, gesperrt')
      .eq('user_id', userId)
      .single();
    return data;
  } catch (_) { return null; }
}

async function odojLogout() {
  await odojSb.auth.signOut();
  localStorage.removeItem('odoj_rolle');
  window.location.href = 'index.html';
}

// Ungelesene Nachrichten zählen
async function odojCountUnread(userId) {
  try {
    const { count } = await odojSb
      .from('nachrichten')
      .select('id', { count: 'exact', head: true })
      .eq('empfaenger_id', userId)
      .eq('gelesen', false);
    return count || 0;
  } catch (_) { return 0; }
}

// Ausstehende Bewerbungen für Arbeitgeber zählen
async function odojCountPendingBewerbungen(userId) {
  try {
    const { count } = await odojSb
      .from('bewerbungen')
      .select('id', { count: 'exact', head: true })
      .eq('arbeitgeber_id', userId)
      .eq('status', 'ausstehend');
    return count || 0;
  } catch (_) { return 0; }
}

// Badge (Zahl) in der Desktop-Nav – funktioniert für <li> und direkte Elemente
function _setNavBadge(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  const target = el.tagName === 'LI' ? (el.querySelector('a') || el) : el;
  let badge = target.querySelector('.odoj-nav-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'odoj-nav-badge';
      target.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
  } else if (badge) {
    badge.remove();
  }
}

// Badge in der Mobile-Nav aktualisieren
function _setMobileNavBadge(elId, count) {
  const el = document.getElementById(elId);
  if (!el) return;
  let badge = el.querySelector('.odoj-nav-badge-mobile');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'odoj-nav-badge-mobile';
      el.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : String(count);
  } else if (badge) {
    badge.remove();
  }
}

// Nachrichten-Badge aktualisieren (wird auch vom Polling gerufen)
function odojUpdateUnreadDot(count) {
  _setNavBadge('nav-dd-nachrichten', count);
  _setMobileNavBadge('nav-mobile-nachrichten', count);
}

// Badge-CSS einmalig injizieren
(function injectBadgeCss() {
  if (document.getElementById('odoj-badge-css')) return;
  const s = document.createElement('style');
  s.id = 'odoj-badge-css';
  s.textContent = `
    .odoj-nav-badge {
      display: inline-flex; align-items: center; justify-content: center;
      background: #e74c3c; color: #fff;
      font-size: 10px; font-weight: 700; line-height: 1;
      min-width: 17px; height: 17px; border-radius: 100px;
      padding: 0 4px; margin-left: 5px; vertical-align: middle;
      font-family: 'Plus Jakarta Sans', sans-serif;
      position: relative; top: -1px;
    }
    .odoj-nav-badge-mobile {
      display: inline-flex; align-items: center; justify-content: center;
      background: #e74c3c; color: #fff;
      font-size: 10px; font-weight: 700; line-height: 1;
      min-width: 17px; height: 17px; border-radius: 100px;
      padding: 0 4px; margin-left: 7px; vertical-align: middle;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
  `;
  document.head.appendChild(s);
})();

// ── LOGOUT BESTÄTIGUNG ──────────────────────────────────
function _ensureLogoutModal() {
  if (document.getElementById('odoj-logout-modal')) return;
  const m = document.createElement('div');
  m.id = 'odoj-logout-modal';
  m.innerHTML = `
    <div class="odoj-logout-box">
      <h3>Ausloggen</h3>
      <p>Möchtest du dich wirklich ausloggen?</p>
      <div class="odoj-logout-btns">
        <button class="odoj-logout-cancel" onclick="odojCloseLogoutConfirm()">Abbrechen</button>
        <button class="odoj-logout-confirm-btn" onclick="odojLogout()">Ausloggen</button>
      </div>
    </div>`;
  m.addEventListener('click', e => { if (e.target === m) odojCloseLogoutConfirm(); });
  document.body.appendChild(m);
}
function odojLogoutConfirm() {
  _ensureLogoutModal();
  document.getElementById('odoj-logout-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function odojCloseLogoutConfirm() {
  const m = document.getElementById('odoj-logout-modal');
  if (m) m.classList.remove('open');
  document.body.style.overflow = '';
}

async function odojInitNav() {
  const session = await odojGetSession();
  const authEl   = document.getElementById('nav-auth');
  const mobileEl = document.getElementById('nav-mobile-auth');

  if (session) {
    const profile = await odojGetProfile(session.user.id);
    const rolle   = profile?.rolle
                    || session.user.user_metadata?.rolle
                    || localStorage.getItem('odoj_rolle')
                    || 'jobber';
    odojSaveRolle(rolle);

    const emailPrefix = session.user.email ? session.user.email.split('@')[0] : 'Mein Konto';
    let displayName = emailPrefix;
    if (profile) {
      displayName = (rolle === 'arbeitgeber' && profile.firmenname)
        ? profile.firmenname
        : (profile.vorname || emailPrefix);
    }
    if (displayName.length > 18) displayName = displayName.substring(0, 16) + '…';

    const unreadCount    = await odojCountUnread(session.user.id);
    const pendingBewCount = rolle === 'arbeitgeber'
      ? await odojCountPendingBewerbungen(session.user.id) : 0;

    // Rollenspezifischer Dropdown-Eintrag
    const roleItem = rolle === 'arbeitgeber'
      ? `<a href="meine-inserate.html" class="nav-dd-item" id="nav-dd-role"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>Meine Inserate</a>`
      : `<a href="meine-bewerbungen.html" class="nav-dd-item" id="nav-dd-role"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Meine Bewerbungen</a>`;

    // ── Desktop: Profil-Dropdown ──
    if (authEl) {
      authEl.innerHTML = `
        <button class="nav-profil-trigger" id="nav-profil-trigger">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          <span>${displayName}</span>
          <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="nav-profil-dropdown" id="nav-profil-dropdown">
          <a href="chat.html" class="nav-dd-item" id="nav-dd-nachrichten">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Nachrichten
          </a>
          ${roleItem}
          <a href="profil.html" class="nav-dd-item">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
            Profileinstellungen
          </a>
          <div class="nav-dd-divider"></div>
          <button class="nav-dd-item nav-dd-logout" onclick="odojLogoutConfirm()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Logout
          </button>
        </div>`;

      const trigger  = document.getElementById('nav-profil-trigger');
      const dropdown = document.getElementById('nav-profil-dropdown');
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const open = dropdown.classList.toggle('open');
        trigger.classList.toggle('open', open);
      });
    }

    // ── Mobile: Profil-Bereich (wie ursprünglich) ──
    if (mobileEl) mobileEl.innerHTML =
      '<a href="profil.html" class="nav-user-name-mobile">✓ ' + displayName + '</a>' +
      '<a href="#" onclick="odojLogout();return false;" class="nav-logout-mobile">Ausloggen →</a>';

    // ── Mobile: Statische Links je nach Rolle ausblenden ──
    const navMobile = document.getElementById('navMobile');
    if (navMobile) {
      navMobile.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (rolle === 'jobber') {
          if (href === 'arbeitgeber.html' || href === 'ueber-uns.html') a.style.display = 'none';
        } else if (rolle === 'arbeitgeber') {
          if (href === 'jobs.html' || href === 'arbeitgeber.html' || href === 'ueber-uns.html') a.style.display = 'none';
        }
      });
    }

    // ── Mobile: Rollenspezifische Links einfügen ──
    if (navMobile && mobileEl && !document.getElementById('nav-mobile-nachrichten')) {
      const msgA = document.createElement('a');
      msgA.href        = 'chat.html';
      msgA.id          = 'nav-mobile-nachrichten';
      msgA.textContent = 'Nachrichten';
      navMobile.insertBefore(msgA, mobileEl);
      if (unreadCount > 0) _setMobileNavBadge('nav-mobile-nachrichten', unreadCount);

      if (rolle === 'jobber' && !document.getElementById('nav-mobile-meine-bew')) {
        const mjA = document.createElement('a');
        mjA.href = 'meine-bewerbungen.html';
        mjA.id   = 'nav-mobile-meine-bew';
        mjA.textContent = 'Meine Bewerbungen';
        navMobile.insertBefore(mjA, msgA);
      }
      if (rolle === 'arbeitgeber' && !document.getElementById('nav-mobile-meine-inserate')) {
        const miA = document.createElement('a');
        miA.href = 'meine-inserate.html';
        miA.id   = 'nav-mobile-meine-inserate';
        miA.textContent = 'Meine Inserate';
        if (location.pathname.includes('meine-inserate')) miA.style.color = 'var(--accent)';
        navMobile.insertBefore(miA, msgA);
        if (pendingBewCount > 0) _setMobileNavBadge('nav-mobile-meine-inserate', pendingBewCount);
      }
    }

    // Desktop-Badges setzen
    _setNavBadge('nav-dd-nachrichten', unreadCount);

    // Alle 30s Badges aktualisieren
    setInterval(async () => {
      const cnt = await odojCountUnread(session.user.id);
      odojUpdateUnreadDot(cnt);
      if (rolle === 'arbeitgeber') {
        const pc = await odojCountPendingBewerbungen(session.user.id);
        _setNavBadge('nav-dd-role', pc);
        _setMobileNavBadge('nav-mobile-meine-inserate', pc);
      }
    }, 30000);

  } else {
    if (authEl) authEl.innerHTML = '<a href="login.html" class="nav-cta">Anmelden</a>';
    if (mobileEl) mobileEl.innerHTML = '<a href="login.html" style="color:var(--accent);font-weight:600">Anmelden →</a>';
  }
}

// Auto-Initialisierung Nav auf allen Seiten
odojInitNav();

// Klick außerhalb schließt mobiles Menü und Profil-Dropdown
document.addEventListener('click', function(e) {
  // Mobiles Menü
  const menu   = document.getElementById('navMobile');
  const burger = document.querySelector('.nav-burger');
  if (menu && menu.classList.contains('open')) {
    if (!menu.contains(e.target) && (!burger || !burger.contains(e.target))) {
      menu.classList.remove('open');
    }
  }
  // Profil-Dropdown
  const dropdown = document.getElementById('nav-profil-dropdown');
  const trigger  = document.getElementById('nav-profil-trigger');
  if (dropdown && dropdown.classList.contains('open')) {
    if (!dropdown.contains(e.target) && (!trigger || !trigger.contains(e.target))) {
      dropdown.classList.remove('open');
      if (trigger) trigger.classList.remove('open');
    }
  }
});
