---
name: fork-release
description: Build and install the profiles fork of T3 Code. Use when upstream publishes a new stable vX.Y.Z tag or the user asks for a fork build. Rebases the profiles branch, runs its checks, builds an ad-hoc-signed macOS app with automatic updates off, installs it after the user's yes, and walks the regression checklist.
---

# Fork release

`scripts/fork-release.ts` (`vp run fork:release`) does the mechanical work. This skill is the
person-facing routine around it: conflicts, the install consent and the regression checks.

## When

- Upstream published a new stable tag (`vX.Y.Z`, not nightly, preview or pr).
- The user asks for a fork build.

## Steps

1. From the main checkout, on `profiles` with a clean worktree, run
   `vp run fork:release --dry-run`. Read the plan: the tag, the base, and whether it rebases.
   Then run `vp run fork:release` without `--install`. It rebases, runs `check:changed` and the
   focused profile tests, builds the DMG and verifies it. The last line is a JSON report.
2. Exit 2 means the rebase hit conflicts. The script already aborted the rebase and reset the
   branch to the backup ref it printed. Resolve by hand:
   - `git rebase --onto <tag> fork-base/profiles profiles`, then resolve each file.
   - Keep the fork's intent and upstream's change. Stop and ask the user on any judgment call.
   - When the rebase finishes, `git tag -f fork-base/profiles <tag>^{commit}` so the next run
     sees the branch is already on the tag, then re-run step 1.
3. Any other failure prints one line. Fix the cause and re-run. Never loosen a check to pass.
4. Ask the user to quit T3 Code, and get their yes to install. The script refuses while the
   app runs; never quit or kill it yourself.
5. Run `vp run fork:release --install`. It rebuilds, then moves the old app to the Trash and
   copies the ad-hoc-signed build into `/Applications`.
6. Walk the regression checklist below on the installed app. On first open, macOS asks once to
   trust the app, and the keychain may ask once for saved connections: the user clicks
   "Always Allow".
7. Report in one line: the tag, whether it rebased, and which checks passed.

## Rules

- Never push, force-push or delete branches without the user's yes.
- Never pass `--force` to the build.
- Never point a server at `~/.t3/userdata` outside the installed app itself.
- Never read or change `~/.t3-profiles` except through the installed app.

## Regression checklist

Run every row on each release. "Affected" rows are where the fork changes behaviour.

| Feature                           | Affected                  | Check                                                                                                                                                                                                                                                                  |
| --------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install over stock                | No                        | With no `~/.t3-profiles`: the same threads, settings and pairings open as before. `ls ~/Library/Application\ Support \| grep t3code` shows no new `t3code-v2-*` folder. `~/.t3-profiles` still does not exist after launch and quit. `t3 status` matches the stock app |
| Updates                           | Yes                       | About says automatic updates are not available and shows the fork's version                                                                                                                                                                                            |
| Remote access and T3 Connect      | Per profile               | Link the Default profile and open it from the phone. Link a second profile from another T3 Connect account                                                                                                                                                             |
| T3 Connect sign-in                | Risk                      | Sign-in works when the build had `T3CODE_CLERK_PUBLISHABLE_KEY`. Passkeys need an Apple-signed build, so they stay unavailable. Tailscale or the local network still work                                                                                              |
| Pairing                           | No                        | Pair a phone to two profiles. Remove one; the other stays                                                                                                                                                                                                              |
| Mobile app (stock)                | No                        | Pair the store phone app with each profile                                                                                                                                                                                                                             |
| Background service (`t3 service`) | Yes                       | The Default profile keeps the service. Other profiles run only while the desktop app has them open                                                                                                                                                                     |
| Usage and limits                  | Per profile               | Run one turn in each profile. Each usage screen shows only its own turn                                                                                                                                                                                                |
| Worktrees                         | No                        | A worktree created in one profile is listed only there                                                                                                                                                                                                                 |
| Guest links                       | No                        | A guest link made in one profile opens                                                                                                                                                                                                                                 |
| Workflows and scheduled tasks     | Yes                       | Schedule a task in a second profile, close it, and confirm it runs when reopened                                                                                                                                                                                       |
| Outside agents (MCP)              | No                        | Connect an outside agent to one profile only                                                                                                                                                                                                                           |
| Secrets                           | No                        | A secret saved in one profile is not visible in another                                                                                                                                                                                                                |
| Saved remote connections          | Risk                      | After "Always Allow" once, saved connections still show                                                                                                                                                                                                                |
| Themes and keybindings            | No                        | Change the theme in one profile only                                                                                                                                                                                                                                   |
| Built-in browser                  | Yes                       | Sign in to a site in one profile. The other profile is signed out                                                                                                                                                                                                      |
| `t3` command-line tool            | No                        | `t3 status` on the Default profile shows the same as before                                                                                                                                                                                                            |
| Provider adapters                 | Claude and Codex separate | Start one turn with each installed provider in a second profile                                                                                                                                                                                                        |
| Languages                         | Yes                       | `vp run i18n:check` passes                                                                                                                                                                                                                                             |
