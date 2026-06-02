# @kohaku-eth/bermuda

Kohaku Plugin for the [Bermuda](https://bermudabay.xyz) privacy layer with
built-in compliance.

The plugin supports Kohaku's standard interfaces to facility shielding,
shielded transfers, unshielding, shielded balance queries and transaction
broadcasting via relayers.

All the heavy operations such as proof generation, compliance checks,
UTXO selection, etc. are handled behind the scenes automatically.

## Installation

```sh
pnpm add @kohaku-eth/bermuda
```

### Quick Start

```js
import { JsonRpcProvider, Wallet } from "ethers";
import { createBermudaPlugin } from "@kohaku-eth/bermuda";

const rpcURL = process.env.RPC_URL;
const privateKey = process.env.PRIVATE_KEY;
const tokenAddress = process.env.TOKEN_ADDRESS;

const provider = new JsonRpcProvider(rpcURL);
const signer = new Wallet(privateKey, provider);

// This is the Kohaku host (mocked for this quickstart).
const host = {
  provider: {
    ...provider,
    getChainId: async () => (await provider.getNetwork()).chainId,
  },
};

// Get a new `BermudaPlugin` instance.
const plugin = await createBermudaPlugin(host, signer);

// Get Alice's shielded address.
const alice = await plugin.instanceId();

// Shield Alice's funds.
const asset = {
  asset: {
    __type: "erc20",
    contract: tokenAddress,
  },
  amount: 1n,
};
const to = alice;

const operation = await plugin.prepareShield(asset, to);

// Broadcast shield transaction and wait until it's included in a block.
const response = await signer.sendTransaction({
  ...operation.payload,
  gasLimit: 7_000_000,
});

await provider.waitForTransaction(response.hash);

// Query Alice's shielded balance.
const balance = await plugin.balance([asset.asset]);

console.log("Balance:", balance);
```

Also see the [tests](./tests) for more examples.

### Development

From the Kohaku root directory run the following commands.

```sh
# Spin up the TypeScript compiler in watch mode.
pnpm --filter ./packages/bermuda run dev

# Build the plugin.
pnpm --filter ./packages/bermuda run build

# Run the tests.
# NOTE: The integration test is run on Base Sepolia using USDC as the token, so
# your account needs to have ETH and USDC. To get testnet USDC you can use
# Circle's faucet: https://faucet.circle.com
PRIVATE_KEY=0x0123 INTEGRATION=1 pnpm --filter ./packages/bermuda run test
```
