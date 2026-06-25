import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertWriteAllowed } from "../config.js";
import { resolveMergeRequestIid } from "../resolve-project.js";
import { prepareReviewWorktree } from "../worktree.js";
import { mergeRequestIidField, projectFields, runTool, truncate, withGitLab } from "../helpers.js";

export function registerReviewTools(server: McpServer): void {
  server.registerTool(
    "gitlab_prepare_review",
    {
      title: "Prepare review folder (worktree + install)",
      description:
        "Creates a worktree from local repo (repo_path) or shallow HTTPS clone with token. Runs npm ci or composer install by default.",
      inputSchema: z.object({
        ...projectFields,
        merge_request_iid: mergeRequestIidField,
        install_command: z
          .string()
          .optional()
          .describe("Shell command at worktree root (e.g. npm ci). Omit to auto-detect."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef, token, baseUrl }) => {
          assertWriteAllowed("gitlab_prepare_review");

          if (!baseUrl) {
            throw new Error("GITLAB_BASE_URL is missing.");
          }

          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );

          const mr = (await client.getJson(`/projects/${enc}/merge_requests/${iid}`)) as {
            source_branch: string;
          };
          const branch = mr.source_branch;
          if (!branch) {
            throw new Error("MR has no source_branch.");
          }

          let cloneUrl = "";
          if (!args.repo_path?.trim()) {
            const proj = (await client.getJson(`/projects/${enc}`)) as { http_url_to_repo?: string };
            if (!proj.http_url_to_repo) {
              throw new Error(
                "Project has no http_url_to_repo; pass repo_path to use local worktree.",
              );
            }
            cloneUrl = proj.http_url_to_repo;
          }

          const result = await prepareReviewWorktree({
            repoPath: args.repo_path,
            sourceBranch: branch,
            cloneHttpUrl: cloneUrl,
            token,
            installCommand: args.install_command,
          });

          return {
            merge_request_iid: iid,
            source_branch: branch,
            worktree_path: result.worktreePath,
            install_command: result.installCommand,
            install_stdout: truncate(result.installStdout, 8000),
            install_stderr: truncate(result.installStderr, 8000),
          };
        }),
      ),
  );
}
