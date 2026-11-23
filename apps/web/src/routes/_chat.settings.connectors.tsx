import { createFileRoute } from "@tanstack/react-router";
import { useGT } from "gt-react";

import { ConnectorsSettings } from "../components/settings/ConnectorsSettings";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";

function SettingsConnectorsRoute() {
  const { environment, scope } = useSettingsScope();
  const gt = useGT();
  if (!environment) {
    return (
      <p className="p-8 text-sm text-muted-foreground">
        {scope.kind === "environment"
          ? gt("Reconnect {label} to manage its connectors.", { label: scope.label })
          : gt("Connect an environment to manage its connectors.")}
      </p>
    );
  }
  return (
    <ConnectorsSettings
      environmentId={environment.environmentId}
      environmentLabel={environment.label}
    />
  );
}

export const Route = createFileRoute("/_chat/settings/connectors")({
  component: SettingsConnectorsRoute,
});
