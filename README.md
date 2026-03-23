# Bulk Emailer

A Node.js bulk emailer that reads contacts from a CSV file and sends personalised emails via SMTP — with built-in anti-spam safeguards to protect your sender reputation.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# Edit .env — fill in SMTP_HOST, SMTP_USER, SMTP_PASS, FROM_EMAIL, etc.

# 3. Add your contacts
# Edit contacts.csv  (required column: email  |  optional: name, company, …)

# 4. Edit your email templates
# templates/email.txt   — plain-text version (required)
# templates/email.html  — HTML version (optional but recommended)

# 5. Preview first — no emails sent
npm run preview

# 6. Send
npm start
```

---

## CSV Format

```csv
email,name,company
alice@example.com,Alice Smith,Acme Corp
bob@example.com,Bob Jones,Widget Co
```

- **Required column:** `email`
- **Optional columns:** `name`, `company`, or any custom column
- All columns are available as `{{column_name}}` placeholders in templates
- Column headers are case-insensitive and trimmed automatically
- Files exported from Excel (with BOM) are handled correctly

---

## Templates

Use `{{placeholder}}` syntax anywhere in `.txt` or `.html` templates:

| Placeholder | Source |
|---|---|
| `{{name}}` | `name` column (falls back to email prefix) |
| `{{email}}` | `email` column |
| `{{company}}` | `company` column |
| `{{subject}}` | `EMAIL_SUBJECT` from `.env` |
| `{{unsubscribe_url}}` | `UNSUBSCRIBE_URL` from `.env` |
| `{{any_column}}` | Any column from your CSV |

---

## Anti-Spam Safeguards

| Feature | What it does |
|---|---|
| **Random per-email delay** | Waits 3–8 s (configurable) between sends — looks human, not a bot |
| **Batch breaks** | Pauses 5 min every 20 emails — avoids sudden volume spikes |
| **Daily / run send limit** | Hard cap on emails per run (`DAILY_LIMIT`) |
| **`List-Unsubscribe` header** | Required by Gmail & Yahoo for bulk senders — enables one-click unsubscribe |
| **`Precedence: bulk` header** | Signals a bulk mailing so auto-reply loops don't trigger |
| **Unique `Message-ID`** | Prevents deduplication issues across mail servers |
| **Multipart text + HTML** | Plain-text fallback is expected by spam filters; text-only HTML fails checks |
| **Personalisation** | Each email differs slightly — identical copies score higher in spam filters |
| **Skip-already-sent** | Resume interrupted runs — logs are checked so nobody gets emailed twice |
| **Single SMTP connection** | Reuses one pooled connection — parallel connections flag as spam |

### Additional recommendations (outside this tool)

1. **SPF** — Add a TXT DNS record authorising your sending server: `v=spf1 include:yourmailprovider.com ~all`
2. **DKIM** — Enable in your mail provider / server; provides cryptographic proof the email is from you
3. **DMARC** — Add `v=DMARC1; p=none; rua=mailto:you@domain.com` to start collecting reports
4. **Warm up your domain** — If your domain is new, start with 20–50/day and double every week
5. **Clean your list** — Remove bounces promptly; a high bounce rate (>2 %) harms sender score
6. **Use a subdomain for bulk mail** — Send from `news@yourdomain.com` or `noreply@yourdomain.com` to protect the root domain

---

## Configuration Reference (`.env`)

| Variable | Default | Description |
|---|---|---|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port (587 = STARTTLS, 465 = SSL) |
| `SMTP_SECURE` | `false` | `true` for port 465 |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password / App Password |
| `FROM_NAME` | — | Sender display name |
| `FROM_EMAIL` | — | Sender email address |
| `REPLY_TO` | `FROM_EMAIL` | Reply-To address |
| `EMAIL_SUBJECT` | — | Subject line (supports `{{placeholders}}`) |
| `TEMPLATE_TEXT` | `templates/email.txt` | Path to plain-text template |
| `TEMPLATE_HTML` | `templates/email.html` | Path to HTML template (leave blank for text-only) |
| `UNSUBSCRIBE_URL` | — | URL for unsubscribe link |
| `CSV_FILE` | `contacts.csv` | Path to contacts CSV |
| `DELAY_MIN_SEC` | `3` | Min seconds between emails |
| `DELAY_MAX_SEC` | `8` | Max seconds between emails |
| `BATCH_SIZE` | `20` | Emails per batch before a long pause |
| `BATCH_BREAK_SEC` | `300` | Seconds to pause between batches (5 min) |
| `DAILY_LIMIT` | `0` | Max emails per run (0 = no limit) |
| `LOG_FILE` | `logs/send_log.csv` | Output log path |

---

## Gmail / Google Workspace Notes

- You **must** use an [App Password](https://myaccount.google.com/apppasswords), not your real password
- Free Gmail: ~500 emails/day limit
- Google Workspace: up to 2,000/day
- Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`

## SendGrid / Mailgun / AWS SES

These transactional email services offer higher limits and better deliverability. Set their SMTP credentials in `.env` the same way. They also handle DKIM/SPF automatically on verified domains.
