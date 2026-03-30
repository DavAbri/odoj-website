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
      .select('vorname, nachname, firmenname, rolle')
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

// Unread-Dot aktualisieren
function odojUpdateUnreadDot(hasUnread) {
  const link = document.querySelector('#nav-nachrichten a');
  if (link) {
    let dot = link.querySelector('.odoj-unread-dot');
    if (hasUnread && !dot) {
      dot = document.createElement('span');
      dot.className = 'odoj-unread-dot';
      link.appendChild(dot);
    } else if (!hasUnread && dot) {
      dot.remove();
    }
  }
  const mLink = document.getElementById('nav-mobile-nachrichten');
  if (mLink) {
    const base = 'Nachrichten';
    const dot = mLink.querySelector('.odoj-unread-dot-mobile');
    if (hasUnread && !dot) {
      const s = document.createElement('span');
      s.className = 'odoj-unread-dot-mobile';
      s.style.cssText = 'display:inline-block;width:7px;height:7px;background:#e74c3c;border-radius:50%;margin-left:6px;vertical-align:middle';
      mLink.appendChild(s);
    } else if (!hasUnread && dot) {
      dot.remove();
    }
  }
}

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

    // Anzeigename
    let displayName = session.user.email;
    if (profile) {
      displayName = (rolle === 'arbeitgeber' && profile.firmenname)
        ? profile.firmenname
        : (profile.vorname || session.user.email);
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

    // Unread-Count
    const unreadCount = await odojCountUnread(session.user.id);
    const hasUnread   = unreadCount > 0;

    // ── Desktop: Links vor #nav-auth einfügen ──
    const navAuthLi = document.getElementById('nav-auth');
    if (navAuthLi && navAuthLi.parentElement && !document.getElementById('nav-nachrichten')) {
      // Jobber: "Meine Bewerbungen"
      if (rolle === 'jobber' && !document.getElementById('nav-meine-jobs')) {
        const mjLi = document.createElement('li');
        mjLi.id = 'nav-meine-jobs';
        mjLi.innerHTML = '<a href="meine-jobs.html">Meine Bewerbungen</a>';
        navAuthLi.parentElement.insertBefore(mjLi, navAuthLi);
      }
      // Nachrichten
      const msgLi = document.createElement('li');
      msgLi.id = 'nav-nachrichten';
      msgLi.innerHTML = '<a href="chat.html" style="position:relative">Nachrichten' +
        (hasUnread ? '<span class="odoj-unread-dot"></span>' : '') + '</a>';
      navAuthLi.parentElement.insertBefore(msgLi, navAuthLi);
    }

    // ── Mobile: Links vor #nav-mobile-auth einfügen ──
    const navMobile = document.getElementById('navMobile');
    if (navMobile && mobileEl && !document.getElementById('nav-mobile-nachrichten')) {
      if (rolle === 'jobber' && !document.getElementById('nav-mobile-meine-jobs')) {
        const mjA = document.createElement('a');
        mjA.href = 'meine-jobs.html';
        mjA.id   = 'nav-mobile-meine-jobs';
        mjA.textContent = 'Meine Bewerbungen';
        navMobile.insertBefore(mjA, mobileEl);
      }
      const msgA = document.createElement('a');
      msgA.href        = 'chat.html';
      msgA.id          = 'nav-mobile-nachrichten';
      msgA.textContent = 'Nachrichten';
      navMobile.insertBefore(msgA, mobileEl);
      if (hasUnread) {
        const dot = document.createElement('span');
        dot.className = 'odoj-unread-dot-mobile';
        dot.style.cssText = 'display:inline-block;width:7px;height:7px;background:#e74c3c;border-radius:50%;margin-left:6px;vertical-align:middle';
        msgA.appendChild(dot);
      }
    }

    // Alle 30s ungelesene prüfen
    setInterval(async () => {
      const cnt = await odojCountUnread(session.user.id);
      odojUpdateUnreadDot(cnt > 0);
    }, 30000);

  } else {
    if (authEl) authEl.innerHTML = '<a href="login.html" class="nav-cta">Anmelden</a>';
    if (mobileEl) mobileEl.innerHTML = '<a href="login.html" style="color:var(--accent);font-weight:600">Anmelden \u2192</a>';
  }
}

// Auto-Initialisierung Nav auf allen Seiten
odojInitNav();
