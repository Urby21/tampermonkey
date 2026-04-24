# Smoke Test

Datum:

Tester:

Verze:

## Pred testem

- [ ] `sh scripts/check.sh` prosel bez chyby.
- [ ] Testuji aktualni soubory ze `src/` nebo `dist/`.
- [ ] Nekopiruji nic z `backup/`.

## Login_AutoFill

- [ ] PPE: skript se aktivuje a v konzoli ukaze `env: PPE`.
- [ ] TST1: skript se aktivuje a v konzoli ukaze `env: TST1`.
- [ ] DEV3: skript se aktivuje a v konzoli ukaze `env: DEV3`.
- [ ] Tlacitko ukazuje badge prostredi.
- [ ] Autofill hesla a OTP projde podle ocekavani.

## NTB_AutoFill_All_In_One

- [ ] PPE: skript se aktivuje a v konzoli ukaze `env: PPE`.
- [ ] TST1: skript se aktivuje a v konzoli ukaze `env: TST1`.
- [ ] Ovladaci tlacitko se zobrazi na onboarding URL.
- [ ] Zakladni akce vyplni testovaci data.
- [ ] Report panel nezobrazuje neocekavany HTML markup z hodnot.

## NTB_Document_Upload_Interceptor

- [ ] PPE: skript se aktivuje a v konzoli ukaze `env: PPE`.
- [ ] TST1: skript se aktivuje a v konzoli ukaze `env: TST1`.
- [ ] Upload OP front se nahradi testovacim vzorkem.
- [ ] Upload OP back se nahradi testovacim vzorkem.
- [ ] Route `secondary-document-photo` posila jen `DRIVING_LICENSE_FRONT`.
- [ ] V konzoli je log `Nahrazen upload dokladu`.

## Poznamky

-
