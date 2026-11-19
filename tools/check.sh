#!/usr/bin/env bash
# Pipeline consistency. A gate measures what it can measure: the presence of
# violations, not the truth of claims (see AGENTS.md §6).
#
# Extend ONLY with defect substitution: introduce a violation the item must
# catch, verify it fails with a clear message; remove — silence again. An
# exception to a gate is a line with a marker, not a file: a file excluded for
# the sake of its own template takes its comments out of the check.
#
# Freshness by mtime: after git clone/checkout all mtimes are "now", the
# freshness gate can fire falsely. Cured by rebuilding artifacts, not touch.
#
# Mode --init full|core: tree composition vs selected modules (run after
# project initialization and manually when the module set changes).
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0
err() { echo "check: $1"; fail=1; }

in_git=0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && in_git=1

# 1. Pipeline files are not in the git index.
if [ "$in_git" = 1 ]; then
  for f in AGENTS.md TODO.md HISTORY.md AI.md AI backlog.md; do
    if [ -n "$(git ls-files -- "$f")" ]; then
      err "pipeline file leaked into the index: $f"
    fi
  done
fi

# 2. Artifacts not older than their sources. Record "artifact:sources" pairs
#    from the project's actual build; the example below is commented out.
#    This project commits no build outputs (out/, dist/ are gitignored), so
#    the pair list is intentionally empty — add a pair when a derived file
#    becomes committed.
FRESHNESS='
# build/report.pdf:report.md,data.csv
'
while IFS=: read -r art srcs; do
  case "$art" in ''|\#*) continue ;; esac
  if [ ! -e "$art" ]; then
    err "artifact missing: $art"
    continue
  fi
  for src in ${srcs//,/ }; do
    [ -e "$src" ] || { err "artifact source missing: $src (for $art)"; continue; }
    [ "$src" -nt "$art" ] && err "stale: $art is older than its source $src"
  done
done <<< "$FRESHNESS"

# 3. No references to pipeline files in committed content (see AGENTS.md §5).
#    Word boundaries: without \b "AI.md" matches OPENAI.md. .gitignore is
#    excluded — it must list pipeline file names. The pattern is a list of
#    name forms, not a single example.
if [ "$in_git" = 1 ]; then
  hits=$(git grep -nE '\b(AGENTS|TODO|HISTORY|AI)\.md\b|\bbacklog\.md\b' -- . \
           ':(exclude).gitignore' ':(exclude)tools/check.sh' 2>/dev/null)
  [ -n "$hits" ] && { err "reference to a pipeline file in committed content:"; echo "$hits" | head -5; }
fi

# 4. AGENTS.md integrity: §N references resolve to headings, no build markers
#    left, section numbering consecutive. Lives in the gate permanently:
#    catches edits after which a reference points into a cut section.
if [ -f AGENTS.md ]; then
  grep -qE '<!-- optional|<!-- /optional -->' AGENTS.md && err "build markers <!-- optional --> left in AGENTS.md"
  secs=$(grep -oE '^## [0-9]+\.' AGENTS.md | grep -oE '[0-9]+')
  for r in $(grep -oE '§[0-9]+' AGENTS.md | grep -oE '[0-9]+' | sort -n | uniq); do
    grep -qx "$r" <<< "$secs" || err "AGENTS.md references §$r but section $r does not exist"
  done
  prev=""
  for s in $secs; do
    if [ -n "$prev" ] && [ "$s" -ne "$((prev + 1))" ]; then
      err "gap in AGENTS.md section numbering: after $prev comes $s"
    fi
    prev="$s"
  done
fi

# --init full|core: tree composition matches the module sets.
if [ "${1:-}" = "--init" ]; then
  mode="${2:?specify mode: --init full|core}"
  have() { [ -e "$1" ]; }
  case "$mode" in
    full)
      for f in AI.md AI/method.md docs/glossary.md; do
        have "$f" || err "full mode: $f missing"
      done
      ;;
    core)
      for f in AI.md AI docs/glossary.md; do
        have "$f" && err "core mode: disabled module present: $f"
      done
      if grep -qiE 'glossary|AI\.md|петл|review-fix|loop' AGENTS.md 2>/dev/null; then
        err "core mode: AGENTS.md mentions disabled modules"
      fi
      ;;
    *) err "unknown --init mode: $mode (full|core)" ;;
  esac
fi

exit "$fail"
