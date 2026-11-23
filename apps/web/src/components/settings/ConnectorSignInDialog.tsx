import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { ExternalLinkIcon } from "lucide-react";
import { useId, useState } from "react";

import { ensureLocalApi } from "../../localApi";
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

/**
 * Signs a connector in through the environment's Claude CLI. The browser may end on a localhost
 * page the environment cannot see, so the user pastes that address back; this works remotely too.
 */
export function ConnectorSignInDialog({
  environmentId,
  instanceId,
  name,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const formId = useId();
  const start = useAtomCommand(claudeConnectorEnvironment.signInStart, {
    label: `start connector sign-in ${name}`,
    reportFailure: false,
  });
  const complete = useAtomCommand(claudeConnectorEnvironment.signInComplete, {
    label: `complete connector sign-in ${name}`,
    reportFailure: false,
  });
  const cancel = useAtomCommand(claudeConnectorEnvironment.signInCancel, {
    label: `cancel connector sign-in ${name}`,
    reportFailure: false,
  });
  const [signIn, setSignIn] = useState<{
    readonly signInId: string;
    readonly authorizationUrl: string;
  } | null>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const failed = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const error = squashAtomCommandFailure(result);
    setFailure(error instanceof Error ? error.message : gt("The request failed."));
  };

  const begin = async () => {
    setBusy(true);
    setFailure(null);
    const result = await start({ environmentId, input: { instanceId, name } });
    setBusy(false);
    if (result._tag === "Success") setSignIn(result.value);
    else failed(result);
  };

  const openPage = async (url: string) => {
    try {
      await ensureLocalApi().shell.openExternal(url);
    } catch {
      setFailure(gt("Could not open the sign-in page. Copy the address instead."));
    }
  };

  const finish = async () => {
    if (signIn === null || callbackUrl.trim().length === 0) return;
    setBusy(true);
    setFailure(null);
    const result = await complete({
      environmentId,
      input: { signInId: signIn.signInId, callbackUrl: callbackUrl.trim() },
    });
    setBusy(false);
    if (result._tag === "Success") setDone(true);
    else failed(result);
  };

  const close = () => {
    if (signIn !== null && !done) {
      void cancel({ environmentId, input: { signInId: signIn.signInId } });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <T>
              Sign in to <Var>{name}</Var>
            </T>
          </DialogTitle>
          <DialogDescription>
            {done ? (
              <T>Signed in. New sessions can use this connector.</T>
            ) : (
              <T>
                Approve access in your browser. When the browser lands on a new page, even one that
                fails to load, copy its address and paste it here.
              </T>
            )}
          </DialogDescription>
        </DialogHeader>
        {done ? null : (
          <DialogPanel>
            <form
              id={formId}
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void finish();
              }}
            >
              {signIn === null ? (
                <Button type="button" disabled={busy} onClick={() => void begin()}>
                  <T>Start sign-in</T>
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void openPage(signIn.authorizationUrl)}
                  >
                    <ExternalLinkIcon />
                    <T>Open sign-in page</T>
                  </Button>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${formId}-callback`}>
                      <T>Paste the address your browser ended on</T>
                    </Label>
                    <Input
                      id={`${formId}-callback`}
                      placeholder="http://localhost:…/callback?code=…"
                      value={callbackUrl}
                      onChange={(event) => {
                        setCallbackUrl(event.target.value);
                        setFailure(null);
                      }}
                      autoComplete="off"
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
        )}
        <DialogFooter variant="bare">
          {done ? (
            <Button onClick={onClose}>
              <T>Done</T>
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                <T>Cancel</T>
              </Button>
              {signIn === null ? null : (
                <Button
                  type="submit"
                  form={formId}
                  disabled={busy || callbackUrl.trim().length === 0}
                >
                  <T>Complete</T>
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
