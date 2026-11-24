# Glossary

**Read first in every session.** Source of truth for terms and naming: a term
renamed here is renamed in all materials — synchronization happens on **every**
renaming, not at the end of the work. Terms of subject blocks and declared
collisions live in thematic glossaries `docs/glossary/*.md`; read them when
working on the block.

Entry format:

    **Term** (*english-term*) — one-phrase definition. Parts of the project: X, Y.
    *Synonyms:* second name — [source]; third — [source]. The primary is the one
    in the external formulation of the task.
    *Difference of emphasis:* how the names differ in meaning (if they do).
    *Notation:* … *Not to be confused with:* related term.

Rules:

- A term enters here when it is used in a **second** part of the project — or
  immediately, if its meaning already diverges from the common one.
- **A term with a diverging naming tradition enters here immediately, at first
  encounter.** A diverging tradition hits three times: a domain source is not
  found by searching with the wrong word; an external reviewer uses their own
  word; different names highlight different sides of the concept, and both
  clarify it.
- In materials, synonyms are given at the **first** use of the term, in one
  phrase in parentheses. The difference of emphasis is a separate remark, not a
  footnote: it is a substantive claim about the concept.
- **False friends are recorded separately:** a word meaning different things to
  different authors is more dangerous than a synonym. Mark it explicitly in the
  entry — "not to be confused with", with analysis.
- Every number in the glossary has its source kind stated: calculation in the
  part's verification file, external document with chapter/page, or direct
  derivation.

## Naming traditions

- **Kimi Dock** — this fork (product name, repo `heni/kimi-dock`).
  *Not to be confused with:* **kimi-desktop** — the upstream project
  (Virusilvester/kimi-desktop). The directory on disk is still named
  `kimi-desktop/`; the product, package and repo are `kimi-dock`.
- **Kimi Code Plan** — the subscription this fork authenticates against
  (`api.kimi.com/coding/v1`, OAuth device flow). *Synonyms:* "Kimi Code",
  "Coding Plan" — [kimi-cli platforms.py]. *Not to be confused with:* **Kimi
  Membership** (consumer subscription, web only, no API) and **Moonshot Open
  Platform** (pay-per-token API keys, `api.moonshot.ai` / `api.moonshot.cn`) —
  three separate Moonshot products, keys and billing are not interchangeable.
- **Offline mode** — the app's fallback chat UI shown when the webview fails to
  load. *Not to be confused with:* true offline operation — chat responses
  still require network (they go through the API); only history, search and
  local message storage work without network. **Forced offline mode**
  (*force offline*) — the same UI shown on demand, without a network outage:
  the persisted setting `forceOfflineMode` (3.4.0), flipped from a title-bar
  toggle or Settings → Advanced; a debugging aid. While forced, the offline
  view hides "Try Reconnecting"; the title-bar badge reads "Forced Offline".
- **userData** — Electron's per-app data directory (`~/.config/kimi-dock` on
  Linux). Holds `kimi-code.json` (OAuth session), `settings.json`,
  `window-state.json`. *Not to be confused with:* the IndexedDB conversation
  storage, which lives in the renderer profile under the same root.
- **Sync queue** — the set of conversations holding undelivered messages,
  derived from the database by the `hasPending` index. *Not to be confused
  with:* a queue as a persisted entity — by design it is always recoverable
  from the database snapshot. Storage half exists since 3.3.0 (DB v3: the
  `hasPending` index + `seq`/`syncStatus`/`lastSeq` fields); the read API and
  the engine ship with the sync unit (Block 5b).
- **Sync schema v3** (*sync schema*) — the 3.3.0 conversation-storage model:
  `Message.seq` (monotonic per conversation, issued by the store — ms
  timestamps may collide, `seq` must not), `Message.syncStatus`
  (`pending`/`syncing`/`synced`/`failed`; a missing field means `synced`),
  `Message.queuedAt`/`syncedAt` (operational lifecycle), `Message.editedAt`
  (content edits only), `Conversation.hasPending` (stored derivative,
  `1/0` — counts `pending`/`syncing`/`failed` messages; the single predicate
  is `isUndelivered()` in `offlineManagerSchema.ts`), `Conversation.lastSeq`
  (the seq counter). Parts: renderer storage, unit tests, e2e migration.
- **Workspace root** (*workspace folder*) — the user-chosen directory that
  holds every chat's artifact directory; persisted as `workspaceRoot` in
  `settings.json`. The renderer reaches it only through the main-process FS
  gateway (`src/main/workspace.ts`), which normalizes every path and refuses
  escapes (precedent: `userDataFile()`). Parts: main, preload, renderer
  (editor, Settings), e2e.
- **Chat directory** — `<workspaceRoot>/<chatId>/`, the artifact home of one
  conversation (the id is `Conversation.id`; the sidebar's `'new'` sentinel
  never reaches the disk). Created lazily on the first file write. *Not to
  be confused with:* the conversation record in IndexedDB — the directory
  holds files, the record holds messages.
- **Artifact** — a non-hidden file inside a chat directory (dot-files and
  dot-directories — `.venv/`, `.git/`, `.bin/` — are hidden from the
  artifact list but stay accessible to the FS gateway; `run.json` is a
  normal visible artifact). Parts: renderer (editor), main (FS gateway).
- **Run console** (*run panel*, *tier-1 run*) — the panel docked under the
  editor that runs the current file via `/bin/bash -c` with cwd = chat
  directory, streaming output, no stdin. Command resolution, later wins:
  built-in extension table → `run.json` at the chat directory root →
  free-form command. *Not to be confused with:* a terminal — tier 2 (a real
  PTY) is a separate future unit over the same IPC surface.
- **run.json** — the per-chat run configuration: top-level `"run"` mapping
  glob → command template (string) or `{ command, env, cwd, timeoutSec }`;
  placeholders `{file} {dir} {name} {base}`; most specific glob wins;
  `*.ext` matches at any depth. Resolution logic is pure in
  `src/main/runConfig.ts`; the assistant-facing schema/recipes live in
  `resources/skills/run-json/SKILL.md`.
- **Surface** — one of the three switchable main-area views: webview /
  offline chat / artifact editor. The webview is never unmounted on a
  switch — it is CSS-hidden (unmounting reloads the kimi.ai SPA).

## Dependencies between parts

The app has a fixed three-process layout: the main process owns secrets and
the network bridge; the preload exposes a controlled API; the renderer owns
UI and the conversation database. Cross-references follow this direction:
renderer → preload → main. Code that moves data the other way (main →
renderer beyond IPC events) is a design violation.
