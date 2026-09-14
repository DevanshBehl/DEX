# Celestial Wallet — NFT Implementation Plan

A phased plan for turning the current demo NFT panel into a real NFT experience: showing the user's own NFTs, sending them, and trading on existing marketplaces (Tensor, Magic Eden, OpenSea) **without ever holding user funds or keys**.

> **Principle — non-custodial by construction.** Third-party APIs are only ever used to *read* data or to *build* unsigned transactions. Every transaction is simulated, shown to the user, and signed locally inside the extension. Private keys and seed phrases never leave the device.

---

## Table of Contents

1. [Current State](#1-current-state)
2. [Target Architecture](#2-target-architecture)
3. [Phase 0 — Test Fixtures (Devnet / Sepolia)](#phase-0--test-fixtures-devnet--sepolia)
4. [Phase 1 — Real Ownership & Data Model](#phase-1--real-ownership--data-model)
5. [Phase 2 — NFT UI (Tab, Grid, Detail Page)](#phase-2--nft-ui-tab-grid-detail-page)
6. [Phase 3 — Send NFTs](#phase-3--send-nfts)
7. [Phase 4 — Marketplace Data (Read-Only)](#phase-4--marketplace-data-read-only)
8. [Phase 5 — Marketplace Trading](#phase-5--marketplace-trading)
9. [Phase 6 — Extras](#phase-6--extras)
10. [Cross-Cutting Concerns](#cross-cutting-concerns)
11. [Network Support Matrix](#network-support-matrix)
12. [Open Questions](#open-questions)

---

## 1. Current State

| Area | File | Status |
|---|---|---|
| Fetching | `celestial-react-wallet/src/utils/nftUtils.ts` | Calls Alchemy `getNFTsForOwner` (EVM) and Helius `getAssetsByOwner` (Solana) |
| UI | `celestial-react-wallet/src/components/NFTTab.tsx` | Separate slide-down panel, 2-column grid (image, collection, name, chain tag) |
| Type | `celestial-react-wallet/src/types/index.ts` → `NFTRecord` | `id, chain, name, collectionName, imageUrl` |
| Entry point | `App.tsx` → "NFTs" label in the asset drawer sets `isNFTsOpen` | Opens the panel |

### Known problems

- **🔴 Hardcoded mock owner.** `fetchAccountNFTs` ignores the user's address and loads NFTs for `vitalik.eth` (EVM) and `vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg` (Solana). The user never sees their own NFTs.
- No pagination — Solana limited to the first 100 assets, EVM to the first Alchemy page.
- No spam filtering (airdropped scam NFTs dominate most wallets).
- Image fallback points to `via.placeholder.com` (offline) → broken images stay broken.
- IPFS resolved via the slow public `ipfs.io` gateway.
- View-only: no detail page, attributes, send, list, buy, or burn.
- Not integrated into the Tokens/NFTs drawer as a real tab.
- NFTs are not counted in portfolio value.

---

## 2. Target Architecture

```
┌──────────────────────────── Extension Popup (UI) ────────────────────────────┐
│  NFTs tab ─ grid ─ detail page ─ send flow ─ marketplace (list/buy/offer)     │
└───────────────┬──────────────────────────────────────────────┬───────────────┘
                │ read                                          │ sign + broadcast
                ▼                                               ▼
┌─────────────────────────────┐                  ┌──────────────────────────────┐
│ src/nft/indexers/           │                  │ src/nft/tx/                  │
│  alchemy.ts  (EVM ownership)│                  │  evm.ts     (721 / 1155)     │
│  helius.ts   (Solana DAS)   │                  │  solana.ts  (NFT/pNFT/cNFT/  │
└─────────────────────────────┘                  │              Core)           │
┌─────────────────────────────┐                  │  simulate.ts (safety check)  │
│ src/nft/marketplaces/       │  unsigned tx ──▶ └──────────────────────────────┘
│  types.ts   (provider API)  │
│  tensor.ts / magiceden.ts / │
│  opensea.ts                 │
└──────────────┬──────────────┘
               │ (Phase 4+) partner API keys
               ▼
┌─────────────────────────────┐
│ celestial-api (thin proxy)  │  holds partner API keys only — never user keys
└─────────────────────────────┘
```

### Proposed folder layout

```
celestial-react-wallet/src/nft/
├── types.ts                  # NFTAsset, NFTCollection, NFTStandard, listing/offer types
├── normalize.ts              # indexer payload → NFTAsset
├── media.ts                  # IPFS/Arweave resolution, image fallbacks
├── spam.ts                   # spam heuristics + user hide/unhide list
├── indexers/
│   ├── alchemy.ts
│   └── helius.ts
├── tx/
│   ├── evm.ts
│   ├── solana.ts
│   └── simulate.ts
├── marketplaces/
│   ├── types.ts
│   ├── magiceden.ts
│   ├── tensor.ts
│   └── opensea.ts
└── hooks/
    ├── useNFTs.ts
    └── useNFTMarket.ts

celestial-react-wallet/src/components/nft/
├── NFTGrid.tsx
├── NFTCard.tsx
├── NFTDetailPage.tsx
├── SendNFTFlow.tsx
├── ListNFTSheet.tsx
├── BuyNFTSheet.tsx
└── TxReviewSheet.tsx         # shared "what will this transaction do" screen
```

---

## Phase 0 — Test Fixtures (Devnet / Sepolia)

**Goal:** a reproducible set of NFTs in a test wallet covering every standard the wallet must support, so Phases 1–3 can be built and verified without mainnet funds.

### 0.1 Solana devnet fixture script

**File:** `celestial-react-wallet/scripts/mint-devnet-nfts.ts`

| Step | Asset | Library |
|---|---|---|
| 1 | Collection NFT ("Celestial Test Collection") | `@metaplex-foundation/mpl-token-metadata` |
| 2 | 2× Standard NFTs in the collection | `createNft` |
| 3 | 1× Programmable NFT (pNFT) | `createProgrammableNft` |
| 4 | 1× Metaplex Core asset | `@metaplex-foundation/mpl-core` `create` |
| 5 | Merkle tree + 2× compressed NFTs | `@metaplex-foundation/mpl-bubblegum` `createTree` / `mintV1` |
| 6 | 1× "spam-like" NFT (no collection, suspicious name/URL) | `createNft` |
| 7 | 1× NFT with broken image URI | `createNft` |

- Reads a **dedicated test keypair** from a local file (never the user's vault).
- Uploads metadata/images (Irys devnet uploader or static JSON on a public URL).
- Prints all mint addresses to `scripts/fixtures.devnet.json`.
- Funding: `faucet.solana.com` or `solana airdrop 2 <addr> --url devnet`.

### 0.2 Sepolia fixture script

**Files:** `celestial-contracts/src/TestERC721.sol`, `celestial-contracts/src/TestERC1155.sol`, `celestial-contracts/script/MintTestNFTs.s.sol`

- OpenZeppelin-based ERC-721 (mint 5, one with broken `tokenURI`) and ERC-1155 (2 ids, quantities 10 and 1).
- Deploy with `forge script ... --rpc-url $SEPOLIA_RPC --broadcast`.
- Funding: Google Cloud Web3 faucet or Alchemy Sepolia faucet.

### ✅ Acceptance criteria

- [ ] Running each script once yields every asset type above in the test wallet.
- [ ] Helius `getAssetsByOwner` (devnet) and Alchemy `getNFTsForOwner` (Sepolia) return all fixtures.
- [ ] Fixture addresses committed to `fixtures.*.json` for use in manual QA.

---

## Phase 1 — Real Ownership & Data Model

**Goal:** fetch the *user's* NFTs correctly, completely, and in a normalized shape the rest of the app can rely on.

### 1.1 Remove the mock override

Delete the `testAddress` block in `nftUtils.ts`; always use `account.address`.

### 1.2 Unified data model

**File:** `src/nft/types.ts`

```ts
export type NFTStandard =
  | 'erc721'
  | 'erc1155'
  | 'metaplex-nft'     // Token Metadata, non-programmable
  | 'metaplex-pnft'    // Programmable NFT
  | 'metaplex-cnft'    // Bubblegum compressed
  | 'metaplex-core'    // mpl-core asset
  | 'token-2022-nft';  // Token-2022 w/ metadata extension

export interface NFTCollection {
  id: string;               // contract address (EVM) or collection mint/address (Solana)
  name: string;
  image: string | null;
  verified: boolean;
}

export interface NFTAsset {
  key: string;              // `${chain}:${contract}:${tokenId}` or `solana:${assetId}`
  chain: 'EVM' | 'Solana';
  standard: NFTStandard;
  contract?: string;        // EVM contract
  tokenId?: string;         // EVM token id
  assetId?: string;         // Solana mint / asset id
  name: string;
  description: string | null;
  image: string | null;
  animationUrl: string | null;
  attributes: { trait_type: string; value: string | number }[];
  collection: NFTCollection | null;
  amount: string;           // "1" for 721/Solana; quantity for 1155
  isSpam: boolean;
  isHiddenByUser: boolean;
  tokenProgram?: string;    // Solana token program (for transfers)
  royaltyBps?: number;
}
```

`NFTRecord` in `types/index.ts` is replaced by `NFTAsset`.

### 1.3 Indexers

**EVM — `src/nft/indexers/alchemy.ts`**
- `getNFTsForOwner?owner=…&withMetadata=true&pageSize=100` looped via `pageKey`.
- Map `tokenType` (`ERC721` / `ERC1155`) → `standard`; `balance` → `amount`.
- Use Alchemy's spam classification where available on the plan (`contract.isSpam` / spam filters), otherwise fall back to local heuristics.

**Solana — `src/nft/indexers/helius.ts`**
- DAS `getAssetsByOwner` with `page`/`limit: 1000`, loop until a page returns fewer than `limit`.
- Map `interface` + flags → `standard`:
  - `compression.compressed === true` → `metaplex-cnft`
  - `interface === 'ProgrammableNFT'` → `metaplex-pnft`
  - `interface === 'MplCoreAsset'` → `metaplex-core`
  - `interface === 'V1_NFT' | 'V1_PRINT'` → `metaplex-nft`
  - exclude `FungibleToken` / `FungibleAsset` (handled by `tokenUtils.ts`)
- Collection from `grouping[group_key=collection]` (+ `verified`).
- Prefer `content.files[].cdn_uri` (Helius CDN) for images.

> Verify field names against current Alchemy / Helius docs during implementation.

### 1.4 Media resolution — `src/nft/media.ts`

- `ipfs://` → configurable fast gateway (e.g. Helius/Alchemy cached URLs first, then a dedicated gateway), `ar://` → `arweave.net`.
- Local bundled placeholder SVG (replace `via.placeholder.com`).
- Detect `video/*`, `model/gltf`, `text/html` animation URLs → render appropriately or show a static image.

### 1.5 Spam handling — `src/nft/spam.ts`

Heuristics (combined score): provider spam flag, unverified collection, URLs/"claim"/"airdrop"/"reward" in name or description, zero-holder collections, known scam domain list. Users can **hide / unhide** any NFT; persisted in `chrome.storage.local` per account + network.

### 1.6 Caching

- Cache per `(accountAddress, network)` in `chrome.storage.local` with timestamp; render cached list instantly, refresh in background (same pattern as token balances).
- Refresh on: tab open, pull-to-refresh, after any NFT transaction confirms.

### ✅ Acceptance criteria

- [ ] Only the unlocked account's NFTs are shown, on the selected network.
- [ ] All Phase 0 fixtures appear with the correct `standard`.
- [ ] Wallets with >100 Solana assets / multiple Alchemy pages load completely.
- [ ] Spam fixture is hidden by default; broken-image fixture shows the local placeholder.

---

## Phase 2 — NFT UI (Tab, Grid, Detail Page)

**Goal:** a first-class NFT experience comparable to Phantom.

### 2.1 Inline tab

- Replace the separate `NFTTab` slide-down panel with a real **Tokens | NFTs** segmented tab inside the existing scrollable asset drawer in `App.tsx` (sticky header already exists).
- Count badge reflects the active tab.

### 2.2 Grid — `NFTGrid.tsx`, `NFTCard.tsx`

- Group by collection (collapsible, with collection image + count); "Ungrouped" section last.
- Card: lazy-loaded image with skeleton, name, chain badge, quantity badge for ERC-1155.
- Footer toggle: **Show hidden / spam (n)**.
- Empty state with "Receive" shortcut.

### 2.3 Detail page — `NFTDetailPage.tsx`

- Large media (image / video / fallback), name, collection (verified badge).
- Description (expandable), attributes grid.
- Details: standard, contract/mint (copy + explorer link), token id, royalties, owner.
- Actions: **Send**, **Hide/Unhide**, **View on explorer**; placeholders for **List / Make offer** (enabled in Phase 5, mainnet only).

### ✅ Acceptance criteria

- [ ] Tokens ↔ NFTs switches inline without closing the drawer.
- [ ] Every fixture opens a correct detail page; video/broken media handled.
- [ ] Hiding an NFT persists across popup reopen and network switch-back.
- [ ] Works at the 360×600 popup size without overlap (bottom nav hidden on detail page).

---

## Phase 3 — Send NFTs

**Goal:** reliable transfers for every supported standard, signed locally.

### 3.1 Transaction builders

**EVM — `src/nft/tx/evm.ts`** (ethers v6, existing dependency)

| Standard | Call |
|---|---|
| ERC-721 | `safeTransferFrom(from, to, tokenId)` |
| ERC-1155 | `safeTransferFrom(from, to, id, amount, "0x")` |

**Solana — `src/nft/tx/solana.ts`**

| Standard | Method | Notes |
|---|---|---|
| `metaplex-nft` | SPL `transferChecked` (amount 1, decimals 0) + idempotent ATA creation | Reuse logic from `sendSPLTokenTransaction` in `txUtils.ts` |
| `token-2022-nft` | Same, with Token-2022 program id | |
| `metaplex-pnft` | `mpl-token-metadata` `transferV1` | Handles token records / authorization rules; plain SPL transfer **fails** |
| `metaplex-cnft` | `mpl-bubblegum` `transfer` | Requires asset proof (`getAssetProof` via Helius DAS) |
| `metaplex-core` | `mpl-core` `transfer` | Pass collection when asset belongs to one |

New dependencies (Solana only): `@metaplex-foundation/umi`, `umi-bundle-defaults`, `mpl-token-metadata`, `mpl-bubblegum`, `mpl-core`.
- Create the Umi signer from the locally derived `Keypair` — keys stay in-process.
- **Lazy-load** Metaplex packages (`import()`) to keep popup startup fast.

### 3.2 Send flow — `SendNFTFlow.tsx`

1. Recipient input with validation (`ethers.isAddress` / `PublicKey` on-curve check), paste, recent addresses.
2. Quantity selector (ERC-1155 only).
3. Review screen (`TxReviewSheet.tsx`): NFT preview, recipient, estimated network fee in native coin, warnings:
   - sending to own address / to the NFT's own contract or mint
   - recipient has never been seen before
   - insufficient ETH/SOL for fees
4. Slide-to-send (reuse existing component), then success state with explorer link.
5. Optimistically remove the NFT from the grid; refetch after confirmation.

### ✅ Acceptance criteria

- [ ] Each Phase 0 fixture type can be sent to a second test wallet and appears there.
- [ ] pNFT and cNFT transfers succeed (the common failure cases).
- [ ] Clear error messages for insufficient fee balance and invalid addresses.
- [ ] No private key material passed to any network request (verified by code review).

---

## Phase 4 — Marketplace Data (Read-Only)

**Goal:** show market context — floor prices, collection stats, estimated NFT value — without trading yet.

### 4.1 Provider abstraction — `src/nft/marketplaces/types.ts`

```ts
export interface MarketplaceProvider {
  id: 'magiceden' | 'tensor' | 'opensea';
  chains: ('EVM' | 'Solana')[];
  getCollectionStats(collectionId: string): Promise<CollectionStats>;   // floor, volume, listed count
  getListings(collectionId: string, cursor?: string): Promise<Page<Listing>>;
  getBestOffer(nft: NFTAsset): Promise<Offer | null>;
  getNFTListing(nft: NFTAsset): Promise<Listing | null>;               // is this NFT listed?
}
```

| Provider | Chains | Initial use |
|---|---|---|
| **Magic Eden** | Solana + EVM | Default for stats/listings on both chains |
| **Tensor** | Solana | Solana floors, listings, collection bids |
| **OpenSea** | EVM | Ethereum listings/offers (Seaport) |

### 4.2 API key proxy — `celestial-api/`

- Thin serverless proxy (e.g. Cloudflare Worker) that injects partner API keys and applies rate limiting/caching.
- **Never** receives keys, seed phrases, or signed-but-unsent user transactions beyond what is required to relay.
- Removes partner keys from the extension bundle (today all `VITE_*` keys ship inside the build).

### 4.3 UI

- Floor price + estimated value on NFT cards and detail page.
- NFT value included in total portfolio (toggle: "Include NFTs at floor").
- **Explore** screen: trending collections → collection page (stats + listings grid).

### ✅ Acceptance criteria

- [ ] Floor prices shown for held mainnet NFTs from verified collections.
- [ ] Graceful "No market data" on devnet/Sepolia and for unlisted collections.
- [ ] No partner API key present in the built extension bundle.

---

## Phase 5 — Marketplace Trading

**Goal:** buy, list, delist, make and accept offers through partner marketplaces — the wallet signs, the marketplace's on-chain program settles.

### 5.1 Trading extensions to the provider interface

```ts
export type UnsignedTx =
  | { chain: 'Solana'; serialized: string /* base64 versioned tx */; expiresAt?: number }
  | { chain: 'EVM'; steps: { kind: 'approval' | 'trade'; to: string; data: string; value: string }[] };

export interface TradingProvider extends MarketplaceProvider {
  buildBuyTx(listing: Listing, buyer: string): Promise<UnsignedTx>;
  buildListTx(nft: NFTAsset, priceNative: string, seller: string): Promise<UnsignedTx>;
  buildDelistTx(nft: NFTAsset, seller: string): Promise<UnsignedTx>;
  buildMakeOfferTx(collectionOrNft: string, priceNative: string, bidder: string): Promise<UnsignedTx>;
  buildAcceptOfferTx(offer: Offer, nft: NFTAsset, seller: string): Promise<UnsignedTx>;
}
```

- EVM trades may need an **approval step** (e.g. `setApprovalForAll` to a marketplace conduit) before the trade step — surface both clearly.
- Some EVM listings/offers are **off-chain signatures** (EIP-712) rather than transactions — requires `eth_signTypedData_v4` signing support.

### 5.2 Mandatory safety pipeline — `src/nft/tx/simulate.ts`

Every marketplace-built transaction goes through:

1. **Program / contract allowlist** — Solana program IDs and EVM contracts for Tensor, Magic Eden, Seaport, etc. Reject unknown targets.
2. **Simulation** — Solana `simulateTransaction` (or provider asset-change simulation); EVM asset-change simulation (e.g. Alchemy `simulateAssetChanges`).
3. **Intent match** — compare simulated balance changes with what the user requested (e.g. "−1.2 SOL − fees, +NFT X"). Block on mismatch, unexpected transfers, or unlimited approvals not required by the action.
4. **Review sheet** — human-readable summary, marketplace fee, royalty, network fee.
5. **Local signing + broadcast** via existing RPCs; Solana blockhash expiry handled by rebuilding if the user takes too long.

### 5.3 UI flows

| Flow | Entry point | Screens |
|---|---|---|
| Buy now | Collection page listing / Explore | Listing → review (price, fees, royalties) → slide to buy → success |
| List | NFT detail → "List" | Price input (floor hint) → marketplace choice → review → sign |
| Delist / edit price | NFT detail (listed badge) | Review → sign |
| Make offer | Collection page / NFT detail | Amount + expiry → review → sign |
| Accept offer | NFT detail → "Best offer" | Review (proceeds after fees) → sign |

- "Listed" / "Has offers" badges on grid cards.
- **My activity:** listings, offers, purchases; **Approvals** page to revoke marketplace approvals (EVM).

### ✅ Acceptance criteria (mainnet, small amounts)

- [ ] Buy, list, delist, make offer, accept offer each completed end-to-end on Solana (Tensor or Magic Eden).
- [ ] Buy and list completed on Ethereum (OpenSea or Magic Eden), or on OpenSea's Sepolia testnet if still available.
- [ ] Simulation blocks a deliberately tampered transaction (unit test with a modified instruction).
- [ ] Unknown program/contract targets are rejected with a clear message.

---

## Phase 6 — Extras

Optional, independent tracks after Phase 5:

- **Burn NFT** (reclaim rent on Solana), with strong confirmation.
- **Bulk actions:** multi-select send / hide / list.
- **Mint from dApps:** verify Candy Machine and generic mint pages work through the connection + signing screens.
- **Launchpad tokens (pump.fun):** separate *token* feature — discovery of new launches, bonding-curve buy/sell via the pump.fun program or a provider, Jupiter swaps after graduation. Reuses the Phase 5 safety pipeline.
- **Referral / platform fees** where partner APIs permit — review each provider's terms.
- **Notifications:** offer received, listing sold, NFT received.

---

## Cross-Cutting Concerns

### Security

- Keys/seed never serialized into any request; code review checklist item for every PR touching `nft/tx` or `nft/marketplaces`.
- Treat all indexer/marketplace data as untrusted: sanitize names/descriptions, never render HTML from metadata, sandbox `animation_url` HTML (or don't render it).
- Warn on blind-signing and unlimited approvals.
- Long-term: move signing into `background.js` so keys never live in popup memory.

### Performance

- Paginated fetch with incremental rendering; virtualized grid for large wallets.
- Lazy-load Metaplex and marketplace modules.
- Image thumbnails via provider CDNs; `loading="lazy"`.

### Testing

| Layer | Approach |
|---|---|
| Normalizers (`normalize.ts`, `spam.ts`, `media.ts`) | Unit tests with recorded Alchemy/Helius payloads |
| Tx builders | Unit tests asserting instructions/calldata; devnet/Sepolia integration using Phase 0 fixtures |
| Safety pipeline | Unit tests with tampered transactions and mismatched simulated diffs |
| UI | Manual QA checklist at 360×600 per phase; fixtures cover all standards and edge cases |

### Observability

- Structured console logging behind a debug flag; user-facing error messages mapped from provider/RPC errors.

---

## Network Support Matrix

| Capability | Solana Devnet | Solana Mainnet | Sepolia | Ethereum Mainnet |
|---|:-:|:-:|:-:|:-:|
| Phase 1–2: view NFTs | ✅ | ✅ | ✅ | ✅ |
| Phase 3: send NFTs | ✅ | ✅ | ✅ | ✅ |
| Phase 4: floor prices / stats | ❌ | ✅ | ⚠️ OpenSea testnet API (if available) | ✅ |
| Phase 5: trading | ❌ (Tensor/ME mainnet only) | ✅ | ⚠️ OpenSea testnets (if available) | ✅ |

---

## Open Questions

1. **Partner API access** — apply for Tensor, Magic Eden and OpenSea API keys; confirm rate limits and commercial terms.
2. **Proxy hosting** — Cloudflare Worker vs. existing backend; who owns deployment and key rotation?
3. **Default marketplace per chain** — Magic Eden for both, or Tensor for Solana + OpenSea for Ethereum?
4. **Fees** — does Celestial take a platform/referral fee where permitted?
5. **Royalties** — honor creator royalties by default on buys/listings where optional?
6. **Signing location** — move all signing to the background service worker before Phase 5?

---

## Milestone Summary

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Devnet + Sepolia fixture scripts | — |
| 1 | Real, complete, normalized NFT data | 0 |
| 2 | Inline NFTs tab, grouped grid, detail page | 1 |
| 3 | Send for all 7 standards | 1, 2 |
| 4 | Floor prices, Explore, API proxy | 1, 2 |
| 5 | Buy / list / delist / offers with simulation safety | 3, 4 |
| 6 | Burn, bulk, launchpad tokens, notifications | 5 |
