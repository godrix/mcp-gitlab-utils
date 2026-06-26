#!/usr/bin/env node
import "dotenv/config";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isGitLabReadOnly } from "./config.js";
import { createServer } from "./server.js";

await createServer().connect(new StdioServerTransport());
console.error(
  `@godrix/gitlab-utils-mcp — ${isGitLabReadOnly() ? "Read-only (GITLAB_READ_ONLY=true)" : "Full access"}`,
);
