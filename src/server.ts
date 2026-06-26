import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerContextTools } from "./tools/context.js";
import { registerMergeRequestTools } from "./tools/merge-request.js";
import { registerPipelineTools } from "./tools/pipeline.js";
import { registerRepositoryTools } from "./tools/repository.js";
import { registerReviewTools } from "./tools/review.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "@godrix/gitlab-utils-mcp",
      version: "0.3.1",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerContextTools(server);
  registerMergeRequestTools(server);
  registerPipelineTools(server);
  registerRepositoryTools(server);
  registerReviewTools(server);
  registerPrompts(server);
  registerResources(server);

  return server;
}
