import {
  ISdk,
  DepositInspectResult,
  IRelayRequest,
  TxDetails,
  IShieldedOwner,
} from "@bermuda/sdk";
import {
  AssetAmount,
  AssetId,
  PluginInstance,
  PrivateOperation,
  PublicOperation,
} from "@kohaku-eth/plugins";

export type Address = `0x${string}`;

export type BermudaAddress = Address;

export type BermudaPublicOperation =
  | (PublicOperation & { status: "proposed" } & { proposalId: string })
  | (PublicOperation & { status: "pending" } & { result: DepositInspectResult })
  | (PublicOperation & { status: "ready" } & { payload: IRelayRequest });

export type BermudaPrivateOperation =
  | (PrivateOperation & { status: "proposed" } & { proposalId: string })
  | (PrivateOperation & { status: "pending" } & { details: TxDetails })
  | (PrivateOperation & { status: "ready" } & { payload: IRelayRequest });

export type BermudaInstance = PluginInstance<
  BermudaAddress,
  {
    publicOp: BermudaPublicOperation;
    privateOp: BermudaPrivateOperation;
    assetAmounts: {
      input: AssetAmount;
      internal: AssetAmount;
      output: AssetAmount;
      read: AssetAmount;
    };
    features: {
      balance: true;
      prepareShield: true;
      prepareTransfer: true;
      prepareUnshield: true;
      broadcast: true;
    };
  }
>;

/**
 * Resolves the on-chain token address used to represent an asset.
 *
 * Native assets are mapped to the chain's wrapped-native token; ERC-20 assets
 * use their own contract address. Addresses are returned lowercased.
 *
 * @param sdk - The Bermuda SDK initialized for the target chain.
 * @param asset - The asset to resolve.
 * @returns The lowercased token address.
 * @throws If the asset is neither native nor an ERC-20.
 */
export function getToken(sdk: ISdk, asset: AssetAmount) {
  if (asset.asset.__type === "native") {
    return sdk.config.wrappedNativeToken.toLowerCase();
  } else if (asset.asset.__type === "erc20") {
    return asset.asset.contract.toLowerCase();
  } else {
    throw new Error("Only Native or ERC-20 assets are supported");
  }
}

/**
 * Sums the shielded UTXOs held by an owner for the requested assets.
 *
 * Native and ERC-20 assets are resolved to their token addresses, queried for
 * UTXOs, and aggregated into per-token totals. Returns an empty array when no
 * assets are requested.
 *
 * @param sdk - The Bermuda SDK initialized for the target chain.
 * @param owner - The shielded owner whose UTXOs are queried.
 * @param assets - The assets to total, or `undefined` to query none.
 * @returns A promise resolving to the per-token balances as asset amounts.
 */
export async function queryBalances(
  sdk: ISdk,
  owner: IShieldedOwner,
  assets: AssetId[] | undefined,
) {
  const result: AssetAmount[] = [];

  const native = assets?.some((asset) => asset.__type === "native");
  const erc20s = assets?.filter((asset) => asset.__type === "erc20");
  const addresses = erc20s?.map((asset) => asset.contract.toLowerCase());

  if (native) {
    addresses?.push(sdk.config.wrappedNativeToken.toLowerCase());
  }

  if (addresses) {
    const utxosByTokens = await sdk.findUtxos({
      keypair: owner,
      tokens: addresses,
    });

    for (const address in utxosByTokens) {
      const total = sdk.sumAmounts(utxosByTokens[address]);

      result.push({
        asset: {
          __type: "erc20",
          contract: address as Address,
        },
        amount: total,
      });
    }
  }

  return result;
}

/**
 * Maps a numeric chain id to the network name expected by the Bermuda SDK.
 *
 * @param chainId - The chain id as a string, number, or bigint.
 * @returns The corresponding network name (e.g. `"gnosis"`, `"base-sepolia"`).
 * @throws If the chain id is not recognized.
 */
// TODO: Export from SDK side.
export function chainIdToName(chainId: string | number | bigint) {
  switch (Number(chainId)) {
    case 100:
      return "gnosis";
    case 31337:
      return "testenv";
    case 84532:
      return "base-sepolia";
    case 9746:
      return "plasma-testnet";
    case 59141:
      return "linea-sepolia";
    default:
      throw Error("Unknown chain id");
  }
}
