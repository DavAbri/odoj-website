import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchDatenblattData, buildDatenblattPdf } from "../_shared/datenblatt.ts";
import { fetchRechnungData, buildRechnungPdf } from "../_shared/rechnung.ts";

const RESEND_API_KEY      = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL        = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL            = Deno.env.get("SITE_URL") || "https://odoj.at";
// Für Tests: "onboarding@resend.dev" verwenden (kein Domain-Verify nötig)
// Für Produktion: eigene verifizierte Domain eintragen, z.B. "noreply@odoj.at"
const FROM                = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
// Staging-Umgebung (siehe Testumgebungs-Setup): kennzeichnet jeden Betreff eindeutig
// als Test, statt E-Mails ganz zu unterdrücken - so bleiben echte und Test-Mails
// (inkl. der internen Benachrichtigung an info@odoj.at) klar unterscheidbar.
const IS_STAGING          = Deno.env.get("ODOJ_ENV") === "staging";
function withTestPrefix(subject: string): string {
  return IS_STAGING ? `[TEST] ${subject}` : subject;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── EMAIL TEMPLATES ──────────────────────────────────────────────

function baseTemplate(content: string): string {
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5;padding:40px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 30px rgba(0,0,0,.10)">
  <!-- HEADER -->
  <tr><td style="background:#0f1f3d;padding:22px 32px;text-align:center">
    <span style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
      O<span style="color:#E8A020">D</span>O<span style="color:#E8A020">J</span>
    </span>
  </td></tr>
  <!-- BODY -->
  ${content}
  <!-- FOOTER -->
  <tr><td style="background:#f8f9fb;border-top:1px solid #eaeaea;padding:20px 32px;text-align:center">
    <p style="margin:0;font-size:12px;color:#999;line-height:1.6">
      Diese E-Mail wurde automatisch von ODOJ gesendet.<br>
      <a href="${SITE_URL}" style="color:#E8A020;text-decoration:none;font-weight:600">odoj.at</a>
      &nbsp;·&nbsp; One Day One Job – Tagesjobs in Vorarlberg
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function newMessageTemplate(recipientName: string, senderName: string, jobTitel: string, bewId: string): string {
  const chatUrl = `${SITE_URL}/chat.html?bew=${bewId}`;
  const greeting = recipientName ? `Hallo ${recipientName},` : "Hallo,";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Neue Nachricht</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      Du hast eine neue Nachricht von <strong style="color:#0f1f3d">${esc(senderName)}</strong>
      zum Job <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> erhalten.
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${chatUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        💬 Nachricht ansehen &rarr;
      </a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Du erhältst diese E-Mail, weil du auf ODOJ registriert bist.</p>
  </td></tr>`);
}

function workConfirmedTemplate(recipientName: string, firmenname: string, jobTitel: string, bewId: string): string {
  const greeting = recipientName ? `Hallo ${recipientName},` : "Hallo,";
  const firmaLabel = firmenname || "dem Betrieb";

  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a7a50;text-transform:uppercase;letter-spacing:.8px">Einsatz abgeschlossen</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 8px;font-size:15px;color:#444;line-height:1.7">
      Dein Einsatz bei <strong style="color:#0f1f3d">${esc(firmenname)}</strong>
      als <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> wurde offiziell bestätigt. Großartige Arbeit!
    </p>
    <div style="background:#e6f5ee;border:1.5px solid #a8d9be;border-radius:10px;padding:16px 20px;margin:20px 0;font-size:14px;color:#1a5c3a;line-height:1.6">
      ✅ Deine Anwesenheit wurde bestätigt.
    </div>

    <!-- BEWERTUNG: nur ein Link/Button, Sterne gibt es ausschließlich auf der Webseite -->
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:22px 24px;margin-top:8px;text-align:center">
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0f1f3d">Wie war es mit ${esc(firmaLabel)}?</p>
      <p style="margin:0 0 18px;font-size:13px;color:#888;line-height:1.6">Wir würden uns sehr über dein Feedback freuen – es hilft uns, unseren Service zu verbessern.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="background:#0f1f3d;border-radius:8px">
        <a href="${SITE_URL}/chat.html?bew=${bewId}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
          Jetzt bewerten &rarr;
        </a>
      </td></tr></table>
    </div>

    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Wir freuen uns, dich bald wieder bei einem Einsatz dabei zu haben!</p>
  </td></tr>`);
}

function bewerbungBestaetigtTemplate(recipientName: string, jobTitel: string, terminInfo?: string): string {
  const dashboardUrl = `${SITE_URL}/meine-bewerbungen.html`;
  const greeting = recipientName ? `Hallo ${recipientName},` : "Hallo,";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a7a50;text-transform:uppercase;letter-spacing:.8px">Bewerbung erfolgreich</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      Deine Bewerbung für den Job <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> wurde erfolgreich übermittelt.
    </p>
    ${terminInfo ? `<p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">Termine: <strong style="color:#0f1f3d">${esc(terminInfo)}</strong></p>` : ""}
    <div style="background:#e6f5ee;border:1.5px solid #a8d9be;border-radius:10px;padding:16px 20px;margin:0 0 24px;font-size:14px;color:#1a5c3a;line-height:1.6">
      ✅ Der Arbeitgeber wurde benachrichtigt und wird deine Bewerbung so bald wie möglich prüfen.<br><br>
      Sobald es ein Update gibt – ob Zusage, Absage oder Rückfrage – wirst du sofort per E-Mail und auf der Plattform benachrichtigt.
    </div>
    <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.7">
      Du kannst den Status deiner Bewerbung jederzeit in deinem Dashboard einsehen.
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${dashboardUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        Meine Bewerbungen ansehen &rarr;
      </a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Viel Erfolg bei deiner Bewerbung!</p>
  </td></tr>`);
}

function neueBewerbungArbeitgeberTemplate(
  recipientName: string, jobberName: string, jobTitel: string, terminInfo?: string,
  uebersicht?: { alter: number | null; sterneAvg: number | null; sterneAnzahl: number; branchenMap: Record<string, number>; lebenslaufPfad: string | null; lebenslaufDateiname: string | null } | null
): string {
  const inserateUrl = `${SITE_URL}/meine-inserate.html`;
  const greeting = recipientName ? `Hallo ${recipientName},` : "Hallo,";

  let uebersichtHtml = "";
  if (uebersicht) {
    const zeilen: string[] = [];
    if (uebersicht.alter !== null) zeilen.push(`<span style="display:inline-block;background:#eef1f7;border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:13px;color:#0f1f3d">${uebersicht.alter} Jahre</span>`);
    if (uebersicht.sterneAnzahl > 0 && uebersicht.sterneAvg !== null) {
      const sterneGerundet = Math.round(uebersicht.sterneAvg);
      const sterneHtml = "★".repeat(sterneGerundet) + "☆".repeat(5 - sterneGerundet);
      zeilen.push(`<span style="display:inline-block;background:#eef1f7;border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:13px;color:#0f1f3d">${sterneHtml} ${uebersicht.sterneAvg.toFixed(1)} (${uebersicht.sterneAnzahl} Bewertung${uebersicht.sterneAnzahl !== 1 ? "en" : ""})</span>`);
    }
    const branchenEintraege = Object.entries(uebersicht.branchenMap);
    branchenEintraege.forEach(([k, v]) => {
      zeilen.push(`<span style="display:inline-block;background:#eef1f7;border-radius:6px;padding:4px 10px;margin:0 6px 6px 0;font-size:13px;color:#0f1f3d">${esc(BRANCHEN_LABEL[k] || k)}: ${v} Einsatz${v !== 1 ? "e" : ""}</span>`);
    });
    if (zeilen.length) {
      uebersichtHtml = `
    <div style="margin:0 0 20px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:.5px">Übersicht zum Bewerber</p>
      <div>${zeilen.join("")}</div>
    </div>`;
    }
  }

  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Neue Bewerbung</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      <strong style="color:#0f1f3d">${esc(jobberName)}</strong> hat sich für deinen Job
      <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> beworben.
    </p>
    ${terminInfo ? `<p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">Termine: <strong style="color:#0f1f3d">${esc(terminInfo)}</strong></p>` : ""}
    ${uebersichtHtml}
    ${uebersicht?.lebenslaufPfad ? `<p style="margin:0 0 16px;font-size:14px;color:#444;line-height:1.7">📎 Der Lebenslauf von ${esc(jobberName)} ist dieser E-Mail angehängt.</p>` : ""}
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:16px 20px;margin:0 0 24px;font-size:14px;color:#7a5500;line-height:1.6">
      📋 Melde dich in deinem ODOJ-Konto an, um die Bewerbung zu prüfen und zu antworten.
    </div>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${inserateUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        Bewerbung ansehen &rarr;
      </a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Du erhältst diese E-Mail, weil du auf ODOJ ein Inserat veröffentlicht hast.</p>
  </td></tr>`);
}

// E9: Stornierung/Zurückziehen durch den Jobber - geht NUR per Mail an den
// Arbeitgeber (Name, Inserat, Datum, Grund), bewusst NICHT als Chat-
// Nachricht (der Prompt verlangt explizit, dass im Chat dazu nichts
// erscheint - weder diese Info noch eine Selbstnotiz an den Jobber).
function bewerbungStorniertTemplate(recipientName: string, jobberName: string, jobTitel: string, datumStr: string, grund: string, warAngenommen: boolean): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  const aktionWort = warAngenommen ? "seine Zusage storniert" : "seine Bewerbung zurückgezogen";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#C0392B;text-transform:uppercase;letter-spacing:.8px">${warAngenommen ? "Stornierung" : "Bewerbung zurückgezogen"}</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      <strong style="color:#0f1f3d">${esc(jobberName)}</strong> hat ${aktionWort} für
      <strong style="color:#0f1f3d">${esc(jobTitel)}</strong>${datumStr ? ` am <strong style="color:#0f1f3d">${esc(datumStr)}</strong>` : ""}.
    </p>
    <div style="background:#FFF0F0;border:1.5px solid #F5C6C0;border-radius:10px;padding:16px 20px;margin:0 0 24px;font-size:14px;color:#7a2020;line-height:1.6">
      <strong>Grund:</strong> ${esc(grund)}
    </div>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/meine-inserate.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        Bewerbungen ansehen &rarr;
      </a>
    </td></tr></table>
  </td></tr>`);
}

// Disk-IO-Aufräumung: beim Löschen eines Inserats wurde die Benachrichtigung
// an die Bewerber bisher per nachrichten-Insert geschickt und Sekunden
// später durch denselben Lösch-Ablauf wieder entfernt, bevor sie je
// sichtbar wurde - Bewerber erfuhren dadurch faktisch nie vom Löschen.
// Jetzt wie bei E9 (Storno): direkte Mail statt Chat-Nachricht.
function jobGeloeschtTemplate(recipientName: string, jobTitel: string, datumStr: string, grund: string): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#C0392B;text-transform:uppercase;letter-spacing:.8px">Inserat gelöscht</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      Das Inserat <strong style="color:#0f1f3d">${esc(jobTitel)}</strong>${datumStr ? ` am <strong style="color:#0f1f3d">${esc(datumStr)}</strong>` : ""}
      wurde vom Arbeitgeber gelöscht. Deine Bewerbung ist damit leider nicht mehr gültig.
    </p>
    <div style="background:#FFF0F0;border:1.5px solid #F5C6C0;border-radius:10px;padding:16px 20px;margin:0 0 24px;font-size:14px;color:#7a2020;line-height:1.6">
      <strong>Grund:</strong> ${esc(grund)}
    </div>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/jobs.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        Weitere Jobs finden &rarr;
      </a>
    </td></tr></table>
  </td></tr>`);
}

function waitlistTemplate(email: string): string {
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Warteliste bestätigt</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">Du bist dabei! 🎉</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      Wir haben deine E-Mail-Adresse <strong style="color:#0f1f3d">${esc(email)}</strong> erfolgreich auf unserer Warteliste eingetragen.
      Sobald ODOJ live geht, melden wir uns bei dir.
    </p>
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:18px 20px;margin:0 0 24px;font-size:14px;color:#7a5500;line-height:1.7">
      🚀 <strong>Was ist ODOJ?</strong><br>
      ODOJ ist die neue Plattform für Tagesjobs in Vorarlberg. Jobber können sich schnell und einfach für Tagesjobs bewerben – Arbeitgeber finden kurzfristig flexible Verstärkung.
    </div>
    <p style="margin:0;font-size:13px;color:#aaa;line-height:1.6">Wir freuen uns, dich bald an Bord begrüßen zu dürfen!</p>
  </td></tr>`);
}

function paymentRequestTemplate(
  recipientName: string, jobTitel: string, datum: string,
  lohnBetrag: number, jobberIban: string, jobberName: string,
  gebuehr: number, odojIban: string, odojKontoinhaber: string, rechnungsnummer: string, bewId: string
): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  const fmt = (n: number) => n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const verwendungszweckGebuehr = `ODOJ – Vermittlungsgebühr – ${rechnungsnummer}`;
  const nichtErschienenUrl = `${SITE_URL}/nicht-erschienen.html?bew=${bewId}`;

  const gebuehrBoxHtml = rechnungsnummer ? `
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:20px 22px;margin:0 0 24px">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#a05000;text-transform:uppercase;letter-spacing:.5px">Separat: Vermittlungsgebühr an ODOJ (Rechnung im Anhang)</p>
      <p style="margin:0 0 10px;font-size:20px;font-weight:800;color:#0f1f3d">€ ${fmt(gebuehr)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#444"><strong>IBAN:</strong> ${esc(odojIban)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#444"><strong>Empfänger:</strong> ${esc(odojKontoinhaber)}</p>
      <p style="margin:0;font-size:14px;color:#444"><strong>Verwendungszweck:</strong> ${esc(verwendungszweckGebuehr)}</p>
    </div>` : "";

  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Zahlungshinweis</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      der Einsatz von <strong style="color:#0f1f3d">${esc(jobberName)}</strong> als <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> hat begonnen. Bitte überweisen Sie den Lohn direkt an den Jobber.
    </p>
    <div style="background:#f4f7fb;border-radius:10px;padding:20px 22px;margin:0 0 20px">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#7a8fa8;text-transform:uppercase;letter-spacing:.5px">Lohn an den Jobber</p>
      <p style="margin:0 0 10px;font-size:24px;font-weight:800;color:#0f1f3d">€ ${fmt(lohnBetrag)}</p>
      <p style="margin:0 0 4px;font-size:14px;color:#444"><strong>IBAN:</strong> ${esc(jobberIban || "– noch nicht hinterlegt, bitte Jobber kontaktieren –")}</p>
      <p style="margin:0;font-size:14px;color:#444"><strong>Empfänger:</strong> ${esc(jobberName)}</p>
    </div>
    ${gebuehrBoxHtml}
    <p style="margin:0 0 24px;font-size:14px;color:#7a5500;background:#fff8e8;border-radius:8px;padding:12px 16px;line-height:1.6">
      ⏱ Bitte überweisen Sie den Lohn zeitnah, idealerweise innerhalb von 3 Werktagen nach dem Einsatz.
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/meine-inserate.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">
        Zur Übersicht meiner Inserate &rarr;
      </a>
    </td></tr></table>
    <p style="margin:20px 0 0;font-size:12px;color:#C0392B;line-height:1.6">
      Falls der Jobber nicht erschienen ist, ist diese Rechnung hinfällig.
      <a href="${nichtErschienenUrl}" style="color:#C0392B;text-decoration:underline">Nichterscheinen melden</a>
    </p>
  </td></tr>`);
}

// Korrektur 4: fehlte bisher komplett im Dispatch - der Client rief diesen
// Typ zwar schon auf, die Funktion kannte ihn aber nicht (400 "Unbekannter
// type", nur durch den leeren catch() im Frontend unbemerkt).
function stammkraftBenachrichtigungTemplate(recipientName: string, firmenname: string, jobTitel: string): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Stammkraft</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      <strong style="color:#0f1f3d">${esc(firmenname)}</strong> hat dich als Stammkraft ausgewählt und möchte dich
      bei neuen Inseraten direkt informieren, bevor sie für alle sichtbar sind.
    </p>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      Das bedeutet: Du bekommst von ${esc(firmenname)} eine Nachricht auf ODOJ, sobald ein neuer Job verfügbar ist,
      und kannst dich dann als einer der ersten darauf bewerben. Du bist dadurch zu nichts verpflichtet.
    </p>
    ${jobTitel ? `<p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">Aktuell gibt es schon ein neues Inserat: <strong style="color:#0f1f3d">${esc(jobTitel)}</strong>.</p>` : ""}
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/chat.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
        Zur Plattform &rarr;
      </a>
    </td></tr></table>
  </td></tr>`);
}

function einsatzErledigtArbeitgeberTemplate(
  recipientName: string, jobTitel: string, jobId: string, bewId: string, jobberName: string
): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  const link = `${SITE_URL}/meine-inserate.html?job=${jobId}&bew=${bewId}&rate=1`;
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1a7a50;text-transform:uppercase;letter-spacing:.8px">Einsatz beendet</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      der Einsatz <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> mit <strong style="color:#0f1f3d">${esc(jobberName)}</strong> ist beendet.
    </p>
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:22px 24px;margin-top:8px;text-align:center">
      <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#0f1f3d">Wie war die Zusammenarbeit mit ${esc(jobberName)}?</p>
      <p style="margin:0 0 18px;font-size:13px;color:#888;line-height:1.6">Ihre Bewertung hilft anderen Arbeitgebern auf der Plattform.</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td style="background:#0f1f3d;border-radius:8px">
        <a href="${link}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
          Jetzt bewerten &rarr;
        </a>
      </td></tr></table>
    </div>
  </td></tr>`);
}

function rechnungErstelltTemplate(recipientName: string, invoiceNumber: string, jobTitel: string, amount: number, anzahl: number): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  const fmt = (n: number) => n.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const leistungText = anzahl > 1 ? `${anzahl} durchgeführte Vermittlungen` : "die Vermittlung des Einsatzes";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Neue Rechnung</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.7">
      anbei die Rechnung <strong style="color:#0f1f3d">${esc(invoiceNumber)}</strong> für ${leistungText}
      <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> über <strong style="color:#0f1f3d">€ ${fmt(amount)}</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#7a5500;background:#fff8e8;border-radius:8px;padding:12px 16px;line-height:1.6">
      Bitte gib bei der Überweisung als Verwendungszweck die Rechnungsnummer <strong>${esc(invoiceNumber)}</strong> an.
    </p>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/profil.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">
        Rechnung ansehen &rarr;
      </a>
    </td></tr></table>
  </td></tr>`);
}

function neueRegistrierungInternTemplate(regType: string, regName: string, regEmail: string, regRefCode: string | null): string {
  const typLabel = regType === 'arbeitgeber' ? 'Arbeitgeber' : 'Jobber';
  const zeitpunkt = new Date().toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'medium', timeStyle: 'short' });
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Interne Benachrichtigung</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">Neue Registrierung</h2>
    <ul style="margin:0;padding:0 0 0 18px;font-size:15px;color:#444;line-height:2">
      <li><strong style="color:#0f1f3d">Nutzertyp:</strong> ${esc(typLabel)}</li>
      <li><strong style="color:#0f1f3d">Name/Firma:</strong> ${esc(regName || '–')}</li>
      <li><strong style="color:#0f1f3d">E-Mail:</strong> ${esc(regEmail)}</li>
      <li><strong style="color:#0f1f3d">Registriert am:</strong> ${esc(zeitpunkt)}</li>
      <li><strong style="color:#0f1f3d">Herkunft (ref):</strong> ${esc(regRefCode || 'Direkt (kein Ref-Link)')}</li>
    </ul>
  </td></tr>`);
}

function bewerbungAngenommenDatenblattTemplate(recipientName: string, jobberName: string, jobTitel: string, datumStr: string): string {
  const greeting = recipientName ? `Hallo ${esc(recipientName)},` : "Hallo,";
  return baseTemplate(`
  <tr><td style="padding:36px 32px 28px">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#E8A020;text-transform:uppercase;letter-spacing:.8px">Bewerbung angenommen</p>
    <h2 style="margin:0 0 20px;font-size:22px;font-weight:800;color:#0f1f3d;line-height:1.3">${greeting}</h2>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      die Bewerbung von <strong style="color:#0f1f3d">${esc(jobberName)}</strong> für
      <strong style="color:#0f1f3d">${esc(jobTitel)}</strong> am <strong style="color:#0f1f3d">${esc(datumStr)}</strong>
      wurde angenommen.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#444;line-height:1.7">
      Im Anhang findest du ein PDF-Datenblatt mit allen Daten für Anmeldung, Lohnverrechnung und
      Bezahlung – du kannst es direkt an deinen Steuerberater bzw. deine Lohnverrechnung weiterleiten.
    </p>
    <div style="background:#fffbf0;border:1.5px solid #f5be5a;border-radius:10px;padding:14px 18px;margin:0 0 24px;font-size:14px;color:#7a5500;line-height:1.6">
      ⏱ Die Anmeldung muss vor Arbeitsantritt erfolgen.
    </div>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0f1f3d;border-radius:8px">
      <a href="${SITE_URL}/meine-inserate.html" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">
        Zur Plattform &rarr;
      </a>
    </td></tr></table>
    <p style="margin:24px 0 0;font-size:13px;color:#aaa">Das Datenblatt kannst du jederzeit erneut unter „Meine Inserate" herunterladen.</p>
  </td></tr>`);
}

function esc(s: string): string {
  return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

const BRANCHEN_LABEL: Record<string, string> = { gastro: "Gastronomie", events: "Veranstaltungen & Events", hotel: "Hotellerie", einzelhandel: "Einzelhandel", sonstige: "Sonstige" };

function berechneAlter(geburtsdatum: string): number | null {
  if (!geburtsdatum) return null;
  const geb = new Date(geburtsdatum);
  if (isNaN(geb.getTime())) return null;
  const heute = new Date();
  let alter = heute.getFullYear() - geb.getFullYear();
  const nochNichtGehabt = heute.getMonth() < geb.getMonth() || (heute.getMonth() === geb.getMonth() && heute.getDate() < geb.getDate());
  if (nochNichtGehabt) alter--;
  return alter;
}

// Bewertungs-/Erfahrungs-Übersicht eines Jobbers für Arbeitgeber - bewusst
// OHNE sensible Felder (SV-Nummer, IBAN, Adresse): nur Alter + aggregierte
// Bewertungsdaten, die der Arbeitgeber auch sonst auf der Plattform sieht.
async function fetchJobberUebersicht(admin: any, jobberId: string) {
  const { data: profile } = await admin.from("Profile").select("geburtsdatum, lebenslauf_pfad, lebenslauf_dateiname").eq("user_id", jobberId).maybeSingle();
  const alter = profile?.geburtsdatum ? berechneAlter(profile.geburtsdatum) : null;

  const { data: bews } = await admin.from("bewertungen").select("sterne").eq("bewertet_id", jobberId).eq("rolle_bewerter", "arbeitgeber");
  const sterneAnzahl = bews?.length || 0;
  const sterneAvg = sterneAnzahl ? (bews!.reduce((s: number, b: any) => s + (b.sterne || 0), 0) / sterneAnzahl) : null;

  const { data: erledigt } = await admin.from("bewerbungen").select("job_id").eq("jobber_id", jobberId).eq("anwesenheit_bestaetigt", true);
  const branchenMap: Record<string, number> = {};
  const jobIds = [...new Set((erledigt || []).map((b: any) => b.job_id).filter(Boolean))];
  if (jobIds.length) {
    const { data: jobData } = await admin.from("jobs").select("branche").in("id", jobIds);
    jobData?.forEach((j: any) => { if (j.branche) branchenMap[j.branche] = (branchenMap[j.branche] || 0) + 1; });
  }

  return {
    alter, sterneAvg, sterneAnzahl, branchenMap,
    lebenslaufPfad: profile?.lebenslauf_pfad || null,
    lebenslaufDateiname: profile?.lebenslauf_dateiname || null,
  };
}

// Lädt den im Storage abgelegten Lebenslauf (falls vorhanden) und gibt ihn
// als E-Mail-Anhang zurück - damit der Arbeitgeber ihn direkt in der
// Bewerbungs-Mail sieht, ohne sich extra einloggen zu müssen.
async function fetchLebenslaufAttachment(
  admin: any, pfad: string | null, dateiname: string | null
): Promise<{ filename: string; content: string } | null> {
  if (!pfad) return null;
  const { data, error } = await admin.storage.from("lebenslaeufe").download(pfad);
  if (error || !data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const filename = dateiname || pfad.split("/").pop() || "Lebenslauf";
  return { filename, content: btoa(String.fromCharCode(...bytes)) };
}

// Lohn-/Zahlungsdaten für die automatische Zahlungshinweis-Mail (Block
// "automatische Mails zu Arbeitsbeginn/-ende") - lädt alles selbst anhand
// der bewId, der Aufrufer (anwesenheit-abwicklung) muss nur die ID kennen.
async function fetchZahlungshinweisData(admin: any, bewId: string) {
  const { data: bew } = await admin.from("bewerbungen").select("job_id, jobber_id, termin_id").eq("id", bewId).maybeSingle();
  if (!bew) return null;

  const [{ data: job }, { data: termin }, { data: jobberProfil }, { data: settings }] = await Promise.all([
    admin.from("jobs").select("titel, tagesgehalt, datum").eq("id", bew.job_id).maybeSingle(),
    bew.termin_id ? admin.from("job_termine").select("datum").eq("id", bew.termin_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("Profile").select("vorname, nachname, iban").eq("user_id", bew.jobber_id).maybeSingle(),
    admin.from("einstellungen").select("schluessel, wert_text").in("schluessel", ["odoj_iban", "odoj_kontoinhaber"]),
  ]);

  const settingsMap: Record<string, string> = {};
  (settings || []).forEach((s: any) => { settingsMap[s.schluessel] = s.wert_text; });
  const effDatum = (termin as any)?.datum || (job as any)?.datum || "";

  return {
    jobTitel: (job as any)?.titel || "Tagesjob",
    datum: effDatum ? new Date(effDatum + "T00:00:00").toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "",
    lohnBetrag: Number((job as any)?.tagesgehalt || 0),
    jobberIban: (jobberProfil as any)?.iban || "",
    jobberName: `${(jobberProfil as any)?.vorname || ""} ${(jobberProfil as any)?.nachname || ""}`.trim() || "der Jobber",
    odojIban: settingsMap["odoj_iban"] || "",
    odojKontoinhaber: settingsMap["odoj_kontoinhaber"] || "ODOJ",
  };
}

// ── MAIN ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const {
      type, recipientId, senderName, jobTitel, bewId, firmenname, jobberName, email,
      datum, lohnBetrag, jobberIban, gebuehr, odojIban, odojKontoinhaber, rechnungsnummer, betrag,
      terminInfo, regType, regName, regEmail, regRefCode, invoiceId, grund, warAngenommen, jobberId, jobId
    } = await req.json();

    // Warteliste: kein recipientId nötig, E-Mail direkt
    if (type === 'waitlist') {
      if (!email) return new Response(JSON.stringify({ error: "email fehlt" }), { status: 400, headers: cors });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: email,
          subject: withTestPrefix("Du bist auf der ODOJ-Warteliste! 🎉"),
          html: waitlistTemplate(email),
        }),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody?.message || "Resend-Fehler");
      return new Response(JSON.stringify({ ok: true, id: resBody.id }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Interne Registrierungs-Benachrichtigung ans ODOJ-Team: fixe Zieladresse,
    // kein recipientId nötig (info@odoj.at ist kein Supabase-Auth-Nutzer).
    if (type === 'neue_registrierung_intern') {
      if (!regEmail) return new Response(JSON.stringify({ error: "regEmail fehlt" }), { status: 400, headers: cors });
      const typLabel = regType === 'arbeitgeber' ? 'Arbeitgeber' : 'Jobber';
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM,
          to: "info@odoj.at",
          subject: withTestPrefix(`Neue Registrierung: ${typLabel} – ${regName || regEmail}`),
          html: neueRegistrierungInternTemplate(regType, regName, regEmail, regRefCode),
        }),
      });
      const resBody = await res.json();
      if (!res.ok) throw new Error(resBody?.message || "Resend-Fehler");
      return new Response(JSON.stringify({ ok: true, id: resBody.id }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!recipientId) return new Response(JSON.stringify({ error: "recipientId fehlt" }), { status: 400, headers: cors });

    // Empfänger-E-Mail über Admin-API holen (sicher serverseitig)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error: userErr } = await admin.auth.admin.getUserById(recipientId);
    if (userErr || !user?.email) return new Response(JSON.stringify({ error: "Benutzer nicht gefunden" }), { status: 404, headers: cors });

    // Empfänger-Name aus Profile holen
    const { data: profile } = await admin.from("Profile").select("vorname, nachname").eq("user_id", recipientId).single();
    const recipientName = profile ? `${profile.vorname || ""} ${profile.nachname || ""}`.trim() : "";

    let subject = "";
    let html = "";
    let attachments: Array<{ filename: string; content: string }> | undefined;
    let bcc: string[] | undefined;

    if (type === "bewerbung_angenommen_datenblatt") {
      if (!bewId) return new Response(JSON.stringify({ error: "bewId fehlt" }), { status: 400, headers: cors });
      const result = await fetchDatenblattData(admin, bewId);
      if (!result) return new Response(JSON.stringify({ error: "Bewerbung nicht gefunden" }), { status: 404, headers: cors });
      const jobberName = `${result.data.jobber.vorname || ""} ${result.data.jobber.nachname || ""}`.trim() || "Ein Jobber";
      const jobTitelStr = result.data.job.titel || "einen Einsatz";
      const datumStr = result.data.einsatzDatum
        ? new Date(result.data.einsatzDatum + "T00:00:00").toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" })
        : "unbekanntes Datum";
      subject = `Bewerbung angenommen: ${jobberName} – ${jobTitelStr} am ${datumStr}`;
      html = bewerbungAngenommenDatenblattTemplate(recipientName, jobberName, jobTitelStr, datumStr);
      const { bytes, filename } = await buildDatenblattPdf(result.data);
      attachments = [{ filename, content: btoa(String.fromCharCode(...bytes)) }];
    } else if (type === "rechnung_erstellt") {
      if (!invoiceId) return new Response(JSON.stringify({ error: "invoiceId fehlt" }), { status: 400, headers: cors });
      const result = await fetchRechnungData(admin, invoiceId);
      if (!result) return new Response(JSON.stringify({ error: "Rechnung nicht gefunden" }), { status: 404, headers: cors });
      subject = `Deine Rechnung ${result.data.invoiceNumber} von ODOJ`;
      html = rechnungErstelltTemplate(recipientName, result.data.invoiceNumber, result.data.job.titel || "", result.data.amount, result.data.positionen.length);
      const safeInvName = result.data.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "") || "Rechnung";
      const rechnungFilename = `Rechnung-${safeInvName}.pdf`;
      // B3: die im Storage abgelegte, unveränderliche Kopie als Anhang
      // verwenden statt unabhängig neu zu erzeugen (eine Quelle der Wahrheit).
      let rechnungBytes: Uint8Array | null = null;
      if (result.pdfPfad) {
        const { data: stored } = await admin.storage.from("rechnungen").download(result.pdfPfad);
        if (stored) rechnungBytes = new Uint8Array(await stored.arrayBuffer());
      }
      if (!rechnungBytes) rechnungBytes = (await buildRechnungPdf(result.data)).bytes;
      attachments = [{ filename: rechnungFilename, content: btoa(String.fromCharCode(...rechnungBytes)) }];
      // B3: jede Rechnungsmail geht zusätzlich als BCC an info@odoj.at.
      bcc = ["info@odoj.at"];
    } else if (type === "new_message") {
      subject = `💬 Neue Nachricht von ${senderName} – ODOJ`;
      html = newMessageTemplate(recipientName, senderName || "", jobTitel || "", bewId || "");
    } else if (type === "work_confirmed") {
      subject = `✅ Einsatz abgeschlossen – Wie war es mit ${firmenname || "deinem Einsatz"}?`;
      html = workConfirmedTemplate(recipientName, firmenname || "", jobTitel || "", bewId || "");
    } else if (type === "bewerbung_bestaetigt") {
      subject = `Deine Bewerbung wurde erfolgreich übermittelt ✓`;
      html = bewerbungBestaetigtTemplate(recipientName, jobTitel || "", terminInfo || "");
    } else if (type === "neue_bewerbung_arbeitgeber") {
      subject = `Neue Bewerbung für deinen Job: ${jobTitel || ""}`;
      const uebersicht = jobberId ? await fetchJobberUebersicht(admin, jobberId) : null;
      html = neueBewerbungArbeitgeberTemplate(recipientName, jobberName || "Ein Jobber", jobTitel || "", terminInfo || "", uebersicht);
      if (uebersicht?.lebenslaufPfad) {
        const lebenslaufAnhang = await fetchLebenslaufAttachment(admin, uebersicht.lebenslaufPfad, uebersicht.lebenslaufDateiname);
        if (lebenslaufAnhang) attachments = [lebenslaufAnhang];
      }
    } else if (type === "payment_request") {
      if (!bewId) return new Response(JSON.stringify({ error: "bewId fehlt" }), { status: 400, headers: cors });
      const pdata = await fetchZahlungshinweisData(admin, bewId);
      if (!pdata) return new Response(JSON.stringify({ error: "Bewerbung nicht gefunden" }), { status: 404, headers: cors });

      let rechnungBetrag = 0;
      let rechnungsnummerAuto = "";
      if (invoiceId) {
        const result = await fetchRechnungData(admin, invoiceId);
        if (result) {
          rechnungBetrag = result.data.amount;
          rechnungsnummerAuto = result.data.invoiceNumber;
          let rechnungBytes: Uint8Array | null = null;
          if (result.pdfPfad) {
            const { data: stored } = await admin.storage.from("rechnungen").download(result.pdfPfad);
            if (stored) rechnungBytes = new Uint8Array(await stored.arrayBuffer());
          }
          if (!rechnungBytes) rechnungBytes = (await buildRechnungPdf(result.data)).bytes;
          const safeInvName = result.data.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, "") || "Rechnung";
          attachments = [{ filename: `Rechnung-${safeInvName}.pdf`, content: btoa(String.fromCharCode(...rechnungBytes)) }];
          bcc = ["info@odoj.at"];
        }
      }

      subject = rechnungsnummerAuto
        ? `Zahlungshinweis + ODOJ-Rechnung – ${pdata.jobTitel}`
        : `Zahlungshinweis – ${pdata.jobTitel}`;
      html = paymentRequestTemplate(
        recipientName, pdata.jobTitel, pdata.datum,
        pdata.lohnBetrag, pdata.jobberIban, pdata.jobberName,
        rechnungBetrag, pdata.odojIban, pdata.odojKontoinhaber, rechnungsnummerAuto, bewId
      );
    } else if (type === "einsatz_erledigt_arbeitgeber") {
      let jobberNameAuto = "den Jobber";
      if (jobberId) {
        const { data: jp } = await admin.from("Profile").select("vorname, nachname").eq("user_id", jobberId).maybeSingle();
        const n = `${jp?.vorname || ""} ${jp?.nachname || ""}`.trim();
        if (n) jobberNameAuto = n;
      }
      subject = `Einsatz beendet – bitte ${jobberNameAuto} bewerten`;
      html = einsatzErledigtArbeitgeberTemplate(recipientName, jobTitel || "Tagesjob", jobId || "", bewId || "", jobberNameAuto);
    } else if (type === "bewerbung_storniert") {
      subject = warAngenommen
        ? `Stornierung: ${jobberName || "Ein Jobber"} – ${jobTitel || ""}`
        : `Bewerbung zurückgezogen: ${jobberName || "Ein Jobber"} – ${jobTitel || ""}`;
      html = bewerbungStorniertTemplate(recipientName, jobberName || "Ein Jobber", jobTitel || "", datum || "", grund || "kein Grund angegeben", !!warAngenommen);
    } else if (type === "job_geloescht") {
      subject = `Inserat gelöscht: ${jobTitel || "Tagesjob"}`;
      html = jobGeloeschtTemplate(recipientName, jobTitel || "", datum || "", grund || "kein Grund angegeben");
    } else if (type === "stammkraft_benachrichtigung") {
      subject = `${firmenname || "Ein Arbeitgeber"} hat dich als Stammkraft ausgewählt ⭐`;
      html = stammkraftBenachrichtigungTemplate(recipientName, firmenname || "Ein Arbeitgeber", jobTitel || "");
    } else {
      return new Response(JSON.stringify({ error: "Unbekannter type" }), { status: 400, headers: cors });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: user.email, subject: withTestPrefix(subject), html, ...(attachments ? { attachments } : {}), ...(bcc ? { bcc } : {}) }),
    });

    const resBody = await res.json();
    if (!res.ok) throw new Error(resBody?.message || "Resend-Fehler");

    return new Response(JSON.stringify({ ok: true, id: resBody.id }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors });
  }
});
