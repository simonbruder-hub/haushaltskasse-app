/** Ergebnis der Belegerkennung (Kanal 1), wie docs/scanner/receipt_extraction.schema.json – ergänzt um product_name und category. */
export type Einheit = "piece" | "kg" | "g" | "l" | "ml";
export interface Zeile {
  position: number;
  raw_text: string;
  item_type: "product" | "deposit_or_fee" | "refund_or_return";
  quantity: number;
  quantity_unit: Einheit;
  unit_price: number | null;
  regular_price: number;
  item_discount: number;
  discount_label: string | null;
  final_price: number;
  is_promo: boolean;
  pack_size_hint: { value: number; unit: Einheit } | null;
  multipack_count: number | null;
  vat_code: string | null;
  ean: string | null;
  confidence: "high" | "medium" | "low";
  product_name: string | null;   // Ergänzung der App: Gattungsname («Vollmilch»)
  category: string | null;       // Ergänzung der App: Kategorie des Haushalts
}
export interface Extraktion {
  document: { document_type: string; language: string | null; legibility: "good" | "partial" | "poor"; is_complete: boolean; warnings: string[] };
  merchant: { name: string; chain_key: string; branch_name: string | null; street: string | null; postal_code: string | null; city: string | null; country: string | null; vat_number: string | null };
  transaction: { date: string | null; time: string | null; currency: "CHF" | "EUR" | "USD"; receipt_number: string | null; register_id: string | null; receipt_barcode_text: string | null; is_refund: boolean };
  line_items: Zeile[];
  basket_discounts: { label: string; kind: string; amount: number; applies_to_positions: number[] }[];
  payments: { kind: string; label: string; amount: number; card_last4: string | null }[];
  loyalty: { program: string; card_masked: string | null; points_earned: number | null; points_redeemed: number | null };
  totals: { subtotal: number | null; total: number; rounding: number; vat_lines: unknown[] };
}
