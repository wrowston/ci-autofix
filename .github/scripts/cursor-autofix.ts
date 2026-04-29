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

const formatList = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

const repository = requiredEnv("GITHUB_REPOSITORY");
const githubSha = requiredEnv("GITHUB_SHA");
const githubRunId = requiredEnv("GITHUB_RUN_ID");
const githubRunAttempt = optionalEnv("GITHUB_RUN_ATTEMPT") ?? "1";
const githubRefName = optionalEnv("GITHUB_REF_NAME") ?? "unknown";
const githubEventName = optionalEnv("GITHUB_EVENT_NAME") ?? "unknown";
const prUrl = optionalEnv("PR_URL");
const workflowUrl = `https://github.com/${repository}/actions/runs/${githubRunId}/attempts/${githubRunAttempt}`;
const repoUrl = `https://github.com/${repository}`;
const dryRun = optionalEnv("CURSOR_AUTOFIX_DRY_RUN") === "true";

const repoConfig = prUrl
  ? { url: repoUrl, prUrl }
  : { url: repoUrl, startingRef: githubSha };

const verificationCommands = ["bun install --frozen-lockfile", "bun test", "bun run build"];

const prompt = `The GitHub Actions CI workflow failed for ${repository}.

Context:
- Event: ${githubEventName}
- Ref: ${githubRefName}
- SHA: ${githubSha}
- Failed workflow run: ${workflowUrl}
${prUrl ? `- Pull request: ${prUrl}` : "- Pull request: none; create a new fix PR"}

Please inspect the failure, reproduce it, and fix the underlying code issue.

Verification commands:
${formatList(verificationCommands)}

Requirements:
- Run the verification commands before finishing.
- Keep the fix focused on the CI failure.
- Do not make unrelated refactors.
- If the failure is caused by unavailable infrastructure or credentials rather than code, document that clearly instead of fabricating a code fix.
${prUrl ? "- Push the fix back to the pull request branch if you have permission." : "- Commit the fix, push a branch, and open a pull request."}
- Include the verification results in your final response.`;

if (dryRun) {
  console.log("Cursor autofix dry run");
  console.log(JSON.stringify({ repoConfig, workflowUrl }, null, 2));
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
  console.log(`Repository: ${repoUrl}`);
  console.log(`Target: ${prUrl ?? githubSha}`);
  console.log(`Workflow: ${workflowUrl}`);

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
