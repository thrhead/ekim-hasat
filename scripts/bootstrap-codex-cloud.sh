#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Run this script from inside the Ekim Hasat Git repository." >&2
  exit 1
}
cd "$repo_root"

if [[ ! -f package.json ]] || ! node -e \
  'const p=require("./package.json"); if(p.name!=="ekim-hasat"||p.packageManager!=="pnpm@10.17.1") process.exit(1)' ; then
  echo "Repository root or packageManager contract is not Ekim Hasat pnpm@10.17.1." >&2
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "Corepack is required to activate pnpm@10.17.1." >&2
  exit 1
fi

# Keep Corepack's package-manager cache in the ignored, repo-local dependency
# directory; fresh Cloud homes may not exist or be writable.
export COREPACK_HOME="$repo_root/node_modules/.cache/corepack"
export npm_config_devdir="$repo_root/node_modules/.cache/node-gyp"
export CI=true
pnpm=(corepack pnpm@10.17.1)
"${pnpm[@]}" --version
"${pnpm[@]}" install --frozen-lockfile --store-dir "$repo_root/node_modules/.cache/pnpm-store"

graft_version="$("${pnpm[@]}" exec graft --version)"
if [[ "$graft_version" != *"0.21.1"* ]]; then
  echo "Expected repository-pinned Graft 0.21.1, got: $graft_version" >&2
  exit 1
fi
printf 'Graft %s\n' "$graft_version"

required_skills=(
  speckit-specify speckit-clarify speckit-plan speckit-checklist
  speckit-tasks speckit-analyze speckit-converge impeccable
  superpowers/using-superpowers superpowers/brainstorming
  superpowers/using-git-worktrees superpowers/writing-plans
  superpowers/executing-plans superpowers/test-driven-development
  superpowers/systematic-debugging superpowers/dispatching-parallel-agents
  superpowers/subagent-driven-development superpowers/requesting-code-review
  superpowers/receiving-code-review superpowers/verification-before-completion
  superpowers/finishing-a-development-branch
)
for skill in "${required_skills[@]}"; do
  if [[ ! -r ".agents/skills/$skill/SKILL.md" ]]; then
    echo "Required repo-local skill is missing or unreadable: $skill" >&2
    exit 1
  fi
done

echo "Ekim Hasat Cloud tooling bootstrap checks passed."
