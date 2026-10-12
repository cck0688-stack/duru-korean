#!/usr/bin/env bash
# Puts the read-online files made so far on rework-output, so a sheet reads
# on its page as soon as it is saved, not when the whole run ends.
# Usage: scripts/push-read.sh <shelf>   (run from the repository root)
[ -d read-output ] || exit 0
here=$(pwd)
if [ ! -d ../rework-output ]; then
  git fetch -q origin rework-output && git worktree add -q ../rework-output origin/rework-output -B rework-output || exit 1
fi
mkdir -p ../rework-output/read
cp -r read-output/. ../rework-output/read/
cd ../rework-output || exit 1
git add -A read
git diff --cached --quiet && exit 0
git commit -q -m "Read-online files (${1:-sheets})"
for i in 1 2 3 4; do
  git pull -q --rebase -X theirs origin rework-output && git push -q origin rework-output && exit 0
  sleep $((2 ** i))
done
cd "$here"
exit 1
