---
name: gh-release-notes-builder
description: "Compose release notes from merged PRs since the last tag. Group by conventional-commit type or PR labels."
argument-hint: "[since-tag] — defaults to the latest tag (e.g. v0.4.2)"
allowed-tools: Bash, Read, Write
tags: [kanban, sdlc]
---

# Release Notes Builder

Generate structured release notes by walking merged PRs since a
reference tag (the latest by default). Output is a markdown block
suitable for `gh release create --notes-file`.

## Input

`$ARGUMENTS` is optional; when present it's the tag to diff against.
When absent, use the latest tag from `git tag --sort=-creatordate`.

If no tags exist yet, treat the repo's first commit as the baseline
and label the output `Initial release`.

## Process

### 1. Resolve baseline

```bash
SINCE="${ARGUMENTS:-$(git tag --sort=-creatordate | head -n1)}"
[ -z "$SINCE" ] && SINCE="$(git rev-list --max-parents=0 HEAD)"
```

### 2. List merged PRs since baseline

```bash
gh pr list --state merged --base main --search "merged:>$(git log -1 --format=%cI "$SINCE")" \
  --json number,title,labels,mergedAt,author --limit 200
```

### 3. Categorise

Bucket each PR into one of:

- **Features** — title starts with `feat`, or PR has label `feat`/`feature`
- **Fixes** — `fix`, label `bug`/`fix`
- **Performance** — `perf`, label `perf`
- **Documentation** — `docs`, label `docs`
- **Refactor** — `refactor`, label `refactor`
- **Other** — anything left

### 4. Render

```markdown
## <new-tag-or-Unreleased> — <YYYY-MM-DD>

### Features
- <title> (#<number>) — @<author>

### Fixes
- <title> (#<number>) — @<author>

### Refactor
- ...

_Compared against <SINCE>; <N> PRs from <X> contributors._
```

Skip empty sections. Sort PRs within a section newest-first.

### 5. Output

Write to stdout AND to `RELEASE_NOTES.md` at the repo root (or
`docs/releases/<new-tag>.md` if the directory exists). Print the
file path on the last line so a caller can read it.

## Notes

- This skill is read-only against GitHub + writes one local file.
  It does **not** call `gh release create` or push tags — caller's
  responsibility.
- Conventional-commit prefixes take precedence over labels when
  both exist.
- Author handles are kept verbatim; squash-merge bot accounts get
  filtered out of the contributor count.
