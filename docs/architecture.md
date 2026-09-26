# Architecture

Celestial is a monorepo of six packages that together form a non-custodial trading stack:

| Package | Stack | Role |
|---|---|---|
| `celestial-contracts/` | Solidity 0.8.24, Foundry, OpenZeppelin | Perps protocol on **Ethereum Sepolia**, plus testnet fixtures (Mock USDC, test NFTs) |
| `celestial-solana/` | Rust, Anchor 1.1.2, Token-2022 | The same protocol on **Solana devnet**, as one program (`celestial_perps`) |
| `celestial-keeper/` | Node 24, TypeScript, ethers 6, @solana/web3.js | Off-chain operator for both chains: executes orders, liquidates, updates funding |
| `celestial-perps/` | Next.js (App Router), React, Tailwind | Trading and liquidity app (`/trade`, `/earn`) for both chains |
| `celestial-react-wallet/` | React 19, Vite, Chrome MV3 | **Celestial Wallet**: an EVM + Solana + Bitcoin browser extension |
| `celestial-landing/` | React 19, Vite | Marketing site and **wallet onboarding** (seed generation, vault encryption) |

Shared assets live at the root: `docs/` (this reference), `deployments/` (addresses), and the ABIs and IDL, which `celestial-perps/src/abis` and `celestial-perps/src/idl` export and the keeper consumes.

## System context

```mermaid
flowchart TB
    Trader([Trader / LP])
    subgraph Browser
        App["celestial-perps<br/>Next.js app"]
        Ext["Celestial Wallet<br/>MV3 extension"]
        Other["Other wallets<br/>MetaMask · Phantom"]
        Landing["celestial-landing<br/>onboarding"]
    end
    subgraph Sepolia["Ethereum Sepolia"]
        Engine[PerpEngine]
        Pool[LiquidityPool]
        CLP[CLP ERC-20]
        Oracle[ChainlinkOracle]
        USDC[MockUSDC]
        CLF[(Chainlink<br/>AggregatorV3 feeds)]
    end
    subgraph Solana["Solana devnet"]
        Prog["celestial_perps<br/>Anchor program"]
        OCR2[(Chainlink OCR2<br/>store feeds)]
    end
    Keeper["celestial-keeper<br/>Node process"]
    CB[(Coinbase Exchange<br/>public market data)]

    Trader --> App
    Trader --> Landing
    Landing -- "encrypted vault<br/>(postMessage)" --> Ext
    App -- "EIP-6963 / Wallet Standard" --> Ext & Other
    App -- "reads (JSON-RPC)" --> Engine & Pool & Prog
    Ext & Other -- "signed txs" --> Engine & Pool & Prog
    App -- "chart + ticker (display only)" --> CB
    Keeper -- "executeRequests / liquidate / updateFunding" --> Engine
    Keeper -- "execute_request / liquidate / update_funding" --> Prog
    Engine --> Pool --> CLP
    Engine --> Oracle --> CLF
    Pool --> USDC
    Prog --> OCR2
```

## The protocol in one paragraph

Celestial Perps is a **pool-based** perpetual futures exchange in the style of GMX v1. A single USDC pool is the counterparty to every trader. Liquidity providers deposit USDC and receive **CLP**, which is valued at the pool's assets under management (AUM) minus the traders' unrealised PnL. Traders open leveraged long or short positions on synthetic markets (BTC-USD, ETH-USD, and SOL-USD on Solana), and the positions are priced by **Chainlink** push feeds. Orders use **two steps**. The trader submits a request that escrows collateral and an execution fee. A whitelisted **keeper** then fills it at the oracle price ± a 0.1% spread, or cancels and refunds it if any rule fails. The protocol guards pool solvency in three ways: it **reserves** 9× collateral of pool liquidity for each position's maximum profit, caps open interest per side at 30% of AUM, and charges skew-based **funding** from the heavier side. Full rules: [protocol-spec.md](protocol-spec.md).

## One protocol, two chains

Both implementations follow the same specification and the same integer maths. They differ only where the chains force them to:

```mermaid
flowchart LR
    Spec["protocol-spec.md<br/>perp-math.md<br/>(Ex 1–10 vectors)"]
    Spec --> Sol["PerpMath.sol<br/>forge tests"]
    Spec --> Rs["math.rs<br/>cargo tests"]
    Spec --> Kt["keeper src/math.ts<br/>node:test"]
    Spec --> Ft["perps lib/perpMath.ts<br/>node:test"]
```

| Concern | EVM (Sepolia) | Solana (devnet) |
|---|---|---|
| Contract layout | 4 contracts: `PerpEngine`, `LiquidityPool`, `CLP`, `ChainlinkOracle` | 1 program, state in PDAs: `Config`, `Pool`, `Market`, `Position`, `Request`, `UserState` |
| Token custody | `LiquidityPool` holds all USDC | `vault` PDA token account (Token-2022), owned by `Pool` |
| Failed order | `try this.executeRequestInternal()` → catch → cancel | Engine runs on in-memory copies; on failure nothing is committed → cancel |
| AUM over all markets | Loop over `marketIds` in storage | Every market and oracle passed as `remaining_accounts` in `Config.markets` order |
| Execution fee | ETH (`msg.value`, ≥ 0.0002 ETH) | Lamports held in the `Request` account (≥ 50,000) |
| CLP decimals | 18 | 6 (fits `u64`) |
| Oracle max age | 3,960 s (hourly heartbeat + 10%) | 120 s (feeds update every few seconds) |
| Markets | BTC-USD, ETH-USD | SOL-USD, BTC-USD, ETH-USD |

Details: [contracts.md](contracts.md), [solana-program.md](solana-program.md).

## Order lifecycle

```mermaid
sequenceDiagram
    autonumber
    actor T as Trader
    participant W as Wallet
    participant App as celestial-perps
    participant P as Protocol<br/>(PerpEngine / program)
    participant K as Keeper
    participant O as Chainlink feed

    T->>App: size, leverage, slippage
    App->>App: previewOpen() with perpMath.ts<br/>acceptablePrice = exec ± slippage
    App->>W: requestIncrease(market, isLong, collateral, size, acceptablePrice) + fee
    W->>P: signed tx
    P->>P: escrow collateral, store Request (Pending)
    loop every 1.5 s
        K->>P: scan pending requests
    end
    K->>P: executeRequests([id]) / execute_request
    P->>O: latest price (age ≤ max age, answer > 0)
    alt all checks pass
        P->>P: fill at oracle × (1 ± 0.1%)<br/>fee → 90% pool / 10% protocol<br/>reserve 9 × collateral
        P-->>K: execution fee
        P-->>App: PositionIncreased + RequestExecuted
    else slippage · stale price · OI cap · leverage · reserve cap…
        P->>T: refund escrow
        P-->>K: execution fee (still paid)
        P-->>App: RequestCancelled(reason)
    end
    App->>T: filled @ price / cancelled: readable reason
    Note over T,P: After 60 s a still-pending request can be cancelled by its owner (fee refunded)
```

Liquidations and funding run on their own keeper loops:

```mermaid
flowchart LR
    subgraph Keeper
        E[Executor<br/>1.5 s]
        L[Liquidator<br/>5 s]
        F[Funding<br/>1 h ±5%]
        H[Health<br/>5 min]
    end
    E -->|pending requests| X1[execute]
    L -->|off-chain check with math.ts| X2{isLiquidatable<br/>on-chain?}
    X2 -->|yes| X3[liquidate<br/>0.5% fee to keeper]
    F -->|markets with OI| X4[updateFunding]
    H -->|balance, whitelist| X5[alert webhook]
```

## Money flow and pool accounting

Every USDC unit sits in exactly one accounting **bucket**. The solvency invariant, checked by the Foundry invariant suite and by the Solana tests after every scenario, is:

```
vault balance ≥ poolAmount + feeReserves + totalCollateral + totalEscrow
reservedAmount ≤ poolAmount
```

```mermaid
flowchart LR
    Wallet([Trader wallet])
    LP([LP wallet])
    subgraph Pool["Pool (one USDC balance)"]
        Esc[totalEscrow]
        Col[totalCollateral]
        PA[poolAmount]
        FR[feeReserves]
        Res[(reservedAmount<br/>⊂ poolAmount)]
    end
    Admin([Protocol treasury])

    Wallet -- requestIncrease --> Esc
    Esc -- cancel --> Wallet
    Esc -- fill --> Col
    Col -- "loss, funding, liq. remainder" --> PA
    Col -- "fee: 90%" --> PA
    Col -- "fee: 10%" --> FR
    PA -- "profit ≤ reserve" --> Wallet
    Col -- "close / withdraw" --> Wallet
    LP -- "addLiquidity (mint CLP)" --> PA
    PA -- "removeLiquidity (burn CLP)<br/>only unreserved" --> LP
    FR -- withdrawFees --> Admin
```

## Frontend architecture

The trading app talks to one interface, `PerpsChain`, with an implementation for each chain. React never touches ethers or web3.js directly.

```mermaid
flowchart TB
    subgraph UI["React (client components)"]
        Trade[TradeApp]
        Earn[EarnApp]
        Comp[TradeForm · PositionsPanel<br/>MarketInfo · OrderTracker]
    end
    subgraph Hooks
        UW[useWallet<br/>WalletProvider context]
        UP[usePerps<br/>5 s visible-tab polling]
        UO[useOrders<br/>tx + order tracking]
        UL[useLivePrice<br/>Coinbase WS]
    end
    subgraph Chains["lib/chains"]
        IF{{PerpsChain interface}}
        EVM[EvmChain<br/>ethers 6]
        SOL[SolanaChain<br/>Anchor IDL coder]
        MATH[lib/perpMath.ts]
    end
    Trade & Earn --> Comp
    Comp --> UW & UP & UO & UL
    UP & UO --> IF
    IF --> EVM & SOL
    EVM & SOL --> MATH
```

Details: [frontend.md](frontend.md).

## Wallet architecture

```mermaid
flowchart LR
    subgraph Page["Web page (any origin)"]
        DApp[dApp JS]
        Inpage["inpage.js<br/>window.ethereum · window.solana<br/>EIP-6963 · Wallet Standard"]
    end
    CS["content.js<br/>(isolated world)"]
    BG["background.js<br/>service worker<br/>vault session · request router"]
    Popup["Popup UI (React)<br/>derivation · signing · NFTs"]
    Store[(chrome.storage.local<br/>encrypted vaults)]

    DApp <--> Inpage
    Inpage <-- window.postMessage --> CS
    CS <-- chrome.runtime messages --> BG
    BG <--> Popup
    BG <--> Store
    Popup --> RPC[(Alchemy · Helius<br/>mempool.space)]
```

Details: [wallet.md](wallet.md), [wallet-nfts.md](wallet-nfts.md), [landing.md](landing.md).

## Repository layout

```
.
├── celestial-contracts/     Foundry project: src/{PerpEngine,pool/,oracle/,libraries/,test-nfts/}, test/, script/
├── celestial-solana/        Anchor workspace: programs/celestial-perps/src/{engine,math,oracle,instructions/}, tests/, scripts/
├── celestial-keeper/        src/{index,config,retry,log,health,math}.ts, src/evm/, src/solana/, test/
├── celestial-perps/         app/, components/, hooks/, lib/chains/, lib/perpMath.ts, src/{abis,idl}/, test/
├── celestial-react-wallet/  public/{manifest.json,background.js,content.js,inpage.js}, src/, tests/, scripts/
├── celestial-landing/       src/pages/{LandingPage,OnboardingPage}.tsx, src/lib/crypto.ts
├── deployments/             sepolia.json · solana-devnet.json · mock-usdc metadata
└── docs/                    this reference
```

## Design decisions

| Decision | Alternatives considered | Why |
|---|---|---|
| Pool-based (LP as counterparty) instead of an order book | CLOB, vAMM | Instant liquidity for any size under the caps. Simple enough to implement identically on two chains |
| Two-step orders with a keeper | Direct market orders | A trader can't choose the oracle round they trade against. Business failures cancel cleanly instead of reverting in the wallet |
| Chainlink push feeds | Pyth pull oracle | Free to read on both testnets and no price-update fetching. Pyth Hermes needs a paid key since Aug 2026. Front-running protection is weaker (see [security.md](security.md)) |
| 0.1% execution spread | Zero spread | Partly offsets the stale-price edge of a slow push oracle (Sepolia heartbeat 1 h) |
| Profit reserved at open (9× collateral) | Unbounded PnL | The pool can always pay every open position's maximum profit |
| One spec, four maths ports, shared vectors | Shared code | No language is shared across Solidity, Rust and TypeScript. Exact vectors make divergence a test failure |
| SOL-USD only on Solana | Custom oracle on EVM | Sepolia has no Chainlink SOL/USD feed |
