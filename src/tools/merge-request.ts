import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GitLabClient } from "../gitlab-client.js";
import { assertWriteAllowed } from "../config.js";
import {
  getCurrentBranch,
  resolveMergeRequestIid,
} from "../resolve-project.js";
import {
  mergeRequestIidField,
  perPageField,
  projectFields,
  readOnly,
  runTool,
  truncate,
  withGitLab,
  writeAction,
} from "../helpers.js";

type MrDiffRefs = {
  base_sha?: string;
  head_sha?: string;
  start_sha?: string;
};

type MrMergeFields = {
  state?: string;
  draft?: boolean;
  work_in_progress?: boolean;
  merge_status?: string;
  detailed_merge_status?: string;
  mergeable?: boolean | null;
  has_conflicts?: boolean;
  blocking_discussions_resolved?: boolean;
  merge_error?: string | null;
  web_url?: string;
  head_pipeline?: { id?: number; status?: string } | null;
  diff_refs?: MrDiffRefs | null;
};

type ApprovalsResponse = {
  approvals_required?: number;
  approvals_left?: number;
  approved?: boolean;
  approved_by?: Array<{ user?: { name?: string; username?: string } }>;
};

async function fetchMrDiffRefs(
  client: GitLabClient,
  enc: string,
  iid: number,
): Promise<MrDiffRefs> {
  const mr = (await client.getJson(`/projects/${enc}/merge_requests/${iid}`)) as {
    diff_refs?: MrDiffRefs | null;
  };
  const refs = mr.diff_refs;
  if (!refs?.base_sha || !refs.head_sha || !refs.start_sha) {
    throw new Error(
      "MR missing complete diff_refs (base_sha/head_sha/start_sha). MR may be empty or closed.",
    );
  }
  return refs;
}

function buildMergeBlockers(mr: MrMergeFields, approvals: ApprovalsResponse): string[] {
  const blockers: string[] = [];

  if (mr.state !== "opened") {
    blockers.push(`MR is not open (state=${mr.state ?? "unknown"})`);
  }
  if (mr.draft || mr.work_in_progress) {
    blockers.push("MR is in draft (draft/WIP)");
  }
  if (mr.has_conflicts) {
    blockers.push("Merge conflicts exist");
  }
  if (mr.blocking_discussions_resolved === false) {
    blockers.push("Unresolved blocking discussions");
  }
  if (mr.merge_status === "cannot_be_merged") {
    blockers.push("merge_status=cannot_be_merged");
  }
  const okDetailed = new Set([
    "mergeable",
    "mergeable_with_exceptions",
    "unchecked",
    "checking",
    "ci_still_running",
    "not_approved",
  ]);
  if (mr.detailed_merge_status && !okDetailed.has(mr.detailed_merge_status)) {
    blockers.push(`detailed_merge_status=${mr.detailed_merge_status}`);
  }
  if (approvals.approved === false && (approvals.approvals_left ?? 0) > 0) {
    blockers.push(`${approvals.approvals_left} approval(s) missing`);
  }
  const pipelineStatus = mr.head_pipeline?.status;
  if (pipelineStatus === "failed") {
    blockers.push("Head pipeline failed");
  }
  if (pipelineStatus === "canceled") {
    blockers.push("Head pipeline canceled");
  }
  if (mr.merge_error) {
    blockers.push(`merge_error: ${mr.merge_error}`);
  }

  return blockers;
}

export function registerMergeRequestTools(server: McpServer): void {
  server.registerTool(
    "gitlab_get_merge_request",
    {
      title: "Merge request details",
      description:
        "Returns MR metadata: title, state, branches, reviewers, labels, head pipeline, approvals, and URL.",
      inputSchema: z.object({
        ...projectFields,
        merge_request_iid: mergeRequestIidField,
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );
          const mr = await client.getJson(`/projects/${enc}/merge_requests/${iid}`);
          return { merge_request_iid: iid, merge_request: mr };
        }),
      ),
  );

  server.registerTool(
    "gitlab_get_mr_context",
    {
      title: "MR context (diff + pipeline + discussions)",
      description:
        "Returns MR changes/diff and optionally failed job traces and review discussions.",
      inputSchema: z.object({
        ...projectFields,
        merge_request_iid: mergeRequestIidField,
        include_failed_jobs_trace: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, attaches logs from failed jobs on head_pipeline."),
        include_discussions: z
          .boolean()
          .optional()
          .default(false)
          .describe("When true, includes discussion threads and inline comments."),
        trace_max_chars: z.number().int().positive().max(500_000).optional().default(24_000),
        discussions_per_page: perPageField(20, 50),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );

          const changes = await client.getJson(`/projects/${enc}/merge_requests/${iid}/changes`);
          const mr = (await client.getJson(`/projects/${enc}/merge_requests/${iid}`)) as {
            head_pipeline?: { id?: number } | null;
          };
          const out: Record<string, unknown> = { merge_request_iid: iid, changes };

          if (args.include_failed_jobs_trace && mr.head_pipeline?.id) {
            const pid = mr.head_pipeline.id;
            const jobs = (await client.getJson(
              `/projects/${enc}/pipelines/${pid}/jobs`,
            )) as Array<{ id: number; name: string; status: string }>;
            const failed = jobs.filter((j) => j.status === "failed");
            const traces: { job_id: number; name: string; trace_excerpt: string }[] = [];
            for (const j of failed) {
              const trace = await client.requestText(`/projects/${enc}/jobs/${j.id}/trace`);
              traces.push({
                job_id: j.id,
                name: j.name,
                trace_excerpt: truncate(trace, args.trace_max_chars ?? 24_000),
              });
            }
            out.failed_job_traces = traces;
            out.pipeline_id = pid;
          }

          if (args.include_discussions) {
            const qs = new URLSearchParams({
              per_page: String(args.discussions_per_page ?? 20),
            });
            out.discussions = await client.getJson(
              `/projects/${enc}/merge_requests/${iid}/discussions?${qs}`,
            );
          }

          return out;
        }),
      ),
  );

  server.registerTool(
    "gitlab_get_mr_discussions",
    {
      title: "Merge request discussions",
      description: "Lists review threads, inline comments, and general MR notes.",
      inputSchema: z.object({
        ...projectFields,
        merge_request_iid: mergeRequestIidField,
        per_page: perPageField(20, 100),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );
          const qs = new URLSearchParams({ per_page: String(args.per_page ?? 20) });
          const discussions = await client.getJson(
            `/projects/${enc}/merge_requests/${iid}/discussions?${qs}`,
          );
          return { merge_request_iid: iid, discussions };
        }),
      ),
  );

  server.registerTool(
    "gitlab_get_mr_merge_status",
    {
      title: "MR merge status",
      description:
        "Summarizes whether the MR can be merged: conflicts, draft, pipeline, approvals, blocking discussions, and actionable blockers.",
      inputSchema: z.object({
        ...projectFields,
        merge_request_iid: mergeRequestIidField,
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );

          const mr = (await client.getJson(`/projects/${enc}/merge_requests/${iid}`)) as MrMergeFields;
          let approvals: ApprovalsResponse = {};
          try {
            approvals = (await client.getJson(
              `/projects/${enc}/merge_requests/${iid}/approvals`,
            )) as ApprovalsResponse;
          } catch {
            approvals = { approved: undefined, approvals_left: undefined };
          }

          const blockers = buildMergeBlockers(mr, approvals);
          const pipelineStatus = mr.head_pipeline?.status;
          const checking =
            mr.merge_status === "checking" ||
            mr.detailed_merge_status === "checking" ||
            mr.mergeable === null;

          const readyToMerge = blockers.length === 0 && !checking && mr.mergeable !== false;

          return {
            merge_request_iid: iid,
            web_url: mr.web_url,
            state: mr.state,
            draft: mr.draft ?? mr.work_in_progress ?? false,
            merge_status: mr.merge_status,
            detailed_merge_status: mr.detailed_merge_status,
            mergeable: mr.mergeable,
            has_conflicts: mr.has_conflicts ?? false,
            blocking_discussions_resolved: mr.blocking_discussions_resolved ?? true,
            head_pipeline: mr.head_pipeline ?? null,
            approvals: {
              approved: approvals.approved,
              approvals_required: approvals.approvals_required,
              approvals_left: approvals.approvals_left,
              approved_by: (approvals.approved_by ?? []).map((a) => ({
                name: a.user?.name,
                username: a.user?.username,
              })),
            },
            ready_to_merge: readyToMerge,
            checking,
            blockers,
            pipeline_blocking:
              pipelineStatus === "failed" ||
              pipelineStatus === "canceled" ||
              pipelineStatus === "running" ||
              pipelineStatus === "pending",
          };
        }),
      ),
  );

  server.registerTool(
    "gitlab_add_mr_inline_comment",
    {
      title: "Inline MR diff comment",
      description:
        "Creates a review thread on a specific diff line (file + new_line or old_line). Requires write permissions.",
      inputSchema: z.object({
        ...projectFields,
        merge_request_iid: mergeRequestIidField,
        body: z.string().min(1).describe("Comment text."),
        file_path: z.string().describe("File path in the diff (e.g. src/app.ts)."),
        new_line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Line in the new file (additions/changes)."),
        old_line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Line in the old file (deletions)."),
        old_path: z
          .string()
          .optional()
          .describe("Old path if the file was renamed; default=file_path."),
        new_path: z
          .string()
          .optional()
          .describe("New path if the file was renamed; default=file_path."),
      }),
      annotations: writeAction,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          assertWriteAllowed("gitlab_add_mr_inline_comment");

          if (!args.new_line && !args.old_line) {
            throw new Error("Provide new_line (added/changed line) or old_line (removed line).");
          }

          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );
          const refs = await fetchMrDiffRefs(client, enc, iid);

          const oldPath = args.old_path?.trim() || args.file_path.trim();
          const newPath = args.new_path?.trim() || args.file_path.trim();

          const position: Record<string, unknown> = {
            position_type: "text",
            base_sha: refs.base_sha,
            start_sha: refs.start_sha,
            head_sha: refs.head_sha,
            old_path: oldPath,
            new_path: newPath,
          };
          if (args.old_line) {
            position.old_line = args.old_line;
          }
          if (args.new_line) {
            position.new_line = args.new_line;
          }

          const result = await client.postJson(`/projects/${enc}/merge_requests/${iid}/discussions`, {
            body: args.body.trim(),
            position,
          });

          return {
            ok: true,
            merge_request_iid: iid,
            file_path: args.file_path,
            new_line: args.new_line,
            old_line: args.old_line,
            discussion: result,
          };
        }),
      ),
  );

  server.registerTool(
    "gitlab_manage_merge_requests",
    {
      title: "Manage merge requests",
      description:
        "List, create, update, approve, merge, close, reopen, draft/ready, or comment on merge requests.",
      inputSchema: z.object({
        ...projectFields,
        action: z.enum([
          "list",
          "get",
          "create",
          "update",
          "approve",
          "unapprove",
          "comment",
          "merge",
          "close",
          "reopen",
          "mark_draft",
          "mark_ready",
        ]),
        merge_request_iid: mergeRequestIidField,
        state: z.enum(["opened", "closed", "merged", "all"]).optional().describe("Filter for list action."),
        source_branch: z.string().optional().describe("Filter for list or branch for create."),
        target_branch: z.string().optional().describe("Target branch for create (default: project default_branch)."),
        title: z.string().optional().describe("Title (create/update)."),
        description: z.string().optional().describe("Description (create/update)."),
        labels: z.string().optional().describe("Comma-separated labels (create/update)."),
        remove_source_branch: z.boolean().optional().describe("Remove branch after merge (create/update/merge)."),
        comment: z.string().optional().describe("Comment body (comment action)."),
        squash: z.boolean().optional().describe("Squash commits when merging."),
        merge_commit_message: z.string().optional().describe("Merge commit message."),
        squash_commit_message: z.string().optional().describe("Squash commit message."),
        merge_when_pipeline_succeeds: z
          .boolean()
          .optional()
          .describe("Schedule merge when pipeline succeeds."),
        sha: z
          .string()
          .optional()
          .describe("Expected source branch SHA (GitLab merge validation)."),
        list_per_page: perPageField(20, 100),
      }),
      annotations: writeAction,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          if (args.action !== "list" && args.action !== "get") {
            assertWriteAllowed(`gitlab_manage_merge_requests action=${args.action}`);
          }

          if (args.action === "list") {
            const qs = new URLSearchParams({
              state: args.state ?? "opened",
              per_page: String(args.list_per_page ?? 20),
            });
            if (args.source_branch?.trim()) {
              qs.set("source_branch", args.source_branch.trim());
            } else if (args.repo_path?.trim()) {
              const branch = await getCurrentBranch(args.repo_path.trim());
              if (branch) {
                qs.set("source_branch", branch);
              }
            }
            const data = await client.getJson(`/projects/${enc}/merge_requests?${qs}`);
            return { merge_requests: data };
          }

          if (args.action === "create") {
            let source = args.source_branch?.trim();
            if (!source && args.repo_path?.trim()) {
              const branch = await getCurrentBranch(args.repo_path.trim());
              if (!branch) {
                throw new Error("source_branch required or repo_path with a valid branch.");
              }
              source = branch;
            }
            if (!source) {
              throw new Error("source_branch is required for create.");
            }
            if (!args.title?.trim()) {
              throw new Error("title is required for create.");
            }
            let target = args.target_branch?.trim();
            if (!target) {
              const proj = (await client.getJson(`/projects/${enc}`)) as { default_branch?: string };
              target = proj.default_branch ?? "main";
            }
            const body: Record<string, unknown> = {
              source_branch: source,
              target_branch: target,
              title: args.title.trim(),
            };
            if (args.description) {
              body.description = args.description;
            }
            if (args.labels) {
              body.labels = args.labels;
            }
            if (args.remove_source_branch !== undefined) {
              body.remove_source_branch = args.remove_source_branch;
            }
            const result = await client.postJson(`/projects/${enc}/merge_requests`, body);
            return { ok: true, merge_request: result };
          }

          const iid = await resolveMergeRequestIid(
            client,
            projectRef,
            args.merge_request_iid,
            args.repo_path,
          );

          if (args.action === "get") {
            const mr = await client.getJson(`/projects/${enc}/merge_requests/${iid}`);
            return { merge_request_iid: iid, merge_request: mr };
          }

          if (args.action === "update") {
            const body: Record<string, unknown> = {};
            if (args.title) {
              body.title = args.title;
            }
            if (args.description !== undefined) {
              body.description = args.description;
            }
            if (args.labels) {
              body.labels = args.labels;
            }
            if (args.remove_source_branch !== undefined) {
              body.remove_source_branch = args.remove_source_branch;
            }
            if (Object.keys(body).length === 0) {
              throw new Error("Provide at least one field for update (title, description, labels).");
            }
            const result = await client.putJson(`/projects/${enc}/merge_requests/${iid}`, body);
            return { ok: true, merge_request_iid: iid, result };
          }

          if (args.action === "approve") {
            const result = await client.postJson(`/projects/${enc}/merge_requests/${iid}/approve`, {});
            return { ok: true, merge_request_iid: iid, result };
          }

          if (args.action === "unapprove") {
            const result = await client.postJson(
              `/projects/${enc}/merge_requests/${iid}/unapprove`,
              {},
            );
            return { ok: true, merge_request_iid: iid, result };
          }

          if (args.action === "comment") {
            const body = args.comment?.trim();
            if (!body) {
              throw new Error("comment is required for comment action.");
            }
            const result = await client.postJson(`/projects/${enc}/merge_requests/${iid}/notes`, {
              body,
            });
            return { ok: true, merge_request_iid: iid, result };
          }

          if (args.action === "merge") {
            const body: Record<string, unknown> = {};
            if (args.squash !== undefined) {
              body.squash = args.squash;
            }
            if (args.merge_commit_message) {
              body.merge_commit_message = args.merge_commit_message;
            }
            if (args.squash_commit_message) {
              body.squash_commit_message = args.squash_commit_message;
            }
            if (args.remove_source_branch !== undefined) {
              body.should_remove_source_branch = args.remove_source_branch;
            }
            if (args.merge_when_pipeline_succeeds !== undefined) {
              body.merge_when_pipeline_succeeds = args.merge_when_pipeline_succeeds;
            }
            if (args.sha?.trim()) {
              body.sha = args.sha.trim();
            }
            const result = await client.putJson(
              `/projects/${enc}/merge_requests/${iid}/merge`,
              body,
            );
            return { ok: true, merge_request_iid: iid, merged: true, result };
          }

          if (args.action === "close") {
            const result = await client.putJson(`/projects/${enc}/merge_requests/${iid}`, {
              state_event: "close",
            });
            return { ok: true, merge_request_iid: iid, state: "closed", result };
          }

          if (args.action === "reopen") {
            const result = await client.putJson(`/projects/${enc}/merge_requests/${iid}`, {
              state_event: "reopen",
            });
            return { ok: true, merge_request_iid: iid, state: "opened", result };
          }

          if (args.action === "mark_draft") {
            const result = await client.putJson(`/projects/${enc}/merge_requests/${iid}`, {
              draft: true,
            });
            return { ok: true, merge_request_iid: iid, draft: true, result };
          }

          if (args.action === "mark_ready") {
            const result = await client.putJson(`/projects/${enc}/merge_requests/${iid}`, {
              draft: false,
            });
            return { ok: true, merge_request_iid: iid, draft: false, result };
          }

          throw new Error("Invalid action.");
        }),
      ),
  );
}
