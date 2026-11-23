---
section: changed
---

- **The approval check asks in a few more cases.** Stricter handling of variables such as `HOME` and `TMPDIR` that a command line sets and then writes or deletes through, of `cp` and `mv` option clusters, of `$'…'` quoting in a script handed to `sh -c`, and of `cd /d` outside Windows' cmd. Commands that stay in the worktree run as before.
- **Long commands are checked faster.** String literals, `mktemp` templates and braced variables in a command are now read in one pass, so a very long command line no longer holds up the other sessions while it is checked. A command longer than 32,768 characters isn't read at all and asks at every permission level.
