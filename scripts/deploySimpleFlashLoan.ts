import hre from "hardhat";
import ethers from "hardhat";
import { network } from "hardhat";
import { networkInterfaces } from "os";
import * as dotenv from "dotenv";
import { Address, parseEther, parseAbi, formatEther, encodeAbiParameters, parseAbiParameters } from "viem";

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
    const requestedAmount = 0.5 // Cantidad del flash loan que se pide

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

    // Esperar a que se añada a la Blockchain para obtener el recibo
    const simpleFlashLoanReceipt = await publicClient.waitForTransactionReceipt({ 
        hash: simpleFlashLoanTransaction.hash,
        // El contrato pudo haberse añadido a la red pero viem aun no haberse actualizado
        retryCount: 5,
        retryDelay: 1000 // 1 sec
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

    /// El ABI actúa como una interfaz que informa al código JavaScript sobre las funciones disponibles en la blockchain y define cómo interactuar con ellas
    const wethAbi = parseAbi([
        'function deposit() payable', // Para convertir ETH -> WETH
        'function transfer(address to, uint256 amount) returns (bool)', // Para enviar
        'function balanceOf(address owner) view returns (uint256)' //
    ]);

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
    const sourceRouter = process.env.UNISWAP_ROUTER_SEPOLIA;
    const destRouter = process.env.SUSHISWAP_ROUTER_SEPOLIA;
    const tokenToConvert = process.env.DAI_TOKEN_SEPOLIA;

    // Codificar los parametros
    const encodedParams = encodeAbiParameters(
        parseAbiParameters("address, address, address"),
        [sourceRouter as Address, destRouter as Address, tokenToConvert as Address]
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
