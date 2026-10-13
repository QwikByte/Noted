#!/usr/bin/env bash
# Noted – Installer für Ubuntu und Debian.
#
#   sudo bash -c "$(curl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh)"
#
# Richtet ein:
#   - Docker Engine mit Compose (offizielle Paketquelle von Docker), falls noch nicht vorhanden
#   - Noted unter /opt/noted, gebaut aus dem neuesten Release
#   - automatische Updates: stündlich, sofort per Button unter Administration → System, von Hand mit „sudo noted-update“
#   - auf Wunsch HTTPS mit Caddy und Let's-Encrypt-Zertifikat für deine Domain
#
# Ohne Rückfragen, z. B.:
#   curl -fsSL …/install.sh | sudo bash -s -- --domain notizen.example.com --email du@example.com
#   curl -fsSL …/install.sh | sudo bash -s -- --no-https
#
# Rückfragen gibt es nur beim Start über „sudo bash -c …“: Bei „curl … | sudo bash“ kommen Tastatureingaben
# mit sudo-rs (Standard ab Ubuntu 25.10) nicht beim Skript an – dann wird nichts gefragt, sondern auf
# --domain hingewiesen.
#
# Optionen:
#   --domain NAME    HTTPS mit Caddy für diese Domain einrichten (muss bereits auf den Server zeigen)
#   --email ADRESSE  Kontaktadresse für Let's Encrypt (optional)
#   --no-https       keine Domain/HTTPS einrichten (App nur lokal auf 127.0.0.1:3000, z. B. für einen eigenen Proxy)
#   --dir PFAD       Installationsordner (Standard: /opt/noted)
#   --repo URL       Git-Repository (Standard: https://github.com/QwikByte/Noted.git)
#
# Erneut ausführen ist gefahrlos: Eine bestehende Installation wird nur ergänzt bzw. aktualisiert.
# Die komplette Ausgabe landet zusätzlich in /var/log/noted-install.log.

main() {
  set -euo pipefail

  REPO=${NOTED_REPO:-https://github.com/QwikByte/Noted.git}
  DIR=${NOTED_DIR:-/opt/noted}
  DOMAIN=''
  EMAIL=''
  HTTPS='ask'
  FRESH=0
  TEE_PID=''
  ADMIN_PW=''
  START_PW_PENDING=0
  ADMIN_USER='admin'
  LOG=/var/log/noted-install.log
  export GIT_TERMINAL_PROMPT=0

  while (($#)); do
    case $1 in
      --domain) DOMAIN=${2:-}; HTTPS=yes; shift ;;
      --email) EMAIL=${2:-}; shift ;;
      --no-https) HTTPS=no ;;
      --dir) DIR=${2:-}; shift ;;
      --repo) REPO=${2:-}; shift ;;
      -h | --help) sed -n '2,/^# Erneut/p' "${BASH_SOURCE[0]:-$0}" 2> /dev/null | sed 's/^# \{0,1\}//'; return 0 ;;
      *) die "Unbekannte Option: $1" ;;
    esac
    shift
  done

  if [[ $(id -u) == 0 ]]; then
    # Alles zusätzlich ins Protokoll schreiben (für die Fehlersuche)
    printf '\n===== %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
    exec > >(tee -a "$LOG") 2>&1
    TEE_PID=$!
  fi
  title 'Noted wird installiert'
  check_system
  install_packages
  install_docker
  fetch_code
  configure_env
  install_update_service
  first_start
  # Bereits mit Domain eingerichtet (erneuter Lauf) → so lassen
  EXISTING_URL=$(sed -n 's/^APP_URL=//p' "$DIR/.env" | tail -n 1)
  if [[ $HTTPS == ask && $EXISTING_URL == https://* ]]; then HTTPS=keep; fi
  if [[ $HTTPS == ask ]]; then ask_domain; fi
  if [[ $HTTPS == yes ]]; then setup_caddy; fi
  summary
  # Ausgabe abschließen und auf tee warten, damit nichts erst nach der Eingabeaufforderung erscheint
  if [[ -n $TEE_PID ]]; then
    exec > /dev/null 2>&1
    wait "$TEE_PID" 2> /dev/null || true
  fi
}

# ---- Ausgabe ---------------------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\e[1m' DIM=$'\e[2m' GREEN=$'\e[32m' YELLOW=$'\e[33m' RED=$'\e[31m' RESET=$'\e[0m'
else
  BOLD='' DIM='' GREEN='' YELLOW='' RED='' RESET=''
fi

title() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
step() { printf '%s•%s %s\n' "$GREEN" "$RESET" "$*"; }
note() { printf '%s! %s%s\n' "$YELLOW" "$*" "$RESET"; }
die() {
  printf '\n%sFehler: %s%s\n' "$RED" "$*" "$RESET" >&2
  [[ -n ${LOG:-} && -f $LOG ]] && printf 'Vollständiges Protokoll: %s\n' "$LOG" >&2
  exit 1
}

# Kann der Installer Rückfragen stellen? Nur wenn die Eingabe ein Terminal ist (Start über „sudo bash -c …“).
# Bei „curl … | sudo bash“ ist stdin das Skript selbst, und sudo-rs leitet die Tastatur nicht weiter.
can_ask() {
  [[ -t 0 ]] && { : < /dev/tty; } 2> /dev/null
}

# Rückfrage direkt am Terminal. Die Frage geht bewusst nicht durch tee (Protokoll): manche tee-Versionen,
# z. B. die Rust-Coreutils ab Ubuntu 25.10, halten Text ohne Zeilenumbruch zurück – sie wäre unsichtbar.
ask() {
  local prompt=$1 answer=''
  if can_ask; then
    printf '%s' "$prompt" > /dev/tty
    read -r answer < /dev/tty || true
    printf '%s%s\n' "$prompt" "$answer" >> "${LOG:-/dev/null}" 2> /dev/null || true
  fi
  printf '%s' "$answer"
}

# ---- Schritte ----------------------------------------------------------------------

check_system() {
  [[ $(id -u) == 0 ]] || die 'Bitte mit sudo bzw. als root ausführen.'
  [[ -r /etc/os-release ]] || die 'Unbekanntes System – unterstützt werden Ubuntu und Debian.'
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID=${ID:-}
  OS_CODENAME=${VERSION_CODENAME:-}
  case "$OS_ID ${ID_LIKE:-}" in
    *ubuntu* | *debian*) ;;
    *) die "Nicht unterstützt: ${PRETTY_NAME:-$OS_ID}. Unterstützt werden Ubuntu und Debian." ;;
  esac
  # Abgeleitete Systeme (z. B. Linux Mint, Raspberry Pi OS) nutzen die Docker-Quellen ihrer Basis
  if [[ $OS_ID != ubuntu && $OS_ID != debian ]]; then
    if [[ ${ID_LIKE:-} == *ubuntu* ]]; then
      OS_ID=ubuntu
      OS_CODENAME=${UBUNTU_CODENAME:-$OS_CODENAME}
    else
      OS_ID=debian
    fi
  fi
  [[ -n $OS_CODENAME ]] || die 'Konnte die Version des Systems nicht erkennen (VERSION_CODENAME fehlt).'
  command -v systemctl > /dev/null || die 'systemd wird benötigt.'
  # Next.js und die mitgelieferten Binärdateien gibt es nur für 64 Bit
  case $(uname -m) in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) die "Nicht unterstützte Prozessor-Architektur: $(uname -m). Noted braucht ein 64-Bit-System (x86_64 oder arm64)." ;;
  esac
  step "System: ${PRETTY_NAME:-$OS_ID} ($(uname -m))"
}

install_packages() {
  title 'Pakete'
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git gnupg util-linux > /dev/null
  step 'git, curl und Zertifikate sind installiert'
}

install_docker() {
  title 'Docker'
  if command -v docker > /dev/null && docker compose version > /dev/null 2>&1; then
    step "Docker ist schon da ($(docker --version | sed 's/,.*//'))"
  elif command -v docker > /dev/null; then
    # Docker aus den Paketen der Distribution: es fehlt nur Compose v2
    apt-get install -y -qq docker-compose-plugin > /dev/null 2>&1 || apt-get install -y -qq docker-compose-v2 > /dev/null 2>&1 ||
      die 'Docker ist installiert, aber Docker Compose v2 fehlt und ließ sich nicht nachinstallieren.'
    step 'Docker Compose nachinstalliert'
  else
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$OS_ID" "$OS_CODENAME" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null
    step "Docker installiert ($(docker --version | sed 's/,.*//'))"
  fi
  systemctl enable --now docker > /dev/null 2>&1 || true
  docker info > /dev/null 2>&1 || die 'Docker läuft nicht (systemctl status docker).'
}

fetch_code() {
  title 'Noted herunterladen'
  if [[ -d $DIR/.git ]]; then
    step "Vorhandene Installation in $DIR gefunden – wird ergänzt"
    git -C "$DIR" fetch --quiet --force --tags origin
  else
    [[ ! -e $DIR || -z $(ls -A "$DIR" 2> /dev/null) ]] || die "$DIR existiert bereits und ist nicht leer."
    git clone --quiet "$REPO" "$DIR" || die "$REPO ließ sich nicht herunterladen (Repository öffentlich? Netzwerk?)."
    FRESH=1
    step "Geklont nach $DIR"
  fi
  LATEST=$(git -C "$DIR" tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)
  if [[ -n $LATEST ]]; then
    # Bei einer neuen Installation gleich den Stand des Releases nehmen (Konfigurationsvorlagen usw.)
    if ((FRESH)); then git -C "$DIR" -c advice.detachedHead=false checkout --quiet --detach "refs/tags/$LATEST"; fi
    step "Neuestes Release: $LATEST"
  else
    note 'Noch kein Release vorhanden – es wird der aktuelle Entwicklungsstand installiert.'
  fi
}

configure_env() {
  title 'Konfiguration'
  if [[ ! -f $DIR/.env ]]; then
    cp "$DIR/.env.example" "$DIR/.env"
    chmod 600 "$DIR/.env"
    step "$DIR/.env angelegt"
  else
    step "$DIR/.env bleibt unverändert"
  fi
  mkdir -p "$DIR/.update/requests"
  chown 1001:1001 "$DIR/.update/requests"
}

# Setzt KEY=Wert in .env (ersetzt eine vorhandene – auch auskommentierte – Zeile)
set_env() {
  local key=$1 value=$2 file="$DIR/.env"
  if grep -qE "^#? *$key=" "$file"; then
    sed -i -E "s|^#? *$key=.*|$key=$value|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

install_update_service() {
  title 'Automatische Updates'
  cat > /etc/systemd/system/noted-update.service << EOF
[Unit]
Description=Noted: auf neue Releases prüfen und installieren
Documentation=file://$DIR/README.md
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$DIR/scripts/auto-update.sh -q
TimeoutStartSec=1h
EOF
  cat > /etc/systemd/system/noted-update.timer << 'EOF'
[Unit]
Description=Noted: stündlich auf neue Releases prüfen

[Timer]
OnCalendar=hourly
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/noted-update.path << EOF
[Unit]
Description=Noted: Update-Anfrage aus dem Admin-Bereich

[Path]
PathExists=$DIR/.update/requests/update
Unit=noted-update.service

[Install]
WantedBy=paths.target
EOF
  ln -sf "$DIR/scripts/auto-update.sh" /usr/local/bin/noted-update
  systemctl daemon-reload
  systemctl enable --quiet noted-update.timer noted-update.path
  step 'stündlich per systemd-Timer, sofort per Button unter Administration → System'
  step 'von Hand: sudo noted-update   (Status: sudo noted-update --status)'
}

first_start() {
  title 'Bauen und starten (dauert beim ersten Mal einige Minuten)'
  if [[ -n $LATEST ]]; then
    # --retry: ein beim letzten Versuch fehlgeschlagenes Release nicht überspringen
    "$DIR/scripts/auto-update.sh" -v --retry || die "Installation fehlgeschlagen – Protokoll: $DIR/.update/last-run.log"
  else
    (cd "$DIR" && docker compose up -d --build) || die 'Bauen fehlgeschlagen.'
  fi
  local _
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null http://127.0.0.1:3000/api/health && break
    sleep 2
  done
  curl -fsS -o /dev/null http://127.0.0.1:3000/api/health || die "Noted antwortet nicht (cd $DIR && docker compose logs noted)."
  systemctl start noted-update.timer noted-update.path
  step 'Noted läuft auf 127.0.0.1:3000'
  read_start_password
}

# Beim allerersten Start erzeugt Noted ein Admin-Passwort und schreibt es ins Log. Anzeigen, solange es
# noch gilt (Konto hat noch das Startpasswort) – auch wenn ein früherer Installationsversuch abgebrochen ist.
read_start_password() {
  local user list
  user=$(sed -n 's/^ADMIN_USERNAME=//p' "$DIR/.env" | tail -n 1)
  user=${user:-admin}
  list=$(cd "$DIR" && docker compose exec -T noted node scripts/admin-cli.mjs list 2> /dev/null) || return 0
  grep -qE "^$user +.*Startpasswort" <<< "$list" || return 0
  START_PW_PENDING=1
  ADMIN_USER=$user
  ADMIN_PW=$(cd "$DIR" && docker compose logs --no-color noted 2> /dev/null | sed -n 's/.*Passwort: *\([^ ]*\)$/\1/p' | tail -n 1 || true)
}

ask_domain() {
  title 'HTTPS'
  if ! can_ask; then
    note 'Keine Rückfrage möglich (Installer über eine Pipe gestartet) – HTTPS wird jetzt nicht eingerichtet.'
    printf 'Mit Domain erneut starten:\n  curl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh | sudo bash -s -- --domain DEINE.DOMAIN\n'
    HTTPS=no
    return
  fi
  printf 'Für die Nutzung unterwegs braucht Noted eine Domain mit HTTPS (z. B. notizen.example.com).\n'
  printf 'Die Domain muss schon auf diesen Server zeigen und die Ports 80 und 443 müssen erreichbar sein.\n'
  DOMAIN=$(ask 'Domain (leer lassen = kein HTTPS, nur lokal auf Port 3000): ')
  DOMAIN=${DOMAIN// /}
  if [[ -n $DOMAIN ]]; then
    HTTPS=yes
    [[ -n $EMAIL ]] || EMAIL=$(ask "E-Mail für Let's Encrypt (optional): ")
  else
    HTTPS=no
  fi
}

setup_caddy() {
  [[ $DOMAIN =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && $DOMAIN == *.* ]] || die "Ungültige Domain: $DOMAIN"
  title "HTTPS für $DOMAIN"
  if ! command -v caddy > /dev/null; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy > /dev/null
    step 'Caddy installiert'
  fi
  local file=/etc/caddy/Caddyfile block
  block="# Noted (eingerichtet von install.sh)
$DOMAIN {
	reverse_proxy 127.0.0.1:3000
}"
  if [[ -n $EMAIL ]]; then
    block="{
	email $EMAIL
}

$block"
  fi
  if [[ ! -s $file ]] || grep -q '/usr/share/caddy' "$file"; then
    # Beispielkonfiguration des Pakets ersetzen
    printf '%s\n' "$block" > "$file"
  elif ! grep -qE "^${DOMAIN//./\\.}[[:space:]]*\\{" "$file"; then
    cp "$file" "$file.vor-noted"
    printf '\n# Noted (eingerichtet von install.sh)\n%s {\n\treverse_proxy 127.0.0.1:3000\n}\n' "$DOMAIN" >> "$file"
    note "Bestehende Caddy-Konfiguration ergänzt (Sicherung: $file.vor-noted)"
  fi
  caddy validate --config "$file" --adapter caddyfile > /dev/null 2>&1 || die "Caddy-Konfiguration ungültig: $file"
  systemctl enable --quiet caddy
  systemctl reload-or-restart caddy
  if command -v ufw > /dev/null && ufw status 2> /dev/null | grep -q 'Status: active'; then
    ufw allow 80/tcp > /dev/null && ufw allow 443/tcp > /dev/null
    step 'Firewall (ufw): Ports 80 und 443 geöffnet'
  fi
  set_env APP_URL "https://$DOMAIN"
  (cd "$DIR" && docker compose up -d --no-build > /dev/null 2>&1) # neue APP_URL übernehmen
  step "Caddy leitet https://$DOMAIN an Noted weiter"
  step 'Das Zertifikat holt Caddy automatisch, sobald die Domain auf diesen Server zeigt'
}

summary() {
  local url='http://127.0.0.1:3000'
  if [[ $HTTPS == yes ]]; then url="https://$DOMAIN"; elif [[ $HTTPS == keep ]]; then url=$EXISTING_URL; fi
  title "${GREEN}Fertig!${RESET}${BOLD} Noted ist installiert"
  printf '\n  Adresse:        %s\n' "$url"
  if [[ -n $ADMIN_PW ]]; then
    printf '  Benutzername:   %s\n  Passwort:       %s%s%s  (bei der ersten Anmeldung ändern)\n' "$ADMIN_USER" "$BOLD" "$ADMIN_PW" "$RESET"
  elif ((START_PW_PENDING)); then
    printf '  Anmeldung:      %s – neues Startpasswort: cd %s && docker compose exec noted node scripts/admin-cli.mjs reset-password %s\n' "$ADMIN_USER" "$DIR" "$ADMIN_USER"
  else
    printf '  Anmeldung:      mit deinem bestehenden Admin-Konto\n'
  fi
  if [[ $HTTPS == no ]]; then
    printf '\n  %sOhne HTTPS ist Noted nur auf dem Server selbst erreichbar. HTTPS später einrichten:%s\n' "$DIM" "$RESET"
    printf '  %scurl -fsSL https://github.com/QwikByte/Noted/releases/latest/download/install.sh | sudo bash -s -- --domain DEINE.DOMAIN%s\n' "$DIM" "$RESET"
  fi
  printf '\n  Updates:        stündlich automatisch, sofort unter Administration → System oder mit „sudo noted-update“\n'
  printf '  Daten:          Docker-Volume, Sicherungen vor jedem Update unter /data/backups\n'
  printf '  Notfall:        cd %s && docker compose exec noted node scripts/admin-cli.mjs reset-mfa admin\n\n' "$DIR"
}

main "$@"; exit $?
