// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.17;

interface IUniversalRouter {
    error ExecutionFailed(uint256 commandIndex, bytes message);
    error ETHNotAccepted();
    error TransactionDeadlinePassed();
    error LengthMismatch();
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}
