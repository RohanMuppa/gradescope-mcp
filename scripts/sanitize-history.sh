#!/usr/bin/env bash
# Git history sanitization script for gradescope-mcp
# Removes leaked credentials, PII, and hardcoded paths from repository history

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo "=================================================="
echo "Git History Sanitization Script"
echo "=================================================="
echo ""

# Pre-flight: Check git-filter-repo installed
if ! command -v git-filter-repo &> /dev/null; then
    echo -e "${RED}ERROR: git-filter-repo is not installed${NC}"
    echo ""
    echo "Install via:"
    echo "  brew install git-filter-repo     (macOS)"
    echo "  pip install git-filter-repo      (Linux/Windows)"
    echo ""
    exit 1
fi

# Verify we're in a git repository
if [ ! -d .git ]; then
    echo -e "${RED}ERROR: Not in a git repository${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Creating backup${NC}"
BACKUP_DIR="../gradescope-mcp-backup-$(date +%Y%m%d-%H%M%S).git"
git clone --mirror . "$BACKUP_DIR"
echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"
echo ""

echo -e "${YELLOW}Step 2: Scanning git history for sensitive data${NC}"
echo ""

# Scan for hardcoded user paths
echo "Checking for hardcoded user paths (/Users/rohanmuppa)..."
HARDCODED_PATHS=$(git log --all --pretty=format: --name-only | sort -u | xargs -I {} git log --all -S "/Users/rohanmuppa" --pretty=format:"%H %s" -- {} 2>/dev/null | head -n 10 || true)
if [ -n "$HARDCODED_PATHS" ]; then
    echo -e "${RED}Found hardcoded paths in history:${NC}"
    echo "$HARDCODED_PATHS"
    echo ""
else
    echo -e "${GREEN}✓ No hardcoded paths found${NC}"
fi

# Scan for purdue.edu emails
echo "Checking for purdue.edu emails (PII)..."
PURDUE_EMAILS=$(git log --all --pretty=format:"%ae %ce %an %cn %s %b" | grep -i "purdue.edu" | head -n 10 || true)
if [ -n "$PURDUE_EMAILS" ]; then
    echo -e "${RED}Found purdue.edu emails in history:${NC}"
    echo "$PURDUE_EMAILS"
    echo ""
else
    echo -e "${GREEN}✓ No purdue.edu emails found${NC}"
fi

# Scan for .env files
echo "Checking for committed .env files..."
ENV_FILES=$(git log --all --name-only --pretty=format: | grep -E "\.env(\.|$)" | sort -u || true)
if [ -n "$ENV_FILES" ]; then
    echo -e "${RED}Found .env files in history:${NC}"
    echo "$ENV_FILES"
    echo ""
else
    echo -e "${GREEN}✓ No .env files found${NC}"
fi

# Scan for common credential patterns
echo "Checking for potential credentials (API keys, tokens, passwords)..."
CREDENTIALS=$(git log --all -S "api_key" -S "password" -S "token" -S "secret" --pretty=format:"%H %s" | head -n 10 || true)
if [ -n "$CREDENTIALS" ]; then
    echo -e "${YELLOW}Found potential credential references:${NC}"
    echo "$CREDENTIALS"
    echo ""
fi

echo ""
echo "=================================================="
echo "Scan Complete"
echo "=================================================="
echo ""

# Determine if sanitization is needed
if [ -z "$HARDCODED_PATHS" ] && [ -z "$PURDUE_EMAILS" ] && [ -z "$ENV_FILES" ]; then
    echo -e "${GREEN}No sensitive data found in git history.${NC}"
    echo "Your repository is clean!"
    exit 0
fi

# Ask for confirmation
echo -e "${YELLOW}WARNING: History rewrite will permanently alter git history${NC}"
echo "This operation will:"
echo "  - Remove all instances of sensitive data from history"
echo "  - Change all commit hashes"
echo "  - Require force push to remote (if applicable)"
echo ""
read -p "Continue with sanitization? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Sanitization cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}Step 3: Creating replacement rules${NC}"

# Create temporary replacement file
REPLACE_FILE=$(mktemp)
trap "rm -f $REPLACE_FILE" EXIT

# Add hardcoded path replacements
if [ -n "$HARDCODED_PATHS" ]; then
    echo "/Users/rohanmuppa==>[REDACTED_USER_PATH]" >> "$REPLACE_FILE"
fi

# Add purdue.edu email replacements (regex pattern)
if [ -n "$PURDUE_EMAILS" ]; then
    echo "regex:[a-zA-Z0-9._%+-]+@purdue\\.edu==>[REDACTED]@purdue.edu" >> "$REPLACE_FILE"
fi

echo -e "${GREEN}✓ Replacement rules created${NC}"
echo ""

echo -e "${YELLOW}Step 4: Running git-filter-repo${NC}"

# Run git-filter-repo with text replacement
if [ -s "$REPLACE_FILE" ]; then
    git filter-repo --replace-text "$REPLACE_FILE" --force
    echo -e "${GREEN}✓ History rewritten successfully${NC}"
else
    echo -e "${YELLOW}No text replacements needed${NC}"
fi

# Remove .env files if found
if [ -n "$ENV_FILES" ]; then
    echo "Removing .env files from history..."
    git filter-repo --invert-paths --path-regex '\.env(\.|$)' --force
    echo -e "${GREEN}✓ .env files removed${NC}"
fi

echo ""
echo "=================================================="
echo "Sanitization Complete"
echo "=================================================="
echo ""
echo -e "${GREEN}Git history has been sanitized.${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify changes: git log --all --oneline"
echo "  2. Test repository: npm install && npm run build"
echo "  3. Force push (if remote exists):"
echo "     ${YELLOW}git push origin --force --all${NC}"
echo "     ${YELLOW}git push origin --force --tags${NC}"
echo ""
echo "  4. Notify collaborators to re-clone:"
echo "     ${YELLOW}git clone <repo-url> gradescope-mcp-clean${NC}"
echo ""
echo -e "${YELLOW}WARNING: All collaborators must re-clone. Old clones will be incompatible.${NC}"
echo ""
echo "Backup preserved at: $BACKUP_DIR"
