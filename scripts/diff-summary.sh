#!/usr/bin/env bash
# forge diff-summary: base ブランチとの差分を要約する(スタック非依存・読み取り専用)
set -euo pipefail

# base branch を解決する: 引数指定 > origin/HEAD > origin/main > origin/master > origin/develop
resolve_base() {
  if [ -n "${1:-}" ]; then
    printf '%s\n' "$1"
    return 0
  fi
  local candidate
  for candidate in origin/HEAD origin/main origin/master origin/develop; do
    if git rev-parse --verify --quiet "$candidate" > /dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  echo "エラー: base branch を解決できません(origin/HEAD, origin/main, origin/master, origin/develop が見つかりません)。引数で明示してください: $0 <base>" >&2
  exit 1
}

base="$(resolve_base "${1:-}")"

merge_base="$(git merge-base HEAD "$base")" || {
  echo "エラー: merge-base を算出できません(base: ${base})。fetch 済みか確認してください。" >&2
  exit 1
}

name_status="$(git diff --name-status "$merge_base")"
untracked="$(git status --short)"

if [ -z "$name_status" ] && [ -z "$untracked" ]; then
  echo "NO_CHANGES"
  exit 0
fi

diffstat="$(git diff --stat "$merge_base")"

echo "## base"
echo "$base"
echo
echo "## merge-base"
echo "$merge_base"
echo
echo "## 変更ファイル(name-status、コミット済み+未コミットのワーキングツリー比較)"
printf '%s\n' "${name_status:-(なし)}"
echo
echo "## 未追跡・未ステージ(git status --short)"
printf '%s\n' "${untracked:-(なし)}"
echo
echo "## 差分統計(diffstat)"
printf '%s\n' "${diffstat:-(なし)}"
