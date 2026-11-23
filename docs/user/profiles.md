# Profiles

A profile is a separate copy of T3 Code's data on one Mac: its own threads,
projects, settings, paired devices, Claude folder and Codex folder. Use one
profile per person, or one for work and one for home. Profiles are available in
the desktop app on macOS.

Your existing data is the **Default** profile. With only Default, T3 Code opens
exactly as before and never shows the profile picker.

## Add your first profile

1. Choose **T3 Code -> Switch Profile...** in the menu bar, or open the command
   palette and run **Switch profile...**.
2. Confirm. T3 Code restarts and opens the profile picker. Agents that are
   running stop.
3. Click **Add profile**, enter a name and, if you want, a password.

The new profile opens empty. Sign in to Claude and Codex inside it; each
profile keeps its own sign-ins. New profiles start with the shared claude.ai
account connectors turned off.

With two or more profiles, the picker shows every time T3 Code starts. The
profile you opened last is highlighted. Click a profile to open it. Use the
**More actions** button on a row to rename it, set, change or remove its
password, or move it to the Trash.

## Passwords

A password stops a profile from opening inside T3 Code. Its server does not
start, so its paired phones and browsers cannot reach it.

A password does not protect the files themselves:

- Anyone who can use the same Mac user account can read the profile's folder in
  `~/.t3-profiles`.
- An agent running in another profile can read any file the Mac user can read.
- A `t3 service` background service keeps serving its home (normally Default)
  even when that profile is locked in the app.

For real separation between people, give each person their own Mac user
account.

There is no password reset. If you forget a password, the data can be recovered
only by someone who can read the folder in Finder.

## Move a profile to the Trash, and restore it

**Move to Trash** moves the profile's folder from `~/.t3-profiles` to the Trash,
together with its built-in browser data. The Default profile cannot be moved.
A profile that is open somewhere else is refused until you quit it there.

To restore a profile, put its folder back in `~/.t3-profiles` and open the
picker again. It comes back with its name and password.

## Limitations

- Profiles are macOS only.
- Only Claude and Codex get a folder of their own. Cursor, Grok, OpenCode,
  Antigravity, Kiro, Pi, Muse Code, fx and ACP agents share their normal folders
  across profiles.
- Opening T3 Code from a terminal with `open -n` or with
  `--t3-profile=<id>` can run a second profile next to the first one. Each keeps
  its own data, so nothing breaks, but both run at the same time.
- A `t3code://` link that starts T3 Code while you have two or more profiles
  opens the picker, and the link is dropped.
