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
  local message storage work without network.
- **userData** — Electron's per-app data directory (`~/.config/kimi-dock` on
  Linux). Holds `kimi-code.json` (OAuth session), `settings.json`,
  `window-state.json`. *Not to be confused with:* the IndexedDB conversation
  storage, which lives in the renderer profile under the same root.
- **Sync queue** (planned) — the set of conversations holding unsent messages,
  derived from the database by the `hasPending` index. *Not to be confused
  with:* a queue as a persisted entity — by design it is always recoverable
  from the database snapshot.

## Dependencies between parts

The app has a fixed three-process layout: the main process owns secrets and
the network bridge; the preload exposes a controlled API; the renderer owns
UI and the conversation database. Cross-references follow this direction:
renderer → preload → main. Code that moves data the other way (main →
renderer beyond IPC events) is a design violation.
