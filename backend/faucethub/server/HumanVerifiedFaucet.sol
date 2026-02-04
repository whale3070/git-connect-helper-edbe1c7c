// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract HumanVerifiedFaucetRelay {
    address public signer;
    address public relayer;
    uint256 public constant AMOUNT = 0.01 ether; // 0.01 CFX
    
    mapping(address => uint256) public lastClaim;
    mapping(address => uint256) public nonces;
    
    event Claimed(address indexed user, uint256 timestamp, uint256 nonce);
    event ClaimedViaRelay(address indexed user, uint256 timestamp, uint256 nonce, address indexed relayer);

    constructor(address _signer, address _relayer) {
        signer = _signer;
        relayer = _relayer;
    }

    // 用户自己调用（需要支付gas）
    function claim(
        bytes memory signature,
        uint256 nonce,
        uint256 deadline
    ) external {
        require(block.timestamp <= deadline, "Signature expired");
        require(nonce == nonces[msg.sender], "Invalid nonce");
        require(block.timestamp - lastClaim[msg.sender] >= 24 hours, "Already claimed in 24h");

        bytes32 messageHash = getMessageHash(msg.sender, nonce, deadline);
        bytes32 ethSignedMessageHash = prefixed(messageHash);
        require(recoverSigner(ethSignedMessageHash, signature) == signer, "Invalid signature");

        nonces[msg.sender] = nonce + 1;
        lastClaim[msg.sender] = block.timestamp;

        // 发送代币给用户
        (bool sent, ) = payable(msg.sender).call{value: AMOUNT}("");
        require(sent, "Failed to send CFX");
        
        emit Claimed(msg.sender, block.timestamp, nonce);
    }

    // Relay调用（服务器支付gas）
    function claimViaRelay(
        address user,
        bytes memory signature,
        uint256 nonce,
        uint256 deadline
    ) external {
        require(msg.sender == relayer, "Only relayer can call");
        require(block.timestamp <= deadline, "Signature expired");
        require(nonce == nonces[user], "Invalid nonce");
        require(block.timestamp - lastClaim[user] >= 24 hours, "Already claimed in 24h");

        bytes32 messageHash = getMessageHash(user, nonce, deadline);
        bytes32 ethSignedMessageHash = prefixed(messageHash);
        require(recoverSigner(ethSignedMessageHash, signature) == signer, "Invalid signature");

        nonces[user] = nonce + 1;
        lastClaim[user] = block.timestamp;

        // 发送代币给用户
        (bool sent, ) = payable(user).call{value: AMOUNT}("");
        require(sent, "Failed to send CFX");
        
        emit ClaimedViaRelay(user, block.timestamp, nonce, msg.sender);
    }

    // 查询用户是否可以领取
    function canClaim(address user) external view returns (bool) {
        return block.timestamp - lastClaim[user] >= 24 hours;
    }
    
    // 获取用户下次可领取时间
    function nextClaimTime(address user) external view returns (uint256) {
        return lastClaim[user] + 24 hours;
    }

    function getMessageHash(address user, uint256 nonce, uint256 deadline) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, nonce, deadline));
    }

    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function recoverSigner(bytes32 message, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid signature length");
        uint8 v;
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(sig,32))
            s := mload(add(sig,64))
            v := byte(0, mload(add(sig,96)))
        }
        if (v < 27) v += 27;
        return ecrecover(message, v, r, s);
    }

    // 允许任何人充值合约
    receive() external payable {}
    
    // 查看合约余额
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    // 管理员可以提取资金（仅用于紧急情况）
    function withdraw(address payable to, uint256 amount) external {
        require(msg.sender == signer, "Only signer can withdraw");
        require(amount <= address(this).balance, "Insufficient balance");
        (bool sent, ) = to.call{value: amount}("");
        require(sent, "Failed to withdraw");
    }
}