# Celestial Perps — Math Reference & Test Vectors

These are the formulas and exact integer test vectors shared by **both chains**.
- EVM implementation: `celestial-contracts/src/libraries/PerpMath.sol`, asserted by `test/PerpMath.t.sol`
- Solana implementation (Phase 4): `math.rs`, which **must reproduce every number below exactly**

Parameters come from [`protocol-spec.md`](protocol-spec.md).

## Units

| Quantity | Unit |
|---|---|
| USD amounts: size `S`, collateral `C`, fees, PnL, funding owed `F` | 6 decimals (`1e6` = $1) |
| Prices `P`, `E` | 8 decimals (`1e8` = $1) |
| `tokens` (base-asset amount held by a position) | `S × 1e20 / P`, 18 decimals |
| Funding rate and index | 1e18 fraction of size |
| CLP (LP token) | 18 decimals |
| Basis points | `BPS = 10_000` |

`mulDiv(a, b, c)` is the exact `a × b / c` in 512-bit maths. **Floor** rounds down and **Ceil** rounds up. **Every rounding choice goes against the trader.**

## Formulas

1. **Execution price** (spread `s` in bps; liquidations use the raw oracle price)
   - Increasing a long or decreasing a short: `ceil(P × (BPS + s) / BPS)`
   - Increasing a short or decreasing a long: `floor(P × (BPS − s) / BPS)`
2. **Tokens** for a size delta at execution price `X`: longs `floor(ΔS × 1e20 / X)`, shorts `ceil(ΔS × 1e20 / X)`. A position stores `size` and `tokens`, and the average entry price is `E = floor(S × 1e20 / tokens)`.
3. **PnL** at price `P`:
   - long: `floor(tokens × P / 1e20) − S`
   - short: `S − ceil(tokens × P / 1e20)`
   - This is the same as `S × (P − E) / E` and `S × (E − P) / E`.
   - On a partial close, the tokens realised are `floor(tokens × ΔS / S)`.
4. **Position fee** (charged on open and on close): `ceil(ΔS × feeBps / BPS)`
5. **Funding**
   - `rate = AUM == 0 ? 0 : min(maxRate, floor(factor × |longOI − shortOI| / AUM))`, per hour
   - Only the heavier side pays: `index[heavy] += floor(rate × dt / 3600)`
   - `F = ceil(S × (index − entryIndex) / 1e18)`. It is paid to the pool (LPs) whenever the position is updated.
6. **Remaining margin:** `R = C + PnL(P) − F − ceil(S × feeBps / BPS)`
   - Liquidatable when `R < ceil(S × mmBps / BPS)`
7. **Liquidation price:** `need = mm + F + closeFee − C`
   - long: `ceil((S + need) × 1e20 / tokens)`
   - short: `floor((S − need) × 1e20 / tokens)`
   - Returns 0 if the threshold is ≤ 0.
   - For a long, prices **below** the liquidation price are liquidatable. For a short, prices **above** it are.
8. **Reserve and profit cap:** `reserved = maxProfitMultiplier × C`. Realised profit is `min(PnL, reserved)`.
9. **Aggregate trader PnL per market:** formula 3 applied to the side totals `(longSize, longTokens)` and `(shortSize, shortTokens)`. The market's net PnL is floored at `−(long collateral + short collateral)`.
10. **AUM:** `max(0, poolAmount − Σ_markets netTraderPnl)`
11. **CLP**
    - mint: `supply == 0 ? amountAfterFee × 1e12 : floor(amountAfterFee × supply / AUM)`, where `amountAfterFee = amount − ceil(amount × lpMintFeeBps / BPS)`
    - redeem: `floor(clp × AUM / supply)`

## Worked examples

Parameters for all examples: spread 10 bps, position fee 6 bps, maintenance margin 250 bps, max leverage 20, funding factor `3e14`/h, max funding rate `1e14`/h, LP mint fee 10 bps, max profit multiplier 9.

### Ex 1: Open an ETH long ($1,000 collateral, 10x, $10,000 size) at an oracle price of $3,000
| Value | Result |
|---|---|
| oracle `P` | `300000000000` |
| execution price `ceil(P × 10010 / 10000)` | `300300000000` ($3,003.00) |
| tokens `floor(10000e6 × 1e20 / 300300000000)` | `3330003330003330003` |
| open fee `ceil(10000e6 × 6 / 10000)` | `6000000` ($6.00) |
| collateral after fee | `994000000` |
| entry `floor(S × 1e20 / tokens)` | `300300000000` |

### Ex 2: Close Ex 1 at $3,300 (+10%)
| Value | Result |
|---|---|
| execution price `floor(330000000000 × 9990 / 10000)` | `329670000000` |
| PnL `floor(tokens × 329670000000 / 1e20) − 10000e6` | `978021978` (+$978.02) |
| close fee | `6000000` |
| trader receives `994000000 + 978021978 − 6000000` | `1966021978` |

### Ex 3: BTC short ($500 collateral, 5x, $2,500 size) opened at $60,000 and closed at $63,000 (a loss)
| Value | Result |
|---|---|
| open execution `floor(6000000000000 × 9990 / 10000)` | `5994000000000` |
| tokens `ceil(2500e6 × 1e20 / 5994000000000)` | `41708375041708376` |
| open fee | `1500000` |
| close execution `ceil(6300000000000 × 10010 / 10000)` | `6306300000000` |
| PnL `2500e6 − ceil(tokens × 6306300000000 / 1e20)` | `-130255256` |
| close fee | `1500000` |
| trader receives `500e6 − 1500000 − 130255256 − 1500000` | `366744744` |

### Ex 4: The same short closed at $57,000 (a profit)
| Value | Result |
|---|---|
| close execution `ceil(5700000000000 × 10010 / 10000)` | `5705700000000` |
| PnL | `120245245` |
| trader receives `500e6 − 1500000 + 120245245 − 1500000` | `617245245` |

### Ex 5: Funding accrual
Long OI $2M, short OI $1M, AUM $5M.

| Value | Result |
|---|---|
| rate `min(1e14, floor(3e14 × 1e12 / 5e12))` | `60000000000000` (0.006%/h, longs pay) |
| long index delta after 8 h `floor(rate × 28800 / 3600)` | `480000000000000` |
| owed by a $10,000 long `ceil(10000e6 × 4.8e14 / 1e18)` | `4800000` ($4.80) |

### Ex 5b: Funding cap
Long OI $3M, short OI $0, AUM $5M. The uncapped rate would be `1.8e14`, so the rate is **capped at `100000000000000`** (0.01%/h).

### Ex 6: Liquidation price for Ex 1
C = `994000000`, F = 0, closeFee = `6000000`, mm = `ceil(10000e6 × 250 / 10000)` = `250000000`.

| Value | Result |
|---|---|
| need `250000000 + 0 + 6000000 − 994000000` | `-738000000` |
| liquidation price `ceil((10000e6 − 738000000) × 1e20 / tokens)` | `278137860001` (≈ $2,781.38) |

### Ex 7: The liquidation boundary for the Ex 1 position (raw oracle price)
| Price | PnL | R | mm | Liquidatable |
|---|---|---|---|---|
| `278137860000` (1 unit below) | `-738000001` | `249999999` | `250000000` | **yes** |
| `278137860001` (the liquidation price) | `-738000000` | `250000000` | `250000000` | no |
| `278137860002` (1 unit above) | `-738000000` | `250000000` | `250000000` | no |

### Ex 8: Regression: opening at max leverage is **not** liquidatable immediately
Collateral 1000e6, ETH at $3,000. This is the largest size where `S ≤ 20 × (C − fee(S))`.

| Value | Result |
|---|---|
| size | `19762845840` |
| collateral after fee | `988142292` |
| PnL at the raw oracle price (spread cost) | `-19743103` |
| R | `956541481` |
| mm | `494071146` |
| liquidatable | **no** |

### Ex 9: Profit cap
This is the Ex 1 position with reserved = `9 × 994000000` = `8946000000`, closed at $6,000 (price doubles): execution `599400000000`, raw PnL `9960039960`, **realised profit is capped at `8946000000`**.

### Ex 10: CLP (LP token)
| Value | Result |
|---|---|
| seed deposit | `5000000000000` ($5M) |
| seed fee `ceil(5e12 × 10 / 10000)` | `5000000000` |
| seed mint (supply 0) `(5e12 − 5e9) × 1e12` | `4995000000000000000000000` CLP |
| later: AUM $5.1M, deposit $1,000, fee | `1000000` |
| minted `floor(999000000 × 4.995e24 / 5100000000000)` | `978432352941176470588` |
| redeeming those CLP immediately, with AUM $5,101,000 and the new supply | `999000195` |
