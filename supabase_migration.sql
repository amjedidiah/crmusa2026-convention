-- ============================================================
-- CRM USA 2026 Convention -- Supabase Migration
-- Run this ONCE in: Supabase → SQL Editor → New Query
-- ============================================================

-- 1. Registrations table
CREATE TABLE IF NOT EXISTS public.registrations (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at       timestamptz DEFAULT now(),
  paypal_order_id  text,
  first_name       text        NOT NULL,
  last_name        text        NOT NULL,
  email            text        NOT NULL,
  phone            text,
  church           text,
  city             text,
  tier             text,
  total_amount     numeric,
  attendees        jsonb,
  status           text        DEFAULT 'confirmed'
);

-- 2. Enable RLS
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

-- 3. Anyone can INSERT (anonymous visitors registering)
CREATE POLICY "Anyone can insert a registration"
  ON public.registrations
  FOR INSERT
  WITH CHECK (true);

-- 4. Only authenticated users (admins) can SELECT
CREATE POLICY "Auth users can read registrations"
  ON public.registrations
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ============================================================
-- Verify: run this to confirm table was created
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'registrations' ORDER BY ordinal_position;
-- ============================================================
