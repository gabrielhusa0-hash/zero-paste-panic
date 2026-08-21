# Zero-Knowledge Pastebin

Pastebin, kde server **nikdy** nevidí obsah v čitelné podobě. Veškeré šifrování
a dešifrování probíhá v prohlížeči pomocí Web Crypto API (AES-256-GCM).

## Jak funguje "zero-knowledge"

1. Prohlížeč vygeneruje náhodný AES-256 klíč.
2. Text se zašifruje **lokálně**, v prohlížeči.
3. Na server se pošle jen šifrovaný obsah (ciphertext) + inicializační vektor (IV).
4. Klíč se zakóduje do **fragmentu URL** (část za `#`), např.:
   `https://tvuj-server.cz/p/aBc123XyZ#kQm9f...`
5. Fragment URL (`#...`) **se z prohlížeče nikdy neposílá na server** — je to
   standardní chování HTTP. Server tedy klíč nikdy neuvidí ani ho nemá kde uložit.
6. Při otevření odkazu prohlížeč stáhne ciphertext podle ID z cesty a klíč
   vezme z fragmentu, a dešifruje lokálně.

Server tak ukládá jen nesmyslná binární data — i kdyby došlo k úniku databáze,
útočník bez fragmentu URL obsah nerozluští.

## Funkce

- AES-256-GCM šifrování/dešifrování čistě na klientovi
- Volitelná expirace (10 min / 1 hod / 1 den / 7 dní / nikdy)
- Volitelné "burn after read" — paste se po prvním přečtení smaže ze serveru
- Jednoduchý rate limiting proti spamu
- Žádné závislosti na databázi — data se ukládají do `data/pastes.json`

## Instalace a spuštění

```bash
npm install
npm start
```

Server poběží na `http://localhost:3000`.

## Struktura projektu

```
zk-pastebin/
├── server.js           # Express server — ukládá jen ciphertext, nikdy klíč
├── package.json
├── data/
│   └── pastes.json     # perzistentní úložiště (vytvoří se automaticky)
└── public/
    ├── index.html       # UI pro vytvoření i zobrazení paste
    ├── style.css
    └── app.js            # veškerá kryptografie + logika na straně klienta
```

## API

| Metoda | Cesta              | Popis                                                        |
|--------|---------------------|---------------------------------------------------------------|
| POST   | `/api/paste`         | Uloží `{ ciphertext, iv, expiresInMinutes?, burnAfterRead? }` → `{ id }` |
| GET    | `/api/paste/:id`     | Vrátí `{ ciphertext, iv, burnAfterRead }`, smaže při expiraci/burnu |
| GET    | `/p/:id`              | Servíruje frontend pro zobrazení paste (klíč je v `#fragmentu`) |
| GET    | `/health`             | Health check                                                  |

## Bezpečnostní poznámky / co by šlo vylepšit dál

- Fragment URL může skončit v historii prohlížeče na sdíleném počítači — pro
  produkční nasazení zvaž i heslem chráněné pasty (odvození klíče přes PBKDF2).
- Rate limiting je in-memory (per proces) — pro víc instancí použij Redis.
- `data/pastes.json` je jednoduché řešení pro demo/portfolio; pro produkci
  nahraď SQLite/Postgres.
- Přidej HTTPS (na serveru/reverzní proxy), fragment jinak sice server
  nevidí, ale samotný přenos ciphertextu by měl být šifrovaný taky.
