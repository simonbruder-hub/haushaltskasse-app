-- =====================================================================
--  Stammdaten für alle Haushalte (Server und Browser identisch, feste IDs)
-- =====================================================================
insert into currency (code, name, minor_units, cash_rounding) values
  ('CHF', 'Schweizer Franken', 2, 0.05), ('EUR', 'Euro', 2, null), ('USD', 'US-Dollar', 2, null)
on conflict (code) do nothing;

insert into merchant (id, household_id, chain_key, name, country, loyalty_program) values
  ('00000000-0000-4000-8000-000000000001', null, 'migros',          'Migros',          'CH', 'cumulus'),
  ('00000000-0000-4000-8000-000000000002', null, 'coop',            'Coop',            'CH', 'supercard'),
  ('00000000-0000-4000-8000-000000000003', null, 'denner',          'Denner',          'CH', null),
  ('00000000-0000-4000-8000-000000000004', null, 'lidl',            'Lidl',            'CH', null),
  ('00000000-0000-4000-8000-000000000005', null, 'aldi',            'Aldi',            'CH', null),
  ('00000000-0000-4000-8000-000000000006', null, 'volg',            'Volg',            'CH', null),
  ('00000000-0000-4000-8000-000000000007', null, 'spar',            'Spar',            'CH', null),
  ('00000000-0000-4000-8000-000000000008', null, 'manor',           'Manor',           'CH', null),
  ('00000000-0000-4000-8000-000000000009', null, 'migrolino',       'Migrolino',       'CH', 'cumulus'),
  ('00000000-0000-4000-8000-000000000010', null, 'coop_pronto',     'Coop Pronto',     'CH', 'supercard'),
  ('00000000-0000-4000-8000-000000000011', null, 'landi',           'Landi',           'CH', null),
  ('00000000-0000-4000-8000-000000000012', null, 'jumbo',           'Jumbo',           'CH', null),
  ('00000000-0000-4000-8000-000000000013', null, 'ikea',            'IKEA',            'CH', null),
  ('00000000-0000-4000-8000-000000000014', null, 'interdiscount',   'Interdiscount',   'CH', 'supercard'),
  ('00000000-0000-4000-8000-000000000015', null, 'mediamarkt',      'MediaMarkt',      'CH', null),
  ('00000000-0000-4000-8000-000000000016', null, 'digitec_galaxus', 'Digitec Galaxus', 'CH', null)
on conflict do nothing;
