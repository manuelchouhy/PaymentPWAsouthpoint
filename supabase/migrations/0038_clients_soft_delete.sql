-- 0038 — Borrado lógico de clientes.
--
-- En la reunión de kickoff se definió NO borrar información de la base: un cliente
-- se DESACTIVA (borrado lógico), no se elimina físicamente; y no se puede desactivar
-- mientras tenga proyectos vinculados (primero se reasignan/quitan los proyectos).
-- El bloqueo por proyectos se hace en la capa de datos (deactivateClient); acá sólo
-- se agrega la columna de estado.
--
-- Aditivo e idempotente: default true → todos los clientes existentes quedan activos.
alter table public.clients
  add column if not exists active boolean not null default true;

-- Índice parcial: las listas y el resolver sólo consultan clientes activos.
create index if not exists clients_active_idx on public.clients (active) where active;
