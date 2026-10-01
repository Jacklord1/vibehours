#!/usr/bin/env bash
# Takes the pictures a build is looked at by: the real app on made-up homes,
# every page, some dark, one narrow, one with names hidden, the share picture
# and a monthly card, and a home with transcripts and no prompt history.
#
#   HOME=<made-up home> bash scripts/pictures.sh <scratch folder> <out folder> [electron flags]
#
# The made-up homes are written under the scratch folder. HOME (USERPROFILE
# on Windows) must already point at <scratch folder>/home, so the app finds
# nothing real.
set -u
scratch="$1"
out="$2"
shift 2

node scripts/fake-home.js "$scratch/home"
node scripts/fake-home.js "$scratch/home-app" 120 120 desktop
mkdir -p "$out" "$scratch/first" "$scratch/main" "$scratch/hidden" "$scratch/app"
click() { echo "[\"document.getElementById(\\\"$1\\\").click()\"]" > "$scratch/$1.json"; }
for id in choice-0 open-settings nav-time nav-tokens nav-agent nav-prompts nav-projects share-open month-open; do click $id; done
echo '{"version":2,"homeZone":"Australia/Brisbane","sources":[{"kind":"local"}],"planPrice":"$20"}' > "$scratch/main/settings.json"
echo '{"version":2,"homeZone":"Australia/Brisbane","sources":[{"kind":"local"}],"hideNames":true}' > "$scratch/hidden/settings.json"
echo '{"version":2,"homeZone":"Australia/Brisbane","sources":[{"kind":"local"}]}' > "$scratch/app/settings.json"
shot() { node_modules/.bin/electron "${flags[@]}" scripts/shot.js "$out/$1.png" "$2" "$scratch/$3" "$4" "$5"; }
flags=("$@")

shot first-run light first "$scratch/choice-0.json" 1080x900
shot overview light main - 1080x1500
shot overview-wide dark main - 2400x1300
shot time dark main "$scratch/nav-time.json" 1080x1200
shot tokens light main "$scratch/nav-tokens.json" 1080x1500
shot agent dark main "$scratch/nav-agent.json" 1080x1400
shot prompts light main "$scratch/nav-prompts.json" 1320x1000
shot projects-narrow light main "$scratch/nav-projects.json" 520x800
shot projects-hidden dark hidden "$scratch/nav-projects.json" 920x700
shot settings dark main "$scratch/open-settings.json" 920x1100
# The share picture and a monthly card, as the window shows them and as they are saved.
SHOT_CANVAS="$out/share-picture.png" shot share light main "$scratch/share-open.json" 1080x900
SHOT_CANVAS="$out/month-card-picture.png" shot month-card dark main "$scratch/month-open.json" 1080x900

# A home with transcripts and no prompt history, as an app that keeps none leaves it.
if [ -n "${USERPROFILE:-}" ]; then export USERPROFILE="$scratch/home-app"; fi
export HOME="$scratch/home-app"
shot app-overview light app - 1080x1500
shot app-settings light app "$scratch/open-settings.json" 1080x800
shot app-prompts dark app "$scratch/nav-prompts.json" 1080x1000
