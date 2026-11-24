---
name: run-json
description: Configure run.json so the Run button does the right thing for the user's file — interpreters, build commands, env vars, timeouts. Use when the user asks about running code, build setup, or "how do I make Run work for X".
---

Audience: the in-app assistant (offline chat / Kimi chat) — loaded into its
context when the user asks about running code, build setup, or "how do I
make ▶ work for X". Answer in the user's language. Be practical: propose a
concrete run.json; don't recite the schema unless asked.

**When this skill applies.** Anything about: running/compiling the user's
file, the ▶ Run button doing the wrong thing, build commands, interpreters,
customizing execution. Not about markdown editing/preview.

**Three levels, later wins.** (1) Built-in extension→command table — zero
configuration; (2) `run.json` at the chat directory root — overrides,
commands run via `/bin/bash -c` with cwd = chat directory; the file itself
is a chat artifact, editable in-app; (3) free-form command in the output
panel — same session, history per chat directory; use for one-offs before
suggesting a run.json.

**Schema.**

```json
{
  "run": {
    "*.py": "source .venv/bin/activate && python {file}",
    "*.ts": "npx tsx {file}",
    "src/**/*.test.js": "node --test {file}",
    "main.c": "make && ./build/app",
    "server.py": {
      "command": "flask --app {name} run --debug",
      "env": { "FLASK_ENV": "development" },
      "cwd": "{dir}",
      "timeoutSec": 60
    }
  }
}
```

Top-level `"run"`; glob (relative to the chat directory) → command template;
most specific glob wins; `*.ext` globs match at any depth. Placeholders:
`{file}` absolute path of the saved file, `{dir}` its directory, `{name}`
basename without extension, `{base}` basename with extension. Files are
saved before the run. Multi-phase commands (`&&`, `;`, pipes) are the
normal case — no separate "compile vs run" model. String form =
`{ "command": <string> }`. Unknown keys are ignored (forward compat).

**Recipes for non-standard cases.**

- Python venv: `"*.py": "source .venv/bin/activate && python {file}"` —
  venv lives in the chat directory; re-activated on each run.
- npm project: `"*.ts": "npm run build --silent && node dist/{name}.js"` or
  `"index.ts": "npm run dev"` — any npm script is a command.
- Cargo with args: `"src/main.rs": { "command": "cargo run -- --input data.txt" }`.
- C outgrowing one file: `"main.c": "make && ./build/app"` — encourage a Makefile.
- Env vars: prefer the `env` object for repeated vars (readable, diffable);
  inline `VAR=x cmd` for one-offs.
- Long-running/server: high or omitted `timeoutSec`; Stop button; output
  streams live. Warn: no stdin — interactive programs don't fit tier 1,
  need an external terminal.
- Tests/lint as run: fine — `"*.test.js": "node --test {file}"`.

**Troubleshooting flow.** (1) Ask: file extension, what "correct run" means
(input? args? server?). (2) Does a built-in template already cover it?
Don't write run.json duplicating the table. (3) Propose the minimal entry;
say where it goes (chat directory root) and that it applies to that chat's
artifacts only. (4) On failure: read the exit code and the output-panel
tail; common causes — interpreter missing from PATH (full path or env
setup), command expects stdin (interactive — not supported in tier 1),
glob mismatch (literal relative globs must match the path; `*.ext` already
matches any depth). (5) JSON mistakes (trailing commas, unescaped quotes) —
validate and fix.

**Boundaries (state honestly).** No stdin/interactivity in the run panel;
servers run until stopped. Commands run as the app's user — a destructive
template will be executed; caution with unknown ones. Chat directories are
the sandbox root: `../` escapes are refused by the FS gateway, but
user-authored shell can still address absolute paths — treat unknown
run.json templates as code.
