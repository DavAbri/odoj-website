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
      .from('profile')
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

async function odojInitNav() {
  const session = await odojGetSession();
  const authEl   = document.getElementById('nav-auth');
  const mobileEl = document.getElementById('nav-mobile-auth');

  if (session) {
    // Rolle ermitteln
    const profile = await odojGetProfile(session.user.id);
    const rolle   = profile?.rolle
                    || session.user.user_metadata?.rolle
                    || localStorage.getItem('odoj_rolle')
                    || 'jobber';
    odojSaveRolle(rolle);

    // Anzeigename: Jobber → Vorname, Arbeitgeber → Firmenname
    let displayName = session.user.email;
    if (profile) {
      displayName = (rolle === 'arbeitgeber' && profile.firmenname)
        ? profile.firmenname
        : (profile.vorname || session.user.email);
    }
    if (displayName.length > 20) displayName = displayName.substring(0, 18) + '\u2026';

    if (authEl) authEl.innerHTML =
      '<span class="nav-user-name">' + displayName + '</span>' +
      '<button onclick="odojLogout()" class="nav-logout-btn">Logout</button>';

    if (mobileEl) mobileEl.innerHTML =
      '<span class="nav-user-name-mobile">\u2713 ' + displayName + '</span>' +
      '<a href="#" onclick="odojLogout();return false;" class="nav-logout-mobile">Ausloggen \u2192</a>';
  } else {
    if (authEl) authEl.innerHTML = '<a href="login.html" class="nav-cta">Anmelden</a>';
    if (mobileEl) mobileEl.innerHTML = '<a href="login.html" style="color:var(--accent);font-weight:600">Anmelden \u2192</a>';
  }
}

// Auto-Initialisierung Nav auf allen Seiten
odojInitNav();
