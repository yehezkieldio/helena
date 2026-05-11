set shell := ["bash", "-cu"]

fmt:
    cargo fmt --all
    bun run format:write

check:
    bun run typecheck
    cargo check --workspace

test:
    cargo test --workspace

