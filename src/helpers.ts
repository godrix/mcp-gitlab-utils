import { z } from "zod";
import { GitLabApiError, GitLabClient, projectPathSegment, requireGitLabEnv } from "./gitlab-client.js";
import { resolveProjectRef, type ResolveProjectArgs } from "./resolve-project.js";

export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) {
    return s;
  }
  return `… (truncated, ${s.length - max} chars omitted)\n${s.slice(-max)}`;
}

export const projectFields = {
  project_id: z
    .string()
    .optional()
    .describe("Numeric ID or group/repo path on GitLab."),
  repo_path: z
    .string()
    .optional()
    .describe("Absolute local clone path; resolves project and MR from current branch."),
};

export const mergeRequestIidField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Merge request IID. Omit with repo_path to resolve from current branch.");

export const perPageField = (defaultValue = 20, max = 100) =>
  z.number().int().min(1).max(max).optional().default(defaultValue);

export type GitLabToolContext = {
  client: GitLabClient;
  projectRef: string;
  enc: string;
  token: string;
  baseUrl: string;
};

export async function withGitLab<T>(
  args: ResolveProjectArgs,
  fn: (ctx: GitLabToolContext) => Promise<T>,
): Promise<T> {
  const gl = requireGitLabEnv();
  const client = new GitLabClient(gl.token, gl.apiBase);
  const baseUrl = process.env.GITLAB_BASE_URL?.trim() ?? "";
  const projectRef = await resolveProjectRef(args, baseUrl);
  const enc = projectPathSegment(projectRef);
  return fn({ client, projectRef, enc, token: gl.token, baseUrl });
}

export async function runTool<T>(fn: () => Promise<T>) {
  try {
    const data = await fn();
    return jsonResult(data);
  } catch (e) {
    if (e instanceof GitLabApiError) {
      return errorResult(e.message);
    }
    const msg = e instanceof Error ? e.message : String(e);
    return errorResult(msg);
  }
}

export const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true } as const;
export const writeAction = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const;
export const destructive = { readOnlyHint: false, destructiveHint: true, openWorldHint: true } as const;
