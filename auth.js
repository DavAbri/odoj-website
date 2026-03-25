// ── ODOJ Auth – Supabase v2 ──────────────────────────
const _odojSb = supabase.createClient(
  'https://vixarulzbsfwnbfucbih.supabase.co',
  'sb_publishable_uSI5RFn7x4OSdbZa2qt7Cg_8bhguUE9'
);

async function odojGetSession() {
  const { data } = await _odojSb.auth.getSession();
  return data.session;
}

async function odojLogout() {
  await _odojSb.auth.signOut();
  localStorage.removeItem('odoj_rolle');
  window.location.href = 'index.html';
}

async function odojInitNav() {
  const session = await odojGetSession();
  const authEl   = document.getElementById('nav-auth');
  const mobileEl = document.getElementById('nav-mobile-auth');

  if (session) {
    const rolle = session.user.user_metadata?.rolle
                  || localStorage.getItem('odoj_rolle')
                  || 'jobber';
    localStorage.setItem('odoj_rolle', rolle);
    let name = session.user.user_metadata?.name || session.user.email;
    if (name.length > 20) name = name.substring(0, 18) + '\u2026';

    if (authEl) authEl.innerHTML =
      '<span class="nav-user-name">' + name + '</span>' +
      '<button onclick="odojLogout()" class="nav-logout-btn">Logout</button>';

    if (mobileEl) mobileEl.innerHTML =
      '<span class="nav-user-name-mobile">\u2713 ' + name + '</span>' +
      '<a href="#" onclick="odojLogout();return false;" class="nav-logout-mobile">Ausloggen \u2192</a>';
  } else {
    if (authEl) authEl.innerHTML = '<a href="login.html" class="nav-cta">Anmelden</a>';
    if (mobileEl) mobileEl.innerHTML = '<a href="login.html" style="color:var(--accent);font-weight:600">Anmelden \u2192</a>';
  }
}

// Auto-initialisierung Nav auf allen Seiten
odojInitNav();
