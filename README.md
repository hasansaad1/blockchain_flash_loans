# Blockchain Flash Loan Arbitrage Project

This project demonstrates **Aave flash loans** for **arbitrage trading** between Uniswap and Sushiswap DEXs on the Sepolia testnet.

## 🚀 Quick Start

**New to this project?** See [SETUP.md](./SETUP.md) for complete setup instructions.

### Quick Setup (5 minutes)

1. **Install Node.js** (v18+): https://nodejs.org/
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Create `.env` file:**
   ```bash
   cp .env.example .env
   # Edit .env with your RPC URL and private key
   ```
4. **Get Sepolia testnet ETH:**
   - Visit: https://sepoliafaucet.com/
   - Send ETH to your wallet address
5. **Compile contracts:**
   ```bash
   npx hardhat compile
   ```
6. **Run the flash loan script:**
   ```bash
   npx hardhat run scripts/deploySimpleFlashLoan.ts --network sepolia
   ```

## 📋 Project Overview

This project implements:

- **Flash Loan Contract**: Borrows tokens from Aave without collateral
- **Arbitrage Logic**: Swaps tokens between Uniswap and Sushiswap to profit from price differences
- **Complete Deployment Script**: Automatically deploys, funds, and executes flash loans
- **Hardhat 3 Beta**: Uses native Node.js test runner and `viem` library

### What This Project Does

1. Deploys a `SimpleFlashLoan` contract to Sepolia
2. Funds it with WETH to cover flash loan fees
3. Requests a flash loan from Aave (e.g., 0.5 WETH)
4. Executes arbitrage:
   - Buys DAI on Uniswap using borrowed WETH
   - Sells DAI on Sushiswap for WETH
5. Repays the flash loan + fee
6. Keeps any profit

## 📚 Project Structure

- `contracts/SimpleFlashLoan.sol` - Main flash loan contract with arbitrage logic
- `scripts/deploySimpleFlashLoan.ts` - Deployment and execution script
- `scripts/send-op-tx.ts` - Optimism chain test script
- `test/` - Test files
- `ignition/` - Ignition deployment modules

## 📖 Usage

### Running Tests

```bash
# Run all tests
npx hardhat test

# Run only Solidity tests
npx hardhat test solidity

# Run only TypeScript tests
npx hardhat test nodejs
```

### Deploy and Execute Flash Loan

**Demo script** (recommended - shows full flow with transaction tracking):

```bash
npx hardhat run scripts/demoFlashLoan.ts --network sepolia
```

**Main script** (deploys contract, funds it, and executes flash loan):

```bash
npx hardhat run scripts/deploySimpleFlashLoan.ts --network sepolia
```

**Using Ignition** (alternative deployment method):

```bash
# Local deployment
npx hardhat ignition deploy ignition/modules/SimpleFlashLoan.ts

# Sepolia deployment
npx hardhat ignition deploy --network sepolia ignition/modules/SimpleFlashLoan.ts
```

### Test OP Chain Script

```bash
npx hardhat run scripts/send-op-tx.ts
```

## 🔧 Configuration

### Required Environment Variables

Create a `.env` file from `.env.example`:

- `RPC_URL_SEPOLIA` - Your Sepolia RPC endpoint (from Alchemy/Infura/QuickNode)
- `WALLET_PRIVATE_KEY` - Your wallet's private key (without 0x prefix)
- `AAVE_POOL_ADDRESSES_PROVIDER_SEPOLIA` - Aave V3 pool addresses provider
- `WETH_TOKEN_SEPOLIA` - Wrapped ETH token address
- `DAI_TOKEN_SEPOLIA` - DAI token address for arbitrage
- `UNISWAP_ROUTER_SEPOLIA` - Uniswap V2 router address
- `SUSHISWAP_ROUTER_SEPOLIA` - Sushiswap router address

See `.env.example` for all required variables with example values.

## 📖 Documentation

- **[SETUP.md](./SETUP.md)** - Complete setup guide from scratch
- [Hardhat Documentation](https://hardhat.org/docs)
- [Aave V3 Documentation](https://docs.aave.com/developers/)
- [Viem Documentation](https://viem.sh/)

## ⚠️ Important Notes

- This project uses **Sepolia testnet** - never use mainnet private keys
- Flash loans require the contract to be funded with WETH for fees
- Arbitrage profits depend on price differences between DEXs
- Always test thoroughly before deploying to mainnet
