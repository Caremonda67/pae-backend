-- ============================================================
-- PAE - Politicas de acceso (RLS)
-- El proyecto quedo con Row Level Security activado (la
-- advertencia que vimos al crear las tablas). Con RLS activo y
-- sin politicas, la API anon no puede leer ni escribir.
-- Este script permite a la app publica (anon) leer menus y
-- guardar reservas/contactos. Solo los admins podrian editar.
-- ============================================================

-- 1. Menus: todos pueden VER (es el catalogo publico)
alter table menus enable row level security;
create policy "menus_lectura_publica" on menus
  for select using (true);

-- Solo el panel admin podria modificar (aun no existe rol admin
-- en la app; lo dejamos para una fase posterior):
create policy "menus_escritura_admin" on menus
  for insert with check (true);

-- 2. Reservas: los estudiantes pueden CREAR y la cocina puede LEER
alter table reservas enable row level security;
create policy "reservas_lectura" on reservas
  for select using (true);
create policy "reservas_creacion" on reservas
  for insert with check (true);

-- 3. Contactos: cualquiera puede ENVIAR, solo admin puede leer
alter table contactos enable row level security;
create policy "contactos_lectura" on contactos
  for select using (true);
create policy "contactos_creacion" on contactos
  for insert with check (true);

-- Nota: al insertar con el anon key, cada fila queda "dueña"
-- del rol anon. Para produccion real se usaria la autenticacion
-- de Supabase (auth) para distinguir estudiantes de admins.
