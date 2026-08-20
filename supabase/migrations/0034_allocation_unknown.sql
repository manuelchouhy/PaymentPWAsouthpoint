-- Agrega 'unknown' (la categoría "X" del grill) a los valores válidos de
-- time_entries.allocation.
--
-- Hasta ahora el CHECK (0018) admitía sólo bill_to_client/overage/sp_internal, con
-- NULL = sin clasificar. "X" NO es lo mismo que sin clasificar: es una 4ta
-- allocation real que se aplica a mano (una hora que no encaja en las otras tres).
-- Sólo las horas allocation='unknown' van a la tab X de Billing; las NULL siguen
-- siendo la cola de triage, aparte.
--
-- NULL sigue permitido: un CHECK no se viola con NULL (comparación → unknown).
alter table public.time_entries drop constraint if exists time_entries_allocation_check;
alter table public.time_entries add constraint time_entries_allocation_check
  check (allocation = any (array['bill_to_client', 'overage', 'sp_internal', 'unknown']));
