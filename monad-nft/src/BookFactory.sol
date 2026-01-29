// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./QuickNFT.sol";

/**
 * @title BookFactory
 * @dev 工厂合约 - 出版社通过此合约部署新书的 NFT 合约
 */
contract BookFactory {
    // 收款地址（平台方）
    address public treasury;
    
    // 部署费用（单位：Wei）
    uint256 public deployFee;
    
    // 所有已部署的书籍合约
    address[] public deployedBooks;
    
    // 出版社地址 => 其部署的书籍合约列表
    mapping(address => address[]) public publisherBooks;
    
    // 书籍合约地址 => 书籍信息
    struct BookInfo {
        string name;
        string symbol;
        string author;
        address publisher;
        uint256 deployedAt;
    }
    mapping(address => BookInfo) public bookInfo;

    event BookDeployed(
        address indexed bookContract,
        address indexed publisher,
        string name,
        string symbol,
        string author
    );
    
    event DeployFeeUpdated(uint256 oldFee, uint256 newFee);
    event TreasuryUpdated(address oldTreasury, address newTreasury);

    /**
     * @dev 构造函数
     * @param _treasury 收款地址
     * @param _deployFee 部署费用（建议 10-50 CFX）
     */
    constructor(address _treasury, uint256 _deployFee) {
        require(_treasury != address(0), "Invalid treasury address");
        treasury = _treasury;
        deployFee = _deployFee;
    }

    /**
     * @dev 部署新书 NFT 合约
     * @param bookName 书籍名称
     * @param symbol 书籍代号（如 "BOOK001"）
     * @param authorName 作者名称
     * @param baseURI 元数据基础 URI
     * @param relayer Relayer 地址（用于代付 Gas mint）
     */
    function deployBook(
        string memory bookName,
        string memory symbol,
        string memory authorName,
        string memory baseURI,
        address relayer
    ) external payable returns (address) {
        require(msg.value >= deployFee, "Insufficient deploy fee");
        require(bytes(bookName).length > 0, "Book name required");
        require(bytes(symbol).length > 0, "Symbol required");
        
        // 部署新的 QuickNFT 合约
        QuickNFT newBook = new QuickNFT(
            bookName,
            symbol,
            authorName,
            msg.sender,  // 出版社成为 Owner
            baseURI
        );
        
        address bookAddress = address(newBook);
        
        // 授权 Relayer
        if (relayer != address(0)) {
            newBook.setRelayerAuthorization(relayer, true);
        }
        
        // 记录书籍信息
        deployedBooks.push(bookAddress);
        publisherBooks[msg.sender].push(bookAddress);
        bookInfo[bookAddress] = BookInfo({
            name: bookName,
            symbol: symbol,
            author: authorName,
            publisher: msg.sender,
            deployedAt: block.timestamp
        });
        
        // 转账给平台
        if (msg.value > 0) {
            payable(treasury).transfer(msg.value);
        }
        
        emit BookDeployed(bookAddress, msg.sender, bookName, symbol, authorName);
        
        return bookAddress;
    }

    /**
     * @dev 获取所有已部署书籍数量
     */
    function totalBooks() external view returns (uint256) {
        return deployedBooks.length;
    }

    /**
     * @dev 获取出版社部署的书籍列表
     */
    function getPublisherBooks(address publisher) external view returns (address[] memory) {
        return publisherBooks[publisher];
    }

    /**
     * @dev 获取书籍销量（调用书籍合约的 totalSales）
     */
    function getBookSales(address bookContract) external view returns (uint256) {
        return QuickNFT(bookContract).totalSales();
    }

    // ========== 管理函数 ==========
    
    /**
     * @dev 更新部署费用（仅平台方）
     */
    function updateDeployFee(uint256 newFee) external {
        require(msg.sender == treasury, "Only treasury");
        emit DeployFeeUpdated(deployFee, newFee);
        deployFee = newFee;
    }

    /**
     * @dev 更新收款地址（仅当前收款方）
     */
    function updateTreasury(address newTreasury) external {
        require(msg.sender == treasury, "Only treasury");
        require(newTreasury != address(0), "Invalid address");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }
}
