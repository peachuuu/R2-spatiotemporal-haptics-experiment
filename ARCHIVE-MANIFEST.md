# R2 Archive Manifest

- Archive assembled: 2026-09-16 (Asia/Shanghai)
- Recommended repository visibility: Private
- Node used for baseline verification: v24.14.1
- npm used for baseline verification: 11.11.0
- R2 source commit: `97ba189c32dcbaf4f007749e5e3f8a75b8ea76d8`
- Game source commit: `b8451b0ca4411830dcd07705b27b6cbcb30b163e`
- Snapshot type: working-tree snapshot including modified and untracked source files listed by the original repositories on 2026-09-16
- Baseline R2 verification: 32 test files / 166 tests passed; production build passed
- Baseline game verification: 35 test files / 213 tests passed; production build passed
- Portable launcher helper test: passed (arbitrary clone path accepted; unrelated port process rejected)
- Archive first-run smoke test: `npm ci` completed for both apps; ports 5173/3001 passed health checks and stopped cleanly
- Archive R2 verification: 32 test files / 166 tests passed; production build passed
- Archive game verification: 35 test files / 213 tests passed; production build passed
- Participant entry: `http://localhost:5173`
- Embedded game service: `http://localhost:3001`

## Physical dependencies

The repository alone is sufficient for dry-run operation. Production electrotactile output additionally requires compatible hardware, correct wiring, flashed firmware, Chrome/Edge Web Serial, operator connection, calibration, and explicit ARM.

## Known dependency warnings

On 2026-09-16, `npm ci` reported one high-severity audit finding for the experiment app and 23 findings for the game dependency tree (1 low, 6 moderate, 16 high). No automatic `npm audit fix --force` was applied because it may introduce breaking dependency changes. A maintainer should review and upgrade these dependencies in a separate tested change; this archive preserves the verified experiment version.

## Release record

Fill these fields after GitHub publication:

- Repository URL:
- Release tag:
- Archive commit:
- Fresh-clone verification date:
- Verified by:
