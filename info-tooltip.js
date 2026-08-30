// ── ODOJ Info-Tooltip ────────────────────────────────────
// Verwendung:
//   <span class="odoj-tip">
//     <button type="button" class="odoj-tip-btn" aria-label="Info">i</button>
//     <span class="odoj-tip-pop">Erklärungstext …</span>
//   </span>
(function () {
  if (!document.getElementById('odoj-tip-styles')) {
    const style = document.createElement('style');
    style.id = 'odoj-tip-styles';
    style.textContent = `
      .odoj-tip { position: relative; display: inline-flex; vertical-align: middle; }
      .odoj-tip-btn {
        width: 18px; height: 18px; border-radius: 50%;
        background: var(--accent-pale, #FDF3DC); color: var(--accent, #E8A020);
        border: 1.5px solid rgba(232,160,32,.4);
        font-size: 11px; font-weight: 800; font-family: 'Plus Jakarta Sans', sans-serif;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; line-height: 1; padding: 0; flex-shrink: 0;
        transition: background .2s, color .2s;
      }
      .odoj-tip-btn:hover { background: var(--accent, #E8A020); color: #fff; }
      .odoj-tip-pop {
        display: none; position: absolute; z-index: 200;
        bottom: calc(100% + 10px); left: 50%; transform: translateX(-50%);
        width: 300px; max-width: 82vw;
        background: #0B1F3A; color: rgba(255,255,255,.85);
        font-size: 12.5px; font-weight: 400; line-height: 1.65;
        border-radius: 10px; padding: 14px 16px;
        box-shadow: 0 12px 32px rgba(11,31,58,.35);
        text-align: left; cursor: default;
      }
      .odoj-tip-pop p { margin: 0 0 10px; }
      .odoj-tip-pop p:last-child { margin-bottom: 0; }
      .odoj-tip-pop::after {
        content: ''; position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
        border: 6px solid transparent; border-top-color: #0B1F3A;
      }
      .odoj-tip.open .odoj-tip-pop { display: block; }
      @media (max-width: 540px) {
        .odoj-tip-pop { left: auto; right: -14px; transform: none; width: 260px; }
        .odoj-tip-pop::after { left: auto; right: 18px; transform: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function closeAll(except) {
    document.querySelectorAll('.odoj-tip.open').forEach(el => { if (el !== except) el.classList.remove('open'); });
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.odoj-tip-btn');
    if (btn) {
      e.stopPropagation();
      const wrap = btn.closest('.odoj-tip');
      const isOpen = wrap.classList.contains('open');
      closeAll();
      if (!isOpen) wrap.classList.add('open');
      return;
    }
    if (!e.target.closest('.odoj-tip-pop')) closeAll();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
})();
