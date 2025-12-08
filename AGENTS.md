# Repository Guidelines

## Project Structure & Module Organization
- `src/index.ts`: MCP server implementation (Zoho Projects task tools, auth helpers).
- `dist/`: Compiled output (`npm run build` writes here).
- `package.json`, `tsconfig.json`: Build and tooling config. No dedicated test directory yet.

## Build, Test, and Development Commands
- `npm install`: Install deps.
- `npm run build`: TypeScript compile to `dist/`.
- `npm run dev`: Compile in watch mode (no automatic run).
- `npm start`: Run compiled server from `dist/index.js`.
Testing: No test suite defined; add focused tests when you introduce non-trivial logic.

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Keep modules typed; prefer explicit interfaces over `any`.
- Indentation: 2 spaces; keep lines concise and readable.
- Naming: camelCase for functions/vars, PascalCase for types/classes. Descriptive tool handler names (e.g., `handleUpdateTaskStatus`).
- Imports: Use ESM `import` with relative paths kept short. Avoid unused imports.
- Errors: Surface clear error messages; preserve HTTP status context when possible.

## Testing Guidelines
- No framework configured yet. If adding tests, prefer a light harness (e.g., Vitest) and colocate under `tests/` or `src/__tests__/`.
- Name tests after behavior under test (e.g., `updateTaskStatus.invalidStatusId.spec.ts`).
- Keep Zoho API calls mocked/faked; do not hit live endpoints in CI.

## Commit & Pull Request Guidelines
- Commits: Present tense, concise scope (e.g., `Add v3 PATCH helper`, `Fix task status payload`). Group related changes; avoid mixed concerns.
- PRs: Include summary, rationale, and any manual verification steps (build/test commands). Link issues/tickets when available. Screenshots not required unless UI changes occur.

## Security & Configuration Tips
- Required env vars: `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`; optional `ZOHO_ACCESS_TOKEN`, `ZOHO_DOMAIN`.
- Never commit secrets. Prefer `.env` in local dev; document required keys in PRs that add new configuration.
- Network calls depend on valid tokens; handle 401s with token refresh (already implemented). Avoid logging tokens or sensitive payloads.***
