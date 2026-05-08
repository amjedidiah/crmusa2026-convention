-- ============================================================
-- One public registration per normalized email; one per
-- normalized phone when the registrant supplies enough digits
-- to form a stable key (nullable / short numbers are ignored).
-- Resolve duplicate emails in existing data before applying.
-- ============================================================

alter table public.registrations
  add column if not exists phone_normalized text;

update public.registrations r
set phone_normalized = sub.n
from (
  select
    id,
    case
      when length(d) = 0 then null::text
      when length(d) = 11 and left(d, 1) = '1' then substring(d from 2 for 10)
      when length(d) = 10 then d
      when length(d) > 10 then d
      else null::text
    end as n
  from (
    select
      id,
      regexp_replace(coalesce(phone, ''), '\D', '', 'g') as d
    from public.registrations
  ) x
) sub
where r.id = sub.id;

drop index if exists public.registrations_email_normalized_idx;

create unique index if not exists registrations_email_normalized_key
  on public.registrations (email_normalized);

create unique index if not exists registrations_phone_normalized_key
  on public.registrations (phone_normalized)
  where phone_normalized is not null;
