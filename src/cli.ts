import { INITIAL_BOOK } from "./book.js";
import { DEFAULT_POLICY } from "./policy.js";
import { deriveAddresses, fetchTokenPrices, fetchYieldPools, postDryQuote } from "./clients.js";
import { runCycle } from "./cycle.js";

const accountId = process.argv[2] || "near";
const addresses = await deriveAddresses(accountId).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  return null;
});
const [prices, pools] = await Promise.all([fetchTokenPrices(), fetchYieldPools()]);
const result = await runCycle({
  book: INITIAL_BOOK,
  policy: DEFAULT_POLICY,
  accountId,
  clients: {
    prices,
    pools,
    addresses,
    quote: ( _job, request) => postDryQuote(request),
  },
});

console.log(`\n${result.decision.action.toUpperCase()}  ${result.totalUsd.toFixed(2)} USD  ${result.ranAt}\n`);
for (const paragraph of result.memo) {
  console.log(paragraph);
  console.log("");
}
if (result.decision.action === "rebalance") {
  console.log("Next paper book:");
  for (const position of result.nextBook) console.log(`  ${position.key}  ${position.amount}`);
}
