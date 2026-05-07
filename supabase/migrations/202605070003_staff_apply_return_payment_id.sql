-- Phase 5: return inserted registration_payments.id from RPC for structured ops logs.

create or replace function public.staff_apply_registration_payment(
  p_registration_id uuid,
  p_source text,
  p_external_ref text,
  p_amount_cents bigint,
  p_received_at timestamptz,
  p_notes text,
  p_raw_payload jsonb,
  p_created_by text,
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

  v_new_paid := v_paid + p_amount_cents;

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
