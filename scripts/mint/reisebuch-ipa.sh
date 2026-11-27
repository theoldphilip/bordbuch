#!/usr/bin/env bash
# Reisebuch-IPA: holt die neueste signierte IPA aus dem Repository, prüft die SHA-256-Prüfsumme
# und installiert sie per USB auf dem iPhone (Linux Mint, libimobiledevice).
#
# Benötigt: gh (angemeldet mit `gh auth login`), curl, python3, sha256sum, zenity,
#           ideviceinstaller, libimobiledevice-utils (idevice_id, idevicepair, ideviceinfo).
#   sudo apt install gh curl zenity ideviceinstaller libimobiledevice-utils usbmuxd
#
# Aufruf:
#   reisebuch-ipa.sh                Fenster: laden, prüfen, auf Knopfdruck installieren
#   reisebuch-ipa.sh --terminal     dasselbe ohne Fenster, Rückfragen im Terminal
#   reisebuch-ipa.sh --nur-laden    nur laden und prüfen, nichts installieren
#   reisebuch-ipa.sh --einrichten   Eintrag „Reisebuch-IPA“ im Startmenü anlegen
#
# Das GitHub-Token kommt aus `gh auth token` (oder der Umgebungsvariablen GH_TOKEN) und wird nirgends gespeichert.
# Ablage der Downloads: ~/Downloads/Reisebuch/<Version>-b<Build>/

# shellcheck disable=SC1111  # deutsche Anführungszeichen sind gewollt
set -euo pipefail

REPO="theoldphilip/bordbuch"
BRANCH="main"
IPA_DIR="ios/Installation"
BUNDLE_ID="de.theoldphilip.Reisebuch"
CACHE="${HOME}/Downloads/Reisebuch"
TITLE="Reisebuch-IPA"

MODE="gui"
ONLY_DOWNLOAD=0
for arg in "$@"; do
  case "$arg" in
    --terminal) MODE="tty" ;;
    --nur-laden) ONLY_DOWNLOAD=1; MODE="tty" ;;
    --einrichten) MODE="setup" ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $arg (siehe --help)" >&2; exit 2 ;;
  esac
done
if [[ "$MODE" == "gui" ]] && { ! command -v zenity >/dev/null || [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; }; then
  MODE="tty"
fi

# ---------- Ausgabe: Fenster oder Terminal ----------
info() {
  if [[ "$MODE" == "gui" ]]; then zenity --info --title="$TITLE" --width=420 --text="$1" 2>/dev/null || true
  else printf '%s\n' "$1"; fi
}
fail() {
  if [[ "$MODE" == "gui" ]]; then zenity --error --title="$TITLE" --width=460 --text="$1" 2>/dev/null || true
  else printf 'FEHLER: %s\n' "$1" >&2; fi
  exit 1
}
# ask "Frage" "Ja-Knopf" → 0 bei Ja
ask() {
  if [[ "$MODE" == "gui" ]]; then
    zenity --question --title="$TITLE" --width=460 --text="$1" --ok-label="$2" --cancel-label="Abbrechen" 2>/dev/null
  else
    local answer
    printf '%s\n%s? [j/N] ' "$1" "$2"
    read -r answer
    [[ "$answer" == [jJyY]* ]]
  fi
}
# busy "Text" Befehl… → führt den Befehl aus, im Fenster mit Fortschrittsbalken; Rückgabe = Exit-Code des Befehls
busy() {
  local text="$1"; shift
  if [[ "$MODE" == "gui" ]]; then
    local rc_file; rc_file="$(mktemp)"
    ( "$@"; echo $? >"$rc_file" ) | zenity --progress --pulsate --auto-close --no-cancel \
      --title="$TITLE" --width=420 --text="$text" 2>/dev/null || true
    local rc; rc="$(cat "$rc_file")"; rm -f "$rc_file"
    return "${rc:-1}"
  else
    printf '%s\n' "$text"
    "$@"
  fi
}

# ---------- Einrichten: Startmenü-Eintrag ----------
if [[ "$MODE" == "setup" ]]; then
  target="${HOME}/.local/bin/reisebuch-ipa.sh"
  mkdir -p "${HOME}/.local/bin" "${HOME}/.local/share/applications"
  if [[ "$(readlink -f "$0")" != "$(readlink -f "$target" 2>/dev/null || true)" ]]; then
    install -m 755 "$0" "$target"
  fi
  cat >"${HOME}/.local/share/applications/reisebuch-ipa.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Reisebuch-IPA
Comment=Neueste Reisebuch-App laden, prüfen und aufs iPhone installieren
Exec=${target}
Icon=phone
Terminal=false
Categories=Utility;
EOF
  echo "Eingerichtet: ${target}"
  echo "Startmenü-Eintrag „Reisebuch-IPA“ angelegt (ggf. einmal ab- und anmelden)."
  exit 0
fi

# ---------- Voraussetzungen ----------
missing=()
for cmd in gh curl python3 sha256sum; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
if [[ "$ONLY_DOWNLOAD" -eq 0 ]]; then
  for cmd in ideviceinstaller idevice_id idevicepair ideviceinfo; do command -v "$cmd" >/dev/null || missing+=("$cmd"); done
fi
if ((${#missing[@]})); then
  fail "Es fehlen Programme: ${missing[*]}

Installieren mit:
sudo apt install gh curl python3 ideviceinstaller libimobiledevice-utils usbmuxd zenity"
fi

TOKEN="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
[[ -n "$TOKEN" ]] || fail "Nicht bei GitHub angemeldet. Einmal im Terminal ausführen:

gh auth login"

api() {   # api <Pfad im Repo> [raw]
  local accept="application/vnd.github+json"
  [[ "${2:-}" == raw ]] && accept="application/vnd.github.raw"
  curl -fsSL --retry 2 -H "Authorization: Bearer ${TOKEN}" -H "Accept: ${accept}" \
    "https://api.github.com/repos/${REPO}/contents/$1?ref=${BRANCH}"
}

# ---------- Neueste Version finden ----------
listing="$(api "$IPA_DIR")" || fail "GitHub nicht erreichbar oder kein Zugriff auf ${REPO}.
Internet prüfen, notfalls neu anmelden: gh auth login"

latest="$(python3 -c '
import json, re, sys
names = [x["name"] for x in json.load(sys.stdin)
         if x.get("type") == "dir" and re.fullmatch(r"\d+\.\d+\.\d+-b\d+", x["name"])]
names.sort(key=lambda n: tuple(int(p) for p in re.findall(r"\d+", n)))
print(names[-1] if names else "")
' <<<"$listing")"
[[ -n "$latest" ]] || fail "Im Repository liegt unter ${IPA_DIR} noch keine IPA."

version="${latest%-b*}"
build="${latest##*-b}"
dir="${CACHE}/${latest}"
ipa_name="Reisebuch-${latest}.ipa"
mkdir -p "$dir"

# ---------- Laden und prüfen ----------
download() {
  api "${IPA_DIR}/${latest}/SHA256.txt" raw >"${dir}/SHA256.txt.neu" &&
  api "${IPA_DIR}/${latest}/${ipa_name}" raw >"${dir}/${ipa_name}.neu" &&
  mv "${dir}/SHA256.txt.neu" "${dir}/SHA256.txt" &&
  mv "${dir}/${ipa_name}.neu" "${dir}/${ipa_name}"
}
check() { (cd "$dir" && sha256sum --check --status SHA256.txt); }

if [[ -f "${dir}/${ipa_name}" && -f "${dir}/SHA256.txt" ]] && check; then
  loaded="schon vorhanden"
else
  busy "Lade Reisebuch ${version} (Build ${build}) …" download ||
    { rm -f "${dir}"/*.neu; fail "Download von ${latest} fehlgeschlagen."; }
  loaded="neu geladen"
fi

grep -q " ${ipa_name}\$" "${dir}/SHA256.txt" ||
  fail "SHA256.txt nennt nicht ${ipa_name}. Bitte den Ordner ${IPA_DIR}/${latest} im Repository prüfen."
if ! check; then
  mv "${dir}/${ipa_name}" "${dir}/${ipa_name}.ungueltig"
  fail "Prüfsumme stimmt NICHT. Die Datei wurde nicht installiert und in
${dir}/${ipa_name}.ungueltig umbenannt."
fi
sum="$(cut -c1-12 "${dir}/SHA256.txt")"

if [[ "$ONLY_DOWNLOAD" -eq 1 ]]; then
  info "Reisebuch ${version} (Build ${build}) ${loaded}, Prüfsumme stimmt (${sum}…).
Datei: ${dir}/${ipa_name}"
  exit 0
fi

# ---------- iPhone finden ----------
while :; do
  udid="$(idevice_id -l 2>/dev/null | head -n1 || true)"
  if [[ -z "$udid" ]]; then
    ask "Kein iPhone gefunden.

iPhone per USB-Kabel anschließen und entsperren." "Erneut suchen" || exit 0
    continue
  fi
  if ! idevicepair -u "$udid" validate >/dev/null 2>&1; then
    idevicepair -u "$udid" pair >/dev/null 2>&1 || true
    ask "Das iPhone muss diesem Rechner vertrauen.

Auf dem iPhone „Vertrauen“ tippen und den Code eingeben, dann hier weiter." "Weiter" || exit 0
    continue
  fi
  break
done

device="$(ideviceinfo -u "$udid" -k DeviceName 2>/dev/null || echo iPhone)"
ios="$(ideviceinfo -u "$udid" -k ProductVersion 2>/dev/null || echo ?)"
current="$(ideviceinstaller -u "$udid" -l 2>/dev/null | grep -F "${BUNDLE_ID}," | head -n1 | cut -d, -f2 | tr -d '" ' || true)"
if [[ -n "$current" ]]; then current="Reisebuch installiert (${current})"; else current="Reisebuch nicht installiert"; fi

# ---------- Knopfdruck ----------
ask "Neueste Version: Reisebuch ${version} (Build ${build}), ${loaded}
Prüfsumme stimmt (${sum}…)

Gerät: ${device} (iOS ${ios})
Auf dem Gerät: ${current}

Jetzt installieren?" "Installieren" || exit 0

log="${dir}/installation.log"
install_ipa() { ideviceinstaller -u "$udid" -i "${dir}/${ipa_name}" >"$log" 2>&1; }

if busy "Installiere Reisebuch ${version} auf ${device} …
iPhone entsperrt lassen." install_ipa && ! grep -qiE '^ERROR|error:' "$log"; then
  info "Fertig: Reisebuch ${version} (Build ${build}) ist auf ${device} installiert."
else
  fail "Installation fehlgeschlagen. Letzte Meldungen:

$(tail -n 6 "$log")

Häufige Ursachen: iPhone gesperrt, Gerät nicht im Ad-hoc-Profil, Profil abgelaufen."
fi
