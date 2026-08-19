# Concept Art Provenance and Runtime Boundary

Four PNGs were generated for `I WAS, SO I AM` on 2026-08-14 with OpenAI ImageGen through Codex's built-in `imagegen` workflow. They served only as visual-direction references for the human, echo, ancient memory chamber, and mechanisms.

They are not runtime assets. The game does not load a background plate, pose sheet, or prop sprite; `public/` contains none of those files, and the production `dist` smoke fails if any retired filename is served or referenced by the JavaScript bundle. Babylon.js constructs the playable scene from live meshes, procedural stone textures, materials, lights, articulated rigs, and simulation-driven transforms.

The retained source references remain under `.omx/artifacts/visual-ralph/humanoid-redesign/source-assets/` for process evidence only. Their paths, SHA-256 digests, purposes, and the zero-runtime-raster declaration are machine-checked in [assets-manifest.json](assets-manifest.json).

No downloaded game art, stock pack, trademarked character, or third-party production asset is used. This is a provenance record, not a legal opinion; retain the associated generation-session records and confirm the organizer's current AI-content and rights rules before submission.
