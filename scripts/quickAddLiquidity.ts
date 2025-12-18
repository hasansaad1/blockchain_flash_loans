import { network } from "hardhat";
import * as dotenv from "dotenv";
import { Address, formatEther, parseEther, parseUnits, maxUint256 } from "viem";

dotenv.config();

async function main() {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [walletClient] = await viem.getWalletClients();

    console.log("\n=== QUICKLY ADDING LIQUIDITY ===\n");

    const account = walletClient.account.address;
    const wethAddress = process.env.WETH_TOKEN_SEPOLIA as Address;
    const usdcAddress = process.env.USDC_TOKEN_SEPOLIA as Address;
    const uniswapRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" as Address;

    const erc20Abi = [
        { inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
        { inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
    ] as const;

    const wethAbi = [
        { inputs: [], name: 'deposit', outputs: [], stateMutability: 'payable', type: 'function' },
    ] as const;

    const routerAbi = [
        {
            inputs: [
                { name: 'tokenA', type: 'address' },
                { name: 'tokenB', type: 'address' },
                { name: 'amountADesired', type: 'uint256' },
                { name: 'amountBDesired', type: 'uint256' },
                { name: 'amountAMin', type: 'uint256' },
                { name: 'amountBMin', type: 'uint256' },
                { name: 'to', type: 'address' },
                { name: 'deadline', type: 'uint256' }
            ],
            name: 'addLiquidity',
            outputs: [
                { name: 'amountA', type: 'uint256' },
                { name: 'amountB', type: 'uint256' },
                { name: 'liquidity', type: 'uint256' }
            ],
            stateMutability: 'nonpayable',
            type: 'function'
        },
        {
            inputs: [
                { name: 'amountIn', type: 'uint256' },
                { name: 'amountOutMin', type: 'uint256' },
                { name: 'path', type: 'address[]' },
                { name: 'to', type: 'address' },
                { name: 'deadline', type: 'uint256' }
            ],
            name: 'swapExactTokensForTokens',
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
            stateMutability: 'nonpayable',
            type: 'function'
        },
        {
            inputs: [
                { name: 'amountIn', type: 'uint256' },
                { name: 'path', type: 'address[]' }
            ],
            name: 'getAmountsOut',
            outputs: [{ name: 'amounts', type: 'uint256[]' }],
            stateMutability: 'view',
            type: 'function'
        },
    ] as const;

    // Check balances
    let wethBalance = await publicClient.readContract({
        address: wethAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
    });

    let usdcBalance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
    });

    console.log("Current balances:");
    console.log("  WETH:", formatEther(wethBalance), "WETH");
    console.log("  USDC:", Number(usdcBalance) / 1e6, "USDC");

    // Convert ETH to WETH if needed
    const wethNeeded = parseEther("0.1");
    if (wethBalance < wethNeeded) {
        const ethToConvert = wethNeeded - wethBalance;
        console.log("\nConverting", formatEther(ethToConvert), "ETH to WETH...");
        const depositHash = await walletClient.writeContract({
            address: wethAddress,
            abi: wethAbi,
            functionName: 'deposit',
            value: ethToConvert,
        });
        await publicClient.waitForTransactionReceipt({ hash: depositHash });
        wethBalance = await publicClient.readContract({
            address: wethAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account],
        });
        console.log("✅ WETH balance:", formatEther(wethBalance));
    }

    // Swap WETH for USDC if needed
    const usdcNeeded = parseUnits("200", 6);
    if (usdcBalance < usdcNeeded) {
        const wethForSwap = parseEther("0.1");
        console.log("\nSwapping", formatEther(wethForSwap), "WETH for USDC...");
        
        // Approve
        await walletClient.writeContract({
            address: wethAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [uniswapRouter, maxUint256],
        });

        // Swap
        const path = [wethAddress, usdcAddress];
        const amounts = await publicClient.readContract({
            address: uniswapRouter,
            abi: routerAbi,
            functionName: 'getAmountsOut',
            args: [wethForSwap, path],
        });
        const minUSDC = amounts[amounts.length - 1] * 90n / 100n;

        const swapHash = await walletClient.writeContract({
            address: uniswapRouter,
            abi: routerAbi,
            functionName: 'swapExactTokensForTokens',
            args: [
                wethForSwap,
                minUSDC,
                path,
                account,
                BigInt(Math.floor(Date.now() / 1000) + 60 * 20)
            ],
        });
        await publicClient.waitForTransactionReceipt({ hash: swapHash });
        
        usdcBalance = await publicClient.readContract({
            address: usdcAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [account],
        });
        console.log("✅ USDC balance:", Number(usdcBalance) / 1e6);
    }

    // Add liquidity
    console.log("\nAdding liquidity...");
    const wethAmount = parseEther("0.05");
    const usdcAmount = parseUnits("100", 6);

    // Approve both
    await walletClient.writeContract({
        address: wethAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [uniswapRouter, maxUint256],
    });
    await walletClient.writeContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [uniswapRouter, maxUint256],
    });

    // Add liquidity
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
    const addLiquidityHash = await walletClient.writeContract({
        address: uniswapRouter,
        abi: routerAbi,
        functionName: 'addLiquidity',
        args: [
            wethAddress,
            usdcAddress,
            wethAmount,
            usdcAmount,
            wethAmount,
            usdcAmount,
            account,
            deadline
        ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: addLiquidityHash });
    if (receipt.status === 'success') {
        console.log("✅ Liquidity added successfully!");
        console.log("   Now you can test the flash loan with swaps!");
    } else {
        console.log("❌ Failed to add liquidity");
    }
}

main().catch(console.error);

