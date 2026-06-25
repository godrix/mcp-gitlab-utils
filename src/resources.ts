import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import { GitLabClient, projectPathSegment, requireGitLabEnv } from "./gitlab-client.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

const AGENT_GUIDE = `# Agent guide — @godrix/mcp-gitlab-utils

${SERVER_INSTRUCTIONS}

## Tools by category

### Discovery
- \`gitlab_resolve_context\` — project_id + MR from local clone
- \`gitlab_search_projects\` — find projects

### Merge requests
- \`gitlab_get_merge_request\` — metadata
- \`gitlab_get_mr_merge_status\` — mergeability, blockers, approvals
- \`gitlab_get_mr_context\` — diff + CI traces + discussions
- \`gitlab_get_mr_discussions\` — review threads
- \`gitlab_add_mr_inline_comment\` — inline diff comment
- \`gitlab_manage_merge_requests\` — list/get/create/update/approve/unapprove/comment/merge/close/reopen/mark_draft/mark_ready

### CI/CD
- \`gitlab_list_pipelines\` — history
- \`gitlab_get_pipeline\` — pipeline + jobs
- \`gitlab_get_job_trace\` — logs
- \`gitlab_control_pipeline\` — list_jobs/play/retry_job/retry_pipeline/cancel_pipeline

### Repository
- \`gitlab_get_file\` — read remote file
- \`gitlab_compare\` — diff between refs

### Local review
- \`gitlab_prepare_review\` — worktree + dependencies

## Token permissions
- Read: api, read_api, read_repository
- Write (approve, comment, merge, play): api

## Read-only mode
- \`GITLAB_READ_ONLY=true\` blocks writes; reads and \`gitlab_get_mr_merge_status\` stay available
`;

export function registerResources(server: McpServer): void {
  server.registerResource(
    "gitlab_agent_guide",
    "gitlab://guide",
    {
      title: "GitLab agent guide",
      description: "Tool reference, context resolution, and recommended workflows.",
      mimeType: "text/markdown",
    },
    async (uri: URL) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: AGENT_GUIDE }],
    }),
  );

  server.registerResource(
    "gitlab_project",
    new ResourceTemplate("gitlab://project/{project_ref}", {
      list: undefined,
      complete: {
        project_ref: async () => {
          const fallback = process.env.GITLAB_PROJECT_ID?.trim();
          return fallback ? [fallback] : [];
        },
      },
    }),
    {
      title: "GitLab project metadata",
      description: "Project info: default_branch, web_url, visibility, and basic stats.",
      mimeType: "application/json",
    },
    async (uri: URL, variables: Variables) => {
      const gl = requireGitLabEnv();
      const client = new GitLabClient(gl.token, gl.apiBase);
      const raw = variables.project_ref;
      const ref = Array.isArray(raw) ? raw[0] : raw;
      if (!ref) {
        throw new Error("Missing project_ref in URI gitlab://project/{project_ref}");
      }
      const enc = projectPathSegment(ref);
      const project = await client.getJson(`/projects/${enc}`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(project, null, 2),
          },
        ],
      };
    },
  );
}
