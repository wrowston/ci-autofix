# CI Autofix

This repository includes a GitHub Actions CI workflow with an optional Cursor Cloud Agent autofix job.

## Setup

Add the following repository secret:

- `CURSOR_API_KEY`: API key used to start Cursor Cloud Agent runs.

Optionally add this repository variable:

- `CURSOR_MODEL`: Cursor model ID to use for autofix runs. Defaults to `composer-2`.

The autofix job runs only after the normal CI job fails. It starts a Cursor Cloud Agent that inspects the failed workflow run, reproduces the failure, applies a focused fix, verifies the result, and opens or updates a pull request.

## Safety Guards

Forked pull requests are intentionally ignored because GitHub does not expose repository secrets to untrusted fork workflows.

Branches beginning with `cursor/` are ignored to prevent autofix loops from Cursor-created fix branches.

Manual dispatch is supported through the `workflow_dispatch` input, but the autofix job only starts when `cursor_autofix=true` and the normal CI job fails.

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
bun .github/scripts/cursor-autofix.ts
```
