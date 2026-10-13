#!/usr/bin/env bash
# Noted – automatische Updates auf das neueste Release.
#
# Läuft auf dem Server im geklonten Repository (dort, wo docker-compose.yml liegt). Der Installer
# (scripts/install.sh) richtet dafür systemd ein: stündlich (noted-update.timer) und sofort, wenn im
# Admin-Bereich „Jetzt nach Updates suchen“ geklickt wird (noted-update.path). Von Hand: sudo noted-update
#
# Ein Release ist ein Git-Tag der Form vX.Y.Z (z. B. v1.4.0). Vorabversionen wie v1.4.0-beta werden ignoriert.
# Bei einem neuen Release:
#   1. Tag auschecken und das neue Image bauen – die laufende Version bleibt währenddessen erreichbar
#   2. Datenbank sichern (im Volume unter /data/backups, die letzten 10 bleiben erhalten)
#   3. Container austauschen und warten, bis die App antwortet
#   4. Startet die neue Version nicht: altes Image, alten Stand und – falls schon migriert – die Datenbank zurückholen
#
# Ein Release, das nicht startet, wird übersprungen, bis ein neueres erscheint. Schlägt nur das Bauen fehl
# (z. B. kurz kein Netz), wird es nach 6 Stunden erneut versucht.
#
# Optionen:
#   --check    nur nachsehen, ob es ein neues Release gibt
#   --retry    ein fehlgeschlagenes Release sofort erneut versuchen
#   --status   letzten Stand anzeigen
#   -q / -v    wenig bzw. ausführliche Ausgabe (Standard: ausführlich im Terminal, still unter Cron –
#              dann gibt es nur bei Fehlern eine Ausgabe, die Cron per Mail verschickt)
#
# Status und Protokolle liegen in .update/ und erscheinen in der App unter Administration → System.
# Anfragen aus dem Admin-Bereich legt die App als .update/requests/update ab (ACTION=check|retry).
# Anpassbar per Umgebungsvariable: NOTED_REMOTE (origin), NOTED_SERVICE (noted), NOTED_IMAGE (noted),
# NOTED_HEALTH_TIMEOUT (180 Sekunden), NOTED_RETRY_HOURS (6).
#
# Hinweis: Der gesamte Ablauf steckt in Funktionen, weil das Auschecken eines Tags diese Datei ersetzen kann.

REMOTE=${NOTED_REMOTE:-origin}
SERVICE=${NOTED_SERVICE:-noted}
IMAGE=${NOTED_IMAGE:-noted}
HEALTH_TIMEOUT=${NOTED_HEALTH_TIMEOUT:-180}
HEALTH_INTERVAL=${NOTED_HEALTH_INTERVAL:-3}
RETRY_HOURS=${NOTED_RETRY_HOURS:-6}
STATUS_KEYS=(CHECKED_AT STATE CURRENT LATEST UPDATED_AT FAILED_TAG FAILED_AT FAILED_STAGE MESSAGE)
HEALTH_JS='fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/api/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

usage() {
  sed -n '2,/^# Hinweis/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
}

# ---- Ausgabe und Protokoll -----------------------------------------------------

now() { date +%s; }

log() {
  local line
  line="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  printf '%s\n' "$line" >> "$HISTORY"
  [[ -n $IN_RUN ]] && printf '%s\n' "$line" >> "$RUN_LOG"
  (( VERBOSE )) && printf '%s\n' "$*"
  return 0
}

# Fehler landen immer auf stderr, damit Cron sie per Mail meldet
warn() {
  log "FEHLER: $*"
  (( VERBOSE )) || printf 'Noted-Update: %s\n' "$*" >&2
  return 0
}

# Befehl ausführen, Ausgabe ins Protokoll des Laufs
run() {
  log "\$ $*"
  if (( VERBOSE )); then
    "$@" 2>&1 | tee -a "$RUN_LOG"
    return "${PIPESTATUS[0]}"
  fi
  "$@" >> "$RUN_LOG" 2>&1
}

# shellcheck disable=SC2329 # wird über on_exit (trap) aufgerufen
trim_history() {
  if [[ -f $HISTORY ]] && (( $(wc -l < "$HISTORY") > 2000 )); then
    tail -n 1000 "$HISTORY" > "$HISTORY.tmp" && mv -f "$HISTORY.tmp" "$HISTORY"
  fi
}

# ---- Status (.update/status, Zeilen KEY=Wert – liest auch die App) -------------

load_status() {
  local line
  [[ -f $STATUS_FILE ]] || return 0
  while IFS= read -r line; do
    [[ $line =~ ^([A-Z_]+)=(.*)$ ]] && S[${BASH_REMATCH[1]}]=${BASH_REMATCH[2]}
  done < "$STATUS_FILE"
  local key
  for key in CHECKED_AT UPDATED_AT FAILED_AT; do
    [[ ${S[$key]:-} =~ ^[0-9]*$ ]] || S[$key]=''
  done
}

save_status() {
  local key value
  {
    for key in "${STATUS_KEYS[@]}"; do
      value=${S[$key]:-}
      value=${value//[$'\r\n\t']/ }
      printf '%s=%s\n' "$key" "${value:0:500}"
    done
  } > "$STATUS_FILE.tmp" && mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
}

clear_failed() {
  S[FAILED_TAG]=''
  S[FAILED_AT]=''
  S[FAILED_STAGE]=''
}

# fail_update <tag> <build|deploy> <meldung> [state]
fail_update() {
  S[FAILED_TAG]=$1
  S[FAILED_STAGE]=$2
  S[FAILED_AT]=$(now)
  S[MESSAGE]=$3
  S[STATE]=${4:-failed}
  UPDATING_TAG=''
  save_status
  warn "$3"
}

# shellcheck disable=SC2329 # trap … EXIT
on_exit() {
  if [[ -n ${UPDATING_TAG:-} ]]; then
    S[STATE]=error
    S[MESSAGE]="Update auf $UPDATING_TAG wurde abgebrochen – bitte den Zustand prüfen"
    save_status
    warn "${S[MESSAGE]}"
  fi
  [[ -n ${HISTORY:-} ]] && trim_history
}

# Anfrage aus dem Admin-Bereich abholen (die App darf nur diese Datei schreiben)
take_request() {
  local file="$STATE_DIR/requests/update" line by=''
  [[ -f $file ]] || return 0
  while IFS= read -r line; do
    case $line in
      ACTION=retry) RETRY=1 ;;
      BY=*) by=${line#BY=} ;;
    esac
  done < <(head -c 1024 "$file")
  rm -f "$file"
  by=${by//[^A-Za-z0-9._-]/}
  log "Im Admin-Bereich angestoßen${by:+ von $by}$( ((RETRY)) && printf ' (erneuter Versuch)')"
}

# Ordner für Anfragen: muss dem Benutzer der App im Container gehören (UID 1001, siehe Dockerfile)
ensure_request_dir() {
  local dir="$STATE_DIR/requests"
  [[ -d $dir ]] || mkdir -p "$dir" || return 0
  if [[ $(id -u) == 0 && $(stat -c %u "$dir") != 1001 ]]; then
    chown 1001:1001 "$dir" 2> /dev/null || true
  fi
}

# ---- Versionen -------------------------------------------------------------------

latest_tag() {
  git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1
}

# version_gt a b: ist a neuer als b?
version_gt() {
  [[ $1 != "$2" && $(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1) == "$1" ]]
}

# ---- Docker ------------------------------------------------------------------------

container_running() {
  local cid
  cid=$("${COMPOSE[@]}" ps -q "$SERVICE" 2>/dev/null) || return 1
  [[ -n $cid && $(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null) == true ]]
}

app_healthy() {
  container_running && "${COMPOSE[@]}" exec -T "$SERVICE" node -e "$HEALTH_JS" > /dev/null 2>&1
}

# Wartet, bis die App zweimal hintereinander antwortet (fängt Neustart-Schleifen ab)
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) ok=0
  log "Warte, bis die App antwortet (höchstens ${HEALTH_TIMEOUT} s) …"
  while (( SECONDS < deadline )); do
    sleep "$HEALTH_INTERVAL"
    if app_healthy; then
      (( ++ok >= 2 )) && return 0
    else
      ok=0
    fi
  done
  return 1
}

# Gibt den Pfad der Sicherung im Container aus (leer, wenn es noch keine Datenbank gibt)
make_backup() {
  local label="vor-$1" out='' ok=0
  if container_running; then
    out=$("${COMPOSE[@]}" exec -T "$SERVICE" node scripts/admin-cli.mjs backup "$label" 2>> "$RUN_LOG") && ok=1
  fi
  # App läuft nicht oder die Sicherung darin klappte nicht: mit dem neuen Image sichern
  if (( ! ok )); then
    out=$("${COMPOSE[@]}" run --rm --no-deps -T "$SERVICE" node scripts/admin-cli.mjs backup "$label" 2>> "$RUN_LOG") || return 1
  fi
  out=$(printf '%s\n' "$out" | tr -d '\r' | tail -n 1)
  [[ -z $out || $out == /* ]] || return 1
  printf '%s' "$out"
}

prune_images() {
  local tag
  docker image ls "$IMAGE" --format '{{.Tag}}' 2> /dev/null | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | head -n -3 |
    while read -r tag; do docker rmi "$IMAGE:$tag" > /dev/null 2>&1 || true; done
  docker image prune -f --filter 'label=org.opencontainers.image.title=noted' > /dev/null 2>&1 || true
}

restore_checkout() {
  if [[ -n $PREV_BRANCH ]]; then
    run git checkout --quiet "$PREV_BRANCH"
  else
    run git -c advice.detachedHead=false checkout --quiet --detach "$PREV_REF"
  fi
}

# ---- Ablauf --------------------------------------------------------------------------

rollback() {
  local tag=$1 had_prev=$2 backup=$3 from=$4
  warn "$tag startet nicht – rolle zurück"
  run "${COMPOSE[@]}" logs --no-color --tail 100 "$SERVICE"
  run "${COMPOSE[@]}" stop "$SERVICE"
  if (( ! had_prev )); then
    restore_checkout
    fail_update "$tag" deploy "$tag startet nicht, und es gibt keine vorherige Version zum Zurückrollen" error
    return
  fi
  run docker tag "$IMAGE:previous" "$IMAGE:latest"
  if [[ -n $backup ]] && ! run "${COMPOSE[@]}" run --rm --no-deps -T "$SERVICE" node scripts/admin-cli.mjs restore "$backup" --if-schema-changed; then
    warn "Datenbank konnte nicht aus $backup zurückgespielt werden"
  fi
  restore_checkout
  if run "${COMPOSE[@]}" up -d --no-build --force-recreate "$SERVICE" && wait_healthy; then
    fail_update "$tag" deploy "Update auf $tag fehlgeschlagen – läuft wieder mit ${from:-der vorherigen Version}" rolled_back
  else
    fail_update "$tag" deploy "Update auf $tag fehlgeschlagen, und die vorherige Version startet auch nicht – bitte manuell prüfen" error
  fi
}

install_release() {
  local tag=$1 from=${S[CURRENT]:-} commit backup had_prev=0
  IN_RUN=1
  : > "$RUN_LOG"
  UPDATING_TAG=$tag
  S[STATE]=updating
  S[MESSAGE]="Update auf $tag läuft …"
  save_status
  log "Installiere $tag (bisher: ${from:-unbekannt})"

  if [[ -n $(git status --porcelain --untracked-files=no 2> /dev/null) ]]; then
    fail_update "$tag" build "Lokale Änderungen im Repository verhindern das Update (git status prüfen)"
    return 1
  fi
  PREV_REF=$(git rev-parse HEAD)
  PREV_BRANCH=$(git symbolic-ref --quiet --short HEAD || true)
  if ! run git -c advice.detachedHead=false checkout --quiet --detach "refs/tags/$tag"; then
    fail_update "$tag" build "Release $tag konnte nicht ausgecheckt werden"
    return 1
  fi
  commit=$(git rev-parse --short=12 HEAD)

  # Bisheriges Image für ein mögliches Zurückrollen aufheben
  if docker image inspect "$IMAGE:latest" > /dev/null 2>&1 && run docker tag "$IMAGE:latest" "$IMAGE:previous"; then
    had_prev=1
  fi

  log "Baue $tag – die laufende Version bleibt so lange erreichbar …"
  if ! run env APP_VERSION="$tag" GIT_COMMIT="$commit" "${COMPOSE[@]}" build --pull "$SERVICE"; then
    restore_checkout
    fail_update "$tag" build "Bauen von $tag fehlgeschlagen (Details im Protokoll)"
    return 1
  fi
  run docker tag "$IMAGE:latest" "$IMAGE:$tag"

  log "Sichere die Datenbank …"
  if ! backup=$(make_backup "$tag"); then
    (( had_prev )) && run docker tag "$IMAGE:previous" "$IMAGE:latest"
    restore_checkout
    fail_update "$tag" build "Datenbanksicherung fehlgeschlagen – Update abgebrochen, die bisherige Version läuft weiter"
    return 1
  fi
  [[ -n $backup ]] && log "Sicherung: $backup"

  log "Starte $tag …"
  if run "${COMPOSE[@]}" up -d --no-build --force-recreate "$SERVICE" && wait_healthy; then
    UPDATING_TAG=''
    S[STATE]=ok
    S[CURRENT]=$tag
    S[UPDATED_AT]=$(now)
    S[MESSAGE]="Aktualisiert auf $tag"
    clear_failed
    save_status
    log "Fertig: $tag läuft."
    prune_images
    return 0
  fi
  rollback "$tag" "$had_prev" "$backup" "$from"
  return 1
}

check_and_update() {
  local out latest current
  log "Suche nach neuen Releases …"
  if ! out=$(git fetch --quiet --force --tags "$REMOTE" 2>&1); then
    S[CHECKED_AT]=$(now)
    S[STATE]=error
    S[MESSAGE]="Releases konnten nicht abgerufen werden (git fetch $REMOTE): ${out//$'\n'/ }"
    save_status
    warn "${S[MESSAGE]}"
    return 1
  fi
  latest=$(latest_tag || true)
  current=${S[CURRENT]:-}
  S[CHECKED_AT]=$(now)
  S[LATEST]=$latest

  if [[ -z $latest ]]; then
    S[STATE]=ok
    S[MESSAGE]='Noch kein Release vorhanden (Git-Tag vX.Y.Z)'
    save_status
    log "${S[MESSAGE]}"
    return 0
  fi

  if [[ -n $current ]] && ! version_gt "$latest" "$current"; then
    S[STATE]=ok
    S[MESSAGE]="Aktuell ($current)"
    clear_failed
    save_status
    log "Aktuell: $current"
    return 0
  fi

  if [[ ${S[FAILED_TAG]:-} == "$latest" ]] && (( ! RETRY )); then
    if [[ ${S[FAILED_STAGE]:-} == build ]] && (( $(now) - ${S[FAILED_AT]:-0} >= RETRY_HOURS * 3600 )); then
      log "Neuer Versuch mit $latest (Bauen schlug vor über $RETRY_HOURS Stunden fehl)"
    else
      save_status
      log "$latest wird übersprungen, weil es zuletzt fehlgeschlagen ist (erneut versuchen: $0 --retry)"
      return 0
    fi
  fi

  if (( CHECK_ONLY )); then
    S[MESSAGE]="Neues Release verfügbar: $latest"
    save_status
    log "${S[MESSAGE]}"
    return 0
  fi

  install_release "$latest"
}

preflight() {
  local missing=() cmd
  for cmd in git docker flock; do
    command -v "$cmd" > /dev/null 2>&1 || missing+=("$cmd")
  done
  if (( ${#missing[@]} )); then
    S[STATE]=error
    S[MESSAGE]="Benötigte Programme fehlen: ${missing[*]}"
    return 1
  fi
  if docker compose version > /dev/null 2>&1; then
    COMPOSE=(docker compose)
  else
    S[STATE]=error
    S[MESSAGE]='Docker Compose v2 („docker compose“) wird benötigt'
    return 1
  fi
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    S[STATE]=error
    S[MESSAGE]="$ROOT ist kein Git-Repository"
    return 1
  fi
}

main() {
  set -uo pipefail
  umask 022
  export PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  # Unter Cron nie auf Passwörter oder Rückfragen warten; Build-Ausgabe ohne Farbcodes
  export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes}"
  export BUILDKIT_PROGRESS=plain COMPOSE_ANSI=never

  VERBOSE=0 CHECK_ONLY=0 RETRY=0 SHOW_STATUS=0 IN_RUN='' UPDATING_TAG='' PREV_REF='' PREV_BRANCH=''
  [[ -t 1 ]] && VERBOSE=1
  local arg
  for arg in "$@"; do
    case $arg in
      --check) CHECK_ONLY=1 ;;
      --retry) RETRY=1 ;;
      --status) SHOW_STATUS=1 ;;
      -q | --quiet) VERBOSE=0 ;;
      -v | --verbose) VERBOSE=1 ;;
      -h | --help) usage; return 0 ;;
      *) printf 'Unbekannte Option: %s\n\n' "$arg" >&2; usage >&2; return 2 ;;
    esac
  done

  ROOT=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd) || return 1
  cd "$ROOT" || return 1
  STATE_DIR="$ROOT/.update"
  STATUS_FILE="$STATE_DIR/status"
  RUN_LOG="$STATE_DIR/last-run.log"
  HISTORY="$STATE_DIR/update.log"
  mkdir -p "$STATE_DIR" || return 1
  declare -gA S=()

  if (( SHOW_STATUS )); then
    if [[ -f $STATUS_FILE ]]; then cat "$STATUS_FILE"; else echo 'Noch kein Lauf.'; fi
    return 0
  fi

  exec 9> "$STATE_DIR/lock"
  if command -v flock > /dev/null 2>&1 && ! flock -n 9; then
    log 'Ein anderer Update-Lauf ist noch aktiv – nichts zu tun.'
    return 0
  fi
  trap on_exit EXIT
  trap 'exit 130' INT TERM

  load_status
  ensure_request_dir
  take_request
  if ! preflight; then
    S[CHECKED_AT]=$(now)
    save_status
    warn "${S[MESSAGE]}"
    return 1
  fi
  check_and_update
}

main "$@"; exit $?
