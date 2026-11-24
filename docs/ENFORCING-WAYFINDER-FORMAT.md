# Enforcing the Wayfinder format for agents

Visor reads only one frontmatter shape. Anything else is shown as `unknown`, as a
"Malformed blocker", or not indexed at all, and Visor never guesses. This page
explains how to make agents write that shape every time.

The format itself is defined in the README section
[Proposal: writing Wayfinder notes that Visor reads](../README.md#proposal-writing-wayfinder-notes-that-visor-reads).
This page covers enforcement only.

## 1. Put the rule where agents already look

Agents follow instructions they load at the start of a session, so the format
must live there, not only in this repo.

| Where | Reaches |
| --- | --- |
| `~/.pi/agent/AGENTS.md`, section **Writing Wayfinder notes that Visor reads** | every pi session and every subagent that inherits it |
| `AGENTS.md` / `CLAUDE.md` in a project | agents working in that repo |
| The prompt of whatever skill or command creates Wayfinder notes | that workflow, even when global instructions are not inherited |

Copy the section verbatim from the README. Do not paraphrase it: agents drift
from loose summaries. Subagents do not always inherit the parent's
instructions, so paste the section (or the templates below) into the brief of
any child that writes Wayfinder notes.

## 2. Give agents templates, not prose

Agents copy structure more reliably than they follow rules. Keep these three
blocks in the brief or skill and tell the agent to start from them.

Map note:

```yaml
---
title: <Map title>
labels: [wayfinder:map]
tags: [<project>, wayfinder]
status: active
---
```

Decision ticket (`wayfinder:research | prototype | grilling | task`):

```yaml
---
title: "<Question as a title>"
labels: [wayfinder:research]
parent: "[[<map-note-name>]]"
status: open
assignee:
blocked-by: []
---
```

Implementation ticket:

```yaml
---
title: "<Slice title>"
labels: [implementation:ticket]
status: ready-for-agent
blocked-by: []
---
```

## 3. Agent self-check before finishing

Add this checklist to the brief. The agent must confirm each item for every
note it wrote or edited.

- [ ] Frontmatter is valid YAML; every value containing `:` is quoted.
- [ ] Map has `labels: [wayfinder:map]`; each decision ticket has exactly one `wayfinder:<type>` label.
- [ ] Each decision ticket has `parent: "[[<map>]]"` (quoted wikilink to a note that exists).
- [ ] `status` is exactly `open`, `closed` or `done` on decision tickets.
- [ ] `blocked-by` is present; `[]` for none; otherwise a list of quoted `"[[note]]"` links to notes that exist inside the map folder.
- [ ] `assignee` is empty or a name; no other field stands in for it.
- [ ] No `[[[a]]]`, bare slugs, `map:`, `claimed-by:`, `wayfinder:` scalar fields or `wayfinder-*` tags.
- [ ] One map per folder; specs, briefs and handoffs carry no ticket label.

## 4. Verify in Visor (the actual gate)

Passing the checklist is not proof. Visor is the parser, so open the map folder
and confirm:

1. The map appears in the **Map** selector. If not, the map label or YAML is wrong.
2. Every ticket is a ticket node (not grey "support"). If grey, the label or `parent` is wrong.
3. No "Malformed blocker" nodes and no `unknown` readiness on tickets that should be open or closed.
4. The folder has no "metadata unavailable (Invalid or unsupported YAML)" issues; that means a note could not be parsed (usually an unquoted colon).

Make "opened in Visor, no unknown or malformed nodes" an explicit acceptance
criterion in the agent's task, and have a reviewer check it.

## 5. Common failures and what causes them

| Symptom in Visor | Cause |
| --- | --- |
| No map listed | map lacks `labels: [wayfinder:map]` |
| Tickets drawn as grey support notes | missing `wayfinder:<type>` label, or no `parent` link to the map |
| "Malformed blocker" | bare slug, unquoted `[[[a]]]`, or a blocker note that does not exist |
| Ticket `unknown` | status not `open`/`closed`/`done`, a cycle, or an unavailable blocker |
| Note missing / "metadata unavailable" | invalid YAML, typically an unquoted `:` in `title` |
| Ticket not in the map | `parent` points to a different map or is not a single quoted wikilink |

## Not included

There is no standalone linter yet; the gate is Visor itself. A small script
that parses the folder with Visor's own `FolderIndex` and `buildGraph` and
exits non-zero on warnings would turn step 4 into an automated check that an
agent or CI can run.
