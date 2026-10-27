# AGENTS.md

## Repository state

- The sole application is `game/`: JavaScript runtime/plugins, JSON gameplay data, PNG/OGG/font/video assets are tracked in Git. Edit source here, never `dist/` output.
- `npm start` / `npm run dev` run source on port 8140. `npm run check` validates source and resource references, `npm test` runs unit/build/browser tests, and `npm run build` produces `dist/fear-and-hunger-web`. Browser tests require Node.js 22+ and Chrome; missing prerequisites must fail rather than silently skip.
- `game/server.js`, `game/build.js` and `game/check.js` are the canonical run/build/check tools. Do not create duplicate copies of these tools. `game/__fnh/compat.js` belongs to the legacy runtime.
- The user requested replacement of the imported RPG Maker runtime/plugins with an independent implementation, retaining assets, audio and JSON content. New runtime code lives in `game/engine/`; the main entry opens `game/standalone.html` without loading `rpg_*.js`, original plugins or `compat.js`. `game/legacy.html` retains the old entry for comparison and access to old saves. Copying or renaming the old runtime does not satisfy this migration.
- `tools/import-game.js` is the optional one-time importer. It refuses to overwrite an existing project. Run/build/test use committed source and assets, with no original installation needed.
- Keep game content and active plugin sources; do not remove assets based only on text searches because events and scripts can build filenames dynamically.
- Remote: `origin` → https://github.com/lighthouse2815/fear-and-hunger.git, default branch `main`.

## Workflow requirement

- Commit messages must be written in Vietnamese with full diacritics (tiếng Việt có dấu chuẩn). Do not write commits in English or in unaccented Vietnamese.
  - Subject line: imperative, <= 72 characters, e.g. `Thêm trang chủ`, `Sửa lỗi tính toán số liệu`, `Cập nhật cấu hình CI`.
  - If a body is needed, also write it in accented Vietnamese, explaining the "why".
- After completing each feature, commit the changes and push them to `origin` (`git push`). Do not leave finished work uncommitted locally.
- Run the relevant checks and tests before committing. Verify source and release builds when changing runtime behavior, packaging or resource paths.
