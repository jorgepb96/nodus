# Workspace tab consistency

Workspace document tabs follow the connected tab design used by Ideas and Authors: a 36 px row, rounded top corners, a surface-colored active tab, and visible close controls. The home tab remains available after the last document closes. Study and Teaching editors omit that home tab because their parent workspace manages the catalog.

Nodus Scriptor and Study/Teaching document tabs occupy their own row above the editor toolbar. The native browser keeps its existing tab lifecycle and widths while using the shared visual styles. Arrow keys, Home, End, and Delete remain available in the shared strip; close confirmation dialogs retain focus, and horizontal scrolling reveals the entire active tab, including its controls.

## Visual verification

The screenshots below use isolated profiles and synthetic/demo content on macOS. They show the actual renderer in Electron, plus the server-web Scriptor. Browser images capture the tab bar; native web contents are outside those images. The complete local verification covered 35 captures across light/dark themes, catalogs, editors, readers, and narrow windows.

| View | Screenshot |
| --- | --- |
| Ideas reference | [Dark](images/workspace-tabs/reference-ideas.png) |
| Deep Research | [Dark](images/workspace-tabs/deep-research-dark.png) |
| Immersion | [Light](images/workspace-tabs/immersion-light.png) |
| Nodus Scriptor | [Dark](images/workspace-tabs/scriptor-dark.png) |
| Server-web Scriptor | [Light](images/workspace-tabs/scriptor-web-light.png) |
| Primary Sources Scriptor | [Light](images/workspace-tabs/scriptor-primary-sources-light.png) |
| Study editor | [Light](images/workspace-tabs/editor-estudio-light.png) |
| Teaching editor | [Dark](images/workspace-tabs/editor-docencia-dark.png) |
| Library reader | [Light](images/workspace-tabs/library-light.png) |
| Dictionary | [Dark](images/workspace-tabs/dictionary-dark.png) |
| Scriptor at 800 px with ten documents | [Narrow window](images/workspace-tabs/scriptor-narrow.png) |
| Native browser | [Light](images/workspace-tabs/browser-tabs-light.png) |
| Native browser at 800 px with twelve tabs | [Narrow window](images/workspace-tabs/browser-tabs-narrow.png) |

Checks covered tab activation, closing, keyboard navigation, title rename, confirmation focus, overflow, and native browser tab widths. No renderer page errors were recorded in the final desktop, browser, or server-web verification.

## Automated checks

- Renderer and Electron TypeScript checks.
- ESLint for the changed TypeScript/TSX files.
- 107 passing regression tests covering workspace UI, server-web parity, library UI, workspace navigation, Scriptor navigation, view snapshots, and browser tabs.
- `node scripts/verify-research-tabs.mjs`: opening, deduplication, keyboard navigation, closing, per-tab reading/progress, remount, and deletion.
- Renderer-only Vite build and `npm run build:server-web`.

The full packaged desktop build and the complete repository test/E2E suites were not run to completion for this change.
