import { ISdk, SafeOwner } from "@bermuda/sdk";
import { AssetAmount } from "@kohaku-eth/plugins";
import {
  Address,
  BermudaAddress,
  BermudaPrivateOperation,
  BermudaPublicOperation,
  getToken,
} from "../utils";

/**
 * Prepares a shield (deposit) operation for a Safe-backed instance.
 *
 * Without a `proposalId` the deposit is proposed and a `"proposed"` operation
 * is returned. With a `proposalId` the proposal is executed, falling back to
 * confirming it (a `"pending"` operation) when shares are still insufficient.
 *
 * @param sdk - The Bermuda SDK initialized for the target chain.
 * @param owner - The Safe's shielded owner.
 * @param asset - The asset and amount to shield.
 * @param to - The shielded recipient address.
 * @param proposalId - An existing proposal id to advance, or `undefined` to propose a new deposit.
 * @returns The resulting public operation (`proposed`, `pending`, or `ready`).
 * @throws Re-throws any execution error not caused by insufficient shares.
 */
export async function prepareShield(
  sdk: ISdk,
  owner: SafeOwner,
  asset: AssetAmount,
  to: BermudaAddress,
  proposalId?: string,
): Promise<BermudaPublicOperation> {
  // If there's no proposal id then we need to propose a deposit.
  if (!proposalId) {
    const proposalId = await sdk.safe.deposit.propose({
      owner,
      token: getToken(sdk, asset),
      amount: asset.amount,
      to,
    });

    return {
      proposalId,
      status: "proposed",
      __type: "publicOperation",
    };
  }

  // Try to `execute` the deposit proposal. If that fails `confirm` instead.
  try {
    const payload = await sdk.safe.deposit.execute({ owner, proposalId });

    return {
      payload,
      status: "ready",
      __type: "publicOperation",
    };
  } catch (error: unknown) {
    if ((error as Error).message.toLowerCase().includes("insufficient")) {
      const result = await sdk.safe.deposit.confirm({ owner, proposalId });

      return {
        result,
        status: "pending",
        __type: "publicOperation",
      };
    }

    // Re-throw error if the error is not due to insufficient shares.
    throw error;
  }
}

/**
 * Prepares a transfer operation between shielded addresses for a Safe-backed
 * instance.
 *
 * Follows the same propose/confirm/execute flow as {@link prepareShield}.
 *
 * @param sdk - The Bermuda SDK initialized for the target chain.
 * @param owner - The Safe's shielded owner.
 * @param asset - The asset and amount to transfer.
 * @param to - The shielded recipient address.
 * @param proposalId - An existing proposal id to advance, or `undefined` to propose a new transfer.
 * @returns The resulting private operation (`proposed`, `pending`, or `ready`).
 * @throws Re-throws any execution error not caused by insufficient shares.
 */
export async function prepareTransfer(
  sdk: ISdk,
  owner: SafeOwner,
  asset: AssetAmount,
  to: BermudaAddress,
  proposalId?: string,
): Promise<BermudaPrivateOperation> {
  // If there's no proposal id then we need to propose a transfer.
  if (!proposalId) {
    const proposalId = await sdk.safe.transfer.propose({
      owner,
      token: getToken(sdk, asset),
      amount: asset.amount,
      to,
    });

    return {
      proposalId,
      status: "proposed",
      __type: "privateOperation",
    };
  }

  // Try to `execute` the transfer proposal. If that fails `confirm` instead.
  try {
    const payload = await sdk.safe.transfer.execute({ owner, proposalId });

    return {
      payload,
      status: "ready",
      __type: "privateOperation",
    };
  } catch (error: unknown) {
    if ((error as Error).message.toLowerCase().includes("insufficient")) {
      const details = await sdk.safe.transfer.confirm({ owner, proposalId });

      return {
        details,
        status: "pending",
        __type: "privateOperation",
      };
    }

    // Re-throw error if the error is not due to insufficient shares.
    throw error;
  }
}

/**
 * Prepares an unshield (withdraw) operation for a Safe-backed instance,
 * moving a shielded asset out to a public address.
 *
 * Follows the same propose/confirm/execute flow as {@link prepareShield}.
 *
 * @param sdk - The Bermuda SDK initialized for the target chain.
 * @param owner - The Safe's shielded owner.
 * @param asset - The asset and amount to unshield.
 * @param to - The public recipient address.
 * @param proposalId - An existing proposal id to advance, or `undefined` to propose a new withdrawal.
 * @returns The resulting private operation (`proposed`, `pending`, or `ready`).
 * @throws Re-throws any execution error not caused by insufficient shares.
 */
export async function prepareUnshield(
  sdk: ISdk,
  owner: SafeOwner,
  asset: AssetAmount,
  to: Address,
  proposalId?: string,
): Promise<BermudaPrivateOperation> {
  // If there's no proposal id then we need to propose a withdrawal.
  if (!proposalId) {
    const proposalId = await sdk.safe.withdraw.propose({
      owner,
      token: getToken(sdk, asset),
      amount: asset.amount,
      to,
    });

    return {
      proposalId,
      status: "proposed",
      __type: "privateOperation",
    };
  }

  // Try to `execute` the withdrawal proposal. If that fails `confirm` instead.
  try {
    const payload = await sdk.safe.withdraw.execute({ owner, proposalId });

    return {
      payload,
      status: "ready",
      __type: "privateOperation",
    };
  } catch (error: unknown) {
    if ((error as Error).message.toLowerCase().includes("insufficient")) {
      const details = await sdk.safe.withdraw.confirm({ owner, proposalId });

      return {
        details,
        status: "pending",
        __type: "privateOperation",
      };
    }

    // Re-throw error if the error is not due to insufficient shares.
    throw error;
  }
}
