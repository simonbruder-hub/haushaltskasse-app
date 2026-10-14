import { useQuery } from "../db/client";
import type { Konto } from "./data";

/** Belege für Listen: Kopf, Laden, Hauptkategorie, Töpfe und die Wirkung auf den Ausgleich je Person */
export interface BelegZeile {
  id: string; kind: "purchase" | "bill" | "refund"; datum: string; total: number; total_chf: number; currency: string;
  titel: string; chain_key: string | null; notes: string | null; kategorie: string | null; konto: string | null;
  toepfe: string[]; anteil: Record<string, number>; wirkung: Record<string, number>; n_pos: number;
}

export const BELEGE_SQL = `
  select h.id, h.kind, h.booking_date::text as datum, h.total_amount::float8 as total, h.total_amount_base::float8 as total_chf, h.currency,
         coalesce(m.name, (select l.raw_text from line_item l where l.transaction_id = h.id order by l.position limit 1), 'Beleg') as titel,
         m.chain_key, h.notes,
         (select c.name from line_item l join category c on c.id = l.category_id where l.transaction_id = h.id
           group by c.name order by sum(abs(l.final_price)) desc limit 1) as kategorie,
         (select a.name from transaction_payment tp join account a on a.id = tp.account_id where tp.transaction_id = h.id
           order by abs(tp.amount) desc limit 1) as konto,
         (select coalesce(json_agg(distinct coalesce(l.cost_account_id, h.default_cost_account_id)), '[]') from line_item l where l.transaction_id = h.id) as toepfe,
         (select coalesce(json_object_agg(e.person_id, e.share), '{}') from v_txn_effect e where e.transaction_id = h.id) as anteil,
         (select coalesce(json_object_agg(e.person_id, e.effect), '{}') from v_txn_effect e where e.transaction_id = h.id) as wirkung,
         (select count(*)::int from line_item l where l.transaction_id = h.id) as n_pos
    from transaction_header h left join merchant m on m.id = h.merchant_id
   where h.household_id = $1 and h.deleted_at is null and h.status = 'confirmed'`;

export function useBelege(household: string, zusatz = "", params: unknown[] = []) {
  return useQuery<BelegZeile>(`${BELEGE_SQL} ${zusatz}`, [household, ...params]);
}

/** Welche Töpfe «gemeinsam» sind und welche einer Person gehören */
export function topfZuordnung(konten: Konto[]) {
  const gemeinsam = new Set(konten.filter((k) => k.owners.length > 1).map((k) => k.id));
  const vonPerson = (p: string) => new Set(konten.filter((k) => k.owners.length === 1 && k.owners[0].person_id === p).map((k) => k.id));
  return { gemeinsam, vonPerson };
}
