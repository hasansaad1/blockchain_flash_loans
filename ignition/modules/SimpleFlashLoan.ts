import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import * as dotenv from "dotenv";

dotenv.config();

export default buildModule("SimpleFlashLoanModule", (m) => {

    const provider = process.env.AAVE_POOL_ADDRESSES_PROVIDER_SEPOLIA;
    if (!provider) throw new Error("Aave pool addresses provider de sepolia no definida en .env");

    const flashLoanContract = m.contract("SimpleFlashLoan", [provider]);
    m.call(flashLoanContract, "requestFlashLoan", ["0x6a17716Ce178e84835cfA73AbdB71cb455032456", "1000"])

    return { flashLoanContract };
});
