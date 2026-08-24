-- 0038 — Borrado lógico de clientes.
--
-- En la reunión de kickoff se definió NO borrar información de la base: un cliente
-- se DESACTIVA (borrado lógico), no se elimina físicamente; y no se puede desactivar
-- mientras tenga proyectos vinculados (primero se reasignan/quitan los proyectos).
-- El bloqueo por proyectos se hace en la capa de datos (deactivateClient); acá sólo
-- se agrega la columna de estado.
--
-- Aditivo e idempotente: default true → todos los clientes existentes quedan activos.
-- No se agrega índice sobre active: es un booleano de baja cardinalidad y el orden
-- por client_name ya lo cubre clients_client_name_idx; un índice acá sería peso muerto.
alter table public.clients
  add column if not exists active boolean not null default true;
