#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo build --release -p vufra-node
case "$(uname -s)" in
  Linux) dylib="target/release/libvufra_node.so" ;;
  Darwin) dylib="target/release/libvufra_node.dylib" ;;
  *) echo "Unsupported OS in this local build script" >&2; exit 2 ;;
esac
test -f "$dylib" || { echo "Native artifact not found: $dylib" >&2; exit 1; }
mkdir -p packages/vufra/native
cp "$dylib" packages/vufra/native/vufra.node
echo "Created packages/vufra/native/vufra.node"
