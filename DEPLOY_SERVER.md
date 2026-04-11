# Server Deploy Runbook

Ez a projekt hibrid deployt használ:

- local gépen fejlesztés
- `git push`
- a home server a repóból húzza le a változást
- a stabil update út jelenleg SSH / remote script, nem a `/server` UI gomb

## Rövid válasz

Ezt használd:

```bash
cd /Users/indijanmac/Projects/arbiter
git push
ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh update
ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh status
ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh logs
```

## Miért ez a helyes út

A `/server` oldali `Update` gomb jelenleg törékeny, mert:

- a futó web processből indítja az update-et
- az update közben leállítja a webet is
- tehát a request saját magát lövi le futás közben

Ettől még a service sokszor visszajön, de a folyamat bizonytalanabb, mint az SSH-s update.

## Ajánlott deploy folyamat

### 1. Local ellenőrzés

```bash
cd /Users/indijanmac/Projects/arbiter
git status --short
git rev-parse HEAD
```

Jó állapot:

- a módosítások commitolva vannak
- tudod a local `HEAD` hash-t

### 2. Push

```bash
cd /Users/indijanmac/Projects/arbiter
git push
```

### 3. Remote update

```bash
cd /Users/indijanmac/Projects/arbiter
ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh update
```

Ez a serveren ezt csinálja:

- `git pull --ff-only`
- `pnpm install`
- `pnpm -C apps/web build`
- web + runner restart

### 4. Azonnali ellenőrzés

```bash
cd /Users/indijanmac/Projects/arbiter
ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh status
ARBITER_HOST=indijan@192.168.1.182 ./scripts/remote.sh logs
```

Jó állapot:

- `web: running`
- `runner: running`
- a `runner.out.log` végén új tickek mennek

## Hogyan ellenőrizd, hogy tényleg az új commit fut

### Saját gépen

```bash
cd /Users/indijanmac/Projects/arbiter
git rev-parse HEAD
```

### Serveren SSH-ban

```bash
cd /Users/indijan/Projects/arbiter
git rev-parse HEAD
git log --oneline -1
git status --short
```

Jó állapot:

- a server `HEAD` ugyanaz, mint localban
- a `git status --short` üres

Megjegyzés:

- nem a commit message számít
- a hash egyezés számít

## Ha az update után a runner nem jön vissza

SSH-ban a serveren:

```bash
cd /Users/indijan/Projects/arbiter
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" ./scripts/mba.sh start
./scripts/mba.sh status
tail -n 60 ~/.arbiter/logs/runner.out.log
tail -n 60 ~/.arbiter/logs/runner.err.log
```

## Ha a repo piszkos marad a serveren

Néha az update után ez marad:

```bash
M pnpm-lock.yaml
```

Takarítás:

```bash
cd /Users/indijan/Projects/arbiter
git restore pnpm-lock.yaml
git status --short
```

Ha a `status` üres, tiszta a worktree.

## Közvetlen SSH parancsok, ha nem a remote helperrel dolgozol

### Status

```bash
ssh indijan@192.168.1.182
cd /Users/indijan/Projects/arbiter
./scripts/mba.sh status
```

### Update

```bash
ssh indijan@192.168.1.182
cd /Users/indijan/Projects/arbiter
./scripts/mba.sh update
./scripts/mba.sh status
```

### Logs

```bash
ssh indijan@192.168.1.182
cd /Users/indijan/Projects/arbiter
./scripts/mba.sh logs
```

## Mit ne használj elsődleges deploy útnak

Jelenleg ne a `/server` oldali `Update` gomb legyen az elsődleges deploy mechanizmus.

Használható ellenőrzésre:

- status
- logok
- utolsó tick

Deployra jelenleg stabilabb:

- `git push`
- `./scripts/remote.sh update`

