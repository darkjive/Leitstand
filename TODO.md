# TODO

## Mögliche nächste Features

- Database Browser (SQLite/Postgres Quick Query)
- Docker Compose Manager (docker-compose.yml Support)
- Process Monitor (htop-style Übersicht)
- Cron Job Manager (crontab Editor)
- Environment Manager (.env File Editor mit Secret Detection)
- API Tester (Mini-Postman mit Saved Requests & History)

## Offene Tasks

- Test-Setup (Vitest) ergänzen (CI-Workflow steht: `.github/workflows/ci.yml`)
- Widgets vom Mount-Fetch-Pattern lösen: `react-hooks/set-state-in-effect` und
  `react-hooks/purity` sind in `eslint.config.js` auf `warn` gesetzt, weil jedes
  Widget im Effect synchron `loading` setzt (12 Warnungen). Danach wieder auf `error`.
