import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "review_merge_request",
    {
      title: "Review merge request",
      description:
        "Agent workflow to review an MR: context, diff, discussions, and quality checklist.",
      argsSchema: {
        repo_path: z.string().optional().describe("Local clone path (recommended)."),
        merge_request_iid: z.string().optional().describe("MR IID if known."),
        project_id: z.string().optional().describe("ID or group/repo when repo_path is not set."),
        focus: z
          .string()
          .optional()
          .describe("Extra scope: security, performance, tests, etc."),
      },
    },
    ({ repo_path, merge_request_iid, project_id, focus }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Review the GitLab merge request using this MCP's tools.

## Parameters
- repo_path: ${repo_path ?? "(infer from workspace)"}
- merge_request_iid: ${merge_request_iid ?? "(resolve from current branch)"}
- project_id: ${project_id ?? "(resolve from repo_path or env)"}
${focus ? `- extra focus: ${focus}` : ""}

## Steps
1. If repo_path is available, call \`gitlab_resolve_context\` to get project_id and merge_request_iid.
2. \`gitlab_get_merge_request\` — state, reviewers, labels, pipeline.
3. \`gitlab_get_mr_merge_status\` — check blockers before approve/merge.
4. \`gitlab_get_mr_context\` with include_failed_jobs_trace=true if the pipeline failed.
5. \`gitlab_get_mr_discussions\` — existing comments and threads.
6. Analyze the diff: bugs, regressions, missing tests, security, project style.
7. Use \`gitlab_add_mr_inline_comment\` for file/line-specific findings.
8. Summarize: approve (\`approve\`), request changes, or general comment (\`comment\`). If GITLAB_READ_ONLY=true, do not approve or comment.

Respond with a clear verdict (Approve / Changes required) and an actionable findings list.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "fix_failed_ci",
    {
      title: "Fix failed CI pipeline",
      description: "Workflow to diagnose and fix failed jobs on the MR or branch pipeline.",
      argsSchema: {
        repo_path: z.string().optional(),
        merge_request_iid: z.string().optional(),
        project_id: z.string().optional(),
      },
    },
    ({ repo_path, merge_request_iid, project_id }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Diagnose and propose a fix for failed GitLab CI.

## Context
- repo_path: ${repo_path ?? "(current workspace)"}
- merge_request_iid: ${merge_request_iid ?? "(resolve)"}
- project_id: ${project_id ?? "(resolve)"}

## Steps
1. \`gitlab_resolve_context\` if repo_path is available.
2. \`gitlab_get_pipeline\` — jobs and states.
3. For each failed job: \`gitlab_get_job_trace\` and identify root cause (test, lint, build, deploy).
4. If useful, \`gitlab_get_file\` for .gitlab-ci.yml or configs referenced in the log.
5. Fix code locally; after push, \`gitlab_control_pipeline\` action=retry_pipeline or retry_job if needed.
6. Report: cause, fix applied, and how to validate.

Prioritize a minimal, correct fix.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "create_mr_from_branch",
    {
      title: "Create MR from current branch",
      description: "Open a merge request with title and description from branch work.",
      argsSchema: {
        repo_path: z.string().describe("Absolute path to local clone."),
        target_branch: z.string().optional().describe("Target branch (default: project default)."),
        draft: z.string().optional().describe("true for draft MR."),
      },
    },
    ({ repo_path, target_branch, draft }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Create a GitLab merge request for work on the current branch.

## Parameters
- repo_path: ${repo_path}
- target_branch: ${target_branch ?? "(project default)"}
- draft: ${draft ?? "false"}

## Steps
1. \`gitlab_resolve_context\` — confirm project_path and current_branch.
2. Analyze \`git log\` and \`git diff\` vs target to summarize changes.
3. \`gitlab_manage_merge_requests\` action=create with clear title and description (what, why, how to test).
4. Share the created MR URL.

Concise title; description sections: Summary, Changes, Testing.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "triage_open_mrs",
    {
      title: "Triage open MRs",
      description: "List and prioritize open merge requests for the project or branch.",
      argsSchema: {
        project_id: z.string().optional(),
        repo_path: z.string().optional(),
      },
    },
    ({ project_id, repo_path }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Triage open merge requests on GitLab.

- project_id: ${project_id ?? "(resolve)"}
- repo_path: ${repo_path ?? "(optional)"}

1. \`gitlab_manage_merge_requests\` action=list
2. For each relevant MR: pipeline state (\`gitlab_get_pipeline\`), reviewers, age.
3. Prioritized table: urgent (red/blocked CI), pending review, ready to merge.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "merge_merge_request",
    {
      title: "Merge merge request",
      description:
        "Workflow to validate mergeability and merge (or schedule merge_when_pipeline_succeeds).",
      argsSchema: {
        repo_path: z.string().optional().describe("Local clone path (recommended)."),
        merge_request_iid: z.string().optional().describe("MR IID if known."),
        project_id: z.string().optional().describe("ID or group/repo when repo_path is not set."),
        squash: z.string().optional().describe("true to squash commits on merge."),
        remove_source_branch: z
          .string()
          .optional()
          .describe("true to delete source branch after merge."),
        wait_for_pipeline: z
          .string()
          .optional()
          .describe("true for merge_when_pipeline_succeeds while CI is running."),
      },
    },
    ({
      repo_path,
      merge_request_iid,
      project_id,
      squash,
      remove_source_branch,
      wait_for_pipeline,
    }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Safely merge a GitLab merge request.

## Parameters
- repo_path: ${repo_path ?? "(infer from workspace)"}
- merge_request_iid: ${merge_request_iid ?? "(resolve from current branch)"}
- project_id: ${project_id ?? "(resolve from repo_path or env)"}
- squash: ${squash ?? "false"}
- remove_source_branch: ${remove_source_branch ?? "false"}
- wait_for_pipeline: ${wait_for_pipeline ?? "false"}

## Steps
1. If repo_path is available, call \`gitlab_resolve_context\` to get project_id and merge_request_iid.
2. \`gitlab_get_mr_merge_status\` — if \`ready_to_merge=false\`, list blockers and **do not** merge; propose fixes.
3. If draft: \`gitlab_manage_merge_requests\` action=mark_ready (if appropriate).
4. If CI failed: stop — suggest \`fix_failed_ci\` or manual retry; do not merge with red pipeline unless explicitly instructed.
5. If CI is running and wait_for_pipeline=true: \`gitlab_manage_merge_requests\` action=merge with merge_when_pipeline_succeeds=true.
6. If \`ready_to_merge=true\`: \`gitlab_manage_merge_requests\` action=merge with squash/remove_source_branch per parameters.
7. Confirm result (state=merged, URL) and summarize what was done.

**Note:** if GITLAB_READ_ONLY=true, only report status — do not merge or mark_ready.

Respond with a clear decision (merged / scheduled / blocked) and reason.`,
          },
        },
      ],
    }),
  );
}
