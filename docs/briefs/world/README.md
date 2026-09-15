# World rebuild briefs (2026-09-14)

The briefs handed to the art department for the world's look, one file per pass,
in the order they ran. Passes 1, 1b, 1c, 2 and 3 were done by the art department;
3b, 4, 5 and 6 were done by the owner's session when the department's usage
limit ran out, and their briefs are kept here so they can be rerun as art passes
later: the contract each brief describes is what the code now implements.

Run one with the Codex wrapper in the website repo (`-Mode workspace-write`, the
game checkout as `-Cwd`), commit everything first so `git status` afterwards shows
only what the department touched, then build, `npm test`, shoot the look sheet
(`tools/looksheet.mjs`) and measure with `tools/world-probe.mjs` and
`tools/sky-budget.mjs`.
