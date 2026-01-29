// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title QuickNFT
 * @dev 每本书对应一个独立的 NFT 合约，由 Factory 部署
 * 出版社是 Owner，可以授权 Relayer 代付 Gas mint
 */
contract QuickNFT is ERC721, Ownable {
    uint256 private _nextTokenId;
    
    // 授权的 Relayer 地址（可以代付 Gas 执行 mint）
    mapping(address => bool) public authorizedRelayers;
    
    // 作者名称
    string public author;
    
    // 基础 URI
    string private _baseTokenURI;

    event RelayerAuthorized(address indexed relayer, bool status);
    event BookMinted(address indexed to, uint256 tokenId);

    /**
     * @dev 构造函数 - 由 Factory 调用
     * @param bookName 书籍名称
     * @param symbol 书籍代号
     * @param authorName 作者名称
     * @param publisher 出版社地址（成为 Owner）
     * @param baseURI 元数据基础 URI
     */
    constructor(
        string memory bookName,
        string memory symbol,
        string memory authorName,
        address publisher,
        string memory baseURI
    ) ERC721(bookName, symbol) Ownable(publisher) {
        author = authorName;
        _baseTokenURI = baseURI;
    }

    /**
     * @dev 授权 Relayer 地址
     */
    function setRelayerAuthorization(address relayer, bool authorized) external onlyOwner {
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorized(relayer, authorized);
    }

    /**
     * @dev 核心铸造函数 - Owner 或授权 Relayer 可调用
     */
    function mint(address to) public {
        require(
            msg.sender == owner() || authorizedRelayers[msg.sender],
            "Not authorized to mint"
        );
        
        uint256 tokenId = _nextTokenId;
        _safeMint(to, tokenId);
        _nextTokenId++;
        
        emit BookMinted(to, tokenId);
    }

    /**
     * @dev 批量铸造
     */
    function batchMint(address[] calldata recipients) external {
        require(
            msg.sender == owner() || authorizedRelayers[msg.sender],
            "Not authorized to mint"
        );
        
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 tokenId = _nextTokenId;
            _safeMint(recipients[i], tokenId);
            _nextTokenId++;
            emit BookMinted(recipients[i], tokenId);
        }
    }

    /**
     * @dev 查询下一个 Token ID（即当前销量）
     */
    function nextTokenId() public view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @dev 查询总销量
     */
    function totalSales() public view returns (uint256) {
        return _nextTokenId;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
