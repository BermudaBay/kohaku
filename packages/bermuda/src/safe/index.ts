export { KeyGenState } from "./keygen";
import * as operations from "./operations";
import { KeyGenState, runKeyGenStep } from "./keygen";
import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, AssetId, Host } from "@kohaku-eth/plugins";
import bermuda, {
  AnySignerLike,
  EthAddress,
  ISdk,
  SafeOwner,
} from "@bermuda/sdk";
import {
  Address,
  BermudaAddress,
  BermudaInstance,
  BermudaPrivateOperation,
  BermudaPublicOperation,
  chainIdToName,
  queryBalances,
} from "../utils";

/**
 * Creates a {@link BermudaSafePlugin} bound to a Safe (multisig) account.
 *
 * When `owner` is omitted the plugin is not yet usable: distributed key
 * generation must first be completed via
 * {@link BermudaSafePlugin.runNextKeyGenStep}.
 *
 * @param host - The host environment providing the chain provider.
 * @param signer - A signer for one of the Safe's owners.
 * @param safe - The address of the Safe account.
 * @param owner - An existing shielded owner; pass to skip key generation.
 * @returns A {@link BermudaSafePlugin}, ready for operations when `owner` is supplied.
 */
export async function createBermudaSafePlugin(
  host: Host,
  signer: AnySignerLike,
  safe: EthAddress,
  owner?: SafeOwner,
) {
  const resolvedChainId = await host.provider.getChainId();
  const initializer = chainIdToName(resolvedChainId);

  const sdk = bermuda(initializer);

  return new BermudaSafePlugin(sdk, signer, safe, owner);
}

/**
 * A Bermuda plugin backed by a Safe (multisig) account.
 *
 * Implements the {@link BermudaInstance} feature set and the
 * {@link Broadcaster} interface. The shielded owner is either supplied at
 * construction or produced by a multi-step distributed key generation (DKG)
 * ceremony driven via {@link runNextKeyGenStep}; it must exist before any
 * operation can be prepared.
 */
export class BermudaSafePlugin implements BermudaInstance, Broadcaster {
  private sdk: ISdk;
  private signer: AnySignerLike;
  private safe: EthAddress;
  private sessionId?: string = undefined;
  private owner?: SafeOwner = undefined;
  private keyGenState: KeyGenState = KeyGenState.Register;

  /**
   * @param sdk - The Bermuda SDK initialized for the target chain.
   * @param signer - A signer for one of the Safe's owners.
   * @param safe - The address of the Safe account.
   * @param owner - An existing shielded owner; pass to skip key generation, otherwise complete it via {@link runNextKeyGenStep}.
   */
  constructor(
    sdk: ISdk,
    signer: AnySignerLike,
    safe: EthAddress,
    owner?: SafeOwner,
  ) {
    this.sdk = sdk;
    this.signer = signer;
    this.safe = safe;
    this.owner = owner;
  }

  /** Returns the shielded owner, throwing if key generation has not finished. */
  private requireOwner(): SafeOwner {
    if (!this.owner) {
      throw new Error("Key Generation not finished");
    }

    return this.owner;
  }

  /**
   * Returns the shielded address that identifies this instance.
   *
   * @returns A promise resolving to this instance's Bermuda address.
   * @throws If key generation has not finished.
   */
  async instanceId(): Promise<BermudaAddress> {
    return this.requireOwner().address() as BermudaAddress;
  }

  /**
   * Queries the shielded balances held by this instance.
   *
   * @param assets - The assets to query, or `undefined` to query none.
   * @returns A promise resolving to the matching asset amounts.
   * @throws If key generation has not finished.
   */
  async balance(assets: AssetId[] | undefined): Promise<AssetAmount[]> {
    return queryBalances(this.sdk, this.requireOwner(), assets);
  }

  /**
   * Prepares a shield (deposit) that moves a public asset into the shielded
   * pool. See {@link operations.prepareShield} for the propose/confirm/execute
   * flow.
   *
   * @throws If key generation has not finished.
   */
  async prepareShield(
    asset: AssetAmount,
    to: BermudaAddress,
    proposalId?: string,
  ): Promise<BermudaPublicOperation> {
    const owner = this.requireOwner();

    return operations.prepareShield(this.sdk, owner, asset, to, proposalId);
  }

  /**
   * Prepares a transfer operation that moves a shielded asset to another
   * shielded address within the pool. See {@link operations.prepareTransfer}.
   *
   * @throws If key generation has not finished.
   */
  async prepareTransfer(
    asset: AssetAmount,
    to: BermudaAddress,
    proposalId?: string,
  ): Promise<BermudaPrivateOperation> {
    const owner = this.requireOwner();

    return operations.prepareTransfer(this.sdk, owner, asset, to, proposalId);
  }

  /**
   * Prepares an unshield (withdraw) that moves a shielded asset back out to a
   * public address. See {@link operations.prepareUnshield}.
   *
   * @throws If key generation has not finished.
   */
  async prepareUnshield(
    asset: AssetAmount,
    to: Address,
    proposalId?: string,
  ): Promise<BermudaPrivateOperation> {
    const owner = this.requireOwner();

    return operations.prepareUnshield(this.sdk, owner, asset, to, proposalId);
  }

  /**
   * Broadcasts a prepared operation by relaying its payload and waiting for it
   * to be processed.
   *
   * @param operation - A prepared operation; must have status `"ready"`.
   * @throws If the operation is not ready to be broadcast.
   */
  async broadcast(
    operation: BermudaPublicOperation | BermudaPrivateOperation,
  ): Promise<void> {
    if (operation.status !== "ready") {
      throw new Error("Operation not ready to be broadcasted");
    }

    this.sdk.relay(operation.payload).then(this.sdk.wait);
  }

  /**
   * Advances the distributed key generation (DKG) ceremony by one step. Call
   * repeatedly, feeding the returned `sessionId` back in, until it returns
   * `next: null` — at which point the shielded owner is set and the plugin is
   * ready for operations. See {@link runKeyGenStep}.
   *
   * @param sessionId - The session id from a prior step, or `undefined` to start a new ceremony.
   * @returns The next state to run (or `null` when finished) and the active session id.
   */
  async runNextKeyGenStep(
    sessionId?: string,
  ): Promise<{ next: KeyGenState | null; sessionId: string }> {
    const step = await runKeyGenStep(
      this.sdk,
      this.safe,
      this.signer,
      this.keyGenState,
      this.sessionId,
      sessionId,
    );

    this.keyGenState = step.nextState;
    this.sessionId = step.nextSessionId;

    if (step.owner) {
      this.owner = step.owner;
    }

    return { next: step.next, sessionId: step.sessionId };
  }
}
