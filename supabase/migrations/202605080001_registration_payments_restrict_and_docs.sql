-- FK + documentation: upgrades databases created from older foundation (ON DELETE CASCADE).
-- Idempotent with foundation that already uses RESTRICT (drops and re-adds same FK).

alter table public.registration_payments
  drop constraint if exists registration_payments_registration_id_fkey;

alter table public.registration_payments
  add constraint registration_payments_registration_id_fkey
  foreign key (registration_id)
  references public.registrations(id)
  on delete restrict;

comment on constraint registration_payments_amount_cents_check on public.registration_payments is
  'Phase 1: strictly positive amounts. Refund/reversal rows (negative amounts) are not modeled in v1; revisit with RPC and constraints if refunds are recorded here.';

comment on constraint registrations_amount_paid_cents_check on public.registrations is
  'Non-negative paid total. amount_paid_cents may exceed total_cents when staff confirms intentional overpayment via staff_apply_registration_payment.';

comment on table public.registration_payments is
  'Authoritative payment events for manual reconciliation and imports. A registration with payments cannot be deleted until those rows are removed or reassigned (ON DELETE RESTRICT). Phase 1: positive payment amounts only; refunds out of scope.';
