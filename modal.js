// ── ODOJ Bestätigungs-Modal ──────────────────────────────
// Verwendung:
//   showBewerbungsModal({ titel, firma, datum, gehalt, onConfirm })

(function () {
  // CSS einmalig in den <head> injizieren
  if (!document.getElementById('odoj-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'odoj-modal-styles';
    style.textContent = `
      #odoj-modal-overlay {
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(11,31,58,.72);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        padding: 24px;
        animation: odoj-fade-in .18s ease;
      }
      @keyframes odoj-fade-in { from { opacity:0 } to { opacity:1 } }
      #odoj-modal-box {
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 24px 80px rgba(11,31,58,.28);
        width: 100%; max-width: 460px;
        overflow: hidden;
        animation: odoj-slide-up .22s cubic-bezier(.34,1.2,.64,1);
      }
      @keyframes odoj-slide-up { from { transform:translateY(24px); opacity:0 } to { transform:translateY(0); opacity:1 } }
      #odoj-modal-header {
        background: #0B1F3A;
        padding: 24px 28px 20px;
      }
      #odoj-modal-header h3 {
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 18px; font-weight: 800;
        color: #fff; margin-bottom: 4px;
      }
      #odoj-modal-header p {
        font-size: 13px; color: rgba(255,255,255,.55); font-weight: 300;
      }
      #odoj-modal-body { padding: 24px 28px; }
      .odoj-modal-row {
        display: flex; justify-content: space-between;
        align-items: center;
        padding: 11px 0;
        border-bottom: 1px solid #E8EDF5;
        font-size: 14px;
      }
      .odoj-modal-row:last-of-type { border-bottom: none; }
      .odoj-modal-row-label { color: #7A8FA8; font-weight: 300; }
      .odoj-modal-row-value { color: #0B1F3A; font-weight: 600; text-align: right; }
      .odoj-modal-gehalt { font-size: 22px; font-weight: 800; color: #0B1F3A; }
      .odoj-modal-gehalt span { font-size: 13px; font-weight: 300; color: #7A8FA8; }
      #odoj-modal-question {
        margin-top: 18px; padding: 14px 16px;
        background: #F4F7FB; border-radius: 10px;
        font-size: 14px; color: #3A5070; line-height: 1.55;
      }
      #odoj-modal-footer {
        padding: 16px 28px 24px;
        display: flex; gap: 10px; justify-content: flex-end;
      }
      #odoj-modal-cancel {
        background: transparent;
        border: 1.5px solid #E8EDF5;
        color: #3A5070; font-weight: 600;
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 14px; padding: 11px 22px;
        border-radius: 10px; cursor: pointer;
        transition: border-color .2s, color .2s;
      }
      #odoj-modal-cancel:hover { border-color: #0B1F3A; color: #0B1F3A; }
      #odoj-modal-confirm {
        background: #E8A020; color: #0B1F3A;
        border: none; font-weight: 700;
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 14px; padding: 11px 26px;
        border-radius: 10px; cursor: pointer;
        transition: background .2s, transform .15s;
        display: flex; align-items: center; gap: 7px;
      }
      #odoj-modal-confirm:hover { background: #F5BE5A; transform: translateY(-1px); }
      #odoj-modal-confirm:disabled { opacity:.6; cursor:default; transform:none; }
    `;
    document.head.appendChild(style);
  }

  window.showBewerbungsModal = function ({ titel, firma, datum, gehalt, onConfirm }) {
    // Altes Modal entfernen
    const old = document.getElementById('odoj-modal-overlay');
    if (old) old.remove();

    const gehaltStr = gehalt
      ? '€ ' + Number(gehalt).toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : null;

    const overlay = document.createElement('div');
    overlay.id = 'odoj-modal-overlay';
    overlay.innerHTML = `
      <div id="odoj-modal-box" role="dialog" aria-modal="true" aria-labelledby="odoj-modal-title">
        <div id="odoj-modal-header">
          <h3 id="odoj-modal-title">Bewerbung bestätigen</h3>
          <p>Bitte überprüfe die Details deiner Bewerbung.</p>
        </div>
        <div id="odoj-modal-body">
          <div class="odoj-modal-row">
            <span class="odoj-modal-row-label">Job</span>
            <span class="odoj-modal-row-value">${escModal(titel)}</span>
          </div>
          <div class="odoj-modal-row">
            <span class="odoj-modal-row-label">Unternehmen</span>
            <span class="odoj-modal-row-value">${escModal(firma)}</span>
          </div>
          ${datum ? `<div class="odoj-modal-row">
            <span class="odoj-modal-row-label">Datum</span>
            <span class="odoj-modal-row-value">${escModal(datum)}</span>
          </div>` : ''}
          ${gehaltStr ? `<div class="odoj-modal-row">
            <span class="odoj-modal-row-label">Tagesgehalt</span>
            <span class="odoj-modal-row-value odoj-modal-gehalt">${gehaltStr} <span>/ Tag</span></span>
          </div>` : ''}
          <div id="odoj-modal-question">
            Möchtest du dich wirklich für diesen Job bewerben?
          </div>
        </div>
        <div id="odoj-modal-footer">
          <button id="odoj-modal-cancel">Abbrechen</button>
          <button id="odoj-modal-confirm">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
            Ja, bewerben
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector('#odoj-modal-confirm');
    const cancelBtn  = overlay.querySelector('#odoj-modal-cancel');

    confirmBtn.addEventListener('click', () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> Wird gespeichert…';
      overlay.remove();
      onConfirm();
    });

    cancelBtn.addEventListener('click', () => overlay.remove());

    // Klick außerhalb schließt
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // ESC schließt
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    // Fokus setzen
    confirmBtn.focus();
  };

  function escModal(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── ERFOLGS-POPUP nach Bewerbung ─────────────────────────────
  window.showBewerbungsErfolg = function ({ titel, firma }) {
    const old = document.getElementById('odoj-success-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'odoj-success-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9999;
      background:rgba(11,31,58,.65);
      backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;padding:24px;
      animation:odoj-fade-in .18s ease;
    `;

    overlay.innerHTML = `
      <div style="
        background:#fff;border-radius:20px;
        box-shadow:0 24px 80px rgba(11,31,58,.28);
        width:100%;max-width:420px;overflow:hidden;
        animation:odoj-slide-up .25s cubic-bezier(.34,1.2,.64,1);
        text-align:center;
      ">
        <!-- Grüner Header -->
        <div style="background:#1a7a50;padding:32px 28px 24px">
          <div style="
            width:64px;height:64px;border-radius:50%;
            background:rgba(255,255,255,.18);
            display:flex;align-items:center;justify-content:center;
            margin:0 auto 16px;font-size:28px;
          ">✓</div>
          <h3 style="
            font-family:'Plus Jakarta Sans',sans-serif;
            font-size:20px;font-weight:800;color:#fff;margin-bottom:6px;
          ">Bewerbung gesendet!</h3>
          <p style="font-size:13px;color:rgba(255,255,255,.7);font-weight:300">
            ${escModal(titel)}${firma ? ' · ' + escModal(firma) : ''}
          </p>
        </div>
        <!-- Body -->
        <div style="padding:24px 28px 28px">
          <p style="font-size:15px;color:#3a5070;line-height:1.65;margin-bottom:24px">
            Deine Bewerbung wurde erfolgreich übermittelt.<br>
            Du wirst benachrichtigt, sobald der Arbeitgeber reagiert.
          </p>
          <div style="display:flex;flex-direction:column;gap:10px">
            <a href="meine-bewerbungen.html" style="
              display:block;background:#0B1F3A;color:#fff;
              font-family:'Plus Jakarta Sans',sans-serif;
              font-size:14px;font-weight:700;
              padding:13px 20px;border-radius:10px;
              text-decoration:none;transition:background .2s;
            ">Meine Bewerbungen ansehen →</a>
            <button id="odoj-success-close" style="
              background:transparent;border:1.5px solid #E8EDF5;
              color:#7a8fa8;font-family:'Plus Jakarta Sans',sans-serif;
              font-size:14px;font-weight:600;
              padding:11px 20px;border-radius:10px;cursor:pointer;
              transition:border-color .2s,color .2s;
            ">Weiter Jobs durchsuchen</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#odoj-success-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    const onKey = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#odoj-success-close').focus();
  };

})();
