import { network } from "hardhat";
import * as dotenv from "dotenv";
import { Address, parseEther, formatEther, encodeAbiParameters, parseAbiParameters } from "viem";

// Import file .env
dotenv.config();

// Conectar a la red
const { viem, networkName } = await network.connect();

// Public client sera como un observador de la blockchain, muy util para esperar que las transacciones sean añadidas a la blockchain (minadas)
const publicClient = await viem.getPublicClient();

// Obtener la wallet, para firmar transacciones
const [walletClient] = await viem.getWalletClients();

// La dirección de la cuenta asociada a la wallet
const account = walletClient.account.address;

// Para output mas claro
const line = "\n---------------------------------------------------------------\n"

async function main() {

    // Variables
    const aavaePoolAddressesProvider = process.env.AAVE_POOL_ADDRESSES_PROVIDER_SEPOLIA;
    const tokenAddressRequested = process.env.WETH_TOKEN_SEPOLIA;
    const tokenNameRequested = "WETH"
    const requestedAmount = 0.01 // Cantidad del flash loan que se pide (reduced for testing with minimal liquidity)

    // Obtener saldo de la cuenta. El saldo sera de ETH ya que Sepolia es una testnet de Etherum
    const weiBalance = await publicClient.getBalance({
        address: account
    });
    //
    const ethBalance = formatEther(weiBalance)

    console.log(line)
    console.log("Deploying SimpleFlashLoan contract to", networkName, "\n");
    console.log("ℹ️ Using the account:", account);
    console.log("ℹ️ Funds of the account:", weiBalance.toString(), "WEI =", ethBalance.toString(), "ETH (approximately)");

    // Desplegar el contrato
    console.log(line)
    console.log("ℹ️ Deploying SimpleFlashLoan contract");

    const { contract: simpleFlashLoan, deploymentTransaction: simpleFlashLoanTransaction } = await viem.sendDeploymentTransaction("SimpleFlashLoan", [aavaePoolAddressesProvider as Address]);

    console.log("📤 Deployment transaction sent:", simpleFlashLoanTransaction.hash);
    console.log("⏳ Waiting for confirmation...");

    // Esperar a que se añada a la Blockchain para obtener el recibo
    const simpleFlashLoanReceipt = await publicClient.waitForTransactionReceipt({ 
        hash: simpleFlashLoanTransaction.hash,
        // El contrato pudo haberse añadido a la red pero viem aun no haberse actualizado
        retryCount: 30, // Increased retry count for network delays
        retryDelay: 2000 // 2 seconds between retries
    });

    console.log("✅ SimpleFlashLoan contract deployed on address:", simpleFlashLoan.address);
    console.log("⛽ Gas Used:", simpleFlashLoanReceipt.gasUsed.toString());
    console.log("💰 Total Cost:", formatEther(simpleFlashLoanReceipt.gasUsed * simpleFlashLoanReceipt.effectiveGasPrice), "ETH");

    // Enviar fondos al contrato para que pueda pagar los intereses del flash loan

    // Obtener el interes a pagar
    const FLASHLOAN_PREMIUM = 9n; // Para calcular los intereses del flash loan de Aavae
    const FLASHLOAN_DENOMINATOR = 10000n; // Intereses = 0,009% del total
    const premium = (parseEther(requestedAmount.toString()) * FLASHLOAN_PREMIUM) / FLASHLOAN_DENOMINATOR; // Intereses totales

    console.log(line)
    console.log("ℹ️ Amount requested:", requestedAmount.toString(), tokenNameRequested)
    console.log("ℹ️ Premium (fee for the flash loan) required:", formatEther(premium), tokenNameRequested, "(approximately)");

    const wethAbi = [
        { inputs: [], name: 'deposit', outputs: [], stateMutability: 'payable', type: 'function' },
        { inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'transfer', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
        { inputs: [{ name: 'owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
    ] as const;

    // Transformar parte de los ETH a WETH
    console.log(line);
    console.log("ℹ️ Converting ETH to WETH");

    const depositHash = await walletClient.writeContract({
        address: tokenAddressRequested as Address,
        abi: wethAbi,
        functionName: 'deposit',
        value: premium + premium,
    });

    // Esperar a que se añada a la Blockchain para obtener el recibo
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositHash,
        // El contrato pudo haberse añadido a la red pero viem aun no haberse actualizado
        retryCount: 5,
        retryDelay: 1000 // 1 sec
    });

    console.log("✅", formatEther(premium + premium), "ETH converted to WETH");
    console.log("⛽ Gas used:", depositReceipt.gasUsed.toString());
    console.log("💰 Total Cost:", formatEther(depositReceipt.gasUsed * depositReceipt.effectiveGasPrice), "ETH");

    // Enviar los WETH al contrato donde se pedira el flash loan
    console.log(line);
    console.log("ℹ️ Transfering WETH from the account to the wallet");

    const transferHash = await walletClient.writeContract({
        address: tokenAddressRequested as Address,
        abi: wethAbi,
        functionName: 'transfer',
        args: [simpleFlashLoan.address, premium + premium],
    });

    // Esperar a que se añada a la Blockchain para obtener el recibo
    const transferReceipt = await publicClient.waitForTransactionReceipt({ 
        hash: transferHash,
        // El contrato pudo haberse añadido a la red pero viem aun no haberse actualizado
        retryCount: 5,
        retryDelay: 1000 // 1 sec
    });

    console.log("✅", formatEther(premium + premium), "WETH transfered to the contract", simpleFlashLoan.address);
    console.log("⛽ Gas used:", transferReceipt.gasUsed.toString());
    console.log("💰 Total Cost:", formatEther(transferReceipt.gasUsed * transferReceipt.effectiveGasPrice), "ETH");

    // Comprobar si se puede obtener un flash loan con la cantidad deseada
    console.log(line)
    console.log("ℹ️ Checking funds for the flash loan")

    const [isLoanPossible, error, currentPool] = await simpleFlashLoan.read.checkToken([tokenAddressRequested as Address, parseEther(requestedAmount.toString())]);

    if (!isLoanPossible) {
        throw new Error(
            "❌ Error: The loan of the token " + tokenAddressRequested + 
            " is NOT possible for the pool " + currentPool + "\n" +
            "Error: ❌ " + error
        );
    }

    console.log("✅ Ready to go! Pool", currentPool, "can lend the requested amount:", requestedAmount.toString(), tokenNameRequested);

    // Solicitar el flash loan
    console.log(line);
    console.log("ℹ️ Requesting the flash loan");

    // Parametros necesarios para realizar el intercambio
    // Now supports multiple DEX types: Uniswap V2 (0) and 0x Protocol (1)
    
    // Option to skip profitability check (for demonstration purposes)
    // Set to true to execute swaps even if not profitable (showcases the full flow)
    const skipProfitabilityCheck = process.env.SKIP_PROFITABILITY_CHECK === "true" || false;
    
    // Source DEX: Uniswap V2 (use router from .env - Sepolia router)
    const sourceRouter = process.env.UNISWAP_ROUTER_SEPOLIA;
    if (!sourceRouter) {
        throw new Error("UNISWAP_ROUTER_SEPOLIA not set in .env");
    }
    const sourceDEXType = 0; // 0 = Uniswap V2
    
    // Destination DEX: Use same Uniswap router for now (0x might not have liquidity)
    // For testing with liquidity we just added, use Uniswap for both
    const destRouter = sourceRouter; // Use same router
    const destDEXType = 0; // 0 = Uniswap V2
    
    console.log("📊 Using DEXs for arbitrage:");
    console.log("   Source DEX: Uniswap V2 (" + sourceRouter + ")");
    console.log("   Dest DEX: Uniswap V2 (" + destRouter + ")");
    if (skipProfitabilityCheck) {
        console.log("   ⚠️  Profitability check: DISABLED (swaps will execute regardless)");
    } else {
        console.log("   ✅ Profitability check: ENABLED (swaps only if profitable)");
    }
    
    // Using USDC instead of DAI because USDC has liquidity on Sepolia
    const tokenToConvert = process.env.USDC_TOKEN_SEPOLIA || process.env.DAI_TOKEN_SEPOLIA;

    // Codificar los parametros: sourceRouter, sourceDEXType, destRouter, destDEXType, tokenToConvert, skipProfitabilityCheck
    const encodedParams = encodeAbiParameters(
        parseAbiParameters("address, uint8, address, uint8, address, bool"),
        [
            sourceRouter as Address, 
            sourceDEXType,
            destRouter as Address, 
            destDEXType,
            tokenToConvert as Address,
            skipProfitabilityCheck
        ]
    );

    const requestFlashLoanHash = await simpleFlashLoan.write.requestFlashLoan([
        tokenAddressRequested as Address, 
        parseEther(requestedAmount.toString()),
        encodedParams
    ]);

    // Esperar a que se añada a la Blockchain para obtener el recibo
    const requestFlashLoanReceipt = await publicClient.waitForTransactionReceipt({ 
        hash: requestFlashLoanHash,
        // El contrato pudo haberse añadido a la red pero viem aun no haberse actualizado
        retryCount: 5,
        retryDelay: 1000 // 1 sec
    });

    // Comprobar que se hizo correctamente
    if (!(requestFlashLoanReceipt.status === "success")) {
        console.error("❌ La transacción falló en la blockchain.");
    }
    console.log("🚀 FLASH LOAN EXECUTED SUCCESSFULLY!");
    console.log("📦 Block Number:", requestFlashLoanReceipt.blockNumber.toString());
    console.log("⛽ Gas used:", requestFlashLoanReceipt.gasUsed.toString());
    console.log("💰 Total Cost:", formatEther(requestFlashLoanReceipt.gasUsed * requestFlashLoanReceipt.effectiveGasPrice), "ETH");
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
