---
name: event-contract
description: Change or audit the AR.js-next marker event contract (ar:markerFound, ar:markerUpdated, ar:markerLost, ar:workerReady, ar:workerError, engine:update frames) consistently across AR.js-next, arjs-plugin-artoolkit and arjs-plugin-threejs. Use when adding, renaming or reshaping an event or payload field, or when one repo's events stop matching another's.
---

# Change the cross-repo event contract

The contract is a promise between three repositories that do not depend on
each other through npm, so nothing fails at install time when they drift; it
fails at runtime, silently. A contract change is only done when every place
below agrees.

## Where the contract lives

| Repository              | Places to update                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AR.js-next`            | `AGENTS.md` ("Contracts other packages depend on"), `src/core/components.js` `EVENTS`, `README.md` event table, examples       |
| `arjs-plugin-artoolkit` | `src/plugin.js` (`_applyDetections`, `_applyMisses`, `_onWorkerMessage`), `AGENTS.md` event table, `README.md` "Events", tests |
| `arjs-plugin-threejs`   | `src/threejs-renderer-plugin.js` (`_adaptLegacy`, `handleUnifiedMarker`), `AGENTS.md`, JSDoc (source of `types/`), tests       |

Repositories are siblings on disk, usually `../AR.js-next`,
`../arjs-plugin-artoolkit`, `../arjs-plugin-threejs`. Ask for their paths if
they are not there.

## Steps

1. **State the change** as a before/after payload table and get the user's
   agreement before editing anything.
2. **Audit first.** Grep all three repositories for the event name and every
   field involved (e.g. `markerId`, `poseMatrix`, `type`), including tests,
   READMEs and examples. Report mismatches already present.
3. **Plan the transition.** Prefer additive changes. For a rename, the
   consumer (threejs) must read old and new spellings for one release before
   the producer (artoolkit) stops sending the old one.
4. **Edit in release order:** consumer first (threejs), producer second
   (artoolkit), core docs and examples last (AR.js-next).
5. **Tests in each repo** must use the real payload shape: `matrix` as a
   `Float32Array(16)`, `markerId` together with `type`, pattern and barcode
   markers sharing a `markerId`.
6. **Track it:** one issue per repository, each assigned to the milestone it
   ships in, all on the AR.js-next roadmap project, cross-linked.

## Invariants

- One payload argument per event.
- Marker identity is `type:markerId`; never key state on `markerId` alone.
- `matrix` is a column-major `Float32Array(16)` in the WebGL/Three
  convention; consumers accept typed arrays (`ArrayBuffer.isView`).
- Payload keys are always present; optional values are `undefined`, never
  missing keys.
