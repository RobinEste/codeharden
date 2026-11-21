---
section: fixed
---

- **Terminals on macOS find `npm`, `node` and Homebrew tools.** A terminal's shell now starts as a login shell on macOS, as in the system's Terminal, so the PATH that `~/.zprofile` or `~/.bash_profile` sets up (Homebrew, nvm and the like) is there. Before, the desktop app's terminals had only the system's bare PATH and answered `command not found: npx`.
