# celestial-react-wallet — Celestial Wallet

A non-custodial Chrome MV3 extension for **EVM**, **Solana** and **Bitcoin** from one BIP-39 seed. It injects EIP-1193 / EIP-6963 and Wallet Standard providers and has a full NFT module.

Full documentation: [`docs/wallet.md`](../docs/wallet.md) · NFTs: [`docs/wallet-nfts.md`](../docs/wallet-nfts.md) · Onboarding: [`docs/landing.md`](../docs/landing.md) · Security notes: [`docs/security.md`](../docs/security.md#wallet-extension)

## Quick start

```bash
npm install
# create .env with the VITE_* variables listed in docs/wallet.md#configuration
# (they are bundled into the extension — use restricted keys)
npm run build            # → dist/
```

Load `dist/` at `chrome://extensions` → Developer mode → **Load unpacked**, then create a wallet on the onboarding site (`celestial-landing`, route `/onboarding`).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server (popup UI only; extension APIs are stubbed) |
| `npm run build` | Type-check and build the extension into `dist/` |
| `npm test` | NFT module unit tests (`node:test`) |
| `npm run typecheck:tests` / `typecheck:scripts` | Type-check tests and scripts |
| `npm run fixtures:solana -- --owner <address>` | Mint the Solana devnet NFT fixtures |
| `npm run lint` | ESLint |

## Layout

```
public/          manifest.json · background.js (service worker) · content.js · inpage.js (providers)
src/App.tsx      popup UI
src/nft/         NFT indexers, normalisers, spam, media, transfers, marketplaces
src/components/  popup components (nft/ for the NFT UI)
src/utils/       derivation, balances, tokens, transactions, history, swap, on-ramp
tests/nft/       unit tests with recorded indexer payloads
scripts/         devnet NFT fixture minting (scripts/.keys/ is gitignored)
```
