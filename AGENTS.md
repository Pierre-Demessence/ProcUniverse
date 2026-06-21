# AGENTS.md

Agent operating notes for the **ProcUniverse** project. See
[docs/INDEX.md](docs/INDEX.md) for full project documentation and
[docs/agent/README.md](docs/agent/README.md) for operational details.

## Testing responsibilities

**Browser / end-to-end testing is Pierre's job, not the agent's.** The agent
must not start a dev server and drive the running app in a browser to verify
behavior — Pierre does that. After the static checks pass, hand off all
in-browser verification (pan/zoom, LOD tier transitions, persistence, visual
and performance checks) to Pierre.

- The agent **must not** E2E-test the app itself (no Playwright/browser runs,
  no `npm run dev` + screenshot loops).
- The agent **must** still run the full static pipeline before handing off:
  `npm run build` (tsc + vite) and `npm test`.

## Peer reviews

Keep the mandatory peer-review pass **fast and lightweight**:

- Use a **fast model** for the review subagent.
- Don't over-invest — a single quick structured pass (correctness, types,
  obvious gaps) is enough. Avoid long, exhaustive review loops.
