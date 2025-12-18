// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataTypes} from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

// Interface for 0x Protocol Exchange Proxy
interface IZeroEx {
    struct Transformation {
        address deployment;
        bytes data;
        uint256 minOutput;
    }
    
    function transformERC20(
        address inputToken,
        address outputToken,
        uint256 inputTokenAmount,
        uint256 minOutputTokenAmount,
        Transformation[] calldata transformations
    ) external payable returns (uint256 outputTokenAmount);
}

contract SimpleFlashLoan is FlashLoanSimpleReceiverBase {

    address public owner;

    constructor(IPoolAddressesProvider _addressProvider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
    {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "===   You are not the owner of this contract. Not authorised!   ===");
        _;
    }

    function checkToken(address _token, uint256 _amount) public view onlyOwner
        returns (bool isLoanPossible, string memory error, address currentPool) {

        DataTypes.ReserveData memory data = POOL.getReserveData(_token);

        if (data.aTokenAddress == address(0)) {
            return (false, "Token unavailable", address(POOL));
        }

        uint256 config = data.configuration.data;
        bool isPaused = (config >> 60) & 1 == 1;
        bool isFrozen = (config >> 59) & 1 == 1;

        if (isPaused || isFrozen) {
            return (false, "Funds paused or frozen", address(POOL));
        }

        uint256 availableLiquidity = IERC20(_token).balanceOf(data.aTokenAddress);
        if (availableLiquidity < _amount) {
            return (false, "Insufficient funds", address(POOL));
        }

        return (true, "", address(POOL));
    }

    function requestFlashLoan(address _token, uint256 _amount, bytes calldata _params) public onlyOwner {
        POOL.flashLoanSimple(
            address(this),
            _token,
            _amount,
            _params,
            0
        );
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address /* initiator */,
        bytes calldata params
    ) external override returns (bool) {

        (
            address sourceRouter,
            uint8 sourceDEXType,
            address destRouter,
            uint8 destDEXType,
            address tokenToConvert,
            bool skipProfitabilityCheck
        ) = abi.decode(
            params,
            (address, uint8, address, uint8, address, bool)
        );

        bool arbitrageSuccess = false;
        try this._executeArbitrage(
            asset, 
            amount, 
            premium, 
            sourceRouter, 
            sourceDEXType,
            destRouter, 
            destDEXType,
            tokenToConvert,
            skipProfitabilityCheck
        ) returns (bool success) {
            arbitrageSuccess = success;
        } catch {
            // Arbitrage failed - will repay using pre-funded WETH
        }

        uint256 totalAmount = amount + premium;
        uint256 contractBalance = IERC20(asset).balanceOf(address(this));
        
        require(
            contractBalance >= totalAmount,
            "Insufficient balance to repay flash loan"
        );

        IERC20(asset).approve(address(POOL), totalAmount);

        return true;
    }

    function _executeArbitrage(
        address asset,
        uint256 amount,
        uint256 premium,
        address sourceRouter,
        uint8 sourceDEXType,
        address destRouter,
        uint8 destDEXType,
        address tokenToConvert,
        bool skipProfitabilityCheck
    ) external returns (bool) {
        require(msg.sender == address(this), "Only self-call allowed");

        uint256 totalAmountNeeded = amount + premium;

        // Step 1: Get quote for first swap
        uint256 expectedTokenAmount;
        
        if (sourceDEXType == 0) {
            address[] memory path1 = new address[](2);
            path1[0] = asset;
            path1[1] = tokenToConvert;
            try IUniswapV2Router02(sourceRouter).getAmountsOut(amount, path1) returns (uint256[] memory amounts) {
                expectedTokenAmount = amounts[amounts.length - 1];
                if (expectedTokenAmount == 0) {
                    return false;
                }
            } catch {
                return false;
            }
        } else if (sourceDEXType == 1) {
            expectedTokenAmount = amount * 90 / 100;
        } else {
            return false;
        }
        
        // Step 2: Get quote for second swap
        uint256 expectedFinalAmount;
        
        if (destDEXType == 0) {
            address[] memory path2 = new address[](2);
            path2[0] = tokenToConvert;
            path2[1] = asset;
            try IUniswapV2Router02(destRouter).getAmountsOut(expectedTokenAmount, path2) returns (uint256[] memory amounts) {
                expectedFinalAmount = amounts[amounts.length - 1];
                if (expectedFinalAmount == 0) {
                    return false;
                }
            } catch {
                return false;
            }
        } else if (destDEXType == 1) {
            expectedFinalAmount = expectedTokenAmount * 90 / 100;
        } else {
            return false;
        }
        
        // Step 3: Profitability check (only if not skipping)
        if (!skipProfitabilityCheck) {
            uint256 minRequired = totalAmountNeeded + (totalAmountNeeded / 1000);
            if (expectedFinalAmount < minRequired) {
                return false; // Not profitable - skip swaps
            }
        }
        
        // Step 4: Execute first swap
        uint256 tokenToConvertAmount;
        
        if (sourceDEXType == 0) {
            address[] memory path1 = new address[](2);
            path1[0] = asset;
            path1[1] = tokenToConvert;
            IERC20(asset).approve(sourceRouter, amount);
            uint256 minOutput1 = skipProfitabilityCheck ? expectedTokenAmount * 99 / 100 : expectedTokenAmount * 95 / 100;
            try IUniswapV2Router02(sourceRouter).swapExactTokensForTokens(
                amount,
                minOutput1,
                path1,
                address(this),
                block.timestamp + 300
            ) returns (uint256[] memory amounts) {
                tokenToConvertAmount = amounts[amounts.length - 1];
            } catch {
                return false;
            }
        } else if (sourceDEXType == 1) {
            IERC20(asset).approve(sourceRouter, amount);
            IZeroEx.Transformation[] memory transformations;
            try IZeroEx(sourceRouter).transformERC20(
                asset,
                tokenToConvert,
                amount,
                expectedTokenAmount * 85 / 100,
                transformations
            ) returns (uint256 amountOut) {
                if (amountOut > 0) {
                    tokenToConvertAmount = amountOut;
                } else {
                    return false;
                }
            } catch {
                return false;
            }
        } else {
            return false;
        }
        
        // Step 5: Execute second swap
        uint256 finalAmount;
        
        if (destDEXType == 0) {
            address[] memory path2 = new address[](2);
            path2[0] = tokenToConvert;
            path2[1] = asset;
            IERC20(tokenToConvert).approve(destRouter, tokenToConvertAmount);
            uint256 minOutput2 = skipProfitabilityCheck ? expectedFinalAmount * 99 / 100 : expectedFinalAmount * 95 / 100;
            try IUniswapV2Router02(destRouter).swapExactTokensForTokens(
                tokenToConvertAmount,
                minOutput2,
                path2,
                address(this),
                block.timestamp + 300
            ) returns (uint256[] memory amountsOut2) {
                finalAmount = amountsOut2[amountsOut2.length - 1];
            } catch {
                return false;
            }
        } else if (destDEXType == 1) {
            IERC20(tokenToConvert).approve(destRouter, tokenToConvertAmount);
            IZeroEx.Transformation[] memory transformations;
            try IZeroEx(destRouter).transformERC20(
                tokenToConvert,
                asset,
                tokenToConvertAmount,
                expectedFinalAmount * 85 / 100,
                transformations
            ) returns (uint256 amountOut) {
                if (amountOut > 0) {
                    finalAmount = amountOut;
                } else {
                    return false;
                }
            } catch {
                return false;
            }
        } else {
            return false;
        }
        
        // Step 6: Return success if skipping profitability check, otherwise verify profitability
        if (skipProfitabilityCheck) {
            return true;
        } else {
            return finalAmount >= totalAmountNeeded;
        }
    }

    receive() external payable {}
}
