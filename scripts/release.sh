#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"

mkdir -p "$DIST_DIR"

cp "$ROOT_DIR/src/login/Login_AutoFill.js" "$DIST_DIR/Login_AutoFill.js"
cp "$ROOT_DIR/src/autofill/NTB_AutoFill_All_In_One.js" "$DIST_DIR/NTB_AutoFill_All_In_One.js"
cp "$ROOT_DIR/src/document_interceptor/NTB_Document_Upload_Interceptor.js" "$DIST_DIR/NTB_Document_Upload_Interceptor.js"

printf '%s\n' 'Release soubory jsou pripravene v dist/.'
