# Vufra Node/TypeScript SDK — experimental

Built using **napi-rs 3** and the Rust crate `vufra-pdf`. This package is not yet published to npm.

## Build locally

From the repository root:

```bash
cargo build --release -p vufra-node
bash scripts/build-native.sh
cd packages/vufra
npm ci
npm run build
npm test
```

## Usage

```ts
import { renderPdf } from 'vufra';
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync('/path/to/NotoSans-Regular.ttf');
const pdf = renderPdf({
  title: 'Reporte de octubre',
  paragraphs: ['¡Hola, Cancún! PDF nativo desde Rust y TypeScript.'],
  rows: Array.from({ length: 1000 }, (_, i) => 'Registro ' + (i + 1))
}, font);

writeFileSync('report.pdf', pdf);
```

## Current support

- UTF-8 Spanish/Latin text with caller-supplied TTF/OTF font
- Automatic paragraph/row line-breaking driven by Parley
- A4 pages, running header/footer and row pagination from Rust
- Error handling for invalid input (including too-tall paragraphs)
- Returns PDF bytes, without requiring a filesystem from the Rust engine

**Limitations:** no complex bidi, fallback, images, multi-column tables, arbitrary page size, configurable styling or splitting a single row across pages. No prebuilt platform packages yet. Only checked on a Linux x86_64 developer workspace.
