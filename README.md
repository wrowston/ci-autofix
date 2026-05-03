# Cursor CI Autofix

This repository provides a reusable GitHub Actions workflow that starts a Cursor Cloud Agent when one of your existing CI/CD workflows fails.

It does not define its own test or build pipeline. Your repository keeps its existing GitHub Actions workflows, and adds one `cursor-autofix` job that runs only when those jobs fail.

## Setup

First, add this repository secret to the repository where you want Cursor to fix CI failures:

- `CURSOR_API_KEY`: API key used to start Cursor Cloud Agent runs.

Then choose one setup mode.

### Recommended: Add A Reusable Autofix Job

Use this mode when you already have a CI, test, build, or deploy workflow and want Cursor to run only when one of that workflow's jobs fails.

In each workflow you want Cursor to autofix, add a final `cursor-autofix` job:

```yaml
name: CI

on:
  pull_request:
  push:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun install
      - run: bun test

  cursor-autofix:
    needs: [test]
    if: ${{ failure() }}
    permissions:
      contents: read
      pull-requests: read
    uses: wrowston/ci-autofix/.github/workflows/cursor-autofix.yml@main
    secrets:
      CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
```

When `test` fails, GitHub calls the reusable workflow from this repository. The reusable workflow starts a Cursor Cloud Agent with the failed run URL, branch, commit SHA, and pull request URL when one is provided.

The workflow can be named anything. It does not need to be named `CI`; that is only the example workflow name.

For workflows with multiple jobs, list every job Cursor should watch in `needs`:

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: bun lint

  test:
    runs-on: ubuntu-latest
    steps:
      - run: bun test

  build:
    runs-on: ubuntu-latest
    steps:
      - run: bun run build

  cursor-autofix:
    needs: [lint, test, build]
    if: ${{ failure() }}
    permissions:
      contents: read
      pull-requests: read
    uses: wrowston/ci-autofix/.github/workflows/cursor-autofix.yml@main
    secrets:
      CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
```

If you only want Cursor to run for failed pull requests, use:

```yaml
if: ${{ failure() && github.event_name == 'pull_request' }}
```

## Inputs

The reusable workflow accepts these optional inputs:

- `model`: Cursor model ID to use for autofix runs. Defaults to `composer-2`.
- `workflows`: comma-separated list of workflow names to autofix, for example `CI,Deploy`.
- `workflow_url`: failed GitHub Actions run URL. Defaults to the current run URL.
- `workflow_name`: name of the workflow that failed. Defaults to the current workflow name.
- `pr_url`: pull request URL to update, if applicable.
- `ref`: commit SHA or branch to inspect. Defaults to the current commit SHA.
- `branch`: branch that contains the failed workflow run. Defaults to the current ref name.
- `dry_run`: print the generated agent prompt without calling the Cursor API.
- `autofix_ref`: ref of `wrowston/ci-autofix` to use for the autofix implementation. Defaults to `main`.

Example with optional inputs:

```yaml
cursor-autofix:
  needs: [lint, test, build]
  if: ${{ failure() }}
  permissions:
    contents: read
    pull-requests: read
  uses: wrowston/ci-autofix/.github/workflows/cursor-autofix.yml@main
  secrets:
    CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
  with:
    model: composer-2
    workflows: CI
    workflow_name: ${{ github.workflow }}
    pr_url: ${{ github.event.pull_request.html_url }}
```

The workflow names must match the `name:` field in your existing GitHub Actions files.

## Listener Mode

Use this mode when you want a separate workflow file that listens for another workflow to fail.

Copy `examples/cursor-autofix-listener.yml` into the target repository:

```sh
mkdir -p .github/workflows
curl -fsSL https://raw.githubusercontent.com/wrowston/ci-autofix/main/examples/cursor-autofix-listener.yml \
  -o .github/workflows/cursor-autofix-listener.yml
```

Then edit the copied file so `workflows` matches the `name:` field of the workflow Cursor should watch:

```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
```

For example, if your existing workflow starts with `name: Tests`, use:

```yaml
on:
  workflow_run:
    workflows: ["Tests"]
    types: [completed]
```

To watch multiple workflows, list each workflow name:

```yaml
on:
  workflow_run:
    workflows: ["CI", "Deploy"]
    types: [completed]
```

GitHub requires `workflow_run.workflows`; a listener cannot watch every workflow without naming them. If you leave the template unchanged, it watches a workflow named `CI`.

Reusable workflow mode is recommended when you want to plug autofix directly into an existing CI, test, or build pipeline.

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

