# Server Deploy

Ezt **a saját gépeden** futtasd.

## Kulcs

Ez a működő SSH key:

```bash
/Users/indijanmac/.ssh/arbiter_ed25519
```

## Frissítés

```bash
cd /Users/indijanmac/Projects/arbiter
git push
ARBITER_SSH_IDENTITY=/Users/indijanmac/.ssh/arbiter_ed25519 ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh update
```

## Ellenőrzés

```bash
cd /Users/indijanmac/Projects/arbiter
ARBITER_SSH_IDENTITY=/Users/indijanmac/.ssh/arbiter_ed25519 ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh status
ARBITER_SSH_IDENTITY=/Users/indijanmac/.ssh/arbiter_ed25519 ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh logs
```

Jó állapot:

- `web: running`
- `runner: running`
- `runner.out (tail)` végén új sorok vannak, pl.:
  - `runner starting`
  - `cron.ingest`
  - `cron.detect`
  - `tick done`

## Ha a runner nem fut

SSH-val lépj be a szerverre, és ott futtasd:

```bash
cd /Users/indijan/Projects/arbiter
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" ./scripts/mba.sh start
./scripts/mba.sh status
tail -n 60 ~/.arbiter/logs/runner.out.log
tail -n 60 ~/.arbiter/logs/runner.err.log
```

## Ha ellenőrizni akarod, hogy az új commit van-e fenn

Saját gépen:

```bash
cd /Users/indijanmac/Projects/arbiter
git rev-parse HEAD
```

Szerveren:

```bash
cd /Users/indijan/Projects/arbiter
git rev-parse HEAD
git status --short
```

Jó állapot:

- a két hash egyezik
- a szerveren a `git status --short` üres

