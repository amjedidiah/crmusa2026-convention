-- Phase 4/5 audit trail: durable staff attribution + import batch correlation.

alter table public.registration_payments
  add column if not exists created_by_staff_user_id uuid,
  add column if not exists created_by_staff_email text,
  add column if not exists import_batch_id text;

create index if not exists registration_payments_created_by_staff_user_id_idx
  on public.registration_payments (created_by_staff_user_id);

create index if not exists registration_payments_created_by_staff_email_idx
  on public.registration_payments (created_by_staff_email);

create index if not exists registration_payments_import_batch_id_idx
  on public.registration_payments (import_batch_id);

comment on column public.registration_payments.created_by is
  'Legacy free-form actor label retained for compatibility. New writes should also populate created_by_staff_user_id / created_by_staff_email.';

comment on column public.registration_payments.created_by_staff_user_id is
  'Supabase Auth user id (sub) for the staff user who created or imported this payment row.';

comment on column public.registration_payments.created_by_staff_email is
  'Normalized allowlisted staff email captured at payment-write time for reconciliation and disputes.';

comment on column public.registration_payments.import_batch_id is
  'Nullable batch identifier for multi-row imports so related payment rows can be audited together.';

drop function if exists public.staff_apply_registration_payment(
  uuid, text, text, bigint, timestamptz, text, jsonb, text, boolean
);

create or replace function public.staff_apply_registration_payment(
  p_registration_id uuid,
  p_source text,
  p_external_ref text,
  p_amount_cents bigint,
  p_received_at timestamptz,
  p_notes text,
  p_raw_payload jsonb,
  p_created_by text,
  p_created_by_staff_user_id uuid,
  p_created_by_staff_email text,
  p_import_batch_id text,
  p_allow_overpayment boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
  v_paid bigint;
  v_new_paid bigint;
  v_status text;
  v_payment_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_source is null or btrim(p_source) = '' then
    raise exception 'invalid_source';
  end if;

  if p_external_ref is null or btrim(p_external_ref) = '' then
    raise exception 'invalid_external_ref';
  end if;

  select total_cents, amount_paid_cents
  into v_total, v_paid
  from public.registrations
  where id = p_registration_id
  for update;

  if not found then
    raise exception 'registration_not_found';
  end if;

  v_new_paid := coalesce(v_paid, 0) + p_amount_cents;

  if v_new_paid > v_total and not coalesce(p_allow_overpayment, false) then
    raise exception 'overpayment_not_allowed';
  end if;

  insert into public.registration_payments (
    registration_id,
    source,
    external_ref,
    amount_cents,
    received_at,
    notes,
    raw_payload,
    created_by,
    created_by_staff_user_id,
    created_by_staff_email,
    import_batch_id,
    status
  )
  values (
    p_registration_id,
    btrim(p_source),
    btrim(p_external_ref),
    p_amount_cents,
    coalesce(p_received_at, timezone('utc', now())),
    p_notes,
    coalesce(p_raw_payload, '{}'::jsonb),
    p_created_by,
    p_created_by_staff_user_id,
    case
      when p_created_by_staff_email is null or btrim(p_created_by_staff_email) = '' then null
      else lower(btrim(p_created_by_staff_email))
    end,
    case
      when p_import_batch_id is null or btrim(p_import_batch_id) = '' then null
      else btrim(p_import_batch_id)
    end,
    'posted'
  )
  returning id into v_payment_id;

  if v_total <= 0 or v_new_paid >= v_total then
    v_status := 'complete';
  elsif v_new_paid > 0 then
    v_status := 'partial';
  else
    v_status := 'pending';
  end if;

  update public.registrations
  set
    amount_paid_cents = v_new_paid,
    status = v_status
  where id = p_registration_id;

  return jsonb_build_object(
    'registration_id', p_registration_id,
    'payment_id', v_payment_id,
    'amount_paid_cents', v_new_paid,
    'total_cents', v_total,
    'remaining_cents', greatest(0::bigint, v_total - v_new_paid),
    'status', v_status
  );
exception
  when unique_violation then
    raise exception 'duplicate_external_ref';
end;
$$;

revoke all on function public.staff_apply_registration_payment(
  uuid, text, text, bigint, timestamptz, text, jsonb, text, uuid, text, text, boolean
) from public;

grant execute on function public.staff_apply_registration_payment(
  uuid, text, text, bigint, timestamptz, text, jsonb, text, uuid, text, text, boolean
) to service_role;

comment on function public.staff_apply_registration_payment is
  'Inserts registration_payments and updates registrations in one transaction, including durable staff attribution and optional import batch identifiers.';
