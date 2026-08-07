#!/bin/sh
# Install the pre-push gate into .githooks/.
#
# .githooks/ is gitignored and graphite owns the trampolines it writes there, so
# the gate cannot live in that directory as tracked content. The tracked script
# is scripts/pre-push.sh; this installs a trampoline that execs it, which keeps
# the logic version-controlled and leaves graphite's own hooks untouched.
#
# Idempotent: re-running overwrites only the pre-push trampoline.

set -eu

repo=$(git rev-parse --show-toplevel)
cd "$repo"

hooks=$(git config core.hooksPath || echo .git/hooks)
mkdir -p "$hooks"

cat > "$hooks/pre-push" <<'TRAMPOLINE'
#!/bin/sh
# Trampoline -- real logic lives in the tracked scripts/pre-push.sh.
exec sh "$(git rev-parse --show-toplevel)/scripts/pre-push.sh" "$@"
TRAMPOLINE

chmod +x "$hooks/pre-push"
printf 'installed %s/pre-push -> scripts/pre-push.sh\n' "$hooks"
