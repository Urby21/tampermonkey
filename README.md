# Tampermonkey scripts

Repo obsahuje tri aktivni, samostatne kopirovatelne userscripty pro testovaci prostredi. Nevyzaduji build, balickovani ani instalaci zavislosti.

## Aktivni skripty

| Skript | Prostredi | URL |
| --- | --- | --- |
| `src/login/Login_AutoFill.js` | PPE, TST1, DEV3 | `tmbs.internetbanka.cz`, `tembs.internetbanka.cz`, `mbczvl6altlsb000003-reactapp.ux.mbid.cz` |
| `src/autofill/NTB_AutoFill_All_In_One.js` | PPE, TST1 | `ppe-aplikace.moneta.cz/smeonboarding/*`, `test1-aplikace.moneta.cz/smeonboarding/*` |
| `src/document_interceptor/NTB_Document_Upload_Interceptor.js` | PPE, TST1 | `ppe-aplikace.moneta.cz/smeonboarding/*`, `test1-aplikace.moneta.cz/smeonboarding/*` |

Kazdy soubor ma vlastni `// ==UserScript==` hlavicku a vice `@match` radku, takze jde vlozit primo do Tampermonkey nebo jako Chrome snippet.

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
- Rucne over login skript na PPE, TST1 a DEV3.
- Rucne over NTB autofill na PPE a TST1.
- Rucne over document interceptor na PPE a TST1.
- V konzoli over aktivacni hlasky a u interceptoru log o nahrazeni uploadu dokladu.

## Poznamky

- `backup/` je historicka kopie. Na obsah v `backup/` pri bezne udrzbe nesahej.
- Testovaci heslo a OTP jsou zamerne soucasti login skriptu, protoze jsou stejne pro vsechny testovaci klienty a prostredi.
- Soubory v `src/` jsou zdroj pravdy pro aktivni pouziti.
- Interni runtime klice v `window` zustavaji kompatibilni se starsimi variantami, aby novy skript umel uklidit predchozi bezici instanci po prekopirovani do prohlizece.

## Rychla kontrola syntaxe

```sh
node --check src/login/Login_AutoFill.js
node --check src/autofill/NTB_AutoFill_All_In_One.js
node --check src/document_interceptor/NTB_Document_Upload_Interceptor.js
```
