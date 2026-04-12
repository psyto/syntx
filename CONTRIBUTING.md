# Contributing to Syntx

Syntx is open source under Apache 2.0. Contributions welcome.

## Getting Started

```bash
git clone https://github.com/psyto/syntx.git
cd syntx
```

### Vault Program (Rust/Anchor)

```bash
# Build
cargo-build-sbf --tools-version v1.53 -- --manifest-path programs/syntx-vault/Cargo.toml

# Test (requires percolator-prog.so)
cargo test -p syntx-vault --test integration

# Lint
cargo clippy -p syntx-vault
```

### Keeper (TypeScript)

```bash
cd keeper
npm install
npx tsc --noEmit     # type check
npx ts-node src/index.ts  # run keeper
```

### Frontend (Next.js)

```bash
cd app
npm install
npx next dev         # local dev
npx next build       # production build
```

### SDK (TypeScript)

```bash
cd sdk
npm install
npx tsc --noEmit     # type check
```

## Adding a New Venue

1. Create `keeper/src/venues/your-venue.ts` implementing `VenueAdapter`
2. Export from `keeper/src/venues/index.ts`
3. Add to factory in `keeper/src/index.ts`
4. Add env vars to `keeper/src/config.ts`

See `examples/venue-adapter/drift-adapter.ts` for a skeleton.

## Code Style

- TypeScript: strict mode, no `any` unless unavoidable
- Rust: follow Anchor conventions, `cargo clippy` clean
- Commits: conventional commits (`feat:`, `fix:`, `docs:`)

## Security

Syntx is **unaudited**. If you find a vulnerability, please report it privately to [@psyto on X](https://x.com/psyto) rather than opening a public issue.
