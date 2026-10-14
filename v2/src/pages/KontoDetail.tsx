import { useEffect, useState } from "react";
import { useQuery } from "../db/client";
import { ibanGueltig, iban as ibanFormat, isoDatum, heute } from "../lib/format";
import { KONTO_ART, kontoSpeichern, persoenlicherTopf, STATUS_TEXT, zahlungsmittelAnlegen, zahlungsmittelLoeschen } from "../lib/data";
import { besitzText } from "../lib/gruppen";
import { useHaushalt } from "../lib/haushalt";
import { Abschnitt, Avatar, farbe, Feld, KontoIcon, Leer, Seite, Sheet, useAktion } from "../ui/kit";
import { Icon } from "../ui/Icon";

const ZAHLART: [string, string][] = [["debit_card", "Debitkarte"], ["credit_card", "Kreditkarte"], ["twint", "Twint"], ["bank_transfer", "Überweisung"], ["ebill", "eBill"], ["cash", "Bargeld"], ["other", "Andere"]];

export function KontoDetail({ id }: { id: string }) {
  const { konten, personen, household } = useHaushalt();
  const k = konten.find((x) => x.id === id);
  const zm = useQuery<{ id: string; kind: string; label: string; card_last4: string | null; holder_person_id: string | null }>(
    `select id, kind, label, card_last4, holder_person_id from payment_method where account_id = $1 order by label`, [id]);
  const kat = useQuery<{ name: string }>(`select name from category where default_cost_account_id = $1 and archived_at is null order by name`, [id]);
  const aktion = useAktion();
  const [form, setForm] = useState({ name: "", iban: "", bank_name: "", opening_date: "", opening_balance: "", note: "" });
  const [aktivieren, setAktivieren] = useState(false);
  const [neuZm, setNeuZm] = useState(false);
  useEffect(() => {
    if (k) setForm({ name: k.name, iban: k.iban ?? "", bank_name: k.bank_name ?? "", opening_date: isoDatum(k.opening_date), opening_balance: k.opening_balance === "0.00" ? "" : k.opening_balance, note: k.note ?? "" });
  }, [k?.id, k?.name, k?.iban, k?.bank_name, k?.opening_date, k?.opening_balance, k?.note]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!k) return <Seite titel="Nicht gefunden" zurueck="konten"><Leer icon="konten" titel="Dieses Konto gibt es nicht (mehr)." /></Seite>;
  const einzeln = k.owners.length === 1;
  const geaendert = form.name !== k.name || form.iban !== (k.iban ?? "") || form.bank_name !== (k.bank_name ?? "") || form.note !== (k.note ?? "")
    || form.opening_date !== isoDatum(k.opening_date) || (form.opening_balance || "0.00") !== k.opening_balance;
  const ibanFehler = form.iban && !ibanGueltig(form.iban);
  const speichern = () => aktion(() => kontoSpeichern(k.id, {
    name: form.name.trim(), iban: form.iban.replace(/\s+/g, "").toUpperCase() || null, bank_name: form.bank_name.trim() || null,
    opening_date: form.opening_date || null, opening_balance: form.opening_balance || "0", note: form.note.trim() || null,
  }), "Gespeichert");
  return (
    <Seite eyebrow={KONTO_ART[k.kind].name} titel={k.name} zurueck="konten">
      <div className={`topf k-${k.kind} ${k.status === "virtual" ? "virtuell" : ""} card p-5 pl-6 grid gap-3`}>
        <div className="flex items-center gap-3">
          <KontoIcon kind={k.kind} />
          <div className="grid flex-1"><b className="text-[17px]">{STATUS_TEXT[k.status]}</b><span className="text-muted text-[13.5px]">{besitzText(k, personen)}</span></div>
          <span className="avatars">{k.owners.map((o) => <Avatar key={o.person_id} name={o.name} color={farbe(o)} />)}</span>
        </div>
        {k.status === "virtual" && (
          <>
            <p className="text-[14px] text-ink-2">Dieser Topf hat noch kein eigenes Bankkonto. Ausgaben dafür werden über ein anderes Konto bezahlt; {k.owners.length > 1 ? "die App rechnet aus, wer wem etwas schuldet." : "sie zählen trotzdem zu diesem Topf."}</p>
            <button className="btn btn-primary" onClick={() => setAktivieren(true)}><Icon name="konten" />Als echtes Konto führen</button>
          </>
        )}
        {k.status === "active" && k.iban && <p className="num text-[15px]">{ibanFormat(k.iban)}{k.bank_name ? ` · ${k.bank_name}` : ""}</p>}
      </div>

      {einzeln && (k.kind === "privat" || k.kind === "freizeit") && (
        <label className="card p-4 flex items-center gap-3">
          <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={k.is_personal_default} disabled={k.is_personal_default}
            onChange={() => aktion(() => persoenlicherTopf(k.owners[0].person_id, k.id), "Persönlicher Topf umgestellt")} />
          <span className="grid"><b>Persönlicher Topf von {k.owners[0].name}</b>
            <span className="text-muted text-[13px]">Hierhin gehen persönliche Ausgaben, wenn nichts anderes gewählt ist. Später z. B. auf «Freizeit» umstellen.</span></span>
        </label>
      )}

      <Abschnitt titel="Angaben">
        <form className="card p-5 grid gap-4" onSubmit={(e) => { e.preventDefault(); speichern(); }}>
          <Feld label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Feld>
          {k.status !== "virtual" && (
            <>
              <Feld label="IBAN" hinweis={ibanFehler ? <span className="text-crit">Die IBAN stimmt nicht (Prüfziffer).</span> : undefined}>
                <input className="input mono" autoCapitalize="characters" value={ibanFormat(form.iban)} onChange={(e) => setForm({ ...form, iban: e.target.value })} />
              </Feld>
              <div className="grid grid-cols-2 gap-3">
                <Feld label="Bank"><input className="input" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></Feld>
                <Feld label="Geführt seit"><input className="input" type="date" value={form.opening_date} onChange={(e) => setForm({ ...form, opening_date: e.target.value })} /></Feld>
              </div>
              <Feld label="Kontostand am Startdatum (CHF)" hinweis="Für den Kontostand in der App. Leer lassen, wenn unbekannt.">
                <input className="input mono" inputMode="decimal" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value.replace(",", ".") })} />
              </Feld>
            </>
          )}
          <Feld label="Notiz"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Feld>
          <button className="btn btn-primary" disabled={!geaendert || !form.name.trim() || !!ibanFehler}>Speichern</button>
        </form>
      </Abschnitt>

      <Abschnitt titel="Zahlungsmittel" text="Karten und Twint, die von diesem Konto abbuchen. Daran erkennt die App später, woher eine Zahlung kam."
        aktion={<button className="btn btn-soft" onClick={() => setNeuZm(true)}><Icon name="plus" />Neu</button>}>
        {zm && zm.length ? (
          <div className="card list overflow-hidden">
            {zm.map((z) => (
              <div key={z.id} className="row cursor-default">
                <span className="k-ico small k-privat"><Icon name="karte" size={18} /></span>
                <span className="grid flex-1"><b>{z.label}</b><span className="text-muted text-[13px]">{ZAHLART.find(([v]) => v === z.kind)?.[1]}{z.card_last4 ? ` · •••• ${z.card_last4}` : ""}{z.holder_person_id ? ` · ${personen.find((p) => p.id === z.holder_person_id)?.display_name}` : ""}</span></span>
                <button className="icon-btn" aria-label={`${z.label} löschen`} onClick={() => aktion(() => zahlungsmittelLoeschen(z.id), "Gelöscht")}><Icon name="muell" /></button>
              </div>
            ))}
          </div>
        ) : <p className="text-muted text-[14px] px-1">{k.status === "virtual" ? "Kommt dazu, sobald es ein echtes Konto gibt." : "Noch keine erfasst."}</p>}
      </Abschnitt>

      {kat && kat.length > 0 && (
        <Abschnitt titel="Standard für diese Kategorien">
          <div className="flex flex-wrap gap-1.5">{kat.map((c) => <a key={c.name} href="#/kategorien" className={`chip k-tag k-${k.kind} no-underline`}>{c.name}</a>)}</div>
        </Abschnitt>
      )}

      <div className="grid gap-2 pt-2">
        {k.status !== "closed"
          ? <button className="btn btn-danger" onClick={() => aktion(() => kontoSpeichern(k.id, { status: "closed", is_personal_default: false }), "Geschlossen")}>Konto/Topf schliessen</button>
          : <button className="btn" onClick={() => aktion(() => kontoSpeichern(k.id, { status: k.opening_date ? "active" : "virtual" }), "Wieder geöffnet")}>Wieder öffnen</button>}
        <p className="text-muted text-[12.5px] px-1">Die Aufteilung ({besitzText(k, personen)}) bleibt fest, damit alte Belege stimmen. Für eine andere Aufteilung einen neuen Topf anlegen.</p>
      </div>

      <Aktivieren offen={aktivieren} schliessen={() => setAktivieren(false)} id={k.id} name={k.name} />
      <NeuesZahlungsmittel offen={neuZm} schliessen={() => setNeuZm(false)} household={household} accountId={k.id} owners={k.owners.map((o) => ({ id: o.person_id, name: o.name }))} />
    </Seite>
  );
}

function Aktivieren({ offen, schliessen, id, name }: { offen: boolean; schliessen: () => void; id: string; name: string }) {
  const [iban, setIban] = useState(""); const [bank, setBank] = useState(""); const [ab, setAb] = useState(heute());
  const aktion = useAktion();
  const fehler = iban && !ibanGueltig(iban);
  return (
    <Sheet offen={offen} onClose={schliessen} titel={`«${name}» wird ein echtes Konto`}>
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => kontoSpeichern(id, { status: "active", iban: iban.replace(/\s+/g, "").toUpperCase() || null, bank_name: bank || null, opening_date: ab }), "Als Konto geführt")) schliessen(); }}>
        <p className="text-[14px] text-ink-2">Alte Belege bleiben, wie sie sind. Ab jetzt könnt ihr die Karte dieses Kontos erfassen und Daueraufträge einrichten.</p>
        <Feld label="IBAN (optional)" hinweis={fehler ? <span className="text-crit">Die IBAN stimmt nicht.</span> : undefined}><input className="input mono" value={ibanFormat(iban)} onChange={(e) => setIban(e.target.value)} /></Feld>
        <div className="grid grid-cols-2 gap-3">
          <Feld label="Bank"><input className="input" value={bank} onChange={(e) => setBank(e.target.value)} /></Feld>
          <Feld label="Geführt ab"><input className="input" type="date" value={ab} onChange={(e) => setAb(e.target.value)} /></Feld>
        </div>
        <button className="btn btn-primary btn-big" disabled={!!fehler || !ab}>Als echtes Konto führen</button>
      </form>
    </Sheet>
  );
}

function NeuesZahlungsmittel({ offen, schliessen, household, accountId, owners }: { offen: boolean; schliessen: () => void; household: string; accountId: string; owners: { id: string; name: string }[] }) {
  const [art, setArt] = useState("debit_card"); const [label, setLabel] = useState(""); const [last4, setLast4] = useState("");
  const [holder, setHolder] = useState(owners[0]?.id ?? "");
  const aktion = useAktion();
  const karte = art === "debit_card" || art === "credit_card";
  return (
    <Sheet offen={offen} onClose={schliessen} titel="Zahlungsmittel">
      <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await aktion(() => zahlungsmittelAnlegen(household, { account_id: accountId, kind: art, label: label || ZAHLART.find(([v]) => v === art)![1], card_last4: karte ? last4 : null, holder: holder || null }), "Erfasst")) { schliessen(); setLabel(""); setLast4(""); } }}>
        <Feld label="Art"><select className="input" value={art} onChange={(e) => setArt(e.target.value)}>{ZAHLART.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></Feld>
        <Feld label="Bezeichnung"><input className="input" placeholder="z. B. UBS Debit" value={label} onChange={(e) => setLabel(e.target.value)} /></Feld>
        {karte && <Feld label="Letzte 4 Ziffern" hinweis="Damit erkennt der Scanner später die Karte auf dem Beleg."><input className="input mono" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} /></Feld>}
        {owners.length > 1 && <Feld label="Karteninhaber"><select className="input" value={holder} onChange={(e) => setHolder(e.target.value)}>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Feld>}
        <button className="btn btn-primary" disabled={karte && last4.length > 0 && last4.length !== 4}>Erfassen</button>
      </form>
    </Sheet>
  );
}
