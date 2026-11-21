# Third-party notices

Visor uses React, React DOM, XYFlow, Dagre, unified/remark and associated Markdown utilities, React Markdown, remark-gfm, rehype-highlight/lowlight/highlight.js, YAML, and Electron. The build preserves the installed runtime dependency license/notice files under `licenses/`, with exact versions in `licenses/INDEX.md`. Electron's distribution retains its Electron and Chromium notices.

`@lxcid/remark-wikilink@0.2.0` is used only for parsing. Its MIT LICENSE (Copyright (c) 2026 Stan Chang) **and** THIRD_PARTY_NOTICES.md (including the adapted MIT GFM table implementation) are copied verbatim into `licenses/@lxcid__remark-wikilink/` in every app build. No Flowershow package or copied Flowershow source is used.

`react-compiler-runtime@1.0.0` ships a source header naming Meta Platforms, Inc. and affiliates and the MIT license at the React repository root, but omits its own LICENSE file. The build preserves the same-upstream React MIT LICENSE with an explicit explanatory NOTICE for that package.

Packaging tools and test tools are development dependencies and are not shipped in the application staging directory.
