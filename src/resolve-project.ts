import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitLabClient } from "./gitlab-client.js";
import { projectPathSegment } from "./gitlab-client.js";

const execFileAsync = promisify(execFile);

export const DEFAULT_WORKTREE_DIR = "/tmp/referencia_ao_mcp_worktree";

export function getWorktreeBaseDir(): string {
  const fromEnv = process.env.WORKTREE_DIR?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_WORKTREE_DIR;
}

export function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

export function parseGitRemoteUrl(remoteUrl: string): { host: string; path: string } {
  const u = remoteUrl.trim();
  if (u.startsWith("git@")) {
    const rest = u.slice(4);
    const colon = rest.indexOf(":");
    if (colon === -1) {
      throw new Error(`Invalid git SSH URL: ${remoteUrl}`);
    }
    const host = rest.slice(0, colon);
    let path = rest.slice(colon + 1);
    if (path.endsWith(".git")) {
      path = path.slice(0, -4);
    }
    return { host: normalizeHost(host), path: path.replace(/^\//, "") };
  }
  try {
    const url = new URL(u);
    const host = normalizeHost(url.hostname);
    let path = url.pathname.replace(/^\/+/, "");
    if (path.endsWith(".git")) {
      path = path.slice(0, -4);
    }
    return { host, path };
  } catch {
    throw new Error(`unrecognized remote origin: ${remoteUrl}`);
  }
}

export function gitlabBaseHost(gitlabBaseUrl: string): string {
  const base = gitlabBaseUrl.replace(/\/+$/, "");
  const withoutApi = base.toLowerCase().endsWith("/api/v4") ? base.slice(0, -"/api/v4".length) : base;
  const url = new URL(withoutApi);
  return normalizeHost(url.hostname);
}

export async function getGitRemoteOrigin(repoPath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function getCurrentBranch(repoPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
      maxBuffer: 1024 * 1024,
    });
    const b = stdout.trim();
    if (b === "HEAD") {
      return null;
    }
    return b;
  } catch {
    return null;
  }
}

export type ResolveProjectArgs = {
  project_id?: string | undefined;
  repo_path?: string | undefined;
};

export async function resolveProjectRef(
  args: ResolveProjectArgs,
  gitlabBaseUrl: string,
): Promise<string> {
  const explicit = args.project_id?.trim();
  if (explicit) {
    return explicit;
  }
  const repo = args.repo_path?.trim();
  if (repo) {
    const remote = await getGitRemoteOrigin(repo);
    const { host, path } = parseGitRemoteUrl(remote);
    const expected = gitlabBaseHost(gitlabBaseUrl);
    if (host !== expected) {
      throw new Error(
        `Remote host (${host}) does not match GITLAB_BASE_URL (${expected}). Pass explicit project_id or use a clone pointing to this instance.`,
      );
    }
    return path;
  }
  const envFallback = process.env.GITLAB_PROJECT_ID?.trim();
  if (envFallback) {
    return envFallback;
  }
  throw new Error(
    "GitLab project not resolved: pass project_id, repo_path (clone directory), or set GITLAB_PROJECT_ID.",
  );
}

export async function resolveMergeRequestIid(
  client: GitLabClient,
  projectRef: string,
  mergeRequestIid: number | undefined,
  repoPath: string | undefined,
): Promise<number> {
  if (mergeRequestIid !== undefined && mergeRequestIid > 0) {
    return mergeRequestIid;
  }
  const repo = repoPath?.trim();
  if (!repo) {
    throw new Error("merge_request_iid is required when repo_path is not provided.");
  }
  const branch = await getCurrentBranch(repo);
  if (!branch) {
    throw new Error("Could not read current branch (detached HEAD?). Pass merge_request_iid.");
  }
  const enc = projectPathSegment(projectRef);
  const qs = new URLSearchParams({
    state: "opened",
    source_branch: branch,
    per_page: "50",
  });
  const data = (await client.getJson(`/projects/${enc}/merge_requests?${qs}`)) as unknown[];
  if (!Array.isArray(data)) {
    throw new Error("Unexpected response when listing merge requests.");
  }
  if (data.length === 0) {
    throw new Error(`No open MR with source_branch=${branch}. Pass merge_request_iid explicitly.`);
  }
  if (data.length > 1) {
    const iids = data.map((m) => (m as { iid?: number }).iid).filter((n) => n !== undefined);
    throw new Error(
      `Multiple open MRs on branch ${branch}. Pass merge_request_iid. Candidates: ${iids.join(", ")}`,
    );
  }
  const iid = (data[0] as { iid: number }).iid;
  if (typeof iid !== "number") {
    throw new Error("MR found without iid.");
  }
  return iid;
}
