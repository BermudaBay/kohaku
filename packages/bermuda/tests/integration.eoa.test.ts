import { Provider, Wallet } from "ethers";
import { it, describe, expect, beforeAll } from "vitest";
import bermuda, { AnySignerLike, ISdk } from "@bermuda/sdk";
import {
  timeout,
  initializer,
  PRIVATE_KEY,
  validateSetup,
  getHost,
  getAsset,
  checkBalance,
  getBalance,
} from "./utils";
import {
  Address,
  BermudaPlugin,
  BermudaAddress,
  createBermudaPlugin,
  BermudaPublicOperation,
} from "../dist";

describe(
  "BermudaPlugin Integration Test",
  () => {
    let sdk: ISdk;
    let provider: Provider;
    let signer: Wallet;
    let plugin: BermudaPlugin;
    let alice: BermudaAddress;
    let bob: BermudaAddress;

    beforeAll(async () => {
      const isValid = validateSetup();

      if (!isValid) {
        return;
      }

      sdk = bermuda(initializer);

      provider = sdk.config.provider as unknown as Provider;

      signer = new Wallet(PRIVATE_KEY, provider);

      const host = getHost(provider);

      plugin = await createBermudaPlugin(
        host,
        signer as unknown as AnySignerLike,
      );

      // Get shielded addresses.
      alice = await plugin.instanceId();
      bob = (await sdk
        .account({ seed: "bob" })
        .then((kp) => kp.address())) as BermudaAddress;
    });

    it("should support shield / transfer / unshield flow (Native)", async () => {
      const shieldAmount = 2n;
      const transferAmount = 1n;
      const unshieldAmount = 1n;

      // Use the chain's native asset under test.
      const token = sdk.config.wrappedNativeToken! as Address;
      const { asset, contract } = getAsset("native", token, provider);

      // Get Alice's initial balances.
      const initUnshieldedBalance = await contract.balanceOf(signer.address);
      const initShieldedBalance = await getBalance(plugin, asset);

      console.log("Testing Shield");
      {
        const assetAmount = {
          asset,
          amount: shieldAmount,
        };

        const to = alice;
        const op = (await plugin.prepareShield(assetAmount, to)) as Extract<
          BermudaPublicOperation,
          { status: "ready" }
        >;

        // Using `provider.getBalance` here as we're shielding a chain's native
        // asset.
        const initUnshieldedBalance = await provider.getBalance(signer.address);

        const response = await signer.sendTransaction({
          ...op.payload,
          value: shieldAmount,
          gasLimit: 7_000_000,
        });

        const receipt = await provider.waitForTransaction(response.hash);

        // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
        const txFee = receipt?.gasUsed! * receipt?.gasPrice!;

        const expectedUnshieldedBalance =
          initUnshieldedBalance - txFee - shieldAmount;
        const expectedShieldedBalance = initShieldedBalance + shieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          plugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await provider.getBalance(signer.address);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }

      console.log("Testing Transfer");
      {
        const assetAmount = {
          asset,
          amount: transferAmount,
        };

        const to = bob;
        const op = await plugin.prepareTransfer(assetAmount, to);

        await plugin.broadcast(op);

        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount;

        const shieldedBalance = await checkBalance(
          plugin,
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

        const to = signer.address as Address;
        const op = await plugin.prepareUnshield(assetAmount, to);

        await plugin.broadcast(op);

        // Unshielding of the chain's native token defaults to using the
        // wrapped token representation. The unshielded amounts accumulate.
        const expectedUnshieldedBalance =
          initUnshieldedBalance + unshieldAmount;
        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount - unshieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          plugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(signer.address);

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

      // Get Alice's initial ERC-20 balances.
      const initUnshieldedBalance = await contract.balanceOf(signer.address);
      const initShieldedBalance = await getBalance(plugin, asset);

      console.log("Testing Shield");
      {
        const assetAmount = {
          asset,
          amount: shieldAmount,
        };

        const to = alice;
        const op = (await plugin.prepareShield(assetAmount, to)) as Extract<
          BermudaPublicOperation,
          { status: "ready" }
        >;

        // Unlike the native asset, an ERC-20 shield moves tokens via an
        // EIP-2612 permit baked into the payload, so no `value` is attached.
        const response = await signer.sendTransaction({
          ...op.payload,
          gasLimit: 7_000_000,
        });

        await provider.waitForTransaction(response.hash);

        const expectedUnshieldedBalance = initUnshieldedBalance - shieldAmount;
        const expectedShieldedBalance = initShieldedBalance + shieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          plugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(signer.address);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }

      console.log("Testing Transfer");
      {
        const assetAmount = {
          asset,
          amount: transferAmount,
        };

        const to = bob;
        const op = await plugin.prepareTransfer(assetAmount, to);

        await plugin.broadcast(op);

        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount;

        const shieldedBalance = await checkBalance(
          plugin,
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

        const to = signer.address as Address;
        const op = await plugin.prepareUnshield(assetAmount, to);

        await plugin.broadcast(op);

        // The unshielded ERC-20 is returned to the recipient as the same token.
        const expectedUnshieldedBalance =
          initUnshieldedBalance - shieldAmount + unshieldAmount;
        const expectedShieldedBalance =
          initShieldedBalance + shieldAmount - transferAmount - unshieldAmount;

        // NOTE: We need to wait until the shielded balance is properly updated
        // on-chain before we query the token contract for the updated balance.
        const shieldedBalance = await checkBalance(
          plugin,
          asset,
          expectedShieldedBalance,
        );
        const unshieldedBalance = await contract.balanceOf(signer.address);

        expect(unshieldedBalance).toBe(expectedUnshieldedBalance);
        expect(shieldedBalance).toBe(expectedShieldedBalance);
      }
    });
  },
  timeout,
);
