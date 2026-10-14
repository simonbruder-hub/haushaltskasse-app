// Rechnet alle Beispiele aus BLUEPRINT.md gegen db/schema.sql nach (echte PostgreSQL-Instanz via PGlite).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const db = new PGlite();
await db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
let fehler = 0, ok = 0;
const gleich = (name, ist, soll) => {
  const a = typeof soll === "number" ? Number(ist) : ist;
  const kanon = x => Array.isArray(x) ? x.map(kanon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map(k => [k, kanon(x[k])])) : x;
  const passt = typeof soll === "number" ? Math.abs(a - soll) < 0.0051 : JSON.stringify(kanon(a)) === JSON.stringify(kanon(soll));
  if (passt) ok++; else { fehler++; console.log(`✗ ${name}: ist ${JSON.stringify(ist)}, soll ${JSON.stringify(soll)}`); }
};
const id = () => randomUUID();

// ---------- Stammdaten ----------
await q(`insert into currency values ('CHF','Schweizer Franken',2,0.05),('EUR','Euro',2,null),('USD','US-Dollar',2,null)`);
const H = id();
await q(`insert into household (id,name) values ($1,'Altstetten')`, [H]);
await q(`insert into household_setting (household_id) values ($1)`, [H]);
const S = id(), E = id(), K = id();
await q(`insert into person (id,household_id,display_name,sort) values ($1,$3,'Simon',1),($2,$3,'Eliana',2)`, [S, E, H]);
await q(`insert into person_income (person_id,valid_from,net_monthly) values ($1,'2026-01-01',6500),($2,'2026-01-01',3500)`, [S, E]);

// Konten/Töpfe. Heute: zwei Privatkonten + virtueller Topf «Gemeinsam Leben». Spar-/Freizeitkonten noch virtuell.
const konto = async (name, kind, owners, status = "virtual", opening = null, beneficiary = null) => {
  const a = id();
  await q(`insert into account (id,household_id,name,kind,status,opening_date,beneficiary_person_id) values ($1,$2,$3,$4,$5,$6,$7)`, [a, H, name, kind, status, opening, beneficiary]);
  for (const [p, s] of owners) await q(`insert into account_owner (account_id, person_id, share) values ($1,$2,$3)`, [a, p, s]);
  return a;
};
const SP = await konto("Simon Privat", "privat", [[S, 1]], "active", "2026-01-01");
const EP = await konto("Eliana Privat", "privat", [[E, 1]], "active", "2026-01-01");
const LEBEN = await konto("Gemeinsam Leben", "leben", [[S, 0.5], [E, 0.5]]);
const SS = await konto("Simon Sparen", "sparen", [[S, 1]]), ES = await konto("Eliana Sparen", "sparen", [[E, 1]]);
const SF = await konto("Simon Freizeit", "freizeit", [[S, 1]]), EF = await konto("Eliana Freizeit", "freizeit", [[E, 1]]);
await q(`update account set is_personal_default = true where id = any($1)`, [[SP, EP]]);
gleich("Persönliche Töpfe", (await q(`select name from v_personal_account order by name`)).map(r => r.name), ["Eliana Privat", "Simon Privat"]);

const migros = id(), coop = id(), lidl = id(), lidlDE = id(), resto = id(), vermieter = id(), velo = id();
for (const [i, k, n, c] of [[migros, "migros", "Migros", "CH"], [coop, "coop", "Coop", "CH"], [lidl, "lidl", "Lidl", "CH"], [lidlDE, "lidl_de", "Lidl Konstanz", "DE"],
  [resto, "resto", "Restaurant Hirschen", "CH"], [vermieter, "tessin", "Ferienhaus Tessin", "CH"], [velo, "velo", "Veloladen", "CH"]])
  await q(`insert into merchant (id,chain_key,name,country) values ($1,$2,$3,$4)`, [i, k, n, c]);

const la = {};
for (const [n, k] of [["Ernährung", "need"], ["Haushalt", "need"], ["Körperpflege", "need"], ["Freizeit", "want"], ["Gesundheit", "need"], ["Kinder", "need"]]) {
  la[n] = id(); await q(`insert into life_area (id,household_id,name,spending_class) values ($1,$2,$3,$4)`, [la[n], H, n, k]);
}
const cat = {};
for (const [n, l, k, pot] of [["Lebensmittel", "Ernährung", null, LEBEN], ["Haushaltsartikel", "Haushalt", null, LEBEN], ["Drogerie", "Körperpflege", null, null],
  ["Kosmetik", "Körperpflege", "want", null], ["Ausgehen", "Freizeit", null, LEBEN], ["Ferien", "Freizeit", null, LEBEN], ["Zahnarzt", "Gesundheit", null, null],
  ["Hobby", "Freizeit", null, null], ["Kinderbedarf", "Kinder", null, null]]) {
  cat[n] = id(); await q(`insert into category (id,household_id,life_area_id,name,spending_class,default_cost_account_id) values ($1,$2,$3,$4,$5,$6)`, [cat[n], H, la[l], n, k, pot]);
}
const mp = {};
for (const [n, c, cu] of [["Vollmilch", "Lebensmittel", "per_1l"], ["Kaffeebohnen", "Lebensmittel", "per_1kg"], ["Bananen", "Lebensmittel", "per_1kg"],
  ["Olivenöl", "Lebensmittel", "per_1l"], ["Chips Nature", "Lebensmittel", "per_100g"], ["Shampoo", "Drogerie", "per_100ml"], ["Gesichtscreme", "Kosmetik", "per_100ml"]]) {
  mp[n] = id(); await q(`insert into master_product (id,household_id,name,category_id,comparison_unit) values ($1,$2,$3,$4,$5)`, [mp[n], H, n, cat[c], cu]);
}
const prod = async (master, name, size, unit, merchant = null, ean = null, extra = {}) => {
  const i = id();
  await q(`insert into merchant_product (id,household_id,master_product_id,merchant_id,ean,name,unit_size,unit_type,is_variable_weight,replaces_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [i, H, master, merchant, ean, name, size, unit, !!extra.offen, extra.ersetzt || null]);
  return i;
};
const pMilchM = await prod(mp.Vollmilch, "M-Classic Vollmilch UHT 1 l", 1, "l", migros, "7617027000000");
const pKaffeeM = await prod(mp.Kaffeebohnen, "Boncampo Bohnen 500 g", 500, "g", migros, "7617027000017");
const pBanM = await prod(mp.Bananen, "Bananen offen", null, null, migros, null, { offen: true });

// Beleg anlegen und bestätigen. zahlungen: [kind, betrag, konto|null]; zeilen[].pot überschreibt den Topf des Belegs
const beleg = async ({ datum, laden, total, waehrung = "CHF", fx = 1, kaeufer = S, topf = LEBEN, kind = "purchase", zahlungen, zeilen, bestaetigen = true }) => {
  const t = id();
  await q(`insert into transaction_header (id,household_id,kind,merchant_id,booking_date,currency,fx_rate,total_amount,buyer_person_id,default_cost_account_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [t, H, kind, laden, datum, waehrung, fx, total, kaeufer, topf]);
  let pos = 0; const ids = [];
  for (const z of zeilen) {
    const l = id(); ids.push(l);
    await q(`insert into line_item (id,transaction_id,position,item_type,raw_text,quantity,quantity_unit,unit_size,unit_type,regular_unit_price,
             regular_price,is_promo,promo_label,category_id,master_product_id,merchant_product_id,cost_account_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [l, t, ++pos, z.type || "product", z.text, z.qty || 1, z.qunit || "piece", z.size ?? null, z.unit ?? null, z.regUnit ?? null,
        z.reg, !!z.promo, z.promo || null, z.cat ? cat[z.cat] : null, z.master || null, z.mprod || null, z.topf || null]);
    for (const [k, lab, a] of z.disc || []) await q(`insert into line_item_discount (line_item_id,kind,label,amount) values ($1,$2,$3,$4)`, [l, k, lab, a]);
  }
  let i = 0;
  for (const [k, a, konto] of zahlungen) await q(`insert into transaction_payment (transaction_id,position,kind,amount,account_id) values ($1,$2,$3,$4,$5)`, [t, ++i, k, a, konto]);
  if (bestaetigen) await q(`update transaction_header set status='confirmed' where id=$1`, [t]);
  return { t, ids };
};
const anteil = async (lineId) => Object.fromEntries((await q(`select p.display_name n, a.amount, a.amount_base from line_item_allocation a join person p on p.id=a.person_id where line_item_id=$1`, [lineId])).map(r => [r.n, [Number(r.amount), Number(r.amount_base)]]));
const saldo = async () => Object.fromEntries((await q(`select display_name n, balance from v_settlement_balance order by 1`)).map(r => [r.n, Number(r.balance)]));
const myShare = async (t) => Object.fromEntries((await q(`select p.display_name n, sum(a.amount) s from line_item_allocation a join line_item l on l.id=a.line_item_id join person p on p.id=a.person_id where l.transaction_id=$1 group by 1`, [t])).map(r => [r.n, Number(r.s)]));

// ---------- §2.1 Einheitspreis-Normalisierung ----------
gleich("Normalisierung 500 g → per_1kg", (await one(`select normalized_unit_price(12.90, 500, 'mass', 'per_1kg') v`)).v, 25.80);
gleich("Normalisierung 6×1.5 l → per_1l", (await one(`select normalized_unit_price(5.70, base_quantity(1,'piece',1.5,'l',6), 'volume', 'per_1l') v`)).v, 0.6333);
gleich("Normalisierung Offenverkauf 0.734 kg", (await one(`select normalized_unit_price(2.13, base_quantity(0.734,'kg',null,null,1), 'mass', 'per_1kg') v`)).v, 2.9019);
gleich("Normalisierung Joghurt 500 ml, per_100g, Dichte 1.03", (await one(`select normalized_unit_price(1.95, 500, 'volume', 'per_100g', 1.03) v`)).v, 0.3786);
gleich("Nicht vergleichbar ohne Dichte", (await one(`select normalized_unit_price(1.95, 500, 'volume', 'per_100g') v`)).v, null);

// Vorbeobachtung Kaffee (Preissprung-Test): 1.8.2026 Regal-Check 11.50 / 500 g
await q(`insert into price_observation (household_id,merchant_id,merchant_product_id,master_product_id,observed_on,source,unit_regular_price,unit_paid_price,unit_base_quantity,base_dimension,comparison_unit)
         values ($1,$2,$3,$4,'2026-08-01','ean_live_check',11.50,11.50,500,'mass','per_1kg')`, [H, migros, pKaffeeM, mp.Kaffeebohnen]);

// ================= Phase 1 (heute): Privatkonten + virtueller Topf «Gemeinsam Leben» =================
await beleg({ datum: "2026-08-20", laden: vermieter, total: 1400, zahlungen: [["bank_transfer", 1400, SP]],
  zeilen: [{ text: "Ferienhaus Tessin 7 Nächte", reg: 1400, cat: "Ferien" }] });
await beleg({ datum: "2026-09-01", laden: migros, total: 3.30, zahlungen: [["debit_card", 3.30, SP]],
  zeilen: [{ text: "2 x M-CL VOLLMI UHT 1L 1.65 A", qty: 2, size: 1, unit: "l", regUnit: 1.65, reg: 3.30, cat: "Lebensmittel", master: mp.Vollmilch, mprod: pMilchM }] });
await beleg({ datum: "2026-09-15", laden: migros, total: 450, kaeufer: E, zahlungen: [["twint", 450, EP]],
  zeilen: [{ text: "2 x M-CL VOLLMI UHT 1L", qty: 2, size: 1, unit: "l", regUnit: 1.65, reg: 3.30, cat: "Lebensmittel", master: mp.Vollmilch, mprod: pMilchM },
           { text: "Wocheneinkauf diverses", reg: 446.70, cat: "Lebensmittel" }] });
await beleg({ datum: "2026-09-20", laden: null, kind: "bill", total: 280, topf: SP, zahlungen: [["ebill", 280, SP]], zeilen: [{ text: "Dentalhygiene", reg: 280, cat: "Zahnarzt" }] });
const C1 = await beleg({ datum: "2026-09-28", laden: coop, total: 79.90, zahlungen: [["credit_card", 79.90, SP]],
  zeilen: [{ text: "BRATPFANNE 28CM", reg: 79.90, cat: "Haushaltsartikel" }] });

// Beispiel A: Artikelrabatt vs. Cumulus-Bon, gemeinsame und private Positionen
const A = await beleg({ datum: "2026-10-03", laden: migros, total: 37.18,
  zahlungen: [["loyalty_points", 5.00, null], ["debit_card", 32.18, SP]],
  zeilen: [
    { text: "2 x M-CL VOLLMI UHT 1L", qty: 2, size: 1, unit: "l", regUnit: 1.65, reg: 3.30, cat: "Lebensmittel", master: mp.Vollmilch, mprod: pMilchM },
    { text: "BONCAMPO BOHNEN 500G", size: 500, unit: "g", regUnit: 12.90, reg: 12.90, disc: [["promo", "Aktion 30%", 3.90]], promo: "Aktion 30%", cat: "Lebensmittel", master: mp.Kaffeebohnen, mprod: pKaffeeM },
    { text: "BANANEN 0.734 kg x 2.90/kg", qty: 0.734, qunit: "kg", regUnit: 2.90, reg: 2.13, cat: "Lebensmittel", master: mp.Bananen, mprod: pBanM },
    { text: "SHAMPOO REPAIR 250ML", size: 250, unit: "ml", reg: 6.95, cat: "Drogerie", master: mp.Shampoo, topf: SP },
    { text: "GESICHTSCREME 50ML", size: 50, unit: "ml", reg: 15.80, cat: "Kosmetik", master: mp.Gesichtscreme, topf: EP }] });
const sumA = await one(`select * from v_transaction_summary where transaction_id=$1`, [A.t]);
gleich("A Artikelrabatte", sumA.item_discount_total, 3.90);
gleich("A Gutschein/Punkte", sumA.voucher_or_loyalty_redeemed, 5.00);
gleich("A von Konten bezahlt", sumA.cash_paid, 32.18);
gleich("A Kaffee final", (await one(`select final_price v from line_item where id=$1`, [A.ids[1]])).v, 9.00);
const obsK = await one(`select normalized_regular_base r, normalized_paid_base p from price_observation where line_item_id=$1`, [A.ids[1]]);
gleich("A Kaffee regulär/kg", obsK.r, 25.80); gleich("A Kaffee bezahlt/kg", obsK.p, 18.00);
gleich("A Bananen/kg", (await one(`select normalized_regular_base v from price_observation where line_item_id=$1`, [A.ids[2]])).v, 2.90);
gleich("A Milch/l", (await one(`select normalized_paid_base v from price_observation where line_item_id=$1`, [A.ids[0]])).v, 1.65);
gleich("A Milch 50/50", await anteil(A.ids[0]), { Simon: [1.65, 1.65], Eliana: [1.65, 1.65] });
gleich("A Bananen: ungerader Rappen, Position 3 → Simon", await anteil(A.ids[2]), { Simon: [1.07, 1.07], Eliana: [1.06, 1.06] });
gleich("A Shampoo privat Simon", await anteil(A.ids[3]), { Simon: [6.95, 6.95] });
gleich("A Creme privat Eliana", await anteil(A.ids[4]), { Eliana: [15.80, 15.80] });
gleich("A My Share (Gutschein ändert ihn nicht)", await myShare(A.t), { Simon: 14.17, Eliana: 23.01 });
const gsA = Object.fromEntries((await q(`select p.display_name n, s.amount_base a from payment_share s join transaction_payment tp on tp.id=s.payment_id join person p on p.id=s.person_id where tp.transaction_id=$1 and tp.account_id is null`, [A.t])).map(r => [r.n, Number(r.a)]));
gleich("A Gutschein anteilig wie der Einkauf", gsA, { Simon: 1.91, Eliana: 3.09 });
const alarmK = await one(`select kind, change_pct from price_alert where merchant_product_id=$1`, [pKaffeeM]);
gleich("A Preissprung Kaffee", [alarmK.kind, Number(alarmK.change_pct)], ["price_jump", 12.17]);

// Rückvergütung: kommt als Gutschrift im Monat, in dem sie eintrifft
const C2 = await beleg({ datum: "2026-10-05", laden: coop, kind: "refund", total: -79.90, zahlungen: [["credit_card", -79.90, SP]],
  zeilen: [{ text: "RETOURE BRATPFANNE 28CM", type: "refund_or_return", reg: -79.90, cat: "Haushaltsartikel" }] });
gleich("C Gutschrift 50/50", await anteil(C2.ids[0]), { Simon: [-39.95, -39.95], Eliana: [-39.95, -39.95] });

const B = await beleg({ datum: "2026-10-10", laden: coop, total: 95.40, kaeufer: E, zahlungen: [["twint", 95.40, EP]],
  zeilen: [{ text: "Grosseinkauf", reg: 80.00, cat: "Lebensmittel" }, { text: "TOILETTENPAPIER 24 ROLLEN", reg: 15.40, cat: "Haushaltsartikel" }] });
gleich("B 50/50", [await anteil(B.ids[0]), await anteil(B.ids[1])], [{ Simon: [40, 40], Eliana: [40, 40] }, { Simon: [7.70, 7.70], Eliana: [7.70, 7.70] }]);
await beleg({ datum: "2026-10-11", laden: resto, total: 96, zahlungen: [["credit_card", 96, SP]],
  zeilen: [{ text: "Essen", reg: 84, cat: "Ausgehen" }, { text: "Trinkgeld", type: "deposit_or_fee", reg: 12, cat: "Ausgehen" }] });
const D = await beleg({ datum: "2026-10-12", laden: lidlDE, total: 50.00, waehrung: "EUR", fx: 0.94, kaeufer: E, zahlungen: [["debit_card", 50.00, EP]],
  zeilen: [{ text: "Einkauf Teil 1", reg: 33.34, cat: "Lebensmittel" }, { text: "Einkauf Teil 2", reg: 16.66, cat: "Lebensmittel" }] });
gleich("D Total CHF", (await one(`select total_amount_base v from transaction_header where id=$1`, [D.t])).v, 47.00);
gleich("D EUR → CHF", [await anteil(D.ids[0]), await anteil(D.ids[1])], [{ Simon: [16.67, 15.67], Eliana: [16.67, 15.67] }, { Simon: [8.33, 7.83], Eliana: [8.33, 7.83] }]);

gleich("Saldo Phase 1", await saldo(), { Eliana: -473.37, Simon: 473.37 });
await q(`insert into transfer (household_id,from_account_id,to_account_id,amount,transfer_date,kind) values ($1,$2,$3,300,'2026-10-13','settlement')`, [H, EP, SP]);
gleich("Saldo nach Ausgleich 300", await saldo(), { Eliana: -173.37, Simon: 173.37 });
const vorschlag1 = await q(`select (select display_name from person where id=from_person_id) v, (select display_name from person where id=to_person_id) a, amount from suggest_settlements($1)`, [H]);
gleich("Ausgleichsvorschlag", vorschlag1.map(r => [r.v, r.a, Number(r.amount)]), [["Eliana", "Simon", 173.37]]);

// ---------- Budgets pro Person (heute) ----------
const bLeb = id(), bKos = id(), bHaus = id();
await q(`insert into variable_budget (id,household_id,name,scope,person_id,category_id,monthly_amount,rollover_mode,valid_from) values ($1,$2,'Lebensmittel Simon','person',$3,$4,300,'surplus_only','2026-09-01')`, [bLeb, H, S, cat.Lebensmittel]);
await q(`insert into variable_budget (id,household_id,name,scope,person_id,category_id,monthly_amount,valid_from) values ($1,$2,'Kosmetik Eliana','person',$3,$4,50,'2026-10-01')`, [bKos, H, E, cat.Kosmetik]);
await q(`insert into variable_budget (id,household_id,name,scope,person_id,life_area_id,monthly_amount,valid_from) values ($1,$2,'Haushalt Simon','person',$3,$4,100,'2026-09-01')`, [bHaus, H, S, la.Haushalt]);
const bm = await q(`select month::text m, rollover_in, available, spent, carry_out from budget_months($1,'2026-10-14')`, [bLeb]);
gleich("Lebensmittel Simon Sep", [bm[0].spent, bm[0].carry_out].map(Number), [226.65, 73.35]);
gleich("Lebensmittel Simon Okt", [bm[1].rollover_in, bm[1].available, bm[1].spent].map(Number), [73.35, 373.35, 70.72]);
const sts = await one(`select * from safe_to_spend($1,'2026-10-14')`, [bLeb]);
gleich("Safe-to-Spend Simon", [sts.remaining_days, Number(sts.safe_per_day), Number(sts.burn_rate_per_day), Number(sts.projected_month_spend), sts.pace],
  [18, 16.80, 5.05, 156.55, "on_track"]);
gleich("Kosmetik Eliana (nur ihr Topf)", Number((await one(`select spent_before_today v from safe_to_spend($1,'2026-10-14')`, [bKos])).v), 15.80);
const bh = await q(`select month::text m, spent from budget_months($1,'2026-10-31') order by month`, [bHaus]);
gleich("Haushalt Simon: Gutschrift im Oktober", bh.map(r => [r.m, Number(r.spent)]), [["2026-09-01", 39.95], ["2026-10-01", -32.25]]);

// ---------- Fixkosten, Verträge, Sinking Fund ----------
await q(`insert into fixed_cost (household_id,name,life_area_id,cost_account_id,pay_from_account_id,amount,frequency,next_due_date)
         values ($1,'Miete',$2,$3,$4,2400,'monthly','2026-11-01'),($1,'Halbtax Simon',$5,$6,$6,190,'annual','2027-03-01')`, [H, la.Haushalt, LEBEN, SP, la.Freizeit, SP]);
const fk = await q(`select name, monthly_equivalent from v_fixed_cost_monthly order by name`);
gleich("Fixkosten Monatsäquivalent", fk.map(r => [r.name, Number(r.monthly_equivalent)]), [["Halbtax Simon", 15.83], ["Miete", 2400]]);
const fkp = Object.fromEntries((await q(`select p.display_name n, monthly_share from v_fixed_cost_person_monthly f join person p on p.id=f.person_id`)).map(r => [r.n, Number(r.monthly_share)]));
gleich("Fixkosten je Person", fkp, { Simon: 1215.83, Eliana: 1200 });
await q(`insert into contract (household_id,name,counterparty,renewal_date,renewal_period_months,auto_renews,cancellation_notice_days,notice_to_month_end)
         values ($1,'Internet','Sunrise','2026-03-01',12,true,60,false),($1,'Grundversicherung','Krankenkasse','2027-01-01',12,true,31,true)`, [H]);
const vd = await q(`select name, next_renewal::text r, cancellation_deadline::text d, remind_on::text e, status from contract_deadlines('2026-10-14') order by name`);
gleich("Verträge", vd.map(r => [r.name, r.r, r.d, r.e, r.status]),
  [["Grundversicherung", "2027-01-01", "2026-11-30", "2026-10-31", "ok"], ["Internet", "2027-03-01", "2026-12-31", "2026-12-01", "ok"]]);
const fund = id();
await q(`insert into sinking_fund (id,household_id,name,holding_account_id,cost_account_id,category_id,target_amount,target_date,monthly_contribution,start_date)
         values ($1,$2,'Zahnarzt Simon',$3,$4,$5,1200,'2027-03-31',150,'2026-07-01')`, [fund, H, SS, SP, cat.Zahnarzt]);
for (const m of ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01", "2026-10-01"]) await q(`select post_fund_contributions($1)`, [m]);
const sf = await one(`select * from sinking_fund_status('2026-10-14')`);
gleich("Sinking Fund", [Number(sf.contributed), Number(sf.spent), Number(sf.balance), sf.months_left, Number(sf.required_monthly), sf.on_track, Number(sf.progress_pct)],
  [600, 280, 320, 6, 146.70, true, 26.7]);

// ================= Phase 2 (später): gemeinsames Konto, Spar-/Freizeitkonten, Kind =================
await q(`update account set status='active', opening_date='2026-11-01' where id = any($1)`, [[LEBEN, SS, ES, SF, EF]]);
await q(`insert into person (id,household_id,display_name,role,sort) values ($1,$2,'Kind 1','child',3)`, [K, H]);
const KIND = await konto("Kind 1", "kind", [[S, 0.5], [E, 0.5]], "virtual", null, K);
await q(`update category set default_cost_account_id=$1 where id=$2`, [KIND, cat.Kinderbedarf]);
for (const [von, nach, betrag, art] of [[SP, LEBEN, 2000, "deposit"], [EP, LEBEN, 1800, "deposit"], [SP, SS, 500, "saving"], [EP, ES, 400, "saving"], [SP, SF, 300, "deposit"], [EP, EF, 300, "deposit"]])
  await q(`insert into standing_order (household_id,from_account_id,to_account_id,amount,day_of_month,kind,valid_from) values ($1,$2,$3,$4,1,$5,'2026-11-01')`, [H, von, nach, betrag, art]);
gleich("Daueraufträge November", (await one(`select post_standing_orders('2026-11-01') n`)).n, 6);
gleich("Daueraufträge idempotent", (await one(`select post_standing_orders('2026-11-15') n`)).n, 0);
await beleg({ datum: "2026-11-05", laden: migros, total: 120, zahlungen: [["debit_card", 120, LEBEN]], zeilen: [{ text: "Wocheneinkauf", reg: 120, cat: "Lebensmittel" }] });
await beleg({ datum: "2026-11-07", laden: velo, total: 59.90, topf: SF, zahlungen: [["debit_card", 59.90, SF]], zeilen: [{ text: "Velohelm", reg: 59.90, cat: "Hobby" }] });
await beleg({ datum: "2026-11-08", laden: coop, total: 40, zahlungen: [["debit_card", 40, SP]], zeilen: [{ text: "Einkauf (private Karte erwischt)", reg: 40, cat: "Lebensmittel" }] });
const W = await beleg({ datum: "2026-11-10", laden: coop, total: 30, topf: KIND, zahlungen: [["debit_card", 30, LEBEN]], zeilen: [{ text: "WINDELN GR. 3", reg: 30, cat: "Kinderbedarf" }] });
gleich("Kind: Eltern tragen 50/50", await anteil(W.ids[0]), { Simon: [15, 15], Eliana: [15, 15] });
gleich("Saldo Phase 2 (Einzahlung 2000 vs. 1800, private Karte 40)", await saldo(), { Eliana: -293.37, Simon: 293.37 });
const kst = Object.fromEntries((await q(`select name, balance from v_account_balance where name in ('Gemeinsam Leben','Simon Freizeit','Simon Sparen')`)).map(r => [r.name, Number(r.balance)]));
gleich("Kontostände", kst, { "Gemeinsam Leben": 3650, "Simon Freizeit": 240.10, "Simon Sparen": 500 });
const fl = await one(`select money_in, money_out from v_account_flow_month where account_id=$1 and month='2026-11-01'`, [LEBEN]);
gleich("Geldfluss Leben November", [Number(fl.money_in), Number(fl.money_out)], [3800, 150]);
const bLebenTopf = id(), bSF = id(), bKind = id();
await q(`insert into variable_budget (id,household_id,name,scope,account_id,category_id,monthly_amount,valid_from) values ($1,$2,'Leben: Lebensmittel','account',$3,$4,800,'2026-11-01')`, [bLebenTopf, H, LEBEN, cat.Lebensmittel]);
await q(`insert into variable_budget (id,household_id,name,scope,account_id,monthly_amount,valid_from) values ($1,$2,'Simon Freizeit','account',$3,300,'2026-11-01'),($4,$2,'Kind 1','account',$5,200,'2026-11-01')`, [bSF, H, SF, bKind, KIND]);
const nov = async (b) => Number((await one(`select spent from budget_months($1,'2026-11-30') where month='2026-11-01'`, [b])).spent);
gleich("Topf-Budgets November", [await nov(bLebenTopf), await nov(bSF), await nov(bKind)], [160, 59.90, 30]);
const a5 = await one(`select * from analysis_50_30_20($1,'2026-11-01')`, [S]);
gleich("50/30/20 Simon November", [a5.income, a5.needs, a5.wants, a5.saved_to_accounts, a5.unallocated].map(Number), [6500, 95, 59.90, 500, 5845.10]);

// Topf mit falschen Anteilen wird abgewiesen
const kaputt = await konto("Falsch", "zweck", [[S, 0.6], [E, 0.6]]);
let anteilFehler = null;
try { await beleg({ datum: "2026-11-11", laden: coop, total: 10, topf: kaputt, zahlungen: [["cash", 10, SP]], zeilen: [{ text: "X", reg: 10 }] }); }
catch (e) { anteilFehler = e.message; }
gleich("Topf-Anteile ≠ 100 % blockiert", !!anteilFehler && anteilFehler.includes("100"), true);
let ohneKonto = null;
try { await q(`insert into transaction_payment (transaction_id,kind,amount) values ($1,'debit_card',1)`, [A.t]); } catch (e) { ohneKonto = e.message; }
gleich("Kartenzahlung ohne Konto blockiert", !!ohneKonto, true);

// ---------- Shrinkflation ----------
const chipsAlt = await prod(mp["Chips Nature"], "Zweifel Nature 300 g", 300, "g", null, "7610095000001");
const chipsNeu = await prod(mp["Chips Nature"], "Zweifel Nature 280 g", 280, "g", null, "7610095000002", { ersetzt: chipsAlt });
const obs = (m, p, master, d, reg, paid, qty, dim, cu, promo = false) => q(`insert into price_observation (household_id,merchant_id,merchant_product_id,master_product_id,observed_on,source,unit_regular_price,unit_paid_price,is_promo,unit_base_quantity,base_dimension,comparison_unit)
   values ($1,$2,$3,$4,$5,'ean_live_check',$6,$7,$8,$9,$10,$11)`, [H, m, p, master, d, reg, paid, promo, qty, dim, cu]);
await obs(coop, chipsAlt, mp["Chips Nature"], "2026-06-01", 4.95, 4.95, 300, "mass", "per_100g");
await obs(coop, chipsNeu, mp["Chips Nature"], "2026-10-10", 4.95, 4.95, 280, "mass", "per_100g");
const sh = await one(`select kind, old_normalized, new_normalized, change_pct from price_alert where merchant_product_id=$1`, [chipsNeu]);
gleich("Shrinkflation", [sh.kind, Number(sh.old_normalized), Number(sh.new_normalized), Number(sh.change_pct)], ["shrinkflation", 1.65, 1.7679, 7.14]);

// ---------- Verbrauchszyklus ----------
const vz = await one(`select purchases, median_interval_days, next_expected::text n from v_consumption_cycle where master_product_id=$1`, [mp.Vollmilch]);
gleich("Verbrauchszyklus Milch", [Number(vz.purchases), Number(vz.median_interval_days), vz.n], [3, 16, "2026-10-19"]);

// ---------- Smart Basket ----------
const mk = async (master, m, name, size, unit) => prod(master, name, size, unit, m);
const pKC = await mk(mp.Kaffeebohnen, coop, "Coop Kaffee 1 kg", 1000, "g"), pKL = await mk(mp.Kaffeebohnen, lidl, "Lidl Kaffee 1 kg", 1000, "g");
const pMC = await mk(mp.Vollmilch, coop, "Coop Milch 1 l", 1, "l"), pML = await mk(mp.Vollmilch, lidl, "Lidl Milch 1 l", 1, "l");
const pBC = await mk(mp.Bananen, coop, "Bananen Coop", null, null), pBL = await mk(mp.Bananen, lidl, "Bananen Lidl", null, null);
const pOM = await mk(mp["Olivenöl"], migros, "Olivenöl Migros 1 l", 1, "l"), pOC = await mk(mp["Olivenöl"], coop, "Olivenöl Coop 1 l", 1, "l"), pOL = await mk(mp["Olivenöl"], lidl, "Olivenöl Lidl 1 l", 1, "l");
await obs(coop, pKC, mp.Kaffeebohnen, "2026-10-12", 23.90, 23.90, 1000, "mass", "per_1kg");
await obs(lidl, pKL, mp.Kaffeebohnen, "2026-10-12", 14.99, 14.99, 1000, "mass", "per_1kg");
await obs(coop, pMC, mp.Vollmilch, "2026-10-12", 1.70, 1.70, 1000, "volume", "per_1l");
await obs(lidl, pML, mp.Vollmilch, "2026-10-12", 1.45, 1.45, 1000, "volume", "per_1l");
await obs(coop, pBC, mp.Bananen, "2026-10-12", 2.75, 2.75, 1000, "mass", "per_1kg");
await obs(lidl, pBL, mp.Bananen, "2026-10-12", 2.49, 2.49, 1000, "mass", "per_1kg");
await obs(migros, pOM, mp["Olivenöl"], "2026-10-12", 9.50, 9.50, 1000, "volume", "per_1l");
await obs(coop, pOC, mp["Olivenöl"], "2026-10-12", 8.95, 4.95, 1000, "volume", "per_1l", true);
await obs(lidl, pOL, mp["Olivenöl"], "2026-10-12", 7.99, 7.99, 1000, "volume", "per_1l");
const liste = id();
await q(`insert into shopping_list (id,household_id) values ($1,$2)`, [liste, H]);
for (const [m, qty, u] of [[mp.Kaffeebohnen, 2, "kg"], [mp.Vollmilch, 6, "l"], [mp.Bananen, 1, "kg"], [mp["Olivenöl"], 3, "l"]])
  await q(`insert into shopping_list_item (list_id,master_product_id,quantity,unit) values ($1,$2,$3,$4)`, [liste, m, qty, u]);
const sb = await q(`select * from smart_basket($1,'2026-10-14')`, [liste]);
const zeig = sb.map(r => [r.merchants, Number(r.total_chf), r.priced_items, r.recommended]);
gleich("Smart Basket Platz 1", zeig[0], ["Coop + Lidl", 56.02, 4, true]);
gleich("Smart Basket bester Einzelladen", zeig.find(r => !r[0].includes("+")), ["Lidl", 65.14, 4, false]);
gleich("Smart Basket Migros einzeln", zeig.find(r => r[0] === "Migros"), ["Migros", 92.90, 4, false]);

// ---------- Alias-Schlüssel ----------
const ak = async (t) => (await one(`select alias_key($1) v`, [t])).v;
gleich("alias 1", await ak("M-CL VOLLMI UHT 1L     1.65 A"), "M-CL VOLLMI UHT 1L");
gleich("alias 2", await ak("2 x ZWEIFEL CHIPS NATURE 280G"), "ZWEIFEL CHIPS NATURE 280G");
gleich("alias 3", await ak("BANANEN 0.734 kg x 2.90/kg 2.13"), "BANANEN");
gleich("alias 4", await ak("Müsli Bircher* AKTION"), "MUESLI BIRCHER");
const a1 = await one(`select confirm_alias($1,$2,'M-CL VOLLMI UHT 1L  1.65 A',$3,$4,1.65,true) v`, [H, migros, mp.Vollmilch, pMilchM]);
await q(`select confirm_alias($1,$2,'M-CL VOLLMI UHT 1L 1.70 A',$3,$4,1.70,true)`, [H, migros, mp.Vollmilch, pMilchM]);
const al = await one(`select times_seen, times_confirmed, confidence from receipt_alias_mapping where id=$1`, [a1.v]);
gleich("Alias gelernt", [al.times_seen, al.times_confirmed, Number(al.confidence)], [2, 2, 0.75]);

// ---------- Garantie ----------
await q(`insert into warranty (household_id,item_name,purchase_date) values ($1,'Stabmixer','2025-11-20')`, [H]);
gleich("Garantie läuft ab", (await one(`select expires_on::text v from warranty`)).v, "2027-11-20");

// ---------- Belegduplikat ----------
let dup = null;
await q(`insert into transaction_header (household_id,merchant_id,booking_date,total_amount,buyer_person_id,default_cost_account_id,receipt_barcode_id) values ($1,$2,'2026-10-03',1,$3,$4,'0123456789')`, [H, migros, S, LEBEN]);
try { await q(`insert into transaction_header (household_id,merchant_id,booking_date,total_amount,buyer_person_id,default_cost_account_id,receipt_barcode_id) values ($1,$2,'2026-10-03',1,$3,$4,'0123456789')`, [H, migros, S, LEBEN]); }
catch (e) { dup = e.message; }
gleich("Doppelter Kassenbon blockiert", !!dup && dup.includes("txn_receipt_barcode_uq"), true);

// ---------- Validierung beim Bestätigen ----------
let ungleich = null;
try { await beleg({ datum: "2026-10-14", laden: migros, total: 10, zahlungen: [["cash", 10, SP]], zeilen: [{ text: "X", reg: 9.95 }] }); }
catch (e) { ungleich = e.message; }
gleich("Summenprüfung beim Bestätigen", !!ungleich && ungleich.startsWith("Positionen 9.95"), true);

const tabellen = await one(`select count(*) n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`);
const views = await one(`select count(*) n from information_schema.views where table_schema='public'`);
console.log(`\n${ok} Prüfungen bestanden, ${fehler} fehlgeschlagen · ${tabellen.n} Tabellen, ${views.n} Views`);
process.exit(fehler ? 1 : 0);
