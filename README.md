# Cursor CI Autofix

This repository is a small GitHub Actions listener that starts a Cursor Cloud Agent when one of your existing CI/CD workflows fails.

It does not define its own test or build pipeline. Your repository keeps its existing GitHub Actions workflows, and this listener reacts to their failures.

## Setup

Copy these files into the repository you want Cursor to autofix:

- `.github/workflows/cursor-autofix.yml`
- `.github/scripts/cursor-autofix.ts`

Then add the script dependencies:

```sh
bun add -d @cursor/february typescript @types/bun
```

Then add this repository secret:

- `CURSOR_API_KEY`: API key used to start Cursor Cloud Agent runs.

Optionally add these repository variables:

- `CURSOR_MODEL`: Cursor model ID to use for autofix runs. Defaults to `composer-2`.
- `CURSOR_AUTOFIX_WORKFLOWS`: comma-separated list of workflow names to autofix, for example `CI,Deploy`. Leave unset to listen to every failed workflow except the autofix workflow itself.

The workflow names must match the `name:` field in your existing GitHub Actions files:

```yaml
name: CI
```

When a matching workflow fails, the listener starts a Cursor Cloud Agent with the failed run URL, branch, commit SHA, and pull request URL when GitHub provides one. The agent inspects the failed workflow, fixes the underlying code issue, verifies the relevant commands, and opens or updates a pull request.

## Dry Run

Maintainers can inspect the generated agent prompt without calling the Cursor API:

```sh
CURSOR_AUTOFIX_DRY_RUN=true \
GITHUB_REPOSITORY=owner/repo \
GITHUB_SHA=0000000000000000000000000000000000000000 \
GITHUB_RUN_ID=123 \
GITHUB_RUN_ATTEMPT=1 \
GITHUB_REF_NAME=main \
GITHUB_EVENT_NAME=workflow_dispatch \
WORKFLOW_URL=https://github.com/owner/repo/actions/runs/123 \
WORKFLOW_NAME=CI \
FAILED_REF=0000000000000000000000000000000000000000 \
FAILED_BRANCH=main \
bun .github/scripts/cursor-autofix.ts
```

