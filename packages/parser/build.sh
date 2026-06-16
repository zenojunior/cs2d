#!/usr/bin/env bash
# Build do parser WASM: compila o crate para wasm32 e gera o glue do wasm-bindgen
# direto na pasta consumida pelo app (os artefatos sao commitados, nao ha
# pipeline automatico). Rode a partir do diretorio do pacote.
#
# Pre-requisitos:
#   - rustup + target wasm32-unknown-unknown  (rustup target add wasm32-unknown-unknown)
#   - wasm-bindgen-cli 0.2.125  (versao TEM que casar com a dep `wasm-bindgen` do Cargo.toml;
#     cargo install wasm-bindgen-cli --version 0.2.125)
#   - um linker C para os build scripts/proc-macros do host. Se a maquina nao tiver
#     gcc/clang, use o zig como driver: crie um wrapper `cc` -> `zig cc` no PATH e
#     exporte CC=cc (o zig traz a libc; sem isso o cargo falha com "linker `cc` not found").
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$PKG_DIR/../../apps/app/src/viewer/parser"
WASM="$PKG_DIR/target/wasm32-unknown-unknown/release/cs2_demo_parser_wasm.wasm"

echo "==> cargo build (wasm32, feature wasm = default)"
cargo build --release --target wasm32-unknown-unknown --manifest-path "$PKG_DIR/Cargo.toml"

echo "==> wasm-bindgen --target web -> $OUT_DIR"
wasm-bindgen "$WASM" \
  --target web \
  --out-name demo_parser \
  --out-dir "$OUT_DIR"

echo "==> ok. Artefatos atualizados em $OUT_DIR"
