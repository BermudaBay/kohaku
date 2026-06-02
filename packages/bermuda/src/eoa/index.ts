import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { Host, AssetId, AssetAmount } from "@kohaku-eth/plugins";
import bermuda, { ISdk, KeyPair, AnySignerLike } from "@bermuda/sdk";
import {
  Address,
  BermudaAddress,
  BermudaInstance,
  BermudaPrivateOperation,
  BermudaPublicOperation,
  chainIdToName,
  getToken,
  queryBalances,
} from "../utils";

/**
 * Creates a {@link BermudaPlugin} bound to an externally owned account (EOA).
 *
 * Resolves the chain from the host's provider, initializes the Bermuda SDK for
 * that network, and derives the shielded key pair from the given signer.
 *
 * @param host - The host environment providing the chain provider.
 * @param signer - The EOA signer used to derive the shielded key pair and sign operations.
 * @returns A promise resolving to a ready-to-use {@link BermudaPlugin}.
 */
export async function createBermudaPlugin(
  host: Host,
  signer: AnySignerLike,
): Promise<BermudaPlugin> {
  const resolvedChainId = await host.provider.getChainId();
  const initializer = chainIdToName(resolvedChainId);

  const sdk = bermuda(initializer);

  const keyPair = await sdk.account({ signer });

  return new BermudaPlugin(sdk, signer, keyPair);
}

/**
 * A Bermuda plugin backed by a single externally owned account (EOA).
 *
 * Implements the {@link BermudaInstance} feature set (shield, transfer,
 * unshield, balance) and the {@link Broadcaster} interface. Operations are
 * authorized directly by the account — the signer for deposits, the shielded
 * key pair for transfers and withdrawals — so each prepared operation is
 * immediately ready to be broadcast.
 */
export class BermudaPlugin implements BermudaInstance, Broadcaster {
  private sdk: ISdk;
  private keyPair: KeyPair;
  private signer: AnySignerLike;

  /**
   * @param sdk - The Bermuda SDK initialized for the target chain.
   * @param signer - The EOA signer used to authorize public (deposit) operations.
   * @param keyPair - The shielded key pair derived from the signer.
   */
  constructor(sdk: ISdk, signer: AnySignerLike, keyPair: KeyPair) {
    this.sdk = sdk;
    this.signer = signer;
    this.keyPair = keyPair;
  }

  /**
   * Returns the shielded address that identifies this instance.
   *
   * @returns A promise resolving to this instance's Bermuda address.
   */
  async instanceId(): Promise<BermudaAddress> {
    return this.keyPair.address() as BermudaAddress;
  }

  /**
   * Queries the shielded balances held by this instance.
   *
   * @param assets - The assets to query, or `undefined` to query none.
   * @returns A promise resolving to the matching asset amounts.
   */
  async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
    return queryBalances(this.sdk, this.keyPair, assets);
  }

  /**
   * Prepares a shield (deposit) operation that moves a public asset into the
   * shielded pool.
   *
   * @param asset - The asset and amount to shield.
   * @param to - The shielded recipient address.
   * @returns A ready-to-broadcast public operation.
   */
  async prepareShield(
    asset: AssetAmount,
    to: BermudaAddress,
  ): Promise<BermudaPublicOperation> {
    const signer = this.signer;
    const amount = asset.amount;
    const token = getToken(this.sdk, asset);

    const payload = await this.sdk.deposit({
      signer,
      token,
      amount,
      to,
    });

    return {
      payload,
      status: "ready",
      __type: "publicOperation",
    };
  }

  /**
   * Prepares a transfer operation that moves a shielded asset to another
   * shielded address within the pool.
   *
   * @param asset - The asset and amount to transfer.
   * @param to - The shielded recipient address.
   * @returns A ready-to-broadcast private operation.
   */
  async prepareTransfer(
    asset: AssetAmount,
    to: BermudaAddress,
  ): Promise<BermudaPrivateOperation> {
    const token = getToken(this.sdk, asset);

    const payload = await this.sdk.transfer({
      spender: this.keyPair,
      token,
      to,
      amount: asset.amount,
    });

    return {
      payload,
      status: "ready",
      __type: "privateOperation",
    };
  }

  /**
   * Prepares an unshield (withdraw) operation that moves a shielded asset back
   * out to a public address.
   *
   * @param asset - The asset and amount to unshield.
   * @param to - The public recipient address.
   * @returns A ready-to-broadcast private operation.
   */
  async prepareUnshield(
    asset: AssetAmount,
    to: Address,
  ): Promise<BermudaPrivateOperation> {
    const token = getToken(this.sdk, asset);

    const payload = await this.sdk.withdraw({
      spender: this.keyPair,
      token,
      to,
      amount: asset.amount,
    });

    return {
      payload,
      status: "ready",
      __type: "privateOperation",
    };
  }

  /**
   * Broadcasts a prepared operation by relaying its payload and waiting for it
   * to be processed.
   *
   * @param operation - A prepared private operation; must have status `"ready"`.
   * @throws If the operation is not ready to be broadcast.
   */
  async broadcast(operation: BermudaPrivateOperation): Promise<void> {
    if (operation.status !== "ready") {
      throw new Error("Operation not ready to be broadcasted");
    }

    this.sdk.relay(operation.payload).then(this.sdk.wait);
  }
}
