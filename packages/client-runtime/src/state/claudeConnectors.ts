import { WS_METHODS, type EnvironmentId, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom, AtomRegistry } from "effect/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type * as Persistence from "../platform/persistence.ts";

/**
 * A Claude instance's connectors (user-scope MCP servers) per environment. Every change refreshes
 * the list, so the settings page never shows a server the CLI already removed.
 */
export function createClaudeConnectorEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Persistence.EnvironmentCacheStore | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:claude-connectors:list",
    tag: WS_METHODS.claudeConnectorsList,
  });
  const refreshList = (
    target: {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly instanceId: ProviderInstanceId };
    },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() =>
      registry.refresh(
        list({
          environmentId: target.environmentId,
          input: { instanceId: target.input.instanceId },
        }),
      ),
    );
  // Each change runs the CLI against one config file, so they go one at a time per environment.
  const serialPerEnvironment = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };
  return {
    list,
    add: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:add",
      tag: WS_METHODS.claudeConnectorsAdd,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
      onSettled: refreshList,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:remove",
      tag: WS_METHODS.claudeConnectorsRemove,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
      onSettled: refreshList,
    }),
    setAccountConnectors: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:set-account-connectors",
      tag: WS_METHODS.claudeConnectorsSetAccountConnectors,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
      onSettled: refreshList,
    }),
    signOut: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:sign-out",
      tag: WS_METHODS.claudeConnectorsSignOut,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
      onSettled: refreshList,
    }),
    signInStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:sign-in-start",
      tag: WS_METHODS.claudeConnectorsSignInStart,
      scheduler: commandScheduler,
    }),
    signInComplete: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:sign-in-complete",
      tag: WS_METHODS.claudeConnectorsSignInComplete,
      scheduler: commandScheduler,
    }),
    signInCancel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:claude-connectors:sign-in-cancel",
      tag: WS_METHODS.claudeConnectorsSignInCancel,
      scheduler: commandScheduler,
    }),
  };
}
