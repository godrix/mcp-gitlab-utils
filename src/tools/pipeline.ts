import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveMergeRequestIid } from "../resolve-project.js";
import { assertWriteAllowed, PIPELINE_WRITE_ACTIONS } from "../config.js";
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

async function resolvePipelineId(
  client: import("../gitlab-client.js").GitLabClient,
  enc: string,
  pipelineId: number | undefined,
  mergeRequestIid: number | undefined,
  repoPath: string | undefined,
  projectRef: string,
): Promise<number> {
  if (pipelineId !== undefined) {
    return pipelineId;
  }
  const iid = await resolveMergeRequestIid(client, projectRef, mergeRequestIid, repoPath);
  const mr = (await client.getJson(`/projects/${enc}/merge_requests/${iid}`)) as {
    head_pipeline?: { id?: number } | null;
  };
  const pid = mr.head_pipeline?.id;
  if (pid === undefined) {
    throw new Error("MR has no head_pipeline. Pass pipeline_id explicitly.");
  }
  return pid;
}

export function registerPipelineTools(server: McpServer): void {
  server.registerTool(
    "gitlab_list_pipelines",
    {
      title: "List pipelines",
      description:
        "Lists recent project pipelines, filtering by ref (branch/tag), MR, or status.",
      inputSchema: z.object({
        ...projectFields,
        ref: z.string().optional().describe("Branch ou tag (ex.: main, feature/foo)."),
        merge_request_iid: mergeRequestIidField,
        status: z
          .enum(["created", "waiting_for_resource", "preparing", "pending", "running", "success", "failed", "canceled", "skipped", "manual", "scheduled"])
          .optional()
          .describe("Filter by pipeline status."),
        per_page: perPageField(20, 100),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          const qs = new URLSearchParams({ per_page: String(args.per_page ?? 20) });
          if (args.ref?.trim()) {
            qs.set("ref", args.ref.trim());
          }
          if (args.status) {
            qs.set("status", args.status);
          }
          if (args.merge_request_iid !== undefined) {
            qs.set("merge_request_iid", String(args.merge_request_iid));
          } else if (args.repo_path?.trim()) {
            const iid = await resolveMergeRequestIid(
              client,
              projectRef,
              undefined,
              args.repo_path,
            );
            qs.set("merge_request_iid", String(iid));
          }
          const pipelines = await client.getJson(`/projects/${enc}/pipelines?${qs}`);
          return { pipelines };
        }),
      ),
  );

  server.registerTool(
    "gitlab_get_pipeline",
    {
      title: "Pipeline details",
      description: "Returns pipeline state and job list with summary (name, stage, status, duration).",
      inputSchema: z.object({
        ...projectFields,
        pipeline_id: z.number().int().positive().optional(),
        merge_request_iid: mergeRequestIidField,
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          const pid = await resolvePipelineId(
            client,
            enc,
            args.pipeline_id,
            args.merge_request_iid,
            args.repo_path,
            projectRef,
          );
          const pipeline = await client.getJson(`/projects/${enc}/pipelines/${pid}`);
          const jobs = await client.getJson(`/projects/${enc}/pipelines/${pid}/jobs`);
          return { pipeline_id: pid, pipeline, jobs };
        }),
      ),
  );

  server.registerTool(
    "gitlab_get_job_trace",
    {
      title: "CI job log",
      description: "Returns the trace (full or truncated log) for a job by job_id.",
      inputSchema: z.object({
        ...projectFields,
        job_id: z.number().int().positive().describe("Job ID (not to be confused with pipeline_id)."),
        max_chars: z.number().int().positive().max(500_000).optional().default(48_000),
      }),
      annotations: readOnly,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc }) => {
          const trace = await client.requestText(`/projects/${enc}/jobs/${args.job_id}/trace`);
          const job = await client.getJson(`/projects/${enc}/jobs/${args.job_id}`);
          return {
            job_id: args.job_id,
            job,
            trace: truncate(trace, args.max_chars ?? 48_000),
            trace_total_chars: trace.length,
          };
        }),
      ),
  );

  server.registerTool(
    "gitlab_control_pipeline",
    {
      title: "Control pipeline and jobs",
      description:
        "Lists jobs, plays manual jobs, retries job/pipeline, or cancels pipeline.",
      inputSchema: z.object({
        ...projectFields,
        action: z.enum(["list_jobs", "play", "retry_job", "retry_pipeline", "cancel_pipeline"]),
        pipeline_id: z.number().int().positive().optional(),
        job_id: z.number().int().positive().optional(),
        merge_request_iid: mergeRequestIidField,
      }),
      annotations: writeAction,
    },
    async (args) =>
      runTool(() =>
        withGitLab(args, async ({ client, enc, projectRef }) => {
          if (PIPELINE_WRITE_ACTIONS.has(args.action)) {
            assertWriteAllowed(`gitlab_control_pipeline action=${args.action}`);
          }

          const pipelineId = await resolvePipelineId(
            client,
            enc,
            args.pipeline_id,
            args.merge_request_iid,
            args.repo_path,
            projectRef,
          );

          if (args.action === "list_jobs") {
            const jobs = await client.getJson(`/projects/${enc}/pipelines/${pipelineId}/jobs`);
            return { pipeline_id: pipelineId, jobs };
          }

          if (args.action === "play" || args.action === "retry_job") {
            if (args.job_id === undefined) {
              throw new Error("job_id is required for play/retry_job.");
            }
            const path =
              args.action === "play"
                ? `/projects/${enc}/jobs/${args.job_id}/play`
                : `/projects/${enc}/jobs/${args.job_id}/retry`;
            const result = await client.postJson(path, {});
            return { ok: true, pipeline_id: pipelineId, result };
          }

          if (args.action === "retry_pipeline") {
            const result = await client.postJson(
              `/projects/${enc}/pipelines/${pipelineId}/retry`,
              {},
            );
            return { ok: true, pipeline_id: pipelineId, result };
          }

          if (args.action === "cancel_pipeline") {
            const result = await client.postJson(
              `/projects/${enc}/pipelines/${pipelineId}/cancel`,
              {},
            );
            return { ok: true, pipeline_id: pipelineId, result };
          }

          throw new Error("Invalid action.");
        }),
      ),
  );
}
