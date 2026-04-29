import { Agent } from "@cursor/february/agent";

const requiredEnv = (name: string) => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const optionalEnv = (name: string) => {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
};

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const formatList = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

const context = (() => {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const githubSha = requiredEnv("GITHUB_SHA");
  const githubRunId = requiredEnv("GITHUB_RUN_ID");
  const githubRunAttempt = optionalEnv("GITHUB_RUN_ATTEMPT") ?? "1";
  const githubRefName = optionalEnv("GITHUB_REF_NAME") ?? "unknown";
  const repoUrl = `https://github.com/${repository}`;

  return {
    repository,
    repoUrl,
    eventName: optionalEnv("GITHUB_EVENT_NAME") ?? "unknown",
    failedRef: optionalEnv("FAILED_REF") ?? githubSha,
    failedBranch: optionalEnv("FAILED_BRANCH") ?? githubRefName,
    workflowName: optionalEnv("WORKFLOW_NAME") ?? "manual dispatch",
    workflowConclusion: optionalEnv("WORKFLOW_CONCLUSION") ?? "unknown",
    workflowAllowlist: splitList(optionalEnv("CURSOR_AUTOFIX_WORKFLOWS")),
    workflowUrl:
      optionalEnv("WORKFLOW_URL") ??
      `${repoUrl}/actions/runs/${githubRunId}/attempts/${githubRunAttempt}`,
    prUrl: optionalEnv("PR_URL"),
    dryRun: optionalEnv("CURSOR_AUTOFIX_DRY_RUN") === "true",
  };
})();

const repoConfig = context.prUrl
  ? { url: context.repoUrl, prUrl: context.prUrl }
  : { url: context.repoUrl, startingRef: context.failedRef };

if (
  context.workflowAllowlist.length > 0 &&
  context.workflowName !== "manual dispatch" &&
  !context.workflowAllowlist.includes(context.workflowName)
) {
  console.log(`Skipping Cursor autofix for workflow "${context.workflowName}".`);
  console.log(`Allowed workflows: ${context.workflowAllowlist.join(", ")}`);
  process.exit(0);
}

const verificationGuidance = [
  "Inspect the failed GitHub Actions run and identify the failing command(s).",
  "Reproduce the failure locally when possible.",
  "Run the smallest relevant verification command(s) after applying the fix.",
];

const prompt = `A GitHub Actions workflow failed for ${context.repository}.

Context:
- Event: ${context.eventName}
- Failed workflow: ${context.workflowName}
- Workflow conclusion: ${context.workflowConclusion}
- Ref: ${context.failedBranch}
- SHA: ${context.failedRef}
- Failed workflow run: ${context.workflowUrl}
${context.prUrl ? `- Pull request: ${context.prUrl}` : "- Pull request: none; create a new fix PR"}

Please inspect the failed workflow run, reproduce the failing command if possible, and fix the underlying code issue.

Verification guidance:
${formatList(verificationGuidance)}

Requirements:
- Keep the fix focused on the failing workflow.
- Do not make unrelated refactors.
- If the failure is caused by unavailable infrastructure or credentials rather than code, document that clearly instead of fabricating a code fix.
${context.prUrl ? "- Push the fix back to the pull request branch if you have permission." : "- Commit the fix, push a branch, and open a pull request."}
- Include the verification results in your final response.`;

if (context.dryRun) {
  console.log("Cursor autofix dry run");
  console.log(JSON.stringify({ repoConfig, workflowUrl: context.workflowUrl }, null, 2));
  console.log(prompt);
  process.exit(0);
}

const agent = Agent.create({
  apiKey: requiredEnv("CURSOR_API_KEY"),
  model: { id: optionalEnv("CURSOR_MODEL") ?? "composer-2" },
  cloud: {
    repos: [repoConfig],
    autoCreatePR: true,
    skipReviewerRequest: true,
  },
});

try {
  console.log("Starting Cursor Cloud Agent autofix run...");
  console.log(`Repository: ${context.repoUrl}`);
  console.log(`Target: ${context.prUrl ?? context.failedRef}`);
  console.log(`Workflow: ${context.workflowUrl}`);

  const run = await agent.send(prompt);

  for await (const event of run.stream()) {
    switch (event.type) {
      case "assistant":
        for (const block of event.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          }
        }
        break;
      case "status":
        console.log(`\n[cursor:status] ${event.status}${event.message ? ` - ${event.message}` : ""}`);
        break;
      case "task":
        if (event.text) {
          console.log(`\n[cursor:task] ${event.text}`);
        }
        break;
      case "tool_call":
        console.log(`\n[cursor:tool] ${event.name}: ${event.status}`);
        break;
      case "thinking":
      case "request":
      case "system":
      case "user":
        break;
    }
  }

  const result = await run.wait();

  console.log(`\nCursor run finished with status: ${result.status}`);

  for (const branch of result.git?.branches ?? []) {
    if (branch.branch) {
      console.log(`Cursor branch: ${branch.branch}`);
    }

    if (branch.prUrl) {
      console.log(`Cursor PR: ${branch.prUrl}`);
    }
  }

  if (result.status !== "finished") {
    process.exitCode = 1;
  }
} finally {
  await agent[Symbol.asyncDispose]();
}
