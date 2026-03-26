#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Run the sync-licence email campaign
# Uses the same SMTP credentials from .env but overrides template, CSV, and log
#
# Usage:
#   ./run_sync.sh             # send emails
#   ./run_sync.sh --preview   # preview only (no emails sent)
# ──────────────────────────────────────────────────────────────────────────────

CSV_FILE=sync_contacts.csv \
EMAIL_SUBJECT="New EP just dropped – available for sync" \
TEMPLATE_TEXT=templates/sync_email.txt \
TEMPLATE_HTML=templates/sync_email.html \
LOG_FILE=logs/sync_log.csv \
node emailer.js "$@"
