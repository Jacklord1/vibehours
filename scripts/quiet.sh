#!/usr/bin/env bash
# Checks what the README says the running app does on the network, not on
# the source: runs the real app on a made-up home, once as a first run and
# once on a chosen source with every page opened, and fails if the app opens
# an internet socket. No SSH host is ticked, so `ssh` is never started.
#
# On Linux the app and everything it starts run under strace. On Windows
# (USERPROFILE set) Windows' own audit of connections is turned on, which
# needs an administrator, and the connections logged against electron.exe are
# counted by scripts/quiet-windows.ps1. There a deliberate connection is made
# first: if the audit does not show that one, nothing was watched.
#
# When it fails it prints where the connections went and, on Linux, the
# addresses Chromium asked for.
#
#   bash scripts/quiet.sh <scratch folder> [electron flags]
set -u
scratch="$1"
shift
flags=("$@")

node scripts/fake-home.js "$scratch/quiet-home" > /dev/null
mkdir -p "$scratch/quiet-first" "$scratch/quiet-main"
echo '{"version":2,"homeZone":"Australia/Brisbane","sources":[{"kind":"local"}],"planPrice":"$20"}' > "$scratch/quiet-main/settings.json"
wait='"new Promise((r) => setTimeout(r, 20000))"'
click() { echo "\"document.getElementById(\\\"$1\\\").click()\""; }
type='"(() => { const e = document.getElementById(\"plan-price\"); e.focus(); e.value = \"$100 helo wrld\"; e.dispatchEvent(new Event(\"input\", { bubbles: true })); })()"'
echo "[$(click choice-0), $wait]" > "$scratch/quiet-first.json"
echo "[$(click nav-time), $(click nav-tokens), $(click nav-agent), $(click nav-prompts), $(click nav-projects), $(click open-settings), $type, $wait]" > "$scratch/quiet-main.json"

# After a fresh `npm ci` the first start of `electron` fetches Electron
# itself from GitHub. That is the build's download, not the app's, so it is
# got out of the way before anything is watched.
node_modules/.bin/electron "${flags[@]}" --version > /dev/null 2>&1

bad=0
if [ -n "${USERPROFILE:-}" ]; then
  export USERPROFILE="$scratch/quiet-home"
  export HOME="$scratch/quiet-home"
  seen() { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/quiet-windows.ps1 -Since "$1"; }
  now() { powershell -NoProfile -Command "(Get-Date).ToString('o')"; }
  # Filtering Platform Connection: every connection, with the program that made it.
  auditpol //set //subcategory:"{0CCE9226-69AE-11D9-BED3-505054503030}" //success:enable //failure:enable > /dev/null \
    || { echo "the audit of connections could not be turned on, so nothing was watched"; exit 1; }
  since=$(now)
  ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e \
    "require('https').get('https://example.com', (r) => { r.resume(); r.on('end', () => process.exit(0)); }).on('error', () => process.exit(0))"
  sleep 5
  control=$(seen "$since" | grep -c .)
  echo "control: $control connections seen from a deliberate one"
  [ "$control" != "0" ] || { echo "the audit did not show a deliberate connection, so nothing was watched"; exit 1; }
  for run in quiet-first quiet-main; do
    since=$(now)
    node_modules/.bin/electron "${flags[@]}" scripts/shot.js "$scratch/$run.png" light "$scratch/$run" "$scratch/$run.json" 1080x900 2> /dev/null \
      | grep -q saved || { echo "$run: the app did not run to its picture"; bad=1; }
    sleep 5
    seen "$since" > "$scratch/$run.seen"
    hits=$(grep -c . "$scratch/$run.seen")
    echo "$run: $hits internet connections"
    if [ "$hits" != "0" ]; then
      sort "$scratch/$run.seen" | uniq -c
      bad=1
    fi
  done
  exit $bad
fi

for run in quiet-first quiet-main; do
  HOME="$scratch/quiet-home" strace -f -qq -e trace=connect,sendto,sendmsg,sendmmsg -o "$scratch/$run.trace" \
    node_modules/.bin/electron "${flags[@]}" --log-net-log="$scratch/$run.netlog" scripts/shot.js "$scratch/$run.png" light "$scratch/$run" "$scratch/$run.json" 1080x900 2> /dev/null \
    | grep -q saved || { echo "$run: the app did not run to its picture"; bad=1; }
  [ -s "$scratch/$run.trace" ] || { echo "$run: strace wrote nothing, so nothing was watched"; bad=1; }
  hits=$(grep -cE "AF_INET6?" "$scratch/$run.trace")
  echo "$run: $hits internet sockets"
  if [ "$hits" != "0" ]; then
    # Where to, and what Chromium says it asked for (no query strings).
    grep -E "AF_INET6?" "$scratch/$run.trace" | grep -oE "sin6?_port=htons\([0-9]+\)[^}]*" | sort | uniq -c
    grep -oE '"url":"https?://[^"?]*' "$scratch/$run.netlog" | sort | uniq -c
    bad=1
  fi
done
exit $bad
