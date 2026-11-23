import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { Link } from "@tanstack/react-router";
import {
  ProviderInstanceId,
  type ClaudeConnectorSummary,
  type EnvironmentId,
} from "@t3tools/contracts";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { claudeConnectorEnvironment } from "../../state/claudeConnectors";
import { useEnvironmentQuery } from "../../state/query";
import { providersIgnoringCheckedAtAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AddConnectorDialog } from "./AddConnectorDialog";
import { ConnectorSignInDialog } from "./ConnectorSignInDialog";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

const DEFAULT_CLAUDE_INSTANCE = ProviderInstanceId.make("claudeAgent");

/** The server's safe detail for a failed command; null on success or when the call was dropped. */
const failureMessage = (
  result: AtomCommandResult<unknown, unknown>,
  fallback: string,
): string | null => {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : fallback;
};

/** A Claude instance's own MCP servers, kept in that instance's config directory. */
export function ConnectorsSettings({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const sectionId = searchableSetting("connectors").id;
  const providers = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  const claudeInstances = providers.filter((provider) => provider.driver === "claudeAgent");
  const [picked, setPicked] = useState<ProviderInstanceId | null>(null);
  const instanceId =
    claudeInstances.find((provider) => provider.instanceId === picked)?.instanceId ??
    claudeInstances.find((provider) => provider.instanceId === DEFAULT_CLAUDE_INSTANCE)
      ?.instanceId ??
    claudeInstances[0]?.instanceId ??
    null;

  if (instanceId === null) {
    return (
      <SettingsPageContainer>
        <SettingsSection id={sectionId} title={gt("Connectors")}>
          <SettingsRow
            title={gt("Add a Claude provider first")}
            description={gt(
              "Connectors belong to a Claude provider. Add one on {label} to give it connectors.",
              { label: environmentLabel },
            )}
            control={
              <Button size="xs" variant="outline" render={<Link to="/settings/providers" />}>
                <T>Open Providers</T>
              </Button>
            }
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      <InstanceConnectors
        // Drafts and dialogs belong to one instance; switching must not carry them over.
        key={`${environmentId}:${instanceId}`}
        sectionId={sectionId}
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        instanceId={instanceId}
        instancePicker={
          claudeInstances.length > 1 ? (
            <Select
              value={instanceId}
              onValueChange={(next) => setPicked(ProviderInstanceId.make(String(next)))}
            >
              <SelectTrigger aria-label={gt("Claude provider")} size="xs">
                <SelectValue>
                  {claudeInstances.find((provider) => provider.instanceId === instanceId)
                    ?.displayName ?? instanceId}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {claudeInstances.map((provider) => (
                  <SelectItem key={provider.instanceId} value={provider.instanceId}>
                    {provider.displayName ?? provider.instanceId}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null
        }
      />
    </SettingsPageContainer>
  );
}

function InstanceConnectors({
  sectionId,
  environmentId,
  environmentLabel,
  instanceId,
  instancePicker,
}: {
  readonly sectionId: string;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly instanceId: ProviderInstanceId;
  readonly instancePicker: ReactNode;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    claudeConnectorEnvironment.list({ environmentId, input: { instanceId } }),
  );
  const canEdit = useAtomValue(claudeConnectorEnvironment.add.permissionAtom(environmentId));
  const setAccountConnectors = useAtomCommand(claudeConnectorEnvironment.setAccountConnectors, {
    label: "switch account connectors",
  });
  const [adding, setAdding] = useState(false);
  const [accountFailure, setAccountFailure] = useState<string | null>(null);
  const title = gt("Connectors");

  if (query.data === null && (query.isPending || query.error === null)) {
    return (
      <SettingsSection id={sectionId} title={title} headerAction={instancePicker}>
        <div className="grid gap-3 px-4 py-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-8 w-full" />
        </div>
      </SettingsSection>
    );
  }

  if (query.data === null) {
    // A server without these methods answers with a defect, so no typed failure arrives.
    const failure = query.failure;
    const description =
      failure !== null && "_tag" in failure && failure._tag === "EnvironmentAuthorizationError"
        ? gt(
            "You need permission to manage providers on {label} to see and change its connectors.",
            { label: environmentLabel },
          )
        : failure === null
          ? gt("This environment's T3 Code doesn't have Connectors.")
          : (query.error ?? gt("The request failed."));
    return (
      <SettingsSection id={sectionId} title={title} headerAction={instancePicker}>
        <SettingsRow
          title={gt("Connectors are unavailable")}
          description={description}
          control={
            <Button size="xs" variant="outline" onClick={query.refresh}>
              <T>Retry</T>
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  const state = query.data;
  const switchAccountConnectors = async (enabled: boolean) => {
    setAccountFailure(null);
    const result = await setAccountConnectors({ environmentId, input: { instanceId, enabled } });
    setAccountFailure(failureMessage(result, gt("The request failed.")));
  };
  return (
    <>
      <SettingsSection
        id={sectionId}
        title={title}
        titleAction={
          canEdit ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    onClick={() => setAdding(true)}
                    aria-label={gt("Add connector")}
                  >
                    <PlusIcon />
                  </Button>
                }
              />
              <TooltipPopup side="top">
                <T>Add connector</T>
              </TooltipPopup>
            </Tooltip>
          ) : null
        }
        headerAction={instancePicker}
      >
        {canEdit ? null : (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            <T>You can see these connectors, but you don't have permission to change them.</T>
          </p>
        )}
        <SettingsRow
          title={gt("Account connectors (claude.ai)")}
          description={gt(
            "When on, sessions also get the connectors set up on claude.ai for this subscription, which everyone who uses the subscription sees. Applies to new sessions.",
          )}
          control={
            <Switch
              checked={state.accountConnectorsEnabled}
              disabled={!canEdit || query.isPending}
              onCheckedChange={(checked) => void switchAccountConnectors(Boolean(checked))}
              aria-label={gt("Account connectors (claude.ai)")}
            />
          }
          status={accountFailure ? <FailureText>{accountFailure}</FailureText> : null}
        />
        {state.servers.length === 0 ? (
          <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground sm:px-4">
            <T>
              No connectors yet. Add one to give this provider's sessions more tools. They live in{" "}
              <Var>{state.configDir}</Var>.
            </T>
          </p>
        ) : (
          state.servers.map((server) => (
            <ConnectorRow
              key={server.name}
              environmentId={environmentId}
              instanceId={instanceId}
              server={server}
              canEdit={canEdit}
            />
          ))
        )}
        {canEdit ? (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground sm:px-4"
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="size-4 shrink-0" />
            <T>Add connector</T>
          </button>
        ) : null}
      </SettingsSection>
      <AddConnectorDialog
        open={adding}
        onOpenChange={setAdding}
        environmentId={environmentId}
        instanceId={instanceId}
        takenNames={state.servers.map((server) => server.name)}
      />
    </>
  );
}

function ConnectorRow({
  environmentId,
  instanceId,
  server,
  canEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly server: ClaudeConnectorSummary;
  readonly canEdit: boolean;
}) {
  const gt = useGT();
  const m = useMessages();
  const remove = useAtomCommand(claudeConnectorEnvironment.remove, {
    label: `remove connector ${server.name}`,
  });
  const signOut = useAtomCommand(claudeConnectorEnvironment.signOut, {
    label: `sign out of connector ${server.name}`,
  });
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const target = { environmentId, input: { instanceId, name: server.name } };
  const run = async (action: () => Promise<AtomCommandResult<unknown, unknown>>) => {
    setBusy(true);
    setFailure(null);
    const result = await action();
    setBusy(false);
    setFailure(failureMessage(result, gt("The request failed.")));
  };

  return (
    <SettingsRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{server.name}</span>
          <Badge variant="outline" size="sm">
            {m(TRANSPORT_LABELS[server.transport])}
          </Badge>
        </span>
      }
      description={
        <span className="grid gap-0.5">
          <span className="truncate font-mono text-xs">{server.target}</span>
          {server.secretNames.length > 0 ? (
            <span>{gt("Uses: {names}", { names: server.secretNames.join(", ") })}</span>
          ) : null}
        </span>
      }
      status={failure ? <FailureText>{failure}</FailureText> : null}
      control={
        canEdit ? (
          <div className="flex items-center gap-1">
            {server.canSignIn ? (
              <>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setSigningIn(true)}
                >
                  <T>Sign in</T>
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => signOut(target))}
                >
                  <T>Sign out</T>
                </Button>
              </>
            ) : null}
            <Button
              size="xs"
              variant="ghost-destructive"
              disabled={busy}
              onClick={() => setConfirmingRemove(true)}
            >
              <T>Remove</T>
            </Button>
            <AlertDialog open={confirmingRemove} onOpenChange={setConfirmingRemove}>
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    <T>
                      Remove <Var>{server.name}</Var>?
                    </T>
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    <T>
                      New sessions stop getting this connector's tools. Running sessions keep it
                      until they end. To change a connector, remove it and add it again.
                    </T>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="outline" />}>
                    <T>Cancel</T>
                  </AlertDialogClose>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setConfirmingRemove(false);
                      void run(() => remove(target));
                    }}
                  >
                    <T>Remove</T>
                  </Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>
            {signingIn ? (
              <ConnectorSignInDialog
                environmentId={environmentId}
                instanceId={instanceId}
                name={server.name}
                onClose={() => setSigningIn(false)}
              />
            ) : null}
          </div>
        ) : null
      }
    />
  );
}

function FailureText({ children }: { readonly children: string }) {
  return (
    <span role="alert" className="text-destructive-foreground">
      {children}
    </span>
  );
}

const TRANSPORT_LABELS: Record<ClaudeConnectorSummary["transport"], string> = {
  http: msg("HTTP"),
  sse: msg("SSE"),
  stdio: msg("Command"),
  ws: msg("WebSocket"),
  unknown: msg("Unknown"),
};
