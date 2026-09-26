// Tracks the user's orders through submitted → pending keeper → filled | cancelled, and any
// other transaction (approve, faucet, liquidity, cancel) through submitted → done | failed.

import { useCallback, useRef, useState } from "react";

import { ChainError, messageFor, type OrderUpdate, type PerpsChain, type TxResult } from "@/lib/chains";

export type TrackedTx = {
  key: number;
  label: string;
  chainId: PerpsChain["id"];
  tx?: string;
  txUrl?: string;
  fillUrl?: string;
  requestId?: string;
  status: "signing" | "submitted" | "pending" | "filled" | "cancelled" | "done" | "failed";
  since: number;
  detail?: string;
  executionPrice?: bigint;
  fee?: bigint;
};

export function useOrders(onSettled: () => void) {
  const [items, setItems] = useState<TrackedTx[]>([]);
  const seq = useRef(0);

  const update = (key: number, patch: Partial<TrackedTx>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  /**
   * Run a write. `isOrder` requests are then tracked until the keeper fills or cancels them.
   * Returns true when the transaction was sent (the order may still be cancelled later).
   */
  const run = useCallback(
    async (chain: PerpsChain, label: string, fn: () => Promise<TxResult>, isOrder = false): Promise<boolean> => {
      const key = ++seq.current;
      setItems((xs) => [{ key, label, chainId: chain.id, status: "signing" as const, since: Date.now() }, ...xs].slice(0, 6));
      let res: TxResult;
      try {
        res = await fn();
      } catch (e) {
        const msg = e instanceof ChainError ? e.message : e instanceof Error ? e.message : String(e);
        update(key, { status: "failed", detail: msg });
        return false;
      }
      const txUrl = res.tx ? chain.explorerTx(res.tx) : undefined;
      if (!isOrder || !res.requestId) {
        update(key, { status: "done", tx: res.tx, txUrl });
        onSettled();
        return true;
      }
      update(key, { status: "submitted", tx: res.tx, txUrl, requestId: res.requestId });
      onSettled();
      void chain
        .trackRequest(res.requestId, res.tx, (u: OrderUpdate) => {
          if (u.status === "pending") update(key, { status: "pending", since: u.since });
          else if (u.status === "filled")
            update(key, { status: "filled", fillUrl: u.tx ? chain.explorerTx(u.tx) : undefined, executionPrice: u.executionPrice, fee: u.fee });
          else if (u.status === "cancelled") update(key, { status: "cancelled", fillUrl: u.tx ? chain.explorerTx(u.tx) : undefined, detail: messageFor(u.reason, u.reason) });
          else if (u.status === "failed") update(key, { status: "failed", detail: u.error });
        })
        .then(() => onSettled())
        .catch((e) => update(key, { status: "failed", detail: e instanceof Error ? e.message : String(e) }));
      return true;
    },
    [onSettled],
  );

  const dismiss = (key: number) => setItems((xs) => xs.filter((x) => x.key !== key));
  const hasPending = items.some((x) => x.status === "pending" || x.status === "submitted" || x.status === "signing");
  return { items, run, dismiss, hasPending };
}
