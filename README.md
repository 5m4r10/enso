# Ensō

Personal project tracker for a single user. PWA (GitHub Pages) + Apps Script API + Google Sheets + Google Calendar.

```
web/      PWA (static, no build). domain.js is the single source of business rules.
gas/      Apps Script project (clasp). Domain.js is GENERATED, do not edit.
scripts/  sync-domain.ps1: copies web/domain.js to gas/Domain.js and runs clasp push.
test/     node --test (Node 22+)
design/   approved mockups and renders (fictional data)
```

## Deploy

**PWA.** Every push to `main` runs the tests and publishes `web/` (`.github/workflows/pages.yml`).
Pages source must be "GitHub Actions". Browsers may cache files for up to 10 minutes.

**OAuth client** (Google Cloud, type Web application). Authorized JavaScript origins, no path, no redirect URIs:
the Pages origin (`https://<user>.github.io`), plus `http://localhost` and `http://localhost:8123` for local use.
The client id goes in `web/config.js` and in `meta.client_id` of the spreadsheet (they must match).
In testing mode the owner must be listed as a test user.

**Backend** (PowerShell, clasp 3, from the repo root; `gas/.clasp.json` is local and not committed):

```powershell
.\scripts\sync-domain.ps1
clasp list-deployments -P gas
clasp update-deployment -P gas <DEPLOYMENT_ID> --description "what changed"
```

`update-deployment` keeps the URL. First time: run `setup()` in the Apps Script editor, then fill `owner_email` and
`client_id` in the `meta` sheet. Access is "Anyone"; every request is authorized by its Google ID token.

## Local

`python -m http.server 8123 --bind 127.0.0.1`, then `http://localhost:8123/web/?mock=1` (in-memory data, no sign-in).

## Security notes

No secrets live in this repository: the API URL and the OAuth client id are public by design. Vault contents are
encrypted in the browser (AES-256-GCM, PBKDF2) and the passphrase never leaves it.
