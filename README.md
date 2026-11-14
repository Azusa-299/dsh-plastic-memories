# dsh-plastic-memories

A single configurable persona for DeepSeek Harness — how the user is addressed, the agent's own name (what the user calls the assistant), and free-form persona text — plus a one-file-per-day diary the agent writes through three tools. The persona is injected into the system prompt on every request and edited from its own page under Settings.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | Host half: registers the `plastic-memories:persona` system-prompt section |
| `src/persona.ts` | Renders the section text from the four fields, expanding `{{user}}` and `{{char}}` |
| `src/config.ts` | Config schema (`userName`, `assistantName`, `persona`, `enabled`), all volatile |
| `src/client/index.tsx` | Client half: registers the `settings.section` page |
| `src/client/PersonaSection.tsx` | The page component, including card import and export |
| `src/client/card.ts` | Character-card JSON mapping (V1, V2/V3) |
| `src/client/locales.ts` | Typed dictionary keys plus the `LocaleNamespaceMap` merge |
| `src/diary.ts` | Diary storage: file names, stamps, append, rename, list, read |
| `src/tools.ts` | The `diary_note` and `diary_read` tools |
| `src/server.ts` | Read-only `/plastic-memories/diary` route feeding the Settings preview |
| `locale/{zh,en}.json` | Plugin title and description shown by the plugin manager |
| `cordis.patch.yml` | Bundle patch inserting the `plastic-memories` row |
| `scripts/build.mjs` | esbuild: Host to ESM, client to the `__ModuleLoader__` format |
| `scripts/smoke.mjs` | Build-artifact test for both halves, no browser needed |

## Build and test

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

`pnpm test` loads `lib/` the way the harness does: the Host half through a real Cordis context (schema validation, service injection, effect disposal), the client half through `__ModuleLoader__` with a stub slot registry and config form.

## Design decisions

- **One persona, no card list.** No card list, no active-card selection. `enabled` mutes the sections without clearing the fields, so a persona can be parked instead of deleted; extending to several personas later means replacing the strings with a dict plus an active key, and the page structure stays.
- **Custom section name.** The section is `plastic-memories:persona`, never `deployment:persona-prefix`: `dsh-system-prompt` registers that name unconditionally and a duplicate fails the plugin load.
- **Volatile config.** Settings forms only expose volatile fields. Writes commit into the running plugin without a remount, and the section text is a function, so a saved change applies from the next request without restarting anything.
- **No agent tools.** Editing happens in the UI, so no tool schema is spent on every request.
- **No conversation memory.** The plugin renders identity text and keeps a diary; it does not index, recall or summarize past conversations.
- **`interpolate: false`.** Persona text is user prose: `{{name}}` stays literal instead of failing strict interpolation for the whole request.
- **`{{user}}` / `{{char}}` only in the persona body.** The two names are already stated in their own lines; expanding macros there too would duplicate them. The mapping follows the Character Card ecosystem, so imported text keeps working.
- **English framing lines.** The two instruction lines are written in English so every model sees one consistent prompt language: `Address the user as "X".` and `Your name is "Y"; the user calls you by it.` The persona body is emitted verbatim, whatever language it is written in. Macro fallbacks use `the user` / `the assistant` for the same reason.
- **Cards are an interchange format, not storage.** The plugin stores three strings; import fills them and export writes a V2 card. `userName` has no card field, so it travels in `data.extensions["plastic-memories"]` and is restored on re-import.
- **A daily diary plus one startup index.** The prompt carries the writing habit; the list of existing diaries is injected as one user-role message when a session starts, not rebuilt on every request. The message is attributed to `plugin:plastic-memories`, so the log shows where it came from, and `injectDiaries` turns it off without touching the files. Resumed and compacted sessions keep the index they were created with; only `startup` and `clear` inject a new one. The index lists at most 40 titles and folds the rest into a count.
- **The preview is served, not read by the page.** The browser has no filesystem access, so the Host half answers one read-only route instead of adding a remote service: the page lists names and shows one diary's text, and never creates, renames or deletes. The route answers `GET` only and reads names through the same matcher the tools use, so a stale selection is a 404 rather than a path. It exists only where a web server is mounted; the desktop `file://` shell reports the preview as unavailable and the rest of the page still works.

## Character cards

`Import card` accepts a Character Card V1 JSON (top-level `name`, `description`, `personality`) or V2/V3 (`data` wrapper, `first_mes` and the rest ignored). The persona becomes `description` plus `personality`; the card name becomes the assistant name. `Export` writes a V2 card with the same mapping. PNG/CHARX cards are not read: they would need an image parser for one field.

## Model experience

The rendered section sits right after the official persona prefix (order `DEPLOYMENT_PERSONA_PREFIX + 1`) and costs one or two short lines plus the persona text on every request. An empty configuration renders nothing, so the empty state adds no tokens. The text is stable while the fields are unchanged, which keeps the system-prompt cache prefix valid; editing a field invalidates the cache from that point in the prefix once, then stays stable again.

The two diary tools add their schemas to every request (about 240 tokens together), and the diary paragraph costs about 110 tokens. They cost the same whether the agent writes a diary or not; removing a tool would mean a separate plugin. The startup index is one user-role message per new session — up to 40 titles plus a count line — so it is paid once per conversation, not per request.

## Diary

The agent writes a diary through three tools; the files are plain Markdown under `diaryRoot`
(default `<DSH_HOME>/plastic-memories/diary`, so `~/.dsh/plastic-memories/diary`).

The system prompt also carries one short paragraph teaching the habit, right after the persona. It is phrased as a duty ("you keep this diary yourself", "without being asked"), because a softer wording reads as optional and the model never calls the tool. It follows Cline's Memory Bank instructions in two ways: the trigger list names the kinds of events worth keeping, and "when in doubt, write it" removes the judgement call that otherwise ends in silence.

> Diary habit: you keep this diary yourself, unasked and without announcing it. Call diary_note whenever the user shares a fact, preference, feeling, plan, or event, or a conversation pauses; when in doubt, write it. One short line, in the user's language. Skip chatter and your own tool calls. A day's first note takes a summary naming the day. Before answering about the past, or when you want to recall what the user said, call diary_read.

Turning the persona off (`enabled`) silences this paragraph too, so the plugin leaves no trace in the prompt.

```
11月12日-用户说中奖了.md
8.00.01: 主人今天感觉好开心，他说中奖了
21.10.21: 主人又在抱怨上早八
```

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `diary_note` | `note`, optional `summary` | Appends exactly one line, stamped `H.MM.SS: `. The first note of a day creates `<MM月DD日>-<summary>.md`; a later note with a new `summary` renames today's file to a better recap. Line breaks are rejected. |
| `diary_read` | optional `name` | Without `name`, lists every diary name, newest first, with its line count. With `name` (full name, with or without `.md`, or a unique fragment such as `11月12日`), returns the text, capped at the newest 200 lines so one long diary cannot flood a request. Ambiguous fragments are refused. |

Rules that keep the diary trustworthy:

- **One file per day.** A day's diary is found by its `MM月DD日-` prefix, so a second call never starts a second file for the same date.
- **Only today's file changes.** Other diaries are never rewritten; the append is a single `appendFile`, and the rename preserves the content.
- **Names are summaries, never paths.** The summary is sanitized (`\ / : * ? " < > |` and control characters become `-`), trimmed and capped at 40 characters; nothing the model sends is used as a path.
- **Creating requires a name.** The first note of a day without `summary` fails with an actionable message instead of inventing a name.
- **Retention runs after the note.** `retainDays` (default `0`, keep all) deletes files whose date is older than the window; the cutoff day itself is kept, a name without a date prefix is never deleted, and a failed cleanup cannot fail the note that was already written. Names carry no year, so each one is dated to its most recent occurrence: a month/day later than today counts as last year.

## Settings page

Namespace and section id both equal the Cordis row id, `plastic-memories`. The page writes through the `configForms` service (`get('plastic-memories')` then `set(field, value)`), which queues writes, fences revisions and reloads host state on rejection. The save button writes all six fields and reports which step failed; the page disables editing while the form is not `ready` or when the profile makes it unwritable.

The page is three cards — identity (the enable switch and both names), persona (the text, a character count and the macro hint), and diary preview — with the import, export and save actions in a bar between the persona card and the preview. Styling uses the settings-page tokens (`--dsw-alias-settings-card-*`, `--dsw-alias-border-l*`, the button and label aliases) through one namespaced style block, so light and dark themes follow the host without per-theme values.

The same page previews the diary in two panes: the left pane lists every diary by name (its line count shows on hover), the right pane shows the selected diary's text in a scrollable block. The list comes from `/plastic-memories/diary`, one diary from `?name=…`, and it reloads when the page opens. Above the panes, two selects filter the list to a month/day span (both ends optional; the same day on both sides narrows it to that day), because diary names carry no year. The filter only hides rows — it never touches files — and a selected diary that falls outside the span is closed rather than left on screen. The switch next to the filter is `injectDiaries`: it decides whether a new session starts with the diary index. The `retainDays` select beside it sets a retention window: every diary older than the window is deleted when the next note lands, and `0` keeps all files. The preview is read-only by construction — no create, rename or delete button exists, and a name outside the current list is answered with 404 instead of being read.

```yaml
- insert:
    - id: plastic-memories
      name: dsh-plastic-memories
      config:
        userName: ""
        assistantName: ""
        persona: ""
        enabled: true
        injectDiaries: true
        retainDays: 0
```

## Installing

The bundle manifest declares `dsh.bundle.patch` and the `web` client half, so any install route that makes the package resolvable from the profile's `node_modules` works:

- From a registry or Git spec: install it from **Plugins → Add plugin** in the GUI, which applies `cordis.patch.yml` and offers the row for enabling.
- From this checkout: link the package into the profile's `node_modules` (a directory junction on Windows), then add the `plastic-memories` row. Restart the host, then reload the page.

```powershell
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\web\node_modules\dsh-plastic-memories" `
  -Target "D:\project\dsh-plastic-memories"
```

```yaml
- insert:
    - id: plastic-memories
      name: dsh-plastic-memories
      config:
        userName: ""
        assistantName: ""
        persona: ""
```

## Verifying a real install

1. Open Settings; the navigation shows **Personal persona** (zh: 个性化人设).
2. Save a user name and an assistant name.
3. Start a new turn and ask the assistant to say its name: it should use the configured one, and the next request's system prompt carries the section.
