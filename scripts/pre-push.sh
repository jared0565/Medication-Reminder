#!/bin/sh
# Pre-push gate: static checks + both suites. ~9s.
#
# Why a hook rather than CI: the suites run in seconds locally, and every defect
# this gate exists to stop was a *gap* in the tests rather than a red test --
# running the same green suite on a server would have caught none of them. What
# closes that gap is the F821 pass. Two shipped defects were unimported names
# that ran fine until the single line touching them: APP_URL, which made
# "Link account" raise on every click in every build ever released, and
# platform, which silently labelled every linked device "Windows widget".
#
# Exit status is read directly and never through a pipe -- `cmd | tail` reports
# tail's status, which has made failing runs look like clean ones.
#
# Bypass with `git push --no-verify` when you genuinely mean to.
#
# This file is the tracked source of truth. `.githooks/` is gitignored and owned
# by graphite, so a hook written directly there would not travel with the repo.
# Install it on a fresh clone with:
#
#   sh scripts/install-hooks.sh

set -u

repo=$(git rev-parse --show-toplevel) || exit 1
cd "$repo" || exit 1

log=$(mktemp) || exit 1
trap 'rm -f "$log"' EXIT

fail=0

run() {
	name=$1
	shift
	printf '  %-24s' "$name"
	if "$@" >"$log" 2>&1; then
		printf 'ok\n'
	else
		printf 'FAILED\n\n'
		sed 's/^/    /' "$log"
		printf '\n'
		fail=1
	fi
}

printf 'pre-push checks\n'

# -P stops a repo-root ruff.py/pytest.py from shadowing the installed package
# (python -m puts the cwd on sys.path[0], and a module-shaped shadow RUNS before
# it errors). pytest still needs the repo root importable, so it gets it from an
# explicit PYTHONPATH rather than that implicit entry -- same protection, imports
# intact. -P is preferred over -I, which would also strip the environment.
run "ruff undefined names" python -P -m ruff check --select F821 --no-cache .
run "python tests" env PYTHONPATH="$repo" python -P -m pytest tests -q
# Node suites are globbed so a new tests/*.mjs file is covered without editing
# this hook.
set -- tests/*.mjs
if [ -e "$1" ]; then
	run "node tests" node --test "$@"
else
	printf '  %-24sno tests/*.mjs found\n' "node tests"
	fail=1
fi

if [ "$fail" -ne 0 ]; then
	printf '\npush blocked. Fix the above, or use --no-verify to override.\n'
	exit 1
fi

printf 'all checks passed\n'
exit 0
