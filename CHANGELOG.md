# Changelog

## 1.0.1

- Document interceptor: runtime API je znovu zapnute pro rucni ladeni a `force(...)` workflow.
- Document interceptor: route detekce `secondary-document-photo` funguje i bez hash prefixu.

## 1.0.0

- Slouceny aktivni skripty do tri samostatnych souboru v `src/`.
- Odstranena env-specific `.user.js` jmena z aktivnich skriptu.
- Sjednocen neutralni namespace `https://local.test-tools/`.
- Pridany environment mapy pro login, autofill a document interceptor.
- Odstranena nepouzivana RP back vetev a sekvencni state interceptoru.
- Osetreno report rendering v autofillu bez vkladani hodnot pres `innerHTML`.
- Pridana dokumentace, kontrolni skript a release workflow.
- Pridany runtime health logy s verzi a prostredim.
- Pridany `USAGE.md`, `SMOKE_TEST.md` a prisnejsi metadata kontroly.
