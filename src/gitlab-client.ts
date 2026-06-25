export class GitLabApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitLabApiError";
  }
}

export function createApiBaseUrl(gitlabBaseUrl: string): string {
  const trimmed = gitlabBaseUrl.replace(/\/+$/, "");
  if (trimmed.toLowerCase().endsWith("/api/v4")) {
    return trimmed;
  }
  return `${trimmed}/api/v4`;
}

export type GitLabEnv = {
  token: string;
  apiBase: string;
};

export function requireGitLabEnv(): GitLabEnv {
  const token = process.env.GITLAB_TOKEN?.trim();
  const base = process.env.GITLAB_BASE_URL?.trim();
  if (!token) {
    throw new Error("GITLAB_TOKEN is required");
  }
  if (!base) {
    throw new Error("GITLAB_BASE_URL is required");
  }
  return { token, apiBase: createApiBaseUrl(base) };
}

export class GitLabClient {
  constructor(
    private readonly token: string,
    private readonly apiBase: string,
    private readonly timeoutMs = 120_000,
  ) {}

  private async parseBody(res: Response): Promise<unknown> {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return res.json() as Promise<unknown>;
    }
    return res.text();
  }

  async requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const url = `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.token,
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await this.parseBody(res);
    if (!res.ok) {
      const snippet =
        typeof body === "string"
          ? body.slice(0, 500)
          : JSON.stringify(body).slice(0, 500);
      throw new GitLabApiError(res.status, `GitLab ${res.status}: ${snippet}`);
    }
    return body;
  }

  async requestText(path: string, init?: RequestInit): Promise<string> {
    const url = `${this.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.token,
        ...((init?.headers as Record<string, string>) ?? {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new GitLabApiError(res.status, `GitLab ${res.status}: ${text.slice(0, 500)}`);
    }
    return text;
  }

  async getJson(path: string): Promise<unknown> {
    return this.requestJson(path, { method: "GET" });
  }

  async postJson(path: string, body?: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body:
        body === undefined || (typeof body === "object" && body !== null && Object.keys(body as object).length === 0)
          ? "{}"
          : JSON.stringify(body),
    });
  }

  async putJson(path: string, body?: unknown): Promise<unknown> {
    return this.requestJson(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? "{}" : JSON.stringify(body),
    });
  }

  async deleteJson(path: string): Promise<unknown> {
    return this.requestJson(path, { method: "DELETE" });
  }
}

export function projectPathSegment(projectRef: string): string {
  if (/^\d+$/.test(projectRef)) {
    return projectRef;
  }
  return encodeURIComponent(projectRef);
}
