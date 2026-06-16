# @clutch/demo-parser-wasm

Parser de demo de CS2 (`.dem`) em **WebAssembly**. Lê os bytes de uma demo
(CS2 / Source 2) e emite o `Replay` no formato `apps/app/src/replay/schema.ts`,
junto da voz dos jogadores (comms). Roda no browser, dentro de um Web Worker;
nenhum byte da demo sai da máquina.

Usa o `source2-demo` (parser streaming, event-driven), então o consumo de
memória fica muito abaixo do teto do wasm32 mesmo em demos longas.

## Importante: este package é "fora da banda"

Isto é um **crate Rust**, não um pacote pnpm (não tem `package.json`, não entra
no workspace nem no `turbo`). É compilado para WASM **na mão**, via `build.sh`.
Consequências:

- `pnpm dev` / `pnpm build` **não recompilam o WASM**. Eles só consomem o
  artefato que já está commitado em `apps/app/src/viewer/parser/`.
- Quem só roda o app (ou clona o repo) **não precisa de Rust nem do toolchain**:
  basta o `.wasm` versionado.
- Só quem **mexe no parser** precisa do toolchain abaixo.

## Como o app consome

O build gera os artefatos direto em `apps/app/src/viewer/parser/` (todos
commitados, são a fonte da verdade que o app importa):

- `clutch_demo_parser.js` (glue do wasm-bindgen)
- `clutch_demo_parser.d.ts` (tipos)
- `clutch_demo_parser_bg.wasm` (o binário enxuto)
- `clutch_demo_parser_bg.wasm.d.ts`
- `package.json`

O worker (`apps/app/src/workers/demoParser.worker.ts`) importa o glue e chama
`init()` + `parse_demo()`. O `init()` resolve o binário por
`new URL('clutch_demo_parser_bg.wasm', import.meta.url)`, padrão que o **Vite**
reconhece e trata como asset (serve no dev, emite com hash no build). Por isso
não há plugin especial: a pasta é só "código + asset" importado por caminho
relativo.

## Pré-requisitos (uma vez por máquina)

- `rustup target add wasm32-unknown-unknown`
- `cargo install wasm-bindgen-cli --version 0.2.125`: a versão **tem que casar**
  com a dep `wasm-bindgen` do `Cargo.toml`, senão dá mismatch entre glue e
  binário (causa nº 1 de "o parser parou de carregar").
- Um linker C para os build scripts/proc-macros do host. Se a máquina não tiver
  gcc/clang, use o **zig como driver**: crie um wrapper `cc` -> `zig cc` no PATH
  e exporte `CC=cc` (o zig traz a libc; sem isso o cargo falha com
  "linker `cc` not found").

## Ciclo de trabalho

```
edita lib.rs  ->  ./build.sh  ->  artefatos em apps/app/src/viewer/parser/  ->  Vite recarrega
```

1. Edita `src/lib.rs`.
2. (opcional, recomendado) Valida rápido **sem WASM** com o binário nativo de
   iteração, bem mais rápido de compilar que o wasm:
   ```bash
   cargo run --no-default-features --bin native -- <entrada.dem> out.json
   ```
   (o `--no-default-features` desliga a feature `wasm` e gera um binário normal.)
3. Builda o WASM, a partir da pasta do pacote:
   ```bash
   cd packages/parser && ./build.sh
   ```
   O `build.sh` faz `cargo build --release --target wasm32-unknown-unknown` (gera
   o `.wasm` cru em `target/`, que está no `.gitignore`) e depois
   `wasm-bindgen --target web` (gera o glue + tipos + o `_bg.wasm` enxuto **direto
   em** `apps/app/src/viewer/parser/`).
4. O app pega sozinho: com o `pnpm dev` rodando, o Vite vê os arquivos mudarem e
   recarrega.
5. **Commita os dois lados**: a mudança no `lib.rs` **e** os artefatos
   regenerados em `apps/app/src/viewer/parser/`. Não há CI que recompile; se
   esquecer os artefatos, o app fica com a versão antiga.

## Armadilhas

1. **O contrato é duplicado.** As `struct`s do `lib.rs` espelham os tipos de
   `apps/app/src/replay/schema.ts` na mão; nenhuma ferramenta garante o
   sincronismo. Mudou um campo no schema TS? Mude o `lib.rs` junto (e rebuilde),
   senão o JSON que o WASM emite deixa de casar com o tipo.
2. **wasm-bindgen-cli vs dep do Cargo.** Se atualizar uma, atualize a outra.

## Features do crate

- `wasm` (default): build para o browser, com `wasm-bindgen`.
- `--no-default-features`: build nativo, usado pelo binário `native` de iteração.
