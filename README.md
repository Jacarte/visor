# Visor

A personal, offline/local **read-only graph viewer** for Wayfinder maps and their project-folder Markdown artifacts. No accounts, GitHub integration, telemetry, ticket editing, or saved positions. Desktop only. Current verification target: **Obsidian 1.15.0** (installer 1.12.7 is not the running app version). Host loading/activation is a separate check from the browser harness; it is not certified by a successful build.

## Build and check

Use the existing Node 24 installation via nvm before **every** npm/npx command; do not change the global default:

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24
node --version
npm ci --ignore-scripts --cache .npm-cache
npm test
npm run typecheck
npm run build
```

Exact versions are pinned in `package.json` and `package-lock.json`. Build outputs are `main.js` (CommonJS, Obsidian/host modules external; React/React Flow bundled), `styles.css` (full React Flow CSS plus Visor styles), and `manifest.json`. No harness or test code is shipped in the plugin bundle.

## Local installation (explicit, not automatic)

After reviewing and checking the exact build artifacts, place **only** `main.js`, `manifest.json`, and `styles.css` in a previously absent `<vault>/.obsidian/plugins/visor/`. Or run this optional artifact-only installer from the project directory:

```sh
# Uses Node 24 selected above. Do not run before artifact review.
node scripts/install.mjs /absolute/path/to/vault
```

The installer requires an existing `.obsidian/plugins` directory. It rejects target collisions and symlink ancestors, exclusively creates `visor`, verifies SHA-256 and sizes, and reports them. On error it removes only newly owned, unchanged completed files; changed/uncertain files and unexpected files are retained and reported. It never writes `community-plugins.json`, autoenables, overwrites an existing installation, quits/restarts Obsidian, or changes Restricted mode. Concurrent hostile filesystem replacement is not an OS-level sandbox; stop other installation writers.

Enable **Visor alone** in Obsidian's Community plugins UI (Restricted mode must already permit plugins). An authorized operator can alternatively use the public CLI `plugin:enable id=visor filter=community` scoped to the intended vault if CLI is already enabled. Do not edit the live enabled-plugin JSON or reload all plugins. Open **Visor: Open graph** from the command palette, or its network ribbon icon; an existing Visor leaf is revealed instead of duplicated.

## Notes and graph

Maps have `labels: ["wayfinder:map"]`. Choose one map in the toolbar. All allowed Markdown files in that map's folder tree (including nested project folders) are visible, even without labels: specs, handoffs, glossary, conventions, working notes and indexes appear as generic note/support artifacts, without guessing meaning from filenames. A folder prefix never includes similarly named sibling folders. A root-level map includes the allowed vault Markdown tree. Cache-null folder notes appear as indexing/unavailable artifacts and update under the same canonical path when indexed.

Actual decision child tickets can still live in any allowed folder:

```yaml
labels: ["wayfinder:research"] # research, prototype, grilling, or task
parent: "[[Folder/Map|Map title]]"
status: open # closed and done are terminal
assignee: null # or an assignee string
blocked-by:
  - "[[Folder/Prerequisite#Heading|Prerequisite]]"
```

`type: permanent` is not a ticket type. Canonical note paths identify nodes; aliases never identify membership. Obsidian's source-aware resolver handles ambiguous basenames and relative links. Headings/block destinations are retained for navigation. Use `blocked-by: []` for no prerequisites; absent/malformed blocker or assignee metadata is conservatively unknown, not ready.

- Full history is shown by default: map header, actual decision children, colored decision type badges, implementation tickets, generic project artifacts, one-hop wikilink context, explicit external blockers, and unresolved-blocker placeholders. Frontmatter `title` (a nonempty string) is displayed; otherwise the basename is used. Paths remain identities.
- `tags: ["implementation-ticket"]` or `labels: ["implementation:ticket"]` identifies a separate purple implementation kind/filter. Labels and tags accept a scalar string or a list of strings; malformed shapes are not interpreted. A recognized Wayfinder decision label with a parent resolving to the selected map takes precedence, without duplicating the note. `implementation:index` alone remains a generic artifact.
- Implementation/generic artifacts display stored status; closed/done are faded. Nonterminal readiness stays **unknown**, even with an assignee, `not-started`, or an approved-change label. Missing assignee/blocker fields are fine for these artifacts. Optional explicit `blocked-by` fields add dependency arrows; malformed/unresolved blockers warn and remain unknown. No execution approval or blockers are inferred from prose/wikilinks.
- Solid arrow: **prerequisite → dependent**, top to bottom. Dashed parent edges are actual selected-map decision membership. Dotted **folder context** edges are project provenance, not fabricated parents; context/type edges are annotations. Folder and stored-parent provenance are shown separately in the preview. Foreign/malformed/absent parents do not hide folder artifacts or make them selected-map decisions. Other maps in the folder remain visible without claiming their children. Only explicit dependencies determine dependency ranks.
- Closed/done nodes are faded. **Frontier** means open + no assignee + every direct blocker closed/done. Assigned/unblocked is separate. Missing metadata, bad blockers, unknown status and cycles produce warnings; there is no false-ready assumption while indexing.
- Search/type/status filters **dim** nonmatching note artifacts rather than hide blockers; the original readiness does not change. Click a type badge to filter; it is not a note.
- Click a note node to render its Markdown in the side panel. **Open note** uses the public workspace API. Internal links preserve headings/blocks and new-leaf modifiers; external links remain normal links.
- Drag, pan, zoom, select, Fit and Reset layout are available. Dragging is temporary. Structural changes still auto-layout, but preserve the user's camera and surviving selection/preview. Automatic fit happens only on initial display/map change; Fit and Reset layout are explicit controls. Nonstructural refreshes preserve dragged positions, selection and viewport. There is no list/hybrid view, connection/deletion API, position persistence, or settings UI.

## Read-only and privacy boundary

Runtime code never writes note/config/plugin data, invokes a mutation API, or saves layouts. Membership discovery scans **allowed metadata** vault-wide, without reading note bodies. Visibility includes the selected map's folder tree plus resolved decision children anywhere allowed. One-hop context links originate from all these inputs; directly linked outside references can appear but are never recursively expanded. External blockers supply their own status only. There is no arbitrary vault-wide provenance crawl. Cache-null/indexing states are explicit and refresh on public metadata/vault events after layout readiness (not an arbitrary indexing delay).

`chats/` and `Javier(me) notes/` are excluded (case-insensitive directory segments) **before** cache/body access and explicit link resolution. A bare basename can require the public resolver to identify its destination; a forbidden resolver result is rejected before metadata/body reads or navigation. Forbidden notes cannot be previewed/opened through Visor.

Preview task checkboxes/forms/editable controls are disabled with capture guards. A Markdown tokenizer removes note embeds/transclusions and inline/reference images **from the preview only**, so they cannot auto-read excluded notes or load remote media. Raw HTML and excluded/unresolved internal links are shown as inert code text (before the host renderer can inspect destinations). A concise notice appears when content was omitted/made inert. Ordinary Markdown, code examples, tasks as read-only display, resolved allowed internal links, and normal web links remain. Each preview generation owns its renderer component and detached DOM host; closing/switching disposes it and rejects stale async output. No source text is modified.

This is not an Obsidian security sandbox. Other installed plugins and arbitrary Markdown postprocessors retain their own permissions and behavior. Their side effects cannot be guaranteed safe by Visor. Actual Obsidian renderer integration and split/popout styling need host smoke testing.

## Real UI fixture harness

The harness imports the **same `src/GraphApp.tsx`** used in the plugin, with a fixture metadata/preview adapter instead of Obsidian. It is not a mock graph. Preview fixtures explicitly do **not** claim to emulate Obsidian's MarkdownRenderer.

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24
npm run harness
# http://127.0.0.1:5173/
```

In a second shell, select nvm 24 again before running npm. With installed Google Chrome:

```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24
PLAYWRIGHT_CHANNEL=chrome npm run test:ui
```

Without Chrome, supply an already-installed Playwright browser (`npm run test:ui` uses its Chromium). No browser install or debug-port setup is automatic. UI tests cover actual graph rendering, all types/full history/frontier, generic/implementation artifacts and indexing updates, filters, click/rapid preview switching, readonly DOM, preserved heading/modifier intent, drag/pan/zoom, reset, irrelevant refresh, live structural arrivals with camera/selection stability, map-change fit, delete guards, type badges, and unmount. A focused GraphApp unit test counts layout/fit calls; the browser test reproduces pan/zoom followed by new nodes/context edges. These establish the camera-yank fix, not a measured Obsidian host-lag improvement or host MarkdownRenderer performance. Unit tests exercise pure model/readiness/layout, adapter boundaries, lifecycle/event cleanup and safe installer rollback on temporary fake vaults. These checks do not prove Obsidian host loading. No real-vault installer invocation is part of repository tests.
