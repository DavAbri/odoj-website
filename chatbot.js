(function () {
  const ANTHROPIC_KEY = 'ANTHROPIC_API_KEY_HIER_EINFUEGEN';

  const SYSTEM_PROMPT = `Du bist der freundliche Assistent von ODOJ (One Day One Job), einer Tagesjob-Vermittlungsplattform in Vorarlberg, Österreich.

Du beantwortest Fragen auf Deutsch und hilfst Nutzern dabei, die richtigen Funktionen der Webseite zu finden.

WICHTIGE INFORMATIONEN ÜBER ODOJ:
- ODOJ vermittelt Tagesjobs in Vorarlberg in den Branchen: Gastronomie & Hotel, Bau & Handwerk, Lager & Logistik, Veranstaltungen & Events
- Es gibt zwei Nutzertypen: Jobber (Arbeitnehmer) und Arbeitgeber
- Die Webseite hat folgende Seiten: index.html (Startseite), jobs.html (Stellenbörse), arbeitgeber.html (Für Arbeitgeber), ueber-uns.html (Über uns), login.html (Anmelden/Registrieren), profil.html (Profil), chat.html (Nachrichten), meine-bewerbungen.html (Meine Bewerbungen), admin.html (nur für Admins)

FÜR JOBBER (Arbeitnehmer):
- Registrierung: Auf login.html als Jobber registrieren mit Name, Geburtsdatum (min 15 Jahre), E-Mail, Passwort
- Jobs finden: Auf jobs.html alle verfügbaren Tagesjobs ansehen und filtern
- Bewerben: Auf jobs.html oder job-detail.html auf Bewerben klicken (Profil muss vollständig sein)
- Profil vervollständigen: Auf profil.html Sozialversicherungsnummer und Adresse eintragen - ohne diese kann man sich nicht bewerben
- Bewerbungen ansehen: Auf meine-bewerbungen.html alle eigenen Bewerbungen und deren Status sehen
- Nachrichten: Auf chat.html mit Arbeitgebern kommunizieren
- Bezahlung: Der Lohn wird automatisch nach Bestätigung der Anwesenheit durch den Arbeitgeber überwiesen

FÜR ARBEITGEBER:
- Registrierung: Auf login.html als Arbeitgeber registrieren mit Firmenname, Ansprechperson, E-Mail, Passwort
- Job inserieren: Auf arbeitgeber.html im Tab 'Job inserieren' - kostenlos inserieren
- Bewerbungen verwalten: Auf arbeitgeber.html im Tab 'Meine Inserate' Bewerbungen ansehen, annehmen oder ablehnen
- Anwesenheit bestätigen: Nach dem Einsatz Anwesenheit bestätigen - erst dann wird bezahlt
- Stammkräfte: Beim Inserieren können bereits bewährte Jobber benachrichtigt werden
- Kosten: Pro erfolgreich abgeschlossenem Einsatz € 15,00 Vermittlungsgebühr
- Nachrichten: Auf chat.html mit Jobbern kommunizieren
- Rechnungen: Auf profil.html alle Rechnungen einsehen

ALLGEMEINE INFOS:
- ODOJ ist kostenlos für Jobber
- Für Arbeitgeber: € 15,00 Vermittlungsgebühr pro erfolgreich abgeschlossenem Einsatz
- Zahlung läuft automatisch über Stripe
- Cookie-Einstellungen: Unten links auf der Seite beim Cookie-Symbol
- Bei technischen Problemen oder Fragen die du nicht beantworten kannst: Verweis auf hallo@odoj.at

WICHTIGE REGELN:
- Antworte immer auf Deutsch
- Sei freundlich und hilfsbereit
- Halte Antworten kurz (max 3-4 Sätze)
- Wenn du auf eine Seite verweist, nenne den Link (z.B. 'Gehe zu jobs.html')
- Beantworte NUR Fragen die mit ODOJ oder der Nutzung der Webseite zu tun haben
- Bei Fragen die nichts mit ODOJ zu tun haben: 'Dazu kann ich leider nicht helfen, aber bei Fragen zu ODOJ stehe ich gerne zur Verfügung!'
- Gib KEINE rechtliche oder finanzielle Beratung`;

  const STARTERS = [
    'Wie kann ich mich als Jobber registrieren?',
    'Was kostet ODOJ für Arbeitgeber?',
    'Wie funktioniert die Bewerbung?',
  ];

  const CSS = `
    #odoj-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: #0f2044; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,.28);
      transition: transform .2s, box-shadow .2s;
    }
    #odoj-chat-btn:hover { transform: scale(1.08); box-shadow: 0 6px 22px rgba(0,0,0,.35); }
    #odoj-chat-btn .tooltip {
      position: absolute; bottom: 66px; right: 0;
      background: #0f2044; color: #fff; font-size: 12px;
      padding: 5px 10px; border-radius: 8px; white-space: nowrap;
      opacity: 0; pointer-events: none; transition: opacity .2s;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    #odoj-chat-btn:hover .tooltip { opacity: 1; }

    #odoj-chat-window {
      position: fixed; bottom: 92px; right: 24px; z-index: 9998;
      width: 320px; height: 440px;
      background: #fff; border-radius: 18px;
      box-shadow: 0 8px 40px rgba(0,0,0,.22);
      display: none; flex-direction: column; overflow: hidden;
      font-family: 'Plus Jakarta Sans', sans-serif;
      animation: odoj-slideup .25s ease;
    }
    #odoj-chat-window.open { display: flex; }
    @keyframes odoj-slideup {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .odoj-chat-header {
      background: #0f2044; color: #fff;
      padding: 14px 16px; display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    .odoj-chat-header-ico {
      width: 34px; height: 34px; border-radius: 50%;
      background: #e8a020; display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .odoj-chat-header-title { flex: 1; }
    .odoj-chat-header-title strong { display: block; font-size: 14px; font-weight: 700; }
    .odoj-chat-header-title span { font-size: 11px; color: rgba(255,255,255,.55); }
    .odoj-chat-close {
      background: none; border: none; color: rgba(255,255,255,.7);
      font-size: 20px; cursor: pointer; padding: 0 2px; line-height: 1;
    }
    .odoj-chat-close:hover { color: #fff; }

    .odoj-chat-messages {
      flex: 1; overflow-y: auto; padding: 14px 12px;
      display: flex; flex-direction: column; gap: 10px;
      scroll-behavior: smooth;
    }
    .odoj-chat-messages::-webkit-scrollbar { width: 4px; }
    .odoj-chat-messages::-webkit-scrollbar-thumb { background: #d0d0d0; border-radius: 4px; }

    .odoj-msg {
      max-width: 82%; font-size: 13px; line-height: 1.5;
      padding: 9px 12px; border-radius: 14px; word-break: break-word;
    }
    .odoj-msg.bot {
      background: #f0f4ff; color: #1a2a4a; border-bottom-left-radius: 4px; align-self: flex-start;
    }
    .odoj-msg.user {
      background: #0f2044; color: #fff; border-bottom-right-radius: 4px; align-self: flex-end;
    }

    .odoj-starters {
      display: flex; flex-direction: column; gap: 6px; margin-top: 4px;
    }
    .odoj-starter-btn {
      background: none; border: 1px solid rgba(15,32,68,.2);
      color: #0f2044; font-size: 12px; padding: 7px 10px;
      border-radius: 10px; cursor: pointer; text-align: left;
      font-family: 'Plus Jakarta Sans', sans-serif; transition: background .15s;
    }
    .odoj-starter-btn:hover { background: #f0f4ff; }

    .odoj-typing {
      display: flex; align-items: center; gap: 4px;
      padding: 10px 12px; background: #f0f4ff;
      border-radius: 14px; border-bottom-left-radius: 4px;
      align-self: flex-start;
    }
    .odoj-typing span {
      width: 7px; height: 7px; border-radius: 50%; background: #0f2044;
      display: inline-block; animation: odoj-bounce .9s infinite;
    }
    .odoj-typing span:nth-child(2) { animation-delay: .15s; }
    .odoj-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes odoj-bounce {
      0%, 80%, 100% { transform: scale(.7); opacity: .4; }
      40% { transform: scale(1); opacity: 1; }
    }

    .odoj-chat-form {
      display: flex; gap: 8px; padding: 10px 12px;
      border-top: 1px solid #eef0f5; flex-shrink: 0;
    }
    .odoj-chat-input {
      flex: 1; border: 1px solid #d8dde8; border-radius: 10px;
      padding: 9px 12px; font-size: 13px; outline: none;
      font-family: 'Plus Jakarta Sans', sans-serif;
      transition: border-color .2s;
    }
    .odoj-chat-input:focus { border-color: #e8a020; }
    .odoj-chat-send {
      background: #e8a020; border: none; border-radius: 10px;
      width: 38px; height: 38px; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: background .2s;
    }
    .odoj-chat-send:hover { background: #d4920e; }

    .odoj-privacy-banner {
      background: #f0f4ff; border-top: 1px solid #d8dde8;
      padding: 10px 12px; font-size: 11px; color: #4a5a7a;
      display: flex; align-items: flex-start; gap: 10px; flex-shrink: 0;
    }
    .odoj-privacy-ok {
      background: #0f2044; color: #fff; border: none;
      border-radius: 8px; padding: 5px 12px; font-size: 11px;
      cursor: pointer; white-space: nowrap; flex-shrink: 0;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }

    @media (max-width: 480px) {
      #odoj-chat-window {
        width: 100vw; height: 100dvh;
        bottom: 0; right: 0; border-radius: 0;
      }
      #odoj-chat-btn { bottom: 16px; right: 16px; }
    }
  `;

  function init() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Toggle button
    const btn = document.createElement('button');
    btn.id = 'odoj-chat-btn';
    btn.setAttribute('aria-label', 'Chat öffnen');
    btn.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="tooltip">Wie kann ich helfen?</span>`;
    document.body.appendChild(btn);

    // Chat window
    const win = document.createElement('div');
    win.id = 'odoj-chat-window';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-label', 'ODOJ Assistent');
    win.innerHTML = `
      <div class="odoj-chat-header">
        <div class="odoj-chat-header-ico">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="odoj-chat-header-title">
          <strong>ODOJ Assistent</strong>
          <span>Wie kann ich helfen?</span>
        </div>
        <button class="odoj-chat-close" aria-label="Schließen">&times;</button>
      </div>
      <div class="odoj-chat-messages" id="odoj-messages"></div>
      <div class="odoj-chat-form">
        <input class="odoj-chat-input" id="odoj-input" type="text" placeholder="Schreibe eine Nachricht..." autocomplete="off" maxlength="300" />
        <button class="odoj-chat-send" id="odoj-send" aria-label="Senden">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>`;
    document.body.appendChild(win);

    const messages = win.querySelector('#odoj-messages');
    const input = win.querySelector('#odoj-input');
    const sendBtn = win.querySelector('#odoj-send');
    const closeBtn = win.querySelector('.odoj-chat-close');

    let history = [];
    let isOpen = false;
    let privacyAccepted = localStorage.getItem('odoj_chat_privacy') === '1';
    let startersShown = false;

    function openChat() {
      isOpen = true;
      win.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      if (!startersShown) showStarters();
      if (!privacyAccepted) showPrivacyBanner();
      setTimeout(() => input.focus(), 100);
    }

    function closeChat() {
      isOpen = false;
      win.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', () => isOpen ? closeChat() : openChat());
    closeBtn.addEventListener('click', closeChat);

    function addMsg(text, role) {
      const div = document.createElement('div');
      div.className = `odoj-msg ${role}`;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }

    function showTyping() {
      const t = document.createElement('div');
      t.className = 'odoj-typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      messages.appendChild(t);
      messages.scrollTop = messages.scrollHeight;
      return t;
    }

    function showStarters() {
      startersShown = true;
      const welcomeDiv = document.createElement('div');
      welcomeDiv.className = 'odoj-msg bot';
      welcomeDiv.textContent = 'Hallo! Ich bin der ODOJ Assistent. Wie kann ich dir helfen?';
      messages.appendChild(welcomeDiv);

      const starterBox = document.createElement('div');
      starterBox.className = 'odoj-starters';
      STARTERS.forEach(q => {
        const b = document.createElement('button');
        b.className = 'odoj-starter-btn';
        b.textContent = q;
        b.addEventListener('click', () => {
          starterBox.remove();
          sendMessage(q);
        });
        starterBox.appendChild(b);
      });
      messages.appendChild(starterBox);
      messages.scrollTop = messages.scrollHeight;
    }

    function showPrivacyBanner() {
      const banner = document.createElement('div');
      banner.className = 'odoj-privacy-banner';
      banner.id = 'odoj-privacy-banner';
      banner.innerHTML = `
        <span>Deine Nachrichten werden zur Verarbeitung an die Anthropic API gesendet. Es werden keine persönlichen Daten gespeichert.</span>
        <button class="odoj-privacy-ok">Verstanden</button>`;
      win.insertBefore(banner, win.querySelector('.odoj-chat-form'));
      banner.querySelector('.odoj-privacy-ok').addEventListener('click', () => {
        localStorage.setItem('odoj_chat_privacy', '1');
        privacyAccepted = true;
        banner.remove();
      });
    }

    async function sendMessage(text) {
      const userText = text.trim();
      if (!userText) return;

      input.value = '';
      input.disabled = true;
      sendBtn.disabled = true;
      addMsg(userText, 'user');

      history.push({ role: 'user', content: userText });
      if (history.length > 20) history = history.slice(-20);

      if (ANTHROPIC_KEY === 'ANTHROPIC_API_KEY_HIER_EINFUEGEN') {
        addMsg('Der Chatbot ist noch nicht konfiguriert. Bitte kontaktiere uns unter hallo@odoj.at', 'bot');
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
        return;
      }

      const typing = showTyping();

      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: history,
          }),
        });

        typing.remove();

        if (!res.ok) throw new Error('API error ' + res.status);

        const data = await res.json();
        const reply = data.content?.[0]?.text ?? 'Entschuldigung, ich konnte keine Antwort generieren.';
        addMsg(reply, 'bot');
        history.push({ role: 'assistant', content: reply });

      } catch {
        typing.remove();
        addMsg('Es gab ein Problem mit der Verbindung. Bitte versuche es erneut.', 'bot');
      }

      input.disabled = false;
      sendBtn.disabled = false;
      input.focus();
    }

    sendBtn.addEventListener('click', () => sendMessage(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.value); } });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
