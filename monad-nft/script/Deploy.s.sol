// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "forge-std/Script.sol";
import "../src/BookFactory.sol";

contract DeployScript is Script {
    function run() external {
        uint256 sk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(sk);
        
        vm.startBroadcast(sk);

        // 使用部署者地址作为 Treasury
        BookFactory factory = new BookFactory(
            deployer,      // Treasury = 部署者地址
            0.1 ether      // 部署费 0.1 CFX (降低门槛)
        );

        vm.stopBroadcast();
        
        console.log("BookFactory deployed at:", address(factory));
        console.log("Treasury address:", deployer);
    }
}
