# Usage

Pouzivej jen aktivni skripty ze `src/`, pripadne kopie v `dist/` vytvorene prikazem `sh scripts/release.sh`.

Nekopiruj skripty z `backup/`; je to jen historicka kopie.

## Tampermonkey

1. Otevri pozadovany soubor v `src/`.
2. Zkopiruj cely obsah vcetne `// ==UserScript==` hlavicky.
3. V Tampermonkey vytvor novy script.
4. Vloz obsah, uloz a obnov cilovou stranku.
5. V konzoli over health log s verzi `1.0.0` a spravnym `env`.

## Chrome snippet

1. Otevri DevTools.
2. V panelu Sources otevri Snippets.
3. Vytvor novy snippet pro pozadovany skript.
4. Vloz cely obsah souboru ze `src/` nebo `dist/`.
5. Spust snippet na cilove strance a over health log v konzoli.

## Ocekavane health logy

- Login: `[IBAF-LOGIN] Login_AutoFill aktivní.`
- Autofill: `[IBAF] NTB_AutoFill_All_In_One aktivní.`
- Interceptor: `[DOC-INT] NTB_Document_Upload_Interceptor aktivní.`

Kazdy log obsahuje `version` a `env`.
