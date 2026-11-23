import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useId, useState } from "react";

import { claudeConnectorEnvironment } from "../../state/claudeConnectors";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  buildConnectorDefinition,
  type ConnectorDraft,
  type ConnectorDraftError,
  type ConnectorKind,
} from "./ConnectorsSettings.logic";

const EMPTY_DRAFT: ConnectorDraft = {
  name: "",
  kind: "http",
  url: "",
  headers: "",
  command: "",
  args: "",
  env: "",
};

export function AddConnectorDialog({
  open,
  onOpenChange,
  environmentId,
  instanceId,
  takenNames,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly takenNames: ReadonlyArray<string>;
}) {
  const gt = useGT();
  const formId = useId();
  const add = useAtomCommand(claudeConnectorEnvironment.add, {
    label: "add connector",
    reportFailure: false,
  });
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const update = (patch: Partial<ConnectorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFailure(null);
  };
  const close = () => {
    setDraft(EMPTY_DRAFT);
    setFailure(null);
    onOpenChange(false);
  };

  const describe = (error: ConnectorDraftError): string => {
    const field = (name: "headers" | "env") =>
      name === "headers" ? gt("Headers") : gt("Environment");
    switch (error._tag) {
      case "InvalidName":
        return gt(
          "Use letters, numbers, dots, dashes or underscores for the name, starting with a letter or number.",
        );
      case "InvalidUrl":
        return gt("Enter a web address that starts with http:// or https://.");
      case "InvalidCommand":
        return gt("Enter the command that starts the server.");
      case "MalformedLine":
        return error.field === "headers"
          ? gt("Headers line {line} needs a name and a value, like Authorization: Bearer token.", {
              line: error.line,
            })
          : gt("Environment line {line} needs a name and a value, like API_KEY=value.", {
              line: error.line,
            });
      case "InvalidKey":
        return gt("{field} line {line} has a name with characters that aren't allowed.", {
          field: field(error.field),
          line: error.line,
        });
      case "DuplicateKey":
        return gt("{field} names {key} more than once.", {
          field: field(error.field),
          key: error.key,
        });
      case "ValueTooLong":
        return gt("{field} line {line} is too long.", {
          field: field(error.field),
          line: error.line,
        });
    }
  };

  const save = async () => {
    const built = buildConnectorDefinition(draft);
    if (!built.ok) {
      setFailure(describe(built.error));
      return;
    }
    if (takenNames.includes(built.value.name)) {
      setFailure(gt("A connector with this name already exists. Remove it first to change it."));
      return;
    }
    setBusy(true);
    const result = await add({ environmentId, input: { instanceId, ...built.value } });
    setBusy(false);
    if (result._tag === "Success") {
      close();
      return;
    }
    const error = squashAtomCommandFailure(result);
    setFailure(error instanceof Error ? error.message : gt("The request failed."));
  };

  const kinds: ReadonlyArray<{ readonly value: ConnectorKind; readonly label: string }> = [
    { value: "http", label: gt("Web address (HTTP)") },
    { value: "sse", label: gt("Web address (SSE)") },
    { value: "stdio", label: gt("Command") },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <T>Add a connector</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              An MCP server this Claude provider's sessions can use. Header and environment values
              stay on the server and are never shown again.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`${formId}-name`}>
                <T>Name</T>
              </Label>
              <Input
                id={`${formId}-name`}
                placeholder="linear"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label>
                <T>Kind</T>
              </Label>
              <Select
                value={draft.kind}
                onValueChange={(next) => update({ kind: next as ConnectorKind })}
              >
                <SelectTrigger aria-label={gt("Kind")}>
                  <SelectValue>
                    {kinds.find((kind) => kind.value === draft.kind)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {kinds.map((kind) => (
                    <SelectItem key={kind.value} value={kind.value}>
                      {kind.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {draft.kind === "stdio" ? (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${formId}-command`}>
                    <T>Command</T>
                  </Label>
                  <Input
                    id={`${formId}-command`}
                    placeholder="npx"
                    value={draft.command}
                    onChange={(event) => update({ command: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${formId}-args`}>
                    <T>Arguments (one per line)</T>
                  </Label>
                  <Textarea
                    id={`${formId}-args`}
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
                    value={draft.args}
                    onChange={(event) => update({ args: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${formId}-env`}>
                    <T>Environment (NAME=value per line)</T>
                  </Label>
                  <Textarea
                    id={`${formId}-env`}
                    placeholder={gt("API_KEY=your key")}
                    value={draft.env}
                    onChange={(event) => update({ env: event.target.value })}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${formId}-url`}>
                    <T>URL</T>
                  </Label>
                  <Input
                    id={`${formId}-url`}
                    placeholder="https://mcp.example.com/mcp"
                    value={draft.url}
                    onChange={(event) => update({ url: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`${formId}-headers`}>
                    <T>Headers (Name: value per line)</T>
                  </Label>
                  <Textarea
                    id={`${formId}-headers`}
                    placeholder={gt("Authorization: Bearer your token")}
                    value={draft.headers}
                    onChange={(event) => update({ headers: event.target.value })}
                  />
                </div>
              </>
            )}
            {failure ? (
              <p role="alert" className="text-sm text-destructive-foreground">
                {failure}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button variant="outline" onClick={close}>
            <T>Cancel</T>
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            <T>Add connector</T>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
