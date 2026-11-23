# Connectors

Connectors are MCP servers that a Claude provider's sessions can use. Each Claude provider keeps its
own list in its config directory, so a provider with its own **CLAUDE_CONFIG_DIR path** (for
example, one per profile) has its own connectors.

Open **Settings → Connectors**. If the environment has more than one Claude provider, pick one at the
top of the page.

## Add a connector

1. Select **Add connector**.
2. Enter a name. Use letters, numbers, dots, dashes or underscores.
3. Choose the kind:
   - **Web address (HTTP)** or **Web address (SSE)**: enter the server's URL, and any headers as
     one `Name: value` per line.
   - **Command**: enter the command that starts the server, one argument per line, and any
     environment variables as one `NAME=value` per line.
4. Select **Add connector**.

New sessions get the connector's tools. Sessions that are already running keep what they started
with. To change a connector, remove it and add it again.

Header and environment values stay on the environment's machine. The page shows only their names.

## Sign in

Web connectors that use OAuth need a sign-in before their tools work.

1. Select **Sign in** on the connector, then **Start sign-in**.
2. Select **Open sign-in page** and approve access in your browser.
3. Your browser then lands on a new page, often a `localhost` address that fails to load. Copy that
   page's address, paste it into **Paste the address your browser ended on**, and select
   **Complete**.

This works from any device, including a remote or tunnel connection, because you paste the address
back yourself. A sign-in expires after 10 minutes. **Sign out** clears the stored credential.

## Account connectors (claude.ai)

Claude subscriptions can also bring the connectors set up on claude.ai. Everyone who uses that
subscription sees the same ones. Turn **Account connectors (claude.ai)** on or off to choose whether
this provider's new sessions get them.

## Good to know

- Connectors belong to the Claude provider on the environment's machine, not to this device.
- You need permission to manage providers on an environment to see or change its connectors.
- Agents cannot add or remove connectors themselves.
- An environment whose T3 Code build has no Connectors, such as the standard release, shows "This
  environment's T3 Code doesn't have Connectors."
