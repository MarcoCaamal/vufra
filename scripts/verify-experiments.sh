#!/usr/bin/env bash
set -euo pipefail
command -v pdfinfo >/dev/null || { echo 'pdfinfo required (Poppler)' >&2; exit 2; }
command -v pdftotext >/dev/null || { echo 'pdftotext required (Poppler)' >&2; exit 2; }
if [ -n "${VUFRA_FONT:-}" ]; then
  FONT="$VUFRA_FONT"
else
  command -v fc-match >/dev/null || { echo 'VUFRA_FONT or fc-match required' >&2; exit 2; }
  FONT="$(fc-match 'Noto Sans' -f '%{file}\n' | head -1)"
fi
cargo run --quiet -p sp-01-pdf-writer -- artifacts/pdf-writer-first.pdf
cargo run --quiet -p sp-01-krilla -- artifacts/krilla-first.pdf "$FONT"
cargo run --quiet -p sp-02-parley
cargo run --quiet -p sp-03-pagination -- artifacts/1000-rows.pdf "$FONT"
python3 - <<'PY'
from pathlib import Path
import re
import subprocess
for p in ['artifacts/pdf-writer-first.pdf','artifacts/krilla-first.pdf','artifacts/1000-rows.pdf']:
    data=Path(p).read_bytes()
    assert data.startswith(b'%PDF-') and data.rstrip().endswith(b'%%EOF')
    info=subprocess.check_output(['pdfinfo',p],text=True)
    assert 'Pages:' in info
    print(p, re.search(r'Pages:\s+(\d+)',info).group(1), 'pages')
info=subprocess.check_output(['pdfinfo','artifacts/1000-rows.pdf'],text=True)
assert re.search(r'Pages:\s+29\s',info)
text=subprocess.check_output(['pdftotext','-layout','artifacts/1000-rows.pdf','-'],text=True)
ids=re.findall(r'Fila\s+(\d{4})',text)
assert ids==[f'{n:04d}' for n in range(1,1001)], (len(ids),ids[:3],ids[-3:])
spanish=subprocess.check_output(['pdftotext','artifacts/krilla-first.pdf','-'],text=True)
for token in ['Cancún','Niño','acción','México','Página','¿Qué']:
    assert token in spanish, token
print('OK: 1000 rows in order, Unicode intact, PDFs valid.')
PY
