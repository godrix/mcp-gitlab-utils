export const SERVER_INSTRUCTIONS = `MCP server for GitLab (pipelines, merge requests, repository, and local review).

## Project resolution (use in this order)
1. Explicit \`project_id\` (numeric ID or \`group/repo\`)
2. \`repo_path\` — local clone; infers \`group/repo\` from \`origin\` remote
3. \`GITLAB_PROJECT_ID\` environment variable

## MR resolution
- Pass \`merge_request_iid\` when you know the MR number
- With \`repo_path\`, the current branch resolves the open MR (\`source_branch\`)
- Call \`gitlab_resolve_context\` first when working locally without a known IID

## Recommended agent workflows
- **Review MR:** \`gitlab_resolve_context\` → \`gitlab_get_mr_context\` (diff + CI traces) → \`gitlab_get_mr_discussions\` → \`gitlab_add_mr_inline_comment\` for line-level feedback
- **Check merge readiness:** \`gitlab_get_mr_merge_status\` — conflicts, draft, pipeline, approvals, blockers
- **Complete MR lifecycle:** \`gitlab_get_mr_merge_status\` → \`gitlab_manage_merge_requests\` (merge/close/mark_ready)
- **Fix CI:** \`gitlab_get_pipeline\` → \`gitlab_get_job_trace\` → \`gitlab_control_pipeline\` (retry/play)
- **Prepare local code:** \`gitlab_prepare_review\` (worktree + install)
- **Explore remote repo:** \`gitlab_get_file\`, \`gitlab_compare\`

## MR lifecycle (\`gitlab_manage_merge_requests\`)
- \`merge\` — merge with optional squash; use \`merge_when_pipeline_succeeds\` if CI is still running
- \`close\` / \`reopen\` — close or reopen MR
- \`mark_draft\` / \`mark_ready\` — draft vs ready for review
- Before merging, confirm with \`gitlab_get_mr_merge_status\`

## Read-only mode
- With \`GITLAB_READ_ONLY=true\`, write operations are blocked: merge, comment, approve, inline comments, pipeline control, and prepare_review.
- Reads (get MR, diff, pipeline, merge status) remain available.

## Conventions
- IID ≠ internal MR ID; always use the IID visible in the URL
- Pipelines: MR \`head_pipeline\` is from the latest push
- GitLab errors include HTTP status and response excerpt — adjust token, permissions, or parameters
`;
