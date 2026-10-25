# AGENTS.md

## Repository state

- The active game source is `game/`: JavaScript runtime/plugins, JSON gameplay data, and imported PNG/OGG/font/video assets are tracked in Git. Edit source here, never the generated `dist/` output.
- `npm start` / `npm run dev` run editable source on port 8140. `npm run check`, `npm test`, and `npm run build` validate and package this source. Browser tests need Node.js 22+ and Chrome.
- `tools/fnh-browser/` contains import/build templates; `game/` also includes standalone copies of the server/build/check tools so the source folder can be moved independently. Keep those helper copies in sync when changing packaging behavior. Web/gameplay changes belong in `game/`, especially `game/__fnh/compat.js` for browser adjustments.
- `npm run import:game` creates source only when the destination is absent; never re-import over edits. No original installation is needed after import.
- `fnh-engine/` is a separate experimental reimplementation. The root `js/` game Cối Hầm remains available via `npm run coi-ham`; it is not the primary application.
- Remote: `origin` → https://github.com/lighthouse2815/fear-and-hunger.git, default branch `main`.

## Workflow requirement

- Commit messages must be written in Vietnamese with full diacritics (tiếng Việt có dấu chuẩn). Do not write commits in English or in unaccented Vietnamese.
  - Subject line: imperative, <= 72 characters, e.g. `Thêm trang chủ`, `Sửa lỗi tính toán số liệu`, `Cập nhật cấu hình CI`.
  - If a body is needed, also write it in accented Vietnamese, explaining the "why".
- After completing each feature, commit the changes and push them to `origin` (`git push`). Do not leave finished work uncommitted locally.
- Once code exists, run whatever verification the project defines (tests, lint, typecheck) before committing. None is configured yet; add it alongside the first code rather than inventing commands here.
