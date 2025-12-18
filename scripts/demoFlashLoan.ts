import { network } from "hardhat";
import * as dotenv from "dotenv";
import { Address, parseEther, formatEther, encodeAbiParameters, parseAbiParameters } from "viem";

dotenv.config();

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTransaction(publicClient: any, hash: Address, description: string, maxRetries: number = 60, delay: number = 3000) {
    console.log(`\n⏳ ${description}`);
    console.log(`   Transaction: ${hash}`);
    console.log(`   Etherscan: https://sepolia.etherscan.io/tx/${hash}`);
    console.log(`   Waiting for confirmation...`);
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const receipt = await publicClient.waitForTransactionReceipt({ 
                hash,
                retryCount: 1,
                retryDelay: 1000
            });
            
            if (receipt.status === 'success') {
                console.log(`   ✅ Confirmed in block ${receipt.blockNumber.toString()}`);
                console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
                return receipt;
            } else {
                console.log(`   ❌ Transaction failed`);
                throw new Error("Transaction failed");
            }
        } catch (e: any) {
            if (i < maxRetries - 1) {
                if (i % 5 === 0) {
                    console.log(`   ⏳ Still waiting... (${i + 1}/${maxRetries} attempts)`);
                }
                await sleep(delay);
            } else {
                throw new Error(`Transaction not found after ${maxRetries} attempts: ${e.message}`);
            }
        }
    }
    throw new Error("Max retries exceeded");
}

async function main() {
    console.log("\n" + "=".repeat(70));
    console.log("🚀 FLASH LOAN ARBITRAGE DEMO");
    console.log("=".repeat(70));
    console.log("\nThis demo will:");
    console.log("  1. Deploy the SimpleFlashLoan contract");
    console.log("  2. Pre-fund the contract with WETH");
    console.log("  3. Request a flash loan");
    console.log("  4. Execute arbitrage swaps (WETH → USDC → WETH)");
    console.log("  5. Repay the flash loan");
    console.log("\nAll transaction hashes will be displayed for tracking.\n");

    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [walletClient] = await viem.getWalletClients();

    const account = walletClient.account.address;
    const aavePoolAddressesProvider = process.env.AAVE_POOL_ADDRESSES_PROVIDER_SEPOLIA as Address;
    const wethAddress = process.env.WETH_TOKEN_SEPOLIA as Address;
    const usdcAddress = process.env.USDC_TOKEN_SEPOLIA as Address;
    const requestedAmount = 0.01;

    const sourceRouter = process.env.UNISWAP_ROUTER_SEPOLIA as Address;
    if (!sourceRouter) {
        throw new Error("UNISWAP_ROUTER_SEPOLIA not set in .env");
    }

    const zeroExRouter = process.env.ZEROX_EXCHANGE_PROXY_SEPOLIA;
    const willUseTwoDEXs = !!zeroExRouter;
    
    console.log("📋 Configuration:");
    console.log(`   Network: Sepolia Testnet`);
    console.log(`   Account: ${account}`);
    console.log(`   Flash Loan Amount: ${requestedAmount} WETH`);
    console.log(`   Source DEX: Uniswap V2`);
    console.log(`   Dest DEX: ${willUseTwoDEXs ? '0x Protocol (2 different marketplaces!)' : 'Uniswap V2 (same marketplace)'}`);
    console.log(`   Token Pair: WETH/USDC`);
    console.log(`   Profitability Check: DISABLED (for demo)`);
    if (!willUseTwoDEXs) {
        console.log(`   ⚠️  Note: Using same DEX for both swaps (not true arbitrage)`);
        console.log(`      Set ZEROX_EXCHANGE_PROXY_SEPOLIA in .env to use 2 different marketplaces`);
    }
    console.log();

    // Step 1: Add liquidity (if needed)
    console.log("=".repeat(70));
    console.log("STEP 1: Ensuring liquidity in pool");
    console.log("=".repeat(70));
    
    try {
        const { exec } = await import("child_process");
        await new Promise((resolve, reject) => {
            exec("npx hardhat run scripts/quickAddLiquidity.ts --network sepolia", (error, stdout, stderr) => {
                if (error && !stdout.includes("Liquidity added")) {
                    console.log("   ⚠️  Liquidity script had issues, continuing anyway...\n");
                } else {
                    console.log("   ✅ Liquidity check complete\n");
                }
                resolve(undefined);
            });
        });
        await sleep(2000);
    } catch (e) {
        console.log("   ⚠️  Skipping liquidity check, continuing...\n");
    }

    // Step 2: Deploy contract
    console.log("=".repeat(70));
    console.log("STEP 2: Deploying SimpleFlashLoan Contract");
    console.log("=".repeat(70));
    
    let simpleFlashLoan, deploymentTransaction;
    try {
        const result = await viem.sendDeploymentTransaction("SimpleFlashLoan", [aavePoolAddressesProvider]);
        simpleFlashLoan = result.contract;
        deploymentTransaction = result.deploymentTransaction;
    } catch (e: any) {
        if (e.message?.includes("Transaction not found")) {
            console.log("   ⚠️  Network delay detected, waiting 10 seconds...");
            await sleep(10000);
            const result = await viem.sendDeploymentTransaction("SimpleFlashLoan", [aavePoolAddressesProvider]);
            simpleFlashLoan = result.contract;
            deploymentTransaction = result.deploymentTransaction;
        } else {
            throw e;
        }
    }

    const deploymentReceipt = await waitForTransaction(
        publicClient,
        deploymentTransaction.hash,
        "Deploying contract",
        60,
        3000
    );

    const contractAddress = simpleFlashLoan.address;
    console.log(`\n   ✅ Contract deployed successfully!`);
    console.log(`   Contract Address: ${contractAddress}`);
    console.log(`   View on Etherscan: https://sepolia.etherscan.io/address/${contractAddress}`);
    await sleep(2000);

    // Step 3: Pre-fund contract
    console.log("\n" + "=".repeat(70));
    console.log("STEP 3: Pre-funding Contract with WETH");
    console.log("=".repeat(70));
    console.log("   (Needed to repay flash loan premium if swaps fail)");

    const FLASHLOAN_PREMIUM = 9n;
    const FLASHLOAN_DENOMINATOR = 10000n;
    const premium = (parseEther(requestedAmount.toString()) * FLASHLOAN_PREMIUM) / FLASHLOAN_DENOMINATOR;
    const preFundAmount = parseEther(requestedAmount.toString()) + premium + (premium * 2n);

    const wethAbi = [
        { inputs: [], name: 'deposit', outputs: [], stateMutability: 'payable', type: 'function' },
        { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
    ] as const;

    // Convert ETH to WETH
    const depositHash = await walletClient.writeContract({
        address: wethAddress,
        abi: wethAbi,
        functionName: 'deposit',
        value: preFundAmount,
    });

    await waitForTransaction(
        publicClient,
        depositHash,
        "Converting ETH to WETH",
        20,
        2000
    );
    console.log(`   ✅ Converted ${formatEther(preFundAmount)} ETH to WETH`);

    // Transfer WETH to contract
    const transferHash = await walletClient.writeContract({
        address: wethAddress,
        abi: wethAbi,
        functionName: 'transfer',
        args: [contractAddress, preFundAmount],
    });

    await waitForTransaction(
        publicClient,
        transferHash,
        "Transferring WETH to contract",
        20,
        2000
    );
    console.log(`   ✅ Transferred ${formatEther(preFundAmount)} WETH to contract`);
    await sleep(2000);

    // Step 4: Request flash loan
    console.log("\n" + "=".repeat(70));
    console.log("STEP 4: Requesting Flash Loan");
    console.log("=".repeat(70));
    console.log("   This will:");
    console.log("   - Borrow 0.01 WETH from Aave");
    console.log("   - Execute WETH → USDC swap");
    console.log("   - Execute USDC → WETH swap");
    console.log("   - Repay the flash loan + premium");

    const skipProfitabilityCheck = true;
    
    // Use Uniswap V2 for first swap
    const sourceDEXType = 0; // 0 = Uniswap V2
    const sourceRouter = process.env.UNISWAP_ROUTER_SEPOLIA as Address;
    
    // Try to use 0x Protocol for second swap (different marketplace for true arbitrage demo)
    // If not available, fallback to Uniswap V2
    const zeroExRouter = process.env.ZEROX_EXCHANGE_PROXY_SEPOLIA;
    let destDEXType = 0; // Default to Uniswap V2
    let destRouter = sourceRouter; // Default to same router
    
    if (zeroExRouter) {
        console.log("   ℹ️  0x Protocol available - will use for second swap (2 different marketplaces!)");
        destDEXType = 1; // 1 = 0x Protocol
        destRouter = zeroExRouter as Address;
    } else {
        console.log("   ⚠️  0x Protocol not configured - using Uniswap V2 for both swaps");
        console.log("   (This demonstrates the flow but not true arbitrage)");
    }

    const encodedParams = encodeAbiParameters(
        parseAbiParameters("address, uint8, address, uint8, address, bool"),
        [
            sourceRouter,
            sourceDEXType,
            destRouter,
            destDEXType,
            usdcAddress,
            skipProfitabilityCheck
        ]
    );

    const contractAbi = [
        {
            inputs: [
                { name: '_token', type: 'address' },
                { name: '_amount', type: 'uint256' },
                { name: '_params', type: 'bytes' }
            ],
            name: 'requestFlashLoan',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function'
        },
    ] as const;

    const flashLoanHash = await walletClient.writeContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: 'requestFlashLoan',
        args: [
            wethAddress,
            parseEther(requestedAmount.toString()),
            encodedParams
        ],
    });

    const flashLoanReceipt = await waitForTransaction(
        publicClient,
        flashLoanHash,
        "Executing flash loan and arbitrage",
        60,
        3000
    );

    // Step 5: Verify results
    console.log("\n" + "=".repeat(70));
    console.log("STEP 5: Verifying Results");
    console.log("=".repeat(70));

    const erc20Abi = [
        {
            type: 'event',
            name: 'Transfer',
            inputs: [
                { name: 'from', type: 'address', indexed: true },
                { name: 'to', type: 'address', indexed: true },
                { name: 'value', type: 'uint256', indexed: false },
            ],
        },
    ] as const;

    let usdcTransfers = 0;
    for (const log of flashLoanReceipt.logs) {
        if (log.address.toLowerCase() === usdcAddress.toLowerCase()) {
            try {
                const { decodeEventLog } = await import("viem");
                const decoded = decodeEventLog({
                    abi: erc20Abi,
                    data: log.data,
                    topics: log.topics,
                });
                if (decoded.eventName === 'Transfer') {
                    usdcTransfers++;
                }
            } catch (e) {
                // Not a transfer
            }
        }
    }

    console.log(`\n   Transaction Status: ${flashLoanReceipt.status === 'success' ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   Block: ${flashLoanReceipt.blockNumber.toString()}`);
    console.log(`   Gas Used: ${flashLoanReceipt.gasUsed.toString()}`);
    console.log(`   Total Logs: ${flashLoanReceipt.logs.length}`);
    console.log(`   USDC Transfers Detected: ${usdcTransfers}`);

    if (usdcTransfers >= 2) {
        console.log(`\n   ✅ SUCCESS! Swaps executed:`);
        console.log(`      - First swap: WETH → USDC`);
        console.log(`      - Second swap: USDC → WETH`);
        console.log(`      - Flash loan repaid`);
    } else {
        console.log(`\n   ⚠️  Swaps may not have executed (check transaction logs)`);
    }

    // Final summary
    console.log("\n" + "=".repeat(70));
    console.log("🎉 DEMO COMPLETE");
    console.log("=".repeat(70));
    console.log("\n📊 Transaction Summary:");
    console.log(`   1. Deployment:     https://sepolia.etherscan.io/tx/${deploymentTransaction.hash}`);
    console.log(`   2. WETH Deposit:   https://sepolia.etherscan.io/tx/${depositHash}`);
    console.log(`   3. WETH Transfer:  https://sepolia.etherscan.io/tx/${transferHash}`);
    console.log(`   4. Flash Loan:     https://sepolia.etherscan.io/tx/${flashLoanHash}`);
    console.log(`\n   Contract:         https://sepolia.etherscan.io/address/${contractAddress}`);
    console.log("\n✅ All transactions completed successfully!");
    console.log("   You can track each transaction on Etherscan using the links above.\n");
}

main().catch((error) => {
    console.error("\n❌ DEMO FAILED:", error);
    process.exitCode = 1;
});

