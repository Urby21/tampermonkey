#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

for file in src/login/Login_AutoFill.js src/autofill/NTB_AutoFill_All_In_One.js src/document_interceptor/NTB_Document_Upload_Interceptor.js; do
  node --check "$file"
done

js_count=$(rg --files src | rg -c '\.js$' || true)
if [ "$js_count" -ne 3 ]; then
  fail "Ocekavam presne 3 aktivni JS soubory v src/, nalezeno: $js_count"
fi

if rg --files src | rg '\.user\.'; then
  fail 'Aktivni skript v src/ nesmi mit .user. v nazvu.'
fi

if rg -n 'REPLACE_ME|RP_BACK|DRIVING_LICENSE_BACK|RP_SEQ|seqState|@downloadURL|@updateURL' src 2>/dev/null; then
  fail 'Kontrola nasla zakazany nebo odstraneny token.'
fi

if rg -n '@namespace' src | rg -v 'https://local\.test-tools/'; then
  fail 'Nektery aktivni skript nema neutralni namespace.'
fi

for file in src/login/Login_AutoFill.js src/autofill/NTB_AutoFill_All_In_One.js src/document_interceptor/NTB_Document_Upload_Interceptor.js; do
  for field in '@name' '@namespace' '@version' '@description' '@match' '@grant' '@run-at'; do
    if ! rg -q "$field" "$file"; then
      fail "$file nema metadata polozku $field"
    fi
  done
  if ! rg -q 'https://local\.test-tools/' "$file"; then
    fail "$file nema neutralni namespace."
  fi
  if ! rg -q '@version\s+1\.0\.0' "$file"; then
    fail "$file nema ocekavanou verzi 1.0.0."
  fi
  if ! rg -q 'SCRIPT_VERSION' "$file"; then
    fail "$file nema runtime health verzi SCRIPT_VERSION."
  fi
done

printf '%s\n' 'OK: syntaxe a zakladni repo kontroly prosly.'
