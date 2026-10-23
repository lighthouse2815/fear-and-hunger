# AGENTS.md

## Repository state

- This repository is empty apart from this file: there is no application code, stack, build config, or test suite yet. Do not assume a language or framework; confirm the intended stack with the user before scaffolding.
- Remote: `origin` → https://github.com/lighthouse2815/fear-and-hunger.git, default branch `main`.

## Workflow requirement

- Commit messages must be written in Vietnamese with full diacritics (tiếng Việt có dấu chuẩn). Do not write commits in English or in unaccented Vietnamese.
  - Subject line: imperative, <= 72 characters, e.g. `Thêm trang chủ`, `Sửa lỗi tính toán số liệu`, `Cập nhật cấu hình CI`.
  - If a body is needed, also write it in accented Vietnamese, explaining the "why".
- After completing each feature, commit the changes and push them to `origin` (`git push`). Do not leave finished work uncommitted locally.
- Once code exists, run whatever verification the project defines (tests, lint, typecheck) before committing. None is configured yet; add it alongside the first code rather than inventing commands here.
