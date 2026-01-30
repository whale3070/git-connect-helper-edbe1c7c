// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "forge-std/Script.sol";
import "../src/BookVault.sol";

contract DeployScript is Script {
    function run() external {
        uint256 sk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(sk);

        new BookFactory(
            0x13cf4980A22310093A7E3EA1C00842974B19Cd7E,
            1 ether // 1 CFX
        );

        vm.stopBroadcast();
    }
}
