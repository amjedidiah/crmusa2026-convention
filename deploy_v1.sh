#!/bin/bash
# ============================================================
# CRM USA 2026 Convention — Deploy Script v1
# Usage: bash deploy_v1.sh
# ============================================================

set -e

REPO_URL="https://github.com/oxofoegbu/crmusa2026-convention.git"
BRANCH="main"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "=============================================="
echo "  CRM USA 2026 Convention — Deploy Script v1"
echo "=============================================="
echo ""

# ── STEP 0: Check git is installed ──
if ! command -v git &> /dev/null; then
  echo -e "${RED}ERROR: git is not installed. Please install git first.${NC}"
  exit 1
fi

# ── STEP 1: Patch the two secret keys into index.html ──
echo -e "${YELLOW}Step 1: Configuring secret keys...${NC}"
echo ""

read -p "  Enter your Supabase ANON KEY (from Supabase → Settings → API): " SUPABASE_KEY
if [ -z "$SUPABASE_KEY" ]; then
  echo -e "${RED}ERROR: Supabase anon key cannot be empty.${NC}"
  exit 1
fi

read -p "  Enter your PayPal LIVE Client ID (from developer.paypal.com): " PAYPAL_ID
if [ -z "$PAYPAL_ID" ]; then
  echo -e "${YELLOW}WARNING: No PayPal Client ID entered. PayPal checkout will show placeholder mode.${NC}"
  PAYPAL_ID="AXu_test_placeholder"
fi

# Patch index.html in-place
if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS sed
  sed -i '' "s|YOUR_ANON_KEY_HERE|$SUPABASE_KEY|g" index.html
  sed -i '' "s|AXu_test_placeholder|$PAYPAL_ID|g" index.html
else
  # Linux sed
  sed -i "s|YOUR_ANON_KEY_HERE|$SUPABASE_KEY|g" index.html
  sed -i "s|AXu_test_placeholder|$PAYPAL_ID|g" index.html
fi

echo -e "${GREEN}  ✓ Keys patched into index.html${NC}"
echo ""

# ── STEP 2: Supabase SQL reminder ──
echo -e "${YELLOW}Step 2: Supabase database setup${NC}"
echo ""
echo "  Have you already run supabase_migration.sql in Supabase?"
read -p "  [y/N]: " RAN_SQL

if [[ ! "$RAN_SQL" =~ ^[Yy]$ ]]; then
  echo ""
  echo "  ──────────────────────────────────────────────"
  echo "  ACTION REQUIRED before continuing:"
  echo "  1. Go to https://supabase.com/dashboard"
  echo "  2. Open project: crmusa2026-convention"
  echo "  3. Click SQL Editor → New Query"
  echo "  4. Paste contents of supabase_migration.sql"
  echo "  5. Click Run"
  echo "  ──────────────────────────────────────────────"
  echo ""
  read -p "  Press ENTER once you have run the SQL, then we will continue..."
fi
echo -e "${GREEN}  ✓ Supabase database confirmed${NC}"
echo ""

# ── STEP 3: Git init / connect ──
echo -e "${YELLOW}Step 3: Initialising git repository...${NC}"
echo ""

if [ -d ".git" ]; then
  echo "  Git repo already initialised."
else
  git init
  echo -e "${GREEN}  ✓ git init done${NC}"
fi

# Set or update remote
if git remote | grep -q "origin"; then
  git remote set-url origin "$REPO_URL"
  echo -e "${GREEN}  ✓ Remote 'origin' updated${NC}"
else
  git remote add origin "$REPO_URL"
  echo -e "${GREEN}  ✓ Remote 'origin' added${NC}"
fi
echo ""

# ── STEP 4: Commit and push ──
echo -e "${YELLOW}Step 4: Committing and pushing to GitHub...${NC}"
echo ""

git add .
git commit -m "v1 initial deploy — CRM USA 2026 Convention site" --allow-empty
git branch -M $BRANCH

echo ""
echo "  Pushing to $REPO_URL ($BRANCH)..."
echo "  (You may be prompted for your GitHub username/password or token)"
echo ""

git push -u origin $BRANCH

echo ""
echo -e "${GREEN}  ✓ Pushed to GitHub successfully${NC}"
echo ""

# ── STEP 5: Done ──
echo "=============================================="
echo -e "${GREEN}  DEPLOY COMPLETE${NC}"
echo "=============================================="
echo ""
echo "  GitHub:  https://github.com/oxofoegbu/crmusa2026-convention"
echo "  Vercel:  https://crmusa2026-convention.vercel.app"
echo "           (Vercel will auto-build from your GitHub push)"
echo ""
echo "  Next steps:"
echo "  1. Go to Vercel → crmusa2026-convention project"
echo "  2. Confirm the deployment is building (takes ~30 seconds)"
echo "  3. Visit your live URL to test registration flow"
echo "  4. Check Supabase → Table Editor → registrations"
echo "     to confirm test submissions are being saved"
echo ""
echo "  Questions: convention@crmusanational.org"
echo ""
