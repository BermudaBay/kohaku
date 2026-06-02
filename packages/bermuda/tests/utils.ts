import { EthAddress } from "@bermuda/sdk";
import {
  Contract,
  ContractFactory,
  EventLog,
  hexlify,
  Interface,
  Provider,
  randomBytes,
  Wallet,
  ZeroAddress,
  NonceManager,
} from "ethers";
import SafeMockSingleton from "./fixtures/SafeMockSingleton.json";
import SafeMockProxyFactory from "./fixtures/SafeMockProxyFactory.json";
import { ERC20AssetId, Host, NativeAssetId } from "@kohaku-eth/plugins";
import { Address, BermudaPlugin, BermudaSafePlugin } from "../dist";

export const timeout = 90 * 1_000;
export const initializer = "base-sepolia";
export const PRIVATE_KEY = process.env.PRIVATE_KEY!;
export const INTEGRATION = process.env.INTEGRATION === "1";

export function validateSetup() {
  if (!INTEGRATION) {
    console.warn("Skipping integration test. Set INTEGRATION=1 to run.");

    return false;
  }

  if (!PRIVATE_KEY) {
    console.warn(
      "Please provide a private key via the PRIVATE_KEY environment variable.",
    );

    return false;
  }

  return true;
}

export function getHost(provider: Provider) {
  return {
    provider: {
      ...provider,
      getChainId: async () => (await provider.getNetwork()).chainId,
    },
  } as unknown as Host;
}

export function getAsset(
  type: "native" | "erc20",
  token: Address,
  provider: Provider,
) {
  let asset;

  if (type === "native") {
    asset = {
      __type: "native",
    } satisfies NativeAssetId;
  } else {
    asset = {
      __type: "erc20",
      contract: token,
    } satisfies ERC20AssetId;
  }

  const contract = new Contract(
    token,
    [
      "function balanceOf(address) view returns (uint256)",
      "function transfer(address to, uint256 amount) returns (bool)",
    ],
    provider,
  );

  return {
    asset,
    contract,
  };
}

export async function checkBalance(
  plugin: BermudaPlugin | BermudaSafePlugin,
  asset: NativeAssetId | ERC20AssetId,
  amount: bigint,
  waitForMs = 2_000,
  maxTries = 3,
) {
  let tries = 0;
  let success = false;

  do {
    if (tries === maxTries) {
      throw new Error(
        `Couldn't find balance after ${(maxTries * waitForMs) / 1_000}s`,
      );
    }

    const balance = await getBalance(plugin, asset);

    if (balance === amount) {
      success = true;

      return balance;
    } else {
      tries += 1;
      await new Promise((resolve) => setTimeout(resolve, waitForMs));
    }
  } while (!success);
}

export async function getBalance(
  plugin: BermudaPlugin | BermudaSafePlugin,
  asset: NativeAssetId | ERC20AssetId,
) {
  const assetAmounts = await plugin.balance([asset]);

  if (assetAmounts[0]) {
    return assetAmounts[0].amount;
  }

  return 0n;
}

export async function deploySafe(
  deployer: Wallet,
  owners: EthAddress[],
  threshold: number,
) {
  const managedDeployer = new NonceManager(deployer);

  // Deploy `SafeSingleton` contract.
  const singletonFactory = new ContractFactory(
    SafeMockSingleton.abi,
    SafeMockSingleton.bytecode.object,
    managedDeployer,
  );

  const singleton = await singletonFactory.deploy();

  await singleton.deploymentTransaction()!.wait();
  const singletonAddress = await singleton.getAddress();

  // Deploy `SafeProxyFactory` contract.
  const proxyFactoryFactory = new ContractFactory(
    SafeMockProxyFactory.abi,
    SafeMockProxyFactory.bytecode.object,
    managedDeployer,
  );

  const proxyFactory = await proxyFactoryFactory.deploy();

  await proxyFactory.deploymentTransaction()!.wait();
  const proxyFactoryAddress = await proxyFactory.getAddress();

  const singletonInterface = new Interface(SafeMockSingleton.abi);
  const initializer = singletonInterface.encodeFunctionData("setup", [
    owners,
    threshold,
    ZeroAddress,
    "0x",
    ZeroAddress,
    ZeroAddress,
    0,
    ZeroAddress,
  ]);

  const saltNonce = BigInt(hexlify(randomBytes(32)));

  const factory = new Contract(
    proxyFactoryAddress,
    SafeMockProxyFactory.abi,
    managedDeployer,
  );
  const tx = await factory.createProxyWithNonce(
    singletonAddress,
    initializer,
    saltNonce,
  );
  const receipt = await tx.wait();

  // Read `ProxyCreation` event to get proxy address.
  const proxyCreation = receipt.logs.find(
    (log: { topics: string[]; data: string }) => {
      try {
        return (
          factory.interface.parseLog({ topics: log.topics, data: log.data })
            ?.name === "ProxyCreation"
        );
      } catch {
        return false;
      }
    },
  ) as EventLog | undefined;

  if (!proxyCreation) {
    throw new Error("ProxyCreation event not found in transaction receipt");
  }

  const parsed = factory.interface.parseLog({
    topics: proxyCreation.topics,
    data: proxyCreation.data,
  })!;

  const proxyAddress: string = parsed.args[0];

  return new Contract(proxyAddress, SafeMockSingleton.abi, deployer.provider);
}
