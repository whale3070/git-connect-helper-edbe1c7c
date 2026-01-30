// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "ERC721A/ERC721A.sol";

/**
 * @title QuickNFT
 * @dev 单书 NFT 合约 - 由 BookFactory 部署
 */
contract QuickNFT is ERC721A {
    // 作者名称
    string public author;
    
    // 出版社（合约 Owner）
    address public publisher;
    
    // 元数据基础 URI
    string private _baseTokenURI;
    
    // 授权的 Relayer 地址（可代付 Gas mint）
    mapping(address => bool) public authorizedRelayers;
    
    // 总销量计数器
    uint256 public totalSales;

    event RelayerAuthorizationChanged(address indexed relayer, bool authorized);
    event BookMinted(address indexed to, uint256 tokenId);

    modifier onlyPublisher() {
        require(msg.sender == publisher, "Only publisher");
        _;
    }

    modifier onlyAuthorizedMinter() {
        require(
            msg.sender == publisher || authorizedRelayers[msg.sender],
            "Not authorized to mint"
        );
        _;
    }

    /**
     * @dev 构造函数
     * @param name_ 书籍名称
     * @param symbol_ 书籍代号
     * @param author_ 作者名称
     * @param publisher_ 出版社地址（成为 Owner）
     * @param baseURI_ 元数据基础 URI
     */
    constructor(
        string memory name_,
        string memory symbol_,
        string memory author_,
        address publisher_,
        string memory baseURI_
    ) ERC721A(name_, symbol_) {
        author = author_;
        publisher = publisher_;
        _baseTokenURI = baseURI_;
    }

    /**
     * @dev 设置 Relayer 授权状态
     */
    function setRelayerAuthorization(address relayer, bool authorized) external onlyPublisher {
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorizationChanged(relayer, authorized);
    }

    /**
     * @dev Mint 函数 - 读者通过 Relayer 调用
     */
    function mint(address to) external onlyAuthorizedMinter returns (uint256) {
        uint256 tokenId = _nextTokenId();
        _mint(to, 1);
        totalSales++;
        emit BookMinted(to, tokenId);
        return tokenId;
    }

    /**
     * @dev 批量 Mint
     */
    function mintBatch(address to, uint256 quantity) external onlyAuthorizedMinter {
        _mint(to, quantity);
        totalSales += quantity;
    }

    /**
     * @dev 返回元数据 URI
     */
    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /**
     * @dev 更新 Base URI
     */
    function setBaseURI(string memory newBaseURI) external onlyPublisher {
        _baseTokenURI = newBaseURI;
    }

    /**
     * @dev Token ID 从 1 开始
     */
    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }
}
