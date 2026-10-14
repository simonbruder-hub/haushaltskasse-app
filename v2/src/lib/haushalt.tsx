import { createContext, useContext } from "react";
import type { Konto, Person } from "./data";

export interface HaushaltDaten { household: string; name: string; ich: string | null; personen: Person[]; konten: Konto[] }
export const HaushaltCtx = createContext<HaushaltDaten | null>(null);
export function useHaushalt(): HaushaltDaten {
  const h = useContext(HaushaltCtx);
  if (!h) throw new Error("Kein Haushalt");
  return h;
}
