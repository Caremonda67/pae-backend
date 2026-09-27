-- ============================================================
-- Chat entre estudiante y admin (mensajes de contacto)
-- Ejecutar este script en Supabase: Dashboard -> SQL Editor -> Run
-- ============================================================

-- Mensajes de la conversacion: el primer mensaje del estudiante
-- sigue guardandose en la tabla "contactos" (columna mensaje) y
-- aqui se van sumando los demas mensajes de ida y vuelta.
create table if not exists public.chat_mensajes (
  id bigint generated always as identity primary key,
  contacto_id bigint not null references public.contactos(id) on delete cascade,
  remitente text not null check (remitente in ('estudiante', 'admin')),
  texto text not null,
  imagen text,
  created_at timestamptz not null default now()
);

-- Indice para traer el hilo ordenado por fecha
create index if not exists chat_mensajes_contacto_idx
  on public.chat_mensajes (contacto_id, created_at);

-- Permitimos que la API (rol de servicio) lea y escriba
alter table public.chat_mensajes enable row level security;
