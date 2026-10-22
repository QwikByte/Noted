#!/usr/bin/env bash
# Noted – Domain anzeigen oder ändern (HTTPS mit Caddy).
#
#   sudo noted-domain                       aktuelle Domain anzeigen
#   sudo noted-domain neu.example.com       auf eine neue Domain umstellen (die alte wird abgeschaltet)
#
# Optionen:
#   --email ADRESSE   Kontaktadresse für Let's Encrypt (optional)
#   --yes             ohne Rückfrage
#   --force           DNS-Prüfung überspringen und nicht zurückrollen, wenn HTTPS noch nicht klappt
#                     (z. B. wenn die Domain erst später umgestellt wird oder hinter Cloudflare liegt)
#
# Ablauf: prüfen, ob die Domain auf diesen Server zeigt → den Noted-Eintrag in /etc/caddy/Caddyfile ersetzen
# (andere Einträge bleiben unberührt) → Caddy neu laden → warten, bis HTTPS für die neue Domain funktioniert
# → APP_URL setzen und Noted neu starten. Klappt HTTPS nicht, wird die vorherige Konfiguration
# wiederhergestellt – die alte Domain funktioniert dann weiter.
#
# Hinweis: Der gesamte Ablauf steckt in Funktionen (siehe auto-update.sh).

MARK_BEGIN='# >>> Noted – verwaltet von noted-domain, nicht von Hand ändern'
MARK_END='# <<< Noted'

usage() {
  sed -n '2,/^# Hinweis/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
}

say() { printf '%s\n' "$*"; }
step() { printf '• %s\n' "$*"; }
die() {
  printf 'Fehler: %s\n' "$*" >&2
  exit 1
}

valid_domain() {
  [[ $1 =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ && ${#1} -le 253 ]]
}

# ---- Caddyfile -------------------------------------------------------------------------

# Aktuelle Noted-Domain: aus dem verwalteten Eintrag oder APP_URL
current_domain() {
  local d=''
  if [[ -f $CADDYFILE ]]; then
    d=$(awk -v b="$MARK_BEGIN" '
      $0 == b { grab = 1; next }
      grab && /\{[[:space:]]*$/ { sub(/[[:space:]]*\{[[:space:]]*$/, ""); print; exit }
      grab { grab = 0 }' "$CADDYFILE")
  fi
  if [[ -z $d && -f $ENV_FILE ]]; then
    d=$(sed -n 's|^APP_URL=https\{0,1\}://\([^/]*\).*|\1|p' "$ENV_FILE" | tail -n 1)
  fi
  printf '%s' "$d"
}

# E-Mail aus dem bisherigen Noted-Eintrag (tls ADRESSE), damit sie beim Wechsel erhalten bleibt
current_email() {
  [[ -f $CADDYFILE ]] || return 0
  awk -v b="$MARK_BEGIN" -v e="$MARK_END" '
    $0 == b { inside = 1; next }
    $0 == e { inside = 0 }
    inside && $1 == "tls" && $2 ~ /@/ { print $2; exit }' "$CADDYFILE"
}

render_block() {
  printf '%s\n' "$MARK_BEGIN"
  printf '%s {\n' "$NEW"
  [[ -n $EMAIL ]] && printf '\ttls %s\n' "$EMAIL"
  printf '\treverse_proxy 127.0.0.1:3000\n}\n'
  printf '%s\n' "$MARK_END"
}

# Schreibt das neue Caddyfile nach $1: Noted-Eintrag ersetzen (bzw. anhängen), alles andere unverändert
build_caddyfile() {
  local out=$1 line state=normal written=0
  if [[ ! -s $CADDYFILE ]] || grep -q '/usr/share/caddy' "$CADDYFILE"; then
    # leer oder Beispielkonfiguration des Caddy-Pakets → ersetzen
    render_block > "$out"
    return
  fi
  {
    while IFS= read -r line || [[ -n $line ]]; do
      case $state in
        normal)
          if [[ $line != "$MARK_BEGIN" ]]; then
            printf '%s\n' "$line"
            continue
          fi
          state=managed
          if ((!written)); then render_block; written=1; fi
          ;;
        managed)
          [[ $line == "$MARK_END" ]] && state=normal
          ;;
      esac
    done < "$CADDYFILE"
    if ((!written)); then
      printf '\n'
      render_block
    fi
  } > "$out"
}

ensure_caddy() {
  command -v caddy > /dev/null && return 0
  step 'Caddy wird installiert …'
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -qq curl gnupg > /dev/null
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy > /dev/null
  command -v caddy > /dev/null || die 'Caddy ließ sich nicht installieren.'
}

# ---- Prüfungen -------------------------------------------------------------------------

# Zeigt die Domain auf diesen Server? (Adressen der Netzwerkschnittstellen, sonst öffentliche IP)
dns_points_here() {
  local resolved mine ip
  resolved=$(getent ahosts "$NEW" 2> /dev/null | awk '{print $1}' | sort -u)
  [[ -n $resolved ]] || return 2
  mine=$(ip -o addr show scope global 2> /dev/null | awk '{print $4}' | cut -d/ -f1)
  for ip in $resolved; do grep -qxF "$ip" <<< "$mine" && return 0; done
  # hinter NAT: öffentliche Adresse erfragen
  mine=$(
    curl -4 -fsS --max-time 5 https://api.ipify.org 2> /dev/null
    echo
    curl -6 -fsS --max-time 5 https://api64.ipify.org 2> /dev/null
  )
  for ip in $resolved; do grep -qxF "$ip" <<< "$mine" && return 0; done
  return 1
}

# Wartet, bis Caddy für die neue Domain ein gültiges Zertifikat ausliefert und Noted antwortet
wait_https() {
  local deadline=$((SECONDS + WAIT_SECONDS))
  while ((SECONDS < deadline)); do
    curl -fsS -o /dev/null --max-time 5 --resolve "$NEW:443:127.0.0.1" "https://$NEW/api/health" 2> /dev/null && return 0
    sleep "$WAIT_INTERVAL"
  done
  return 1
}

wait_app() {
  local _
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null --max-time 3 http://127.0.0.1:3000/api/health 2> /dev/null && return 0
    sleep "$WAIT_INTERVAL"
  done
  return 1
}

confirm() {
  local answer=''
  ((YES)) && return 0
  if [[ ! -t 0 ]]; then
    die 'Keine Rückfrage möglich – zum Bestätigen mit --yes aufrufen.'
  fi
  read -r -p 'Fortfahren? [j/N] ' answer
  [[ $answer =~ ^[jJyY] ]]
}

# Setzt KEY=Wert in .env (ersetzt eine vorhandene – auch auskommentierte – Zeile)
set_env() {
  local key=$1 value=$2
  touch "$ENV_FILE"
  if grep -qE "^#? *$key=" "$ENV_FILE"; then
    sed -i -E "s|^#? *$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

reload_caddy() {
  systemctl enable --quiet caddy 2> /dev/null || true
  systemctl reload-or-restart caddy
}

# ---- Ablauf ----------------------------------------------------------------------------

main() {
  set -uo pipefail
  umask 022
  NEW='' EMAIL='' YES=0 FORCE=0
  WAIT_SECONDS=${NOTED_HTTPS_WAIT:-120}
  WAIT_INTERVAL=${NOTED_WAIT_INTERVAL:-2}
  CADDYFILE=${NOTED_CADDYFILE:-/etc/caddy/Caddyfile}

  while (($#)); do
    case $1 in
      --email) EMAIL=${2:-}; shift ;;
      --yes | -y) YES=1 ;;
      --force) FORCE=1 ;;
      -h | --help) usage; return 0 ;;
      -*) printf 'Unbekannte Option: %s\n\n' "$1" >&2; usage >&2; return 2 ;;
      *) [[ -z $NEW ]] || die 'Bitte nur eine Domain angeben.'; NEW=$1 ;;
    esac
    shift
  done

  ROOT=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd) || return 1
  ENV_FILE="$ROOT/.env"
  local old
  old=$(current_domain)

  if [[ -z $NEW ]]; then
    if [[ -n $old ]]; then say "Aktuelle Domain: $old  (https://$old)"; else say 'Noch keine Domain eingerichtet – Noted ist nur lokal auf Port 3000 erreichbar.'; fi
    say ''
    say "Ändern: sudo noted-domain neu.example.com"
    return 0
  fi

  [[ $(id -u) == 0 ]] || die 'Bitte mit sudo ausführen.'
  # Eingabe wie „https://Notizen.Example.com/“ zulassen
  NEW=${NEW#http://}
  NEW=${NEW#https://}
  NEW=${NEW%%/*}
  NEW=${NEW%.}
  NEW=${NEW,,}
  valid_domain "$NEW" || die "Ungültige Domain: $NEW"
  if [[ -n $EMAIL ]]; then
    [[ $EMAIL =~ ^[^@[:space:]{}]+@[^@[:space:]{}]+\.[^@[:space:]{}]+$ ]] || die "Ungültige E-Mail-Adresse: $EMAIL"
  else
    EMAIL=$(current_email)
  fi

  if [[ $NEW == "$old" ]] && grep -qxF "$MARK_BEGIN" "$CADDYFILE" 2> /dev/null && [[ $EMAIL == "$(current_email)" ]]; then
    say "Noted läuft bereits unter https://$NEW – nichts zu tun."
    return 0
  fi

  if [[ -n $old && $old != "$NEW" ]]; then
    say "Noted wechselt von $old auf $NEW. Die alte Domain wird abgeschaltet."
    say ''
    say 'Danach:'
    say "  - unter https://$NEW neu anmelden (Anmeldungen gelten pro Domain)"
    say '  - die Handy-App einmal löschen und von der neuen Adresse neu installieren'
    say '  - Vorher jedes Gerät einmal online öffnen, damit offline geschriebene Änderungen'
    say "    hochgeladen sind – unter $old sind sie danach nicht mehr erreichbar."
    say ''
  else
    say "Noted wird unter https://$NEW eingerichtet."
  fi
  confirm || die 'Abgebrochen.'

  if ((!FORCE)); then
    dns_points_here
    case $? in
      0) step "$NEW zeigt auf diesen Server" ;;
      2) die "$NEW lässt sich nicht auflösen. DNS-Eintrag (A/AAAA) anlegen und erneut versuchen – oder mit --force trotzdem einrichten." ;;
      *) die "$NEW zeigt nicht auf diesen Server. DNS prüfen (A/AAAA-Eintrag) – liegt die Domain hinter einem Proxy wie Cloudflare, mit --force fortfahren." ;;
    esac
  fi

  ensure_caddy
  mkdir -p "$(dirname "$CADDYFILE")"
  local tmp backup=''
  tmp=$(mktemp "${CADDYFILE}.neu.XXXXXX")
  build_caddyfile "$tmp"
  if ! caddy validate --config "$tmp" --adapter caddyfile > /dev/null 2>&1; then
    rm -f "$tmp"
    die "Die neue Caddy-Konfiguration ist ungültig – $CADDYFILE bleibt unverändert."
  fi
  if [[ -f $CADDYFILE ]]; then
    backup="$CADDYFILE.vor-$(date +%Y%m%d-%H%M%S)"
    cp -p "$CADDYFILE" "$backup"
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$CADDYFILE"
  reload_caddy || {
    [[ -n $backup ]] && cp -p "$backup" "$CADDYFILE" && reload_caddy
    die 'Caddy ließ sich nicht neu laden – vorherige Konfiguration wiederhergestellt.'
  }
  step "Caddy umgestellt (Sicherung: ${backup:-keine})"

  if ((!FORCE)); then
    step "Warte auf das Zertifikat für $NEW (höchstens ${WAIT_SECONDS} s) …"
    if ! wait_https; then
      if [[ -n $backup ]]; then
        cp -p "$backup" "$CADDYFILE"
        reload_caddy
      fi
      die "HTTPS für $NEW funktioniert nicht (Zertifikat? Ports 80/443 erreichbar?). Vorherige Konfiguration wiederhergestellt${old:+ – Noted läuft weiter unter https://$old}. Protokoll: journalctl -u caddy"
    fi
    step "HTTPS für $NEW funktioniert"
  fi

  if command -v ufw > /dev/null && ufw status 2> /dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp > /dev/null && ufw allow 443/tcp > /dev/null
  fi

  set_env APP_URL "https://$NEW"
  (cd "$ROOT" && docker compose up -d --no-build --force-recreate noted > /dev/null 2>&1) || die 'Noted ließ sich nicht neu starten (cd '"$ROOT"' && docker compose logs noted).'
  wait_app || die "Noted antwortet nach dem Neustart nicht (cd $ROOT && docker compose logs noted)."
  step 'APP_URL gesetzt und Noted neu gestartet'
  say ''
  say "Fertig: Noted läuft unter https://$NEW"
  if ((FORCE)); then
    say "(Ohne Prüfung eingerichtet – das Zertifikat holt Caddy, sobald $NEW auf diesen Server zeigt.)"
  fi
}

main "$@"; exit $?
