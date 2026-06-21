---
type: protocol
id: protocol-command-policy
category: governance
scope: system
enforcement: mandatory
---

# Command Policy

What commands the AI assistant may execute without confirmation, with confirmation, and never.

---

## Execute Without Confirmation

- `git status`, `git log`, `git diff` (read-only)
- `cat`, `ls`, `find`, `grep` (read-only)
- Build commands: `tsc`, `pnpm build`, `npm run build`
- Lint: `eslint`, `prettier`
- Test: `pnpm test`, `npm test`

---

## Execute With User Confirmation

- `git commit`, `git push`
- `git reset`, `git checkout`
- File creation in source directories
- `npm install`, `pnpm add`
- Any command that modifies shared state

---

## Never Execute Without Explicit Instruction

- `rm -rf`, `git clean -f`, `git reset --hard`
- Database migrations on production
- Deploy to production
- Publish to npm
- Delete branches
- Force push

---

## Rules

1. When in doubt: ask, don't act
2. Destructive operations: always show dry-run first
3. Production-affecting operations: require explicit written confirmation
4. Never bypass safety hooks (--no-verify, --force) without explicit instruction
