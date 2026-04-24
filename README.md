# Tampermonkey scripts

Repo obsahuje tri aktivni, samostatne kopirovatelne userscripty pro testovaci prostredi. Nevyzaduji build, balickovani ani instalaci zavislosti.

Pro rucni pouziti viz `USAGE.md`. Pro rychle overeni po zmene viz `SMOKE_TEST.md`.

## Aktivni skripty

| Skript | Prostredi | URL |
| --- | --- | --- |
| `src/login/Login_AutoFill.js` | PPE, TST1, DEV3 | `tmbs.internetbanka.cz`, `tembs.internetbanka.cz`, `mbczvl6altlsb000003-reactapp.ux.mbid.cz` |
| `src/autofill/NTB_AutoFill_All_In_One.js` | PPE, TST1 | `ppe-aplikace.moneta.cz/smeonboarding/*`, `test1-aplikace.moneta.cz/smeonboarding/*` |
| `src/document_interceptor/NTB_Document_Upload_Interceptor.js` | PPE, TST1 | `ppe-aplikace.moneta.cz/smeonboarding/*`, `test1-aplikace.moneta.cz/smeonboarding/*` |

Kazdy soubor ma vlastni `// ==UserScript==` hlavicku a vice `@match` radku, takze jde vlozit primo do Tampermonkey nebo jako Chrome snippet.
Namespace je zamerne neutralni (`https://local.test-tools/`) a neni spojeny se zamestnavatelem.
Zdroj pravdy je `src/`; `dist/` obsahuje jen pripravene kopie a `backup/` je pouze historicka kopie.

## Metadata standard

Kazdy aktivni skript drzi stejny zaklad hlavicky:

```js
// ==UserScript==
// @name         Nazev_Skriptu
// @namespace    https://local.test-tools/
// @version      1.0.0
// @description  Strucny popis
// @author       Vojtech Urban
// @match        https://example.test/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
```

Nepouzivej `@downloadURL` ani `@updateURL`, aby skripty zustaly vhodne pro rucni kopirovani v omezenem korporatnim prostredi.

## Pouziti

1. Otevri pozadovany soubor ze `src/`.
2. Zkopiruj cely obsah souboru.
3. Vloz ho jako novy Tampermonkey script nebo Chrome snippet.
4. Uloz a obnov cilovou stranku.
5. Zkontroluj v konzoli aktivacni hlasku skriptu.

## Smoke checklist

Po zmene skriptu rucne over:

- `Login_AutoFill.js` se aktivuje na PPE loginu.
- `Login_AutoFill.js` se aktivuje na TST1 loginu.
- `Login_AutoFill.js` se aktivuje na DEV3 loginu.
- `NTB_AutoFill_All_In_One.js` zobrazi ovladaci tlacitko na PPE NTB onboarding URL.
- `NTB_AutoFill_All_In_One.js` zobrazi ovladaci tlacitko na TST1 NTB onboarding URL.
- `NTB_Document_Upload_Interceptor.js` se aktivuje na PPE NTB onboarding URL.
- `NTB_Document_Upload_Interceptor.js` se aktivuje na TST1 NTB onboarding URL.
- Upload OP front/back je nahrazen testovacim vzorkem.
- Route `secondary-document-photo` posila pouze `DRIVING_LICENSE_FRONT`; zadni strana RP se nepouziva.

## Pred predanim

- Spust syntax kontrolu pro vsechny tri aktivni skripty.
- Spust zakladni repo kontrolu `sh scripts/check.sh`.
- Volitelne priprav kopie do `dist/` prikazem `sh scripts/release.sh`.
- Vypln nebo projdi `SMOKE_TEST.md`.
- Rucne over login skript na PPE, TST1 a DEV3.
- Rucne over NTB autofill na PPE a TST1.
- Rucne over document interceptor na PPE a TST1.
- V konzoli over aktivacni hlasky a u interceptoru log o nahrazeni uploadu dokladu.

## Known behavior

- Testovaci heslo a OTP jsou zamerne hardcoded testovaci hodnoty.
- Zadni strana RP se zamerne nepouziva; `secondary-document-photo` mapuje jen `DRIVING_LICENSE_FRONT`.
- Skripty jsou samostatne a bez buildu/importu.
- Puvodni env-specific `.user.js` varianty byly nahrazeny jednim souborem na rodinu skriptu.
- Interceptor uz neobsahuje sekvencni state pro RP front/back, protoze back cast se nepouziva.
- Debug a runtime API prepinace jsou soustredene nahore v `CONFIG`.

## Poznamky

- `backup/` je historicka kopie. Na obsah v `backup/` pri bezne udrzbe nesahej.
- Testovaci heslo a OTP jsou zamerne soucasti login skriptu, protoze jsou stejne pro vsechny testovaci klienty a prostredi.
- Soubory v `src/` jsou zdroj pravdy pro aktivni pouziti.
- Interni runtime klice v `window` zustavaji kompatibilni se starsimi variantami, aby novy skript umel uklidit predchozi bezici instanci po prekopirovani do prohlizece.

## Rychla kontrola syntaxe

Jednim prikazem:

```sh
sh scripts/check.sh
```

Nebo jednotlive:

```sh
node --check src/login/Login_AutoFill.js
node --check src/autofill/NTB_AutoFill_All_In_One.js
node --check src/document_interceptor/NTB_Document_Upload_Interceptor.js
```
