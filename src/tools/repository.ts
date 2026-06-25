import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectFields, readOnly, runTool, withGitLab } from "../helpers.js";

export function registerRepositoryTools(server: McpServer): void {
  server.registerTool(
    "gitlab_get_file",
    {
      title: "Read repository file",
      description:
        "Returns file content at a ref (branch, tag, or commit SHA). Useful for .gitlab-ci.yml or configs without a local clone.",
      inputSchema: z.object({
        ...projectFields,
        file_path: z.string().describe("File path in the repo (e.g. .gitlab-ci.yml, src/main.ts)."),
        ref: z.string().optional().describe("Branch, tag, or SHA. Default: project default_branch."),
        max_chars: z.number().int().positive().max(500_000).optional().default(100_000),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc }) => {
          let ref = args.ref?.trim();
          if (!ref) {
            const proj = (await client.getJson(`/projects/${enc}`)) as { default_branch?: string };
            ref = proj.default_branch ?? "main";
          }
          const encodedPath = encodeURIComponent(args.file_path.replace(/^\//, ""));
          const qs = new URLSearchParams({ ref });
          const content = await client.requestText(
            `/projects/${enc}/repository/files/${encodedPath}/raw?${qs}`,
          );
          const max = args.max_chars ?? 100_000;
          const truncated = content.length > max;
          return {
            file_path: args.file_path,
            ref,
            size_chars: content.length,
            truncated,
            content: truncated ? content.slice(0, max) : content,
          };
        }),
      ),
  );

  server.registerTool(
    "gitlab_compare",
    {
      title: "Compare branches or commits",
      description:
        "Diff between two refs (branches, tags, or SHAs). Returns commits and file diffs.",
      inputSchema: z.object({
        ...projectFields,
        from: z.string().describe("Source ref (branch, tag, or SHA)."),
        to: z.string().describe("Target ref (branch, tag, or SHA)."),
        straight: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, direct comparison without merge-base."),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc }) => {
          const qs = new URLSearchParams({
            from: args.from,
            to: args.to,
            straight: String(args.straight ?? false),
          });
          const compare = await client.getJson(`/projects/${enc}/repository/compare?${qs}`);
          return { from: args.from, to: args.to, compare };
        }),
      ),
  );
}
