#!/usr/bin/env bash
# OBSOLETE — do not run (Phase 2+ architecture).
#
# This script previously patched a Supabase anon key into index.html and pushed the entire
# worktree to GitHub. The current site uses server-side APIs only for registration and does
# not embed anon keys in the public HTML.
#
# Deploy instead by:
#   1. Push to GitHub; let Vercel build.
#   2. Set environment variables in the Vercel project (see README.md and .env.example).
#   3. Apply supabase/migrations/* to your Supabase project (supabase db push or SQL editor).

echo "deploy_v1.sh is obsolete and has been disabled. See README.md → Deploy notes." >&2
exit 1
