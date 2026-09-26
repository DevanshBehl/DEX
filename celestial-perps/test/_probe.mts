import { SolanaChain, DEVNET_CONFIG } from "../lib/chains/solana";
const c = new SolanaChain(DEVNET_CONFIG);
const t0 = Date.now();
try { console.log("params", (await c.getParams()).minExecutionFee, Date.now()-t0, "ms"); } catch (e) { console.log("params ERR", (e as Error).message); }
try { const m = await c.getMarketState("SOL-USD"); console.log("SOL price", m.price, "updatedAt", m.updatedAt ?? m.priceUpdatedAt, "issue", m.priceIssue, Date.now()-t0, "ms"); } catch (e) { console.log("market ERR", (e as Error).message); }
try { const p = await c.getPool(); console.log("aum", p.aum, Date.now()-t0, "ms"); } catch (e) { console.log("pool ERR", (e as Error).message); }
process.exit(0);
