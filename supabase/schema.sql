-- Enma - esquema completo de Supabase
-- Ejecutar una vez en Supabase > SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 60),
  role text not null check (role in ('woman','man')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cycle_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  typical_period_days integer not null default 5 check (typical_period_days between 1 and 15),
  default_cycle_length integer not null default 28 check (default_cycle_length between 15 and 60),
  cycle_mode text not null default 'auto' check (cycle_mode in ('auto','regular','irregular')),
  updated_at timestamptz not null default now()
);

create table if not exists public.periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_period_dates check (end_date >= start_date and end_date <= start_date + 29),
  constraint unique_period_start unique (user_id, start_date)
);

create table if not exists public.partnerships (
  id uuid primary key default gen_random_uuid(),
  woman_id uuid not null references public.profiles(id) on delete cascade,
  man_id uuid not null references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint different_users check (woman_id <> man_id)
);

create unique index if not exists one_active_partner_per_woman
  on public.partnerships(woman_id) where active = true;
create unique index if not exists one_active_partner_per_man
  on public.partnerships(man_id) where active = true;

create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  woman_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique check (char_length(code) = 6),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists periods_user_start_idx on public.periods(user_id, start_date desc);
create index if not exists pairing_codes_code_idx on public.pairing_codes(code);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    raise exception 'El tipo de usuario no se puede cambiar después de crear la cuenta.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles
for each row execute function public.protect_profile_role();

create or replace function public.validate_period_record()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.start_date > current_date then
    raise exception 'No se puede registrar un periodo que empiece en el futuro.';
  end if;
  if exists (
    select 1 from public.periods p
    where p.user_id = new.user_id
      and p.id <> new.id
      and daterange(p.start_date, p.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'Las fechas se solapan con otro periodo ya registrado.';
  end if;
  return new;
end;
$$;

drop trigger if exists periods_validate_record on public.periods;
create trigger periods_validate_record before insert or update on public.periods
for each row execute function public.validate_period_record();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch_updated_at on public.cycle_settings;
create trigger settings_touch_updated_at before update on public.cycle_settings
for each row execute function public.touch_updated_at();

drop trigger if exists periods_touch_updated_at on public.periods;
create trigger periods_touch_updated_at before update on public.periods
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role text;
  requested_name text;
begin
  requested_role := coalesce(new.raw_user_meta_data->>'role', 'woman');
  if requested_role not in ('woman','man') then
    requested_role := 'woman';
  end if;

  requested_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '');
  if requested_name is null then
    requested_name := split_part(coalesce(new.email, 'Enma'), '@', 1);
  end if;

  insert into public.profiles(id, full_name, role)
  values (new.id, left(requested_name, 60), requested_role)
  on conflict (id) do nothing;

  if requested_role = 'woman' then
    insert into public.cycle_settings(user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_linked_partner(p_woman_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.partnerships p
    where p.active = true
      and p.woman_id = p_woman_id
      and p.man_id = auth.uid()
  );
$$;

create or replace function public.create_pairing_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  generated text;
  caller_role text;
  attempts integer := 0;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is distinct from 'woman' then
    raise exception 'Solo una cuenta de mujer puede generar un código de pareja.';
  end if;

  if exists(select 1 from public.partnerships where active = true and woman_id = auth.uid()) then
    raise exception 'Ya existe una pareja vinculada. Desvincúlala antes de generar otro código.';
  end if;

  update public.pairing_codes
  set expires_at = now()
  where woman_id = auth.uid() and used_at is null and expires_at > now();

  loop
    attempts := attempts + 1;
    generated := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 6));
    begin
      insert into public.pairing_codes(woman_id, code, expires_at)
      values (auth.uid(), generated, now() + interval '24 hours');
      return generated;
    exception when unique_violation then
      if attempts >= 10 then
        raise exception 'No se pudo generar el código. Inténtalo de nuevo.';
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.claim_pairing_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
  code_row public.pairing_codes%rowtype;
  woman_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is distinct from 'man' then
    raise exception 'Este código debe vincularse desde una cuenta de hombre.';
  end if;

  select * into code_row
  from public.pairing_codes
  where code = upper(trim(p_code))
  for update;

  if code_row.id is null or code_row.used_at is not null or code_row.expires_at <= now() then
    raise exception 'Código de pareja inválido o caducado.';
  end if;

  select role into woman_role from public.profiles where id = code_row.woman_id;
  if woman_role is distinct from 'woman' then
    raise exception 'El código no pertenece a una cuenta válida.';
  end if;

  if exists(select 1 from public.partnerships where active = true and man_id = auth.uid()) then
    raise exception 'Tu cuenta ya tiene una pareja vinculada.';
  end if;

  if exists(select 1 from public.partnerships where active = true and woman_id = code_row.woman_id) then
    raise exception 'Esa cuenta ya tiene una pareja vinculada.';
  end if;

  insert into public.partnerships(woman_id, man_id, active)
  values (code_row.woman_id, auth.uid(), true);

  update public.pairing_codes set used_at = now() where id = code_row.id;
  return true;
end;
$$;

create or replace function public.revoke_partnership()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.partnerships
  set active = false, ended_at = now()
  where active = true and (woman_id = auth.uid() or man_id = auth.uid());
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

alter table public.profiles enable row level security;
alter table public.cycle_settings enable row level security;
alter table public.periods enable row level security;
alter table public.partnerships enable row level security;
alter table public.pairing_codes enable row level security;

-- PERFIL
create policy "profile read own or linked woman" on public.profiles
for select using (id = auth.uid() or public.is_linked_partner(id));
create policy "profile update own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

-- AJUSTES DE CICLO
create policy "settings read own or linked" on public.cycle_settings
for select using (user_id = auth.uid() or public.is_linked_partner(user_id));
create policy "settings insert woman own" on public.cycle_settings
for insert with check (
  user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'woman')
);
create policy "settings update woman own" on public.cycle_settings
for update using (
  user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'woman')
) with check (user_id = auth.uid());

-- PERIODOS: la pareja solo puede leer
create policy "periods read own or linked" on public.periods
for select using (user_id = auth.uid() or public.is_linked_partner(user_id));
create policy "periods insert woman own" on public.periods
for insert with check (
  user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'woman')
);
create policy "periods update woman own" on public.periods
for update using (
  user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'woman')
) with check (user_id = auth.uid());
create policy "periods delete woman own" on public.periods
for delete using (
  user_id = auth.uid() and exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'woman')
);

-- VÍNCULOS: solo visibles por sus dos integrantes. Escritura únicamente por RPC.
create policy "partnership participants read" on public.partnerships
for select using (woman_id = auth.uid() or man_id = auth.uid());

-- CÓDIGOS: la mujer solo puede consultar sus propios códigos. Creación/reclamación por RPC.
create policy "pair codes owner read" on public.pairing_codes
for select using (woman_id = auth.uid());
create policy "pair codes owner delete" on public.pairing_codes
for delete using (woman_id = auth.uid());

grant execute on function public.create_pairing_code() to authenticated;
grant execute on function public.claim_pairing_code(text) to authenticated;
grant execute on function public.revoke_partnership() to authenticated;
grant execute on function public.is_linked_partner(uuid) to authenticated;

revoke all on public.profiles from anon;
revoke all on public.cycle_settings from anon;
revoke all on public.periods from anon;
revoke all on public.partnerships from anon;
revoke all on public.pairing_codes from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.cycle_settings to authenticated;
grant select, insert, update, delete on public.periods to authenticated;
grant select on public.partnerships to authenticated;
grant select, delete on public.pairing_codes to authenticated;
