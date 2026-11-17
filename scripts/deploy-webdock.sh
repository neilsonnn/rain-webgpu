#!/usr/bin/env bash
set -Eeuo pipefail

# No secrets are printed or stored in the repository. No live files are mirrored/deleted.
for name in WEBDOCK_HOST WEBDOCK_USER WEBDOCK_SSH_KEY WEBDOCK_KNOWN_HOSTS WEBDOCK_DEPLOY_PATH GITHUB_SHA GITHUB_RUN_ID GITHUB_RUN_ATTEMPT; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing deployment setting: %s\n' "$name" >&2
    exit 1
  fi
done
[[ "$WEBDOCK_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid SSH hostname' >&2; exit 1; }
[[ "$WEBDOCK_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo 'Invalid SSH username' >&2; exit 1; }
port="${WEBDOCK_SSH_PORT:-22}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( 10#$port >= 1 && 10#$port <= 65535 )) || { echo 'Invalid SSH port' >&2; exit 1; }
root="${WEBDOCK_DEPLOY_PATH%/}"
[[ "$root" =~ ^/[a-zA-Z0-9_./-]+$ && "$root" != '/' ]] || { echo 'Use an absolute deployment directory without spaces' >&2; exit 1; }
case "$root/" in *'/../'*|*'/./'*) echo 'Deployment path must not contain traversal components' >&2; exit 1;; esac
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$GITHUB_RUN_ID" =~ ^[0-9]+$ && "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]] || { echo 'Invalid GitHub release identifiers' >&2; exit 1; }
activate="${WEBDOCK_ACTIVATE:-false}"
[[ "$activate" == 'true' || "$activate" == 'false' ]] || { echo 'Invalid activation flag' >&2; exit 1; }
[[ -f neilsonks/dist/index.html && -d neilsonks/dist/assets ]] || { echo 'Build the site before deploying' >&2; exit 1; }
for command in ssh rsync ssh-keygen python3 curl; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done

release="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
chmod 700 "$temporary"
printf '%s\n' "$WEBDOCK_SSH_KEY" > "$temporary/key"
printf '%s\n' "$WEBDOCK_KNOWN_HOSTS" > "$temporary/known_hosts"
chmod 600 "$temporary/key" "$temporary/known_hosts"
ssh-keygen -y -P '' -f "$temporary/key" >/dev/null
ssh_options=(-i "$temporary/key" -p "$port" -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$temporary/known_hosts" -o ConnectTimeout=15)
target="$WEBDOCK_USER@$WEBDOCK_HOST"
remote_action() {
  ssh "${ssh_options[@]}" "$target" "python3 - '$root' '$1' '$release'" < scripts/webdock-release.py
}

# Stage only into a new release directory. Existing webroots and releases stay intact.
remote_action stage
printf '{"commit":"%s","release":"%s"}\n' "$GITHUB_SHA" "$release" > neilsonks/dist/_deployment.json
printf -v ssh_command '%q ' ssh "${ssh_options[@]}"
rsync -az --safe-links -e "$ssh_command" neilsonks/dist/ "$target:$root/releases/$release/"

if [[ "$activate" == 'true' ]]; then
  remote_action publish
  if [[ -n "${WEBDOCK_SITE_URL:-}" ]]; then
    [[ "$WEBDOCK_SITE_URL" =~ ^https://[^[:space:]]+$ && "$WEBDOCK_SITE_URL" != *'?'* && "$WEBDOCK_SITE_URL" != *'#'* ]] || { remote_action rollback; echo 'Use an HTTPS site URL without a query or fragment' >&2; exit 1; }
    url="${WEBDOCK_SITE_URL%/}/_deployment.json?release=$release"
    if ! curl --fail --silent --show-error --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 30 "$url" > "$temporary/response.json" ||
       ! python3 - "$temporary/response.json" "$release" <<'PY'
import json, sys
with open(sys.argv[1]) as response:
    manifest = json.load(response)
if manifest.get('release') != sys.argv[2]:
    raise SystemExit('The public site is not serving the expected release')
PY
    then
      remote_action rollback
      echo 'Live verification failed; restored the previous release' >&2
      exit 1
    fi
  fi
  result="Published $release. Webdock must serve $root/current."
else
  result="Staged $release at $root/releases/$release. The live site was not changed."
fi
printf '%s\n' "$result"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Webdock deployment\n\n%s\n\nCommit: `%s`\n' "$result" "$GITHUB_SHA" >> "$GITHUB_STEP_SUMMARY"
fi
