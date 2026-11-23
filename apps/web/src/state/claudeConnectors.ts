import { createClaudeConnectorEnvironmentAtoms } from "@t3tools/client-runtime/state/claude-connectors";

import { connectionAtomRuntime } from "../connection/runtime";

export const claudeConnectorEnvironment =
  createClaudeConnectorEnvironmentAtoms(connectionAtomRuntime);
