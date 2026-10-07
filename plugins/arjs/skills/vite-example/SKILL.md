---
name: vite-example
description: Create or convert an AR.js-next example into a standalone Vite project that installs ar.js-next, arjs-plugin-artoolkit and arjs-plugin-threejs from npm (local package via file:../..) instead of vendored builds. Use when adding an example, or when an example has a vendor/ folder or copies plugin dist files.
argument-hint: "[example folder, e.g. examples/vite-artoolkit]"
---

# npm-based Vite example

Target folder: `$ARGUMENTS`.

## Layout

```
<example>/
  package.json
  vite.config.js
  index.html
  src/main.js
  public/data/      # camera_para.dat, *.patt, printable marker images
```

`package.json`: private, `"type": "module"`, scripts `dev`/`build`/`preview`
running vite. Dependencies:

- the repository's own package as `"file:../.."` (or `"file:../../.."`,
  matching depth), so the example exercises local code;
- every other AR.js package from the registry at its current published
  version (check with `npm view <pkg> version`);
- `three` only when the threejs renderer is used; `vite` as a dev dependency.

## Rules

- **No `vendor/` folders and no copied `dist/` files.** Delete them when
  converting, and remove their entries from ignore files.
- **WASM through the bundler**, never a hard-coded `/node_modules/...` path:

  ```js
  import wasmUrl from "@ar-js-org/artoolkit5-wasm/dist/artoolkit5.wasm?url";
  const artoolkit = new ArtoolkitPlugin({
    wasmUrl,
    cameraParametersUrl: "/data/camera_para.dat",
  });
  ```

- If the artoolkit worker fails to resolve in dev, add
  `optimizeDeps: { exclude: ['@ar-js-org/arjs-plugin-artoolkit'] }` to
  `vite.config.js`. Verify rather than adding it by default.
- Register plugins with `pluginManager.register(id, plugin)` and
  `pluginManager.enable(id, engine.getContext())`; check the boolean results.
- Start the capture/frame pump before calling `loadMarker`/`trackBarcode`:
  the detector initialises on the first frame.
- Subscribe to `ar:markerFound/Updated/Lost` directly; never bridge
  `ar:getMarker` (removed in artoolkit 0.2.0). Key per-marker state on
  `type:markerId`.
- Show `ar:workerError` messages in the page: a wrong `wasmUrl` surfaces there.

## Verify

1. `npm install` inside the example, then `npm run build` and
   `npm run preview`: the build must succeed and the WASM must load (check
   the network panel or the absence of `ar:workerError`).
2. `npm run dev` with a camera: Hiro marker found, pose follows, lost after
   it leaves the frame.
3. Add the example's `node_modules/` and `dist/` to the repository ignore
   files, and link it from `examples/index.html` or the README.
