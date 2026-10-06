(function () {
  // Live-Seite ist öffentlich erreichbar (Vorschau-Modus: Registrierung
  // offen, Jobs selbst bleiben über RLS gesperrt - siehe app_settings).
  // Überall sonst (Staging, lokal) bleibt der Team-Zugangscode nötig.
  var isLive = ['odoj.at', 'www.odoj.at'].indexOf(location.hostname) !== -1;
  if (!isLive && localStorage.getItem('odoj_access') !== 'granted') {
    window.location.replace('gate.html');
  }
})();
