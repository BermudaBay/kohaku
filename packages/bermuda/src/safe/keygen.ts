import { AnySignerLike, EthAddress, ISdk, SafeOwner } from "@bermuda/sdk";

/** The sequential stages of the Safe's distributed key generation ceremony. */
export enum KeyGenState {
  Register,
  Publish,
  Owner,
}

/** The outcome of advancing the key generation ceremony by one step. */
export interface KeyGenStep {
  /** The next stage to run, or `null` once the ceremony is finished. */
  next: KeyGenState | null;
  /** The session id active for this ceremony. */
  sessionId: string;
  /** The stage the caller should store for the following invocation. */
  nextState: KeyGenState;
  /** The session id the caller should store, or `undefined` once finished. */
  nextSessionId?: string;
  /** The resolved shielded owner, set only once the ceremony is finished. */
  owner?: SafeOwner;
}

/**
 * Advances the Safe's distributed key generation (DKG) ceremony by one step.
 *
 * Encapsulates the SDK calls for each stage and reports the resulting state
 * transition; the caller persists that state and feeds it back on the next
 * invocation, repeating until `next` is `null`.
 *
 * @param sdk - The Bermuda SDK initialized for the target chain.
 * @param safe - The address of the Safe account.
 * @param signer - A signer for one of the Safe's owners.
 * @param state - The current stage of the ceremony.
 * @param currentSessionId - The session id stored from a prior step, if any.
 * @param inputSessionId - A session id supplied by the caller to resume an existing ceremony.
 * @returns The step outcome describing the next stage and the state to persist.
 */
export async function runKeyGenStep(
  sdk: ISdk,
  safe: EthAddress,
  signer: AnySignerLike,
  state: KeyGenState,
  currentSessionId: string | undefined,
  inputSessionId: string | undefined,
): Promise<KeyGenStep> {
  if (state === KeyGenState.Register) {
    // Start a new DKG session when no session id was passed-in.
    let sessionId = inputSessionId;

    if (!sessionId) {
      ({ sessionId } = await sdk.safe.golden.start({ safe, signer }));
    }

    await sdk.safe.register({ safe, signer });

    return {
      next: KeyGenState.Publish,
      sessionId,
      nextState: KeyGenState.Publish,
      nextSessionId: sessionId,
    };
  }

  if (state === KeyGenState.Publish) {
    await sdk.safe.golden.publish({
      safe,
      signer,
      sessionId: currentSessionId!,
    });

    return {
      next: KeyGenState.Owner,
      sessionId: currentSessionId!,
      nextState: KeyGenState.Owner,
      nextSessionId: currentSessionId,
    };
  }

  // KeyGenState.Owner: resolve the owner and reset for a fresh ceremony.
  const owner = await sdk.safe.owner({
    safe,
    signer,
    sessionId: currentSessionId!,
  });

  return {
    next: null,
    sessionId: currentSessionId!,
    nextState: KeyGenState.Register,
    nextSessionId: undefined,
    owner,
  };
}
