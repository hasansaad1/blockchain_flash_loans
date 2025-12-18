import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

import * as dotenv from "dotenv";

dotenv.config();

const RPC_URL_SEPOLIA: string = process.env.RPC_URL_SEPOLIA || "";

const PRIVATE_KEY: string = process.env.WALLET_PRIVATE_KEY || "";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    sepolia: {
      type: "http",
      url: RPC_URL_SEPOLIA,
      accounts: [PRIVATE_KEY],
    },
  },
});
