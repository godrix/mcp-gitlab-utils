# @godrix/mcp-gitlab-utils

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en-US/install-mcp?name=gitlab-utils&config=eyJlbnYiOnsiR0lUTEFCX1RPS0VOIjoieW91cl90b2tlbl9oZXJlIiwiR0lUTEFCX0JBU0VfVVJMIjoiaHR0cHM6Ly9naXRsYWIuZXhhbXBsZS5jb20iLCJHSVRMQUJfUkVBRF9PTkxZIjoiZmFsc2UifSwiY29tbWFuZCI6Im5weCAteSBAZ29kcml4L21jcC1naXRsYWItdXRpbHMifQ==)

Node.js [MCP](https://modelcontextprotocol.io) server for the GitLab REST API — built for **AI agents** (pipelines, merge requests, diffs, local review, and context discovery).

**Version 0.3.1** — `gitlab_`-prefixed tools, full MR lifecycle, read-only mode, server instructions, prompts, and resources.

## Prerequisites

- Node.js 18+
- GitLab PAT with `api` and `read_repository` (write scope for merge/comment/approve)
- Git on PATH (for `repo_path`, worktrees, and local review)

## Quick install (npx)

No clone or local build — the published npm package includes compiled JavaScript.

### Cursor / Claude Desktop (`mcp.json`)

```json
{
  "mcpServers": {
    "gitlab-utils": {
      "command": "npx",
      "args": ["-y", "@godrix/mcp-gitlab-utils"],
      "env": {
        "GITLAB_TOKEN": "glpat-...",
        "GITLAB_BASE_URL": "https://gitlab.example.com",
        "GITLAB_READ_ONLY": "false"
      }
    }
  }
}
```

Restart your MCP client after saving. Optional variables: `GITLAB_PROJECT_ID`, `WORKTREE_DIR`.

### Global install (alternative)

```bash
npm install -g @godrix/mcp-gitlab-utils
```

Then use `"command": "mcp-gitlab-utils"` in `mcp.json` (no `npx`).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITLAB_TOKEN` | Yes | Sent as `PRIVATE-TOKEN` header |
| `GITLAB_BASE_URL` | Yes | e.g. `https://gitlab.example.com` |
| `GITLAB_PROJECT_ID` | No | Fallback `group/repo` or numeric ID |
| `WORKTREE_DIR` | No | Default: `/tmp/referencia_ao_mcp_worktree` |
| `GITLAB_READ_ONLY` | No | Default: `false`. When `true`, blocks writes (merge, comment, approve, pipeline control, prepare_review) |

**Project resolution:** pass `project_id` on a tool, or `repo_path` (local clone) to infer `group/repo` from `origin`, or set `GITLAB_PROJECT_ID`.

**MR without IID:** with `repo_path`, the current branch resolves the open MR (`source_branch`); errors if zero or multiple MRs match. Use `gitlab_resolve_context` to discover the IID.

## Tools

### Discovery
| Tool | Description |
|------|-------------|
| `gitlab_resolve_context` | Resolve `project_path`, branch, and MR from `repo_path` |
| `gitlab_search_projects` | Search projects accessible by the token |

### Merge requests
| Tool | Description |
|------|-------------|
| `gitlab_get_merge_request` | MR metadata (state, reviewers, pipeline) |
| `gitlab_get_mr_merge_status` | Mergeability: conflicts, draft, pipeline, approvals, blockers |
| `gitlab_get_mr_context` | Diff/changes + optional CI traces and discussions |
| `gitlab_get_mr_discussions` | Review threads and comments |
| `gitlab_add_mr_inline_comment` | Inline comment on a diff line |
| `gitlab_manage_merge_requests` | `list`, `get`, `create`, `update`, `approve`, `unapprove`, `comment`, `merge`, `close`, `reopen`, `mark_draft`, `mark_ready` |

### CI/CD
| Tool | Description |
|------|-------------|
| `gitlab_list_pipelines` | List pipelines (by ref, MR, or status) |
| `gitlab_get_pipeline` | Pipeline + jobs |
| `gitlab_get_job_trace` | Job log |
| `gitlab_control_pipeline` | `list_jobs`, `play`, `retry_job`, `retry_pipeline`, `cancel_pipeline` |

### Repository
| Tool | Description |
|------|-------------|
| `gitlab_get_file` | Read remote file at a ref (e.g. `.gitlab-ci.yml`) |
| `gitlab_compare` | Diff between two refs |

### Local review
| Tool | Description |
|------|-------------|
| `gitlab_prepare_review` | `git worktree` + `npm ci` / `composer install` |

## Prompts (workflows)

| Prompt | Use |
|--------|-----|
| `review_merge_request` | Full MR review with checklist |
| `merge_merge_request` | Validate mergeability and merge |
| `fix_failed_ci` | Diagnose and fix failed pipeline |
| `create_mr_from_branch` | Create MR from current branch |
| `triage_open_mrs` | Prioritize open MRs |

## Resources

| URI | Content |
|-----|---------|
| `gitlab://guide` | Markdown agent guide (tools and flows) |
| `gitlab://project/{project_ref}` | Project metadata JSON |

## Read-only mode

With `GITLAB_READ_ONLY=true`:

- **Allowed:** reads (MR, diff, pipeline, merge status, list/get)
- **Blocked:** merge, comment, inline comment, approve, create/update MR, pipeline control, prepare_review

Useful for analysis/review agents without mutating GitLab.

## Migration 0.2 → 0.3

New tools and actions (no breaking changes to existing names):

| Addition | Description |
|----------|-------------|
| `gitlab_get_mr_merge_status` | Mergeability state and blockers |
| `gitlab_add_mr_inline_comment` | Inline diff comment |
| `gitlab_manage_merge_requests` | New actions: `merge`, `close`, `reopen`, `mark_draft`, `mark_ready` |

## Migration 0.1 → 0.2

Legacy names were renamed with the `gitlab_` prefix:

| 0.1.0 | 0.2.0 |
|-------|-------|
| `control_pipeline` | `gitlab_control_pipeline` |
| `get_mr_context` | `gitlab_get_mr_context` |
| `manage_mrs` | `gitlab_manage_merge_requests` |
| `prepare_review` | `gitlab_prepare_review` |

`gitlab_control_pipeline`: `retry` → `retry_job`; new actions `retry_pipeline` and `cancel_pipeline`.

## MCPB install (Claude Desktop / local bundle)

Alternative to npx for clients that support `.mcpb` files:

1. Clone the repo: `git clone ... && npm install && npm run build`
2. `npm run pack:mcpb` — produces `.mcpb` with `manifest.json`, `dist/`, and `node_modules`
3. For a smaller bundle: `npm run pack:mcpb:slim`
4. Install the `.mcpb` in your client and fill in token + URL

## Local development

To contribute or test changes before publishing to npm:

```bash
git clone https://github.com/godrix/mcp-gitlab-utils.git
cd mcp-gitlab-utils
npm install
cp .env.example .env   # set GITLAB_TOKEN and GITLAB_BASE_URL
npm run dev            # tsx, stdio
# or
npm run build && npm start
```

Cursor config pointing at the clone (instead of npx):

```json
{
  "mcpServers": {
    "gitlab-utils": {
      "command": "node",
      "args": ["/absolute/path/mcp-gitlab-utils/dist/main.js"],
      "env": {
        "GITLAB_TOKEN": "glpat-...",
        "GITLAB_BASE_URL": "https://gitlab.example.com",
        "GITLAB_READ_ONLY": "false"
      }
    }
  }
}
```

Extra requirements for local review: `npm` and/or `composer` depending on the target repo.

## License

MIT
