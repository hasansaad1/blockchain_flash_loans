// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DataTypes} from "@aave/core-v3/contracts/protocol/libraries/types/DataTypes.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract SimpleFlashLoan is FlashLoanSimpleReceiverBase {

    // El Pool y AddressProvider son almacenados en el contrato FlashLoanSimpleReceiverBase
    address public owner;

    constructor(IPoolAddressesProvider _addressProvider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider))
    {
        owner = msg.sender; // Contract owner = Creator of this contract
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "===   You are not the owner of this contract. Not authorised!   ===");
        _;
    }

    // Funcion que sirve para comprobar si el pool posee el token y si tiene los funds
    // suficientes con respecto a la cantidad indicada
    // Como tiene el atributo view, no consume gas
    function checkToken(address _token, uint256 _amount) public view onlyOwner
        returns (bool isLoanPossible, string memory error, address currentPool) {

        DataTypes.ReserveData memory data = POOL.getReserveData(_token);

        // Verificar existencia del token
        // Si la dirección del aToken es 0, el token no está listado
        if (data.aTokenAddress == address(0)) {
            return (false, "Token unavailable", address(POOL));
        }

        // Verificar que los fondos no están pausados o congelados
        uint256 config = data.configuration.data;
        bool isPaused = (config >> 60) & 1 == 1; // Bit 60 is pause
        bool isFrozen = (config >> 59) & 1 == 1; // Bit 59 is freeze

        if (isPaused || isFrozen) {
            return (false, "Funds paused or frozen", address(POOL));
        }

        // Verificar la liquidez real
        // No puedes pedir prestado mas de lo que hay en el aToken
        uint256 availableLiquidity = IERC20(_token).balanceOf(data.aTokenAddress);
        if (availableLiquidity < _amount) {
            return (false, "Insufficient funds", address(POOL));
        }

        return (true, "", address(POOL));
    }

    function requestFlashLoan(address _token, uint256 _amount, bytes calldata _params) public onlyOwner
        returns (DataTypes.ReserveData memory) {

        address receiverAddress = address(this);
        address asset = _token;
        uint256 amount = _amount;
        bytes memory params = _params;
        uint16 referralCode = 0;

        POOL.flashLoanSimple(
            receiverAddress,
            asset,
            amount,
            params,
            referralCode
        );
    }

    // Esta funcion es invocada justo despues de que el contrato reciba el flash loan
    function  executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    )  external override returns (bool) {

        //Logic goes here

        // require(initiator == owner, "Only the owner of the contract can invoke this function");

        // Recordar que asset sera la direccion del token que se ha solicitado a aavae

        // Decodificamos el intercambio deseado
        (address sourceRouter, address destRouter, address tokenToConvert) = abi.decode(params, (address, address, address));

        // Autorizamos al primer Exchange (DEX) para gestionar la cantidad del token solo del flash loan
        IERC20(asset).approve(sourceRouter, amount);

        address[] memory path = new address[](2);
        path[0] = asset; 
        path[1] = tokenToConvert;

        // Intercambio de activos por parte del primer DEX
        IUniswapV2Router02(sourceRouter).swapExactTokensForTokens(
            amount,
            0, 
            path,
            address(this),
            block.timestamp
        );

        // Obtenemos cantidad despues del swap con el primer DEX
        uint256 interimBalance = IERC20(tokenToConvert).balanceOf(address(this));

        // Autorizamos al segundo Exchange (DEX) para gestionar esa cantidad
        IERC20(tokenToConvert).approve(destRouter, interimBalance);

        path[0] = tokenToConvert; 
        path[1] = asset;

        IUniswapV2Router02(destRouter).swapExactTokensForTokens(
            interimBalance,
            0,
            path,
            address(this),
            block.timestamp
        );

        // El contrato ya tiene una cantidad mínima de fondos que se usarán para pagar los intereses del flash loan
        // para asegurar que el intercambio siempre se realice aunque no se obtenga beneficio del swap
        // Esto llevado a una red normal habría que modificarlo
        uint256 totalAmount = amount + premium;
        IERC20(asset).approve(address(POOL), totalAmount);

        return true;
    }

    receive() external payable {}
}
