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

// Badge (Zahl) in der Desktop-Nav aktualisieren
function _setNavBadge(liId, count) {
  const li = document.getElementById(liId);
  if (!li) return;
  const a = li.querySelector('a');
  if (!a) return;
  let badge = a.querySelector('.odoj-nav-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'odoj-nav-badge';
      a.appendChild(badge);
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
  _setNavBadge('nav-nachrichten', count);
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

async function odojInitNav() {
  const session = await odojGetSession();
  const authEl   = document.getElementById('nav-auth');
  const mobileEl = document.getElementById('nav-mobile-auth');

  if (session) {
    // Profil laden
    const profile = await odojGetProfile(session.user.id);
    const rolle   = profile?.rolle
                    || session.user.user_metadata?.rolle
                    || localStorage.getItem('odoj_rolle')
                    || 'jobber';
    odojSaveRolle(rolle);

    // Anzeigename (niemals E-Mail — E-Mail-Prefix als letzter Fallback)
    const emailPrefix = session.user.email ? session.user.email.split('@')[0] : 'Mein Konto';
    let displayName = emailPrefix;
    if (profile) {
      displayName = (rolle === 'arbeitgeber' && profile.firmenname)
        ? profile.firmenname
        : (profile.vorname || emailPrefix);
    }
    if (displayName.length > 20) displayName = displayName.substring(0, 18) + '\u2026';

    // Nav Auth Element
    if (authEl) authEl.innerHTML =
      '<a href="profil.html" class="nav-profil-btn">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>' +
        '<span>' + displayName + '</span>' +
      '</a>' +
      '<button onclick="odojLogout()" class="nav-logout-btn">Logout</button>';

    if (mobileEl) mobileEl.innerHTML =
      '<a href="profil.html" class="nav-user-name-mobile">\u2713 ' + displayName + '</a>' +
      '<a href="#" onclick="odojLogout();return false;" class="nav-logout-mobile">Ausloggen \u2192</a>';

    // Zähler laden
    const unreadCount   = await odojCountUnread(session.user.id);
    const pendingBewCount = rolle === 'arbeitgeber'
      ? await odojCountPendingBewerbungen(session.user.id)
      : 0;

    // ── Desktop: Statische Links anpassen und rollenspezifische einfügen ──
    const navAuthLi = document.getElementById('nav-auth');

    if (navAuthLi && navAuthLi.parentElement) {
      navAuthLi.parentElement.querySelectorAll('li a').forEach(a => {
        const href = a.getAttribute('href');
        if (rolle === 'jobber') {
          if (href === 'arbeitgeber.html' || href === 'ueber-uns.html') a.parentElement.style.display = 'none';
        } else if (rolle === 'arbeitgeber') {
          if (href === 'jobs.html' || href === 'arbeitgeber.html' || href === 'ueber-uns.html') a.parentElement.style.display = 'none';
        }
      });
    }

    if (navAuthLi && navAuthLi.parentElement && !document.getElementById('nav-nachrichten')) {
      // Nachrichten-Link
      const msgLi = document.createElement('li');
      msgLi.id = 'nav-nachrichten';
      msgLi.innerHTML = '<a href="chat.html" style="position:relative">Nachrichten</a>';
      navAuthLi.parentElement.insertBefore(msgLi, navAuthLi);
      if (unreadCount > 0) _setNavBadge('nav-nachrichten', unreadCount);

      // Jobber: "Meine Bewerbungen"
      if (rolle === 'jobber' && !document.getElementById('nav-meine-bew')) {
        const mjLi = document.createElement('li');
        mjLi.id = 'nav-meine-bew';
        mjLi.innerHTML = '<a href="meine-bewerbungen.html">Meine Bewerbungen</a>';
        navAuthLi.parentElement.insertBefore(mjLi, msgLi);
      }

      // Arbeitgeber: "Meine Inserate" mit Badge für ausstehende Bewerbungen
      if (rolle === 'arbeitgeber' && !document.getElementById('nav-meine-inserate')) {
        const miLi = document.createElement('li');
        miLi.id = 'nav-meine-inserate';
        const miActive = location.pathname.includes('meine-inserate') ? ' class="active"' : '';
        miLi.innerHTML = `<a href="meine-inserate.html"${miActive}>Meine Inserate</a>`;
        navAuthLi.parentElement.insertBefore(miLi, msgLi);
        if (pendingBewCount > 0) _setNavBadge('nav-meine-inserate', pendingBewCount);
      }
    }

    // ── Mobile: Statische Links anpassen und rollenspezifische einfügen ──
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

    // Alle 30s Badges aktualisieren
    setInterval(async () => {
      const cnt = await odojCountUnread(session.user.id);
      odojUpdateUnreadDot(cnt);
      if (rolle === 'arbeitgeber') {
        const pc = await odojCountPendingBewerbungen(session.user.id);
        _setNavBadge('nav-meine-inserate', pc);
        _setMobileNavBadge('nav-mobile-meine-inserate', pc);
      }
    }, 30000);

  } else {
    if (authEl) authEl.innerHTML = '<a href="login.html" class="nav-cta">Anmelden</a>';
    if (mobileEl) mobileEl.innerHTML = '<a href="login.html" style="color:var(--accent);font-weight:600">Anmelden \u2192</a>';
  }
}

// Auto-Initialisierung Nav auf allen Seiten
odojInitNav();
