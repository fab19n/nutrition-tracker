-- Kira Makan sync storage (ARCHITECTURE.md §6.2).
-- Paste the whole file into Supabase › SQL Editor › New query › Run. Safe to run again.
-- Later changes ship as new files (sync-002.sql, …). To change a function's arguments, drop the old
-- signature first: create or replace with different arguments adds an overload.
-- Keep this file out of supabase/migrations: a pasted file isn't recorded as applied, so db push would rerun it.

-- 1. Tables ------------------------------------------------------------------------------------
create table if not exists public.sync_accounts (
  user_id    uuid primary key references auth.users (id) on delete restrict,
  dataset    uuid not null default pg_catalog.gen_random_uuid(), -- replaced when the account's synced copy is wiped
  rev        bigint not null default 0 check (rev >= 0),         -- last revision handed out
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sync_rows (
  user_id    uuid not null references public.sync_accounts (user_id) on delete cascade,
  tbl        text not null check (tbl ~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'),
  row_key    text not null check (char_length(row_key) between 1 and 200),
  rev        bigint not null check (rev > 0),
  deleted    boolean not null default false,
  data       jsonb,
  changed_at timestamptz not null,  -- when the edit was made: device clock, offset-corrected, never after server time
  device_id  text not null check (char_length(device_id) between 1 and 64),
  nonce      text not null check (char_length(nonce) between 1 and 64),  -- the edit's id: spots a retried push
  server_at  timestamptz not null default now(),
  primary key (user_id, tbl, row_key),
  -- "data is not null" matters: a check that comes out null passes, so a live row without data would get in.
  constraint sync_rows_shape check ((deleted and data is null) or (not deleted and data is not null and jsonb_typeof(data) = 'object'))
);
create unique index if not exists sync_rows_user_rev on public.sync_rows (user_id, rev);

-- 2. Access: read your own rows; nobody writes the tables directly; nothing for anon -------------
alter table public.sync_accounts enable row level security;
alter table public.sync_rows     enable row level security;
revoke all on table public.sync_accounts, public.sync_rows from public, anon, authenticated;
grant select on table public.sync_accounts, public.sync_rows to authenticated;

drop policy if exists sync_accounts_select_own on public.sync_accounts;
create policy sync_accounts_select_own on public.sync_accounts
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists sync_rows_select_own on public.sync_rows;
create policy sync_rows_select_own on public.sync_rows
  for select to authenticated using (user_id = (select auth.uid()));

-- 3. Functions -----------------------------------------------------------------------------------
-- The signed-in user, or a 401. supabase-js falls back to the anon key without a session; this
-- makes that an error, never an empty answer that restore could read as "nothing saved".
create or replace function public.sync_caller()
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in to sync' using errcode = 'PT401';
  end if;
  return v_uid;
end; $$;

-- Creates the account's sync record on first use and says what it holds.
create or replace function public.sync_hello()
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := public.sync_caller(); v_acc public.sync_accounts%rowtype;
begin
  insert into public.sync_accounts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_acc from public.sync_accounts a where a.user_id = v_uid;
  return jsonb_build_object(
    'dataset', v_acc.dataset,
    'head', v_acc.rev,
    'counts', coalesce((select jsonb_object_agg(c.tbl, c.n) from (
        select r.tbl, count(*) as n from public.sync_rows r
         where r.user_id = v_uid and not r.deleted group by r.tbl) c), '{}'::jsonb),
    'lastChangeAt', (select max(r.server_at) from public.sync_rows r where r.user_id = v_uid));
end; $$;

-- Rows changed after revision p_after, oldest first. STABLE: head and rows come from one snapshot.
create or replace function public.sync_pull(p_after bigint, p_limit integer default 500)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_uid   uuid := public.sync_caller();
  v_acc   public.sync_accounts%rowtype;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
begin
  select * into v_acc from public.sync_accounts a where a.user_id = v_uid;
  return jsonb_build_object(
    'dataset', v_acc.dataset,
    'head', coalesce(v_acc.rev, 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        't', p.tbl, 'k', p.row_key, 'rev', p.rev, 'del', p.deleted, 'data', p.data, 'at', p.changed_at) order by p.rev)
      from (select r.tbl, r.row_key, r.rev, r.deleted, r.data, r.changed_at
              from public.sync_rows r
             where r.user_id = v_uid and r.rev > greatest(coalesce(p_after, 0), 0)
             order by r.rev limit v_limit) p), '[]'::jsonb));
end; $$;

-- Every live key with its revision (used by "Keep this device's data").
create or replace function public.sync_keys()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := public.sync_caller(); v_acc public.sync_accounts%rowtype;
begin
  select * into v_acc from public.sync_accounts a where a.user_id = v_uid;
  return jsonb_build_object(
    'dataset', v_acc.dataset,
    'head', coalesce(v_acc.rev, 0),
    'keys', coalesce((select jsonb_agg(jsonb_build_array(r.tbl, r.row_key, r.rev))
                        from public.sync_rows r where r.user_id = v_uid and not r.deleted), '[]'::jsonb));
end; $$;

-- Applies up to 200 changes [{t, k, del, data, base, at, n}].
--   base: the revision this device last had for the row (null if never); at: when the edit was made
--   (device clock, ISO); n: the edit's id. p_sent_at is the device clock at sending, to correct its offset.
-- Result per change, by index i: ok (rev) | lost (the winning rev, del, data) | invalid.
create or replace function public.sync_push(p_dataset uuid, p_device text, p_sent_at timestamptz, p_changes jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid     uuid := public.sync_caller();
  v_now     timestamptz := now();
  v_skew    interval := now() - coalesce(p_sent_at, now());
  v_acc     public.sync_accounts%rowtype;
  v_cur     public.sync_rows%rowtype;
  v_head    bigint;
  v_change  jsonb;
  v_idx     bigint;
  v_tbl     text;
  v_key     text;
  v_del     boolean;
  v_data    jsonb;
  v_base    bigint;
  v_at      timestamptz;
  v_nonce   text;
  v_wins    boolean;
  v_results jsonb := '[]'::jsonb;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'Missing device id' using errcode = 'PT400';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) > 200 then
    raise exception 'Send at most 200 changes at a time' using errcode = 'PT400';
  end if;

  -- One push at a time per account. Revisions are handed out under this row lock and commit in
  -- order, so a pull that has seen revision n has seen every revision below n.
  select * into v_acc from public.sync_accounts a where a.user_id = v_uid for update;
  if not found or v_acc.dataset is distinct from p_dataset then
    raise exception 'The synced copy in this account changed' using errcode = 'PT409';
  end if;
  v_head := v_acc.rev;

  for v_change, v_idx in
    select e.value, e.ordinality - 1 from jsonb_array_elements(p_changes) with ordinality as e(value, ordinality)
  loop
    v_tbl   := v_change ->> 't';
    v_key   := v_change ->> 'k';
    v_nonce := v_change ->> 'n';
    v_del   := coalesce(v_change -> 'del' = 'true'::jsonb, false);
    v_data  := case when v_del then null else v_change -> 'data' end;

    -- The device's clock offset is removed, and no edit can claim a time after the server's. A value
    -- that fits the pattern but can't be cast (30 February, a base past bigint) leaves v_at null: invalid.
    v_at := null;
    begin
      v_base := case when jsonb_typeof(v_change -> 'base') = 'number' then (v_change ->> 'base')::numeric::bigint end;
      if coalesce(v_change ->> 'at', '') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then
        v_at := least((v_change ->> 'at')::timestamptz + v_skew, v_now);
      end if;
    exception when others then
      v_at := null;
    end;

    -- A bad row never fails the batch: it's answered 'invalid' and the rest go through.
    if v_tbl is null or v_tbl !~ '^[a-zA-Z][a-zA-Z0-9]{0,39}$'
       or v_key is null or char_length(v_key) not between 1 and 200
       or v_nonce is null or char_length(v_nonce) not between 1 and 64
       or v_at is null
       or (not v_del and (jsonb_typeof(v_data) is distinct from 'object' or octet_length(v_data::text) > 262144))
       or (v_tbl = 'profile' and (v_del or coalesce(v_data -> 'demoMode' = 'true'::jsonb, false)))
    then
      v_results := v_results || jsonb_build_array(jsonb_build_object('i', v_idx, 's', 'invalid'));
      continue;
    end if;

    select * into v_cur from public.sync_rows r where r.user_id = v_uid and r.tbl = v_tbl and r.row_key = v_key;
    if not found then
      v_wins := true;                                          -- new to the account
    elsif v_cur.device_id = p_device and v_cur.nonce = v_nonce then
      -- A retry of a push whose answer was lost: already here.
      v_results := v_results || jsonb_build_array(jsonb_build_object('i', v_idx, 's', 'ok', 'rev', v_cur.rev));
      continue;
    elsif v_cur.device_id = p_device or v_cur.rev = v_base then
      v_wins := true;                                          -- made on top of the current copy
    else
      -- Two edits that didn't see each other: the later one wins; a tie goes to the larger device id.
      v_wins := v_at > v_cur.changed_at
             or (v_at = v_cur.changed_at and p_device collate "C" > v_cur.device_id collate "C");
    end if;

    if v_wins then
      v_head := v_head + 1;
      insert into public.sync_rows (user_id, tbl, row_key, rev, deleted, data, changed_at, device_id, nonce, server_at)
      values (v_uid, v_tbl, v_key, v_head, v_del, v_data, v_at, p_device, v_nonce, v_now)
      on conflict (user_id, tbl, row_key) do update
        set rev = excluded.rev, deleted = excluded.deleted, data = excluded.data, changed_at = excluded.changed_at,
            device_id = excluded.device_id, nonce = excluded.nonce, server_at = excluded.server_at;
      v_results := v_results || jsonb_build_array(jsonb_build_object('i', v_idx, 's', 'ok', 'rev', v_head));
    else
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'i', v_idx, 's', 'lost', 'rev', v_cur.rev, 'del', v_cur.deleted, 'data', v_cur.data));
    end if;
  end loop;

  if v_head <> v_acc.rev then
    update public.sync_accounts a set rev = v_head, updated_at = v_now where a.user_id = v_uid;
  end if;
  return jsonb_build_object('dataset', v_acc.dataset, 'prevHead', v_acc.rev, 'head', v_head, 'results', v_results);
end; $$;

-- 4. Who may call what ---------------------------------------------------------------------------
revoke all on function public.sync_caller(), public.sync_hello(), public.sync_pull(bigint, integer),
  public.sync_keys(), public.sync_push(uuid, text, timestamptz, jsonb) from public, anon;
grant execute on function public.sync_caller(), public.sync_hello(), public.sync_pull(bigint, integer),
  public.sync_keys(), public.sync_push(uuid, text, timestamptz, jsonb) to authenticated;

notify pgrst, 'reload schema';
