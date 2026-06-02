import { Contract, Provider, Wallet } from "ethers";
import { it, describe, expect, beforeAll } from "vitest";
import bermuda, { AnySignerLike, EthAddress, ISdk } from "@bermuda/sdk";
import {
  timeout,
  initializer,
  PRIVATE_KEY,
  validateSetup,
  deploySafe,
  getHost,
  getAsset,
  checkBalance,
  getBalance,
} from "./utils";
import {
  Address,
  BermudaAddress,
  createBermudaSafePlugin,
  BermudaSafePlugin,
  BermudaPublicOperation,
  BermudaPrivateOperation,
  KeyGenState,
} from "../dist";

describe(
  "BermudaSafePlugin Integration Test",
  () => {
    let sdk: ISdk;
    let provider: Provider;
    let signer: Wallet;
    let alicePlugin: BermudaSafePlugin;
    let bobPlugin: BermudaSafePlugin;
    let safeAddress: EthAddress;
    let safeShieldedAddress: BermudaAddress;

    beforeAll(async () => {
      const isValid = validateSetup();

      if (!isValid) {
        return;
      }

      sdk = bermuda(initializer);

      provider = sdk.config.provider as unknown as Provider;

      signer = new Wallet(PRIVATE_KEY, provider);

      const aliceSigner = signer;
      const aliceAddress = aliceSigner.address;

      const bobSigner = new Wallet(Wallet.createRandom().privateKey, provider);
      const bobAddress = bobSigner.address;

      const safe = await deploySafe(signer, [aliceAddress, bobAddress], 2);

      safeAddress = await safe.getAddress();

      const host = getHost(provider);

      alicePlugin = await createBermudaSafePlugin(
        host,
        aliceSigner as unknown as AnySignerLike,
        safeAddress,
      );

      bobPlugin = await createBermudaSafePlugin(
        host,
        bobSigner as unknown as AnySignerLike,
        safeAddress,
      );

      // Alice and Bob run the DKG protocol. Alice leads each round and Bob
      // follows with the same session id; `runNextKeyGenStep` reports the next
      // stage and yields `null` once the ceremony is complete.
      let sessionId: string | undefined;
      let next: KeyGenState | null = null;

      do {
        ({ next, sessionId } = await alicePlugin.runNextKeyGenStep(sessionId));
        await bobPlugin.runNextKeyGenStep(sessionId);
      } while (next !== null);

      // Get Safe's shielded address.
      safeShieldedAddress = await alicePlugin.instanceId();

      // Fund Safe.
      const amount = 2n;
      const tx = await signer.sendTransaction({
        to: safeAddress,
        value: amount,
      });

      await tx.wait();
    });

    it("should support shield / transfer / unshield flow (Native)", async () => {
      const shieldAmount = 2n;
      const transferAmount = 1n;
      const unshieldAmount = 1n;

      // Use the chain's native asset under test.
      const token = sdk.config.wrappedNativeToken! as Address;
      const { asset, contract } = getAsset("native", token, provider);

      // Get Safe's initial balances.
      const initUnshieldedBalance = await provider.getBalance(safeAddress);
      const initShieldedBalance = await getBalance(alicePlugin, asset);

      console.log("Testing Shield");
      {
        const assetAmount = {
          asset,
          amount: shieldAmount,
        };

        const to = safeShieldedAddress;

        // Alice proposes.
        const { proposalId } = (await alicePlugin.prepareShield(
          assetAmount,
          to,
        )) as Extract<BermudaPublicOperation, { status: "proposed" }>;

        // Bob confirms.
        (await bobPlugin.prepareShield(assetAmount, to, proposalId)) as Extract<
          BermudaPublicOperation,
          { status: "pending" }
        >;
        // Alice executes.
        const op = (await alicePlugin.prepareShield(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPublicOperation, { status: "ready" }>;

        // Relay payload.
        await alicePlugin.broadcast(op);

        const expectedUnshieldedBalance = initUnshieldedBalance - shieldAmount;
        const expectedShieldedBalance = initShieldedBalance + shieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          alicePlugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(safeAddress);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }

      console.log("Testing Transfer");
      {
        const assetAmount = {
          asset,
          amount: transferAmount,
        };

        const recipient = await sdk.account({ seed: "recipient" });
        const to = recipient.address() as BermudaAddress;

        // Alice proposes.
        const { proposalId } = (await alicePlugin.prepareTransfer(
          assetAmount,
          to,
        )) as Extract<BermudaPrivateOperation, { status: "proposed" }>;

        // Bob confirms.
        (await bobPlugin.prepareTransfer(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "pending" }>;
        // Alice executes.
        const op = (await alicePlugin.prepareTransfer(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "ready" }>;

        // Relay payload.
        await alicePlugin.broadcast(op);

        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount;

        const shieldedBalance = await checkBalance(
          alicePlugin,
          asset,
          expectedShieldedBalance,
        );

        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }

      console.log("Testing Unshield");
      {
        const assetAmount = {
          asset,
          amount: unshieldAmount,
        };

        const to = safeAddress as Address;

        // Alice proposes.
        const { proposalId } = (await alicePlugin.prepareUnshield(
          assetAmount,
          to,
        )) as Extract<BermudaPrivateOperation, { status: "proposed" }>;

        // Bob confirms.
        (await bobPlugin.prepareUnshield(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "pending" }>;
        // Alice executes.
        const op = (await alicePlugin.prepareUnshield(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "ready" }>;

        // Relay payload.
        await alicePlugin.broadcast(op);

        const expectedUnshieldedBalance =
          initUnshieldedBalance - shieldAmount + unshieldAmount;
        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount - unshieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          alicePlugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(safeAddress);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }
    });

    it("should support shield / transfer / unshield flow (ERC-20)", async () => {
      const shieldAmount = 2n;
      const transferAmount = 1n;
      const unshieldAmount = 1n;

      // Use USDC as the ERC-20 token under test.
      const token = sdk.config.USDC! as Address;
      const { asset, contract } = getAsset("erc20", token, provider);

      // Fund the Safe with the ERC-20 token (the native flow funds via `value`).
      const fundTx = await (contract.connect(signer) as Contract).transfer(
        safeAddress,
        shieldAmount,
      );

      await fundTx.wait();

      // Get Safe's initial ERC-20 balances.
      const initUnshieldedBalance = await contract.balanceOf(safeAddress);
      const initShieldedBalance = await getBalance(alicePlugin, asset);

      console.log("Testing Shield");
      {
        const assetAmount = {
          asset,
          amount: shieldAmount,
        };

        const to = safeShieldedAddress;

        // Alice proposes.
        const { proposalId } = (await alicePlugin.prepareShield(
          assetAmount,
          to,
        )) as Extract<BermudaPublicOperation, { status: "proposed" }>;

        // Bob confirms.
        (await bobPlugin.prepareShield(assetAmount, to, proposalId)) as Extract<
          BermudaPublicOperation,
          { status: "pending" }
        >;
        // Alice executes.
        const op = (await alicePlugin.prepareShield(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPublicOperation, { status: "ready" }>;

        // Relay payload.
        await alicePlugin.broadcast(op);

        const expectedUnshieldedBalance = initUnshieldedBalance - shieldAmount;
        const expectedShieldedBalance = initShieldedBalance + shieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          alicePlugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(safeAddress);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }

      console.log("Testing Transfer");
      {
        const assetAmount = {
          asset,
          amount: transferAmount,
        };

        const recipient = await sdk.account({ seed: "recipient" });
        const to = recipient.address() as BermudaAddress;

        // Alice proposes.
        const { proposalId } = (await alicePlugin.prepareTransfer(
          assetAmount,
          to,
        )) as Extract<BermudaPrivateOperation, { status: "proposed" }>;

        // Bob confirms.
        (await bobPlugin.prepareTransfer(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "pending" }>;
        // Alice executes.
        const op = (await alicePlugin.prepareTransfer(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "ready" }>;

        // Relay payload.
        await alicePlugin.broadcast(op);

        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount;

        const shieldedBalance = await checkBalance(
          alicePlugin,
          asset,
          expectedShieldedBalance,
        );

        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }

      console.log("Testing Unshield");
      {
        const assetAmount = {
          asset: asset,
          amount: unshieldAmount,
        };

        const to = safeAddress as Address;

        // Alice proposes.
        const { proposalId } = (await alicePlugin.prepareUnshield(
          assetAmount,
          to,
        )) as Extract<BermudaPrivateOperation, { status: "proposed" }>;

        // Bob confirms.
        (await bobPlugin.prepareUnshield(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "pending" }>;
        // Alice executes.
        const op = (await alicePlugin.prepareUnshield(
          assetAmount,
          to,
          proposalId,
        )) as Extract<BermudaPrivateOperation, { status: "ready" }>;

        // Relay payload.
        await alicePlugin.broadcast(op);

        const expectedUnshieldedBalance =
          initUnshieldedBalance - shieldAmount + unshieldAmount;
        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount - unshieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          alicePlugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(safeAddress);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }
    });
  },
  timeout,
);
