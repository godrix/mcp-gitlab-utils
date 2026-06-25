import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitLabClient, requireGitLabEnv } from "../gitlab-client.js";
import {
  getCurrentBranch,
  getGitRemoteOrigin,
  parseGitRemoteUrl,
  gitlabBaseHost,
} from "../resolve-project.js";
import { projectFields, readOnly, runTool, withGitLab } from "../helpers.js";

export function registerContextTools(server: McpServer): void {
  server.registerTool(
    "gitlab_resolve_context",
    {
      title: "Resolve local GitLab context",
      description:
        "Discovers project_id, current branch, and merge_request_iid from repo_path. Use before other tools when working in a local clone.",
      inputSchema: z.object({
        repo_path: z.string().describe("Absolute path to local clone."),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(async () => {
        const repo = args.repo_path.trim();
        const baseUrl = process.env.GITLAB_BASE_URL?.trim() ?? "";
        if (!baseUrl) {
          throw new Error("GITLAB_BASE_URL is missing.");
        }

        const remote = await getGitRemoteOrigin(repo);
        const { host, path } = parseGitRemoteUrl(remote);
        const expected = gitlabBaseHost(baseUrl);
        const branch = await getCurrentBranch(repo);

        const out: Record<string, unknown> = {
          repo_path: repo,
          remote_origin: remote,
          project_path: path,
          gitlab_host: host,
          gitlab_host_matches: host === expected,
          current_branch: branch,
        };

        if (host === expected && branch) {
          await withGitLab({ project_id: path }, async ({ client, enc }) => {
            const qs = new URLSearchParams({
              state: "opened",
              source_branch: branch,
              per_page: "50",
            });
            const mrs = (await client.getJson(`/projects/${enc}/merge_requests?${qs}`)) as Array<{
              iid: number;
              title: string;
              web_url: string;
            }>;
            out.open_merge_requests = mrs.map((m) => ({
              iid: m.iid,
              title: m.title,
              web_url: m.web_url,
            }));
            if (mrs.length === 1) {
              out.merge_request_iid = mrs[0].iid;
            }
          });
        }

        const envProject = process.env.GITLAB_PROJECT_ID?.trim();
        if (envProject) {
          out.gitlab_project_id_env = envProject;
        }

        return out;
      }),
  );

  server.registerTool(
    "gitlab_search_projects",
    {
      title: "Search GitLab projects",
      description: "Lists projects accessible by the token, with optional name or path filter.",
      inputSchema: z.object({
        search: z.string().optional().describe("Search term (name or path)."),
        membership: z
          .boolean()
          .optional()
          .default(true)
          .describe("When true, only projects where the user is a member."),
        per_page: z.number().int().min(1).max(100).optional().default(20),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(async () => {
        const gl = requireGitLabEnv();
        const client = new GitLabClient(gl.token, gl.apiBase);
        const qs = new URLSearchParams({
          per_page: String(args.per_page ?? 20),
          membership: String(args.membership ?? true),
          order_by: "last_activity_at",
        });
        if (args.search?.trim()) {
          qs.set("search", args.search.trim());
        }
        const projects = await client.getJson(`/projects?${qs}`);
        return { projects };
      }),
  );
}
