// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./QuickNFT.sol";

/**
 * @title BookFactory
 * @dev 工厂合约 - 出版社通过此合约部署新书的 NFT 合约
 */
contract BookFactory {
    // 收款地址（平台方）
    address public treasury; [cite: 16]
    // 部署费用（单位：Wei）
    uint256 public deployFee; [cite: 17]
    
    // 所有已部署的书籍合约
    address[] public deployedBooks; [cite: 17]
    // 出版社地址 => 其部署的书籍合约列表
    mapping(address => address[]) public publisherBooks; [cite: 18]

    struct BookInfo {
        string name; [cite: 19]
        string symbol; [cite: 20]
        string author; [cite: 20]
        address publisher; [cite: 20]
        uint256 deployedAt; [cite: 20]
    }
    mapping(address => BookInfo) public bookInfo; [cite: 20]

    event BookDeployed(
        address indexed bookContract,
        address indexed publisher,
        string name,
        string symbol,
        string author
    ); [cite: 21]
    event DeployFeeUpdated(uint256 oldFee, uint256 newFee); [cite: 22]
    event TreasuryUpdated(address oldTreasury, address newTreasury); [cite: 22]

    constructor(address _treasury, uint256 _deployFee) {
        require(_treasury != address(0), "Invalid treasury address"); [cite: 23]
        treasury = _treasury; [cite: 24]
        deployFee = _deployFee; [cite: 24]
    }

    /**
     * @dev 部署新书 NFT 合约
     */
    function deployBook(
        string memory bookName,
        string memory symbol,
        string memory authorName,
        string memory baseURI,
        address relayer
    ) external payable returns (address) {
        require(msg.value >= deployFee, "Insufficient deploy fee"); [cite: 25]
        require(bytes(bookName).length > 0, "Book name required"); [cite: 26]
        require(bytes(symbol).length > 0, "Symbol required"); [cite: 26]

        // 【关键修改】直接在部署时传入 relayer 参数
        // 这样 QuickNFT 可以在构造函数里直接完成授权，不需要工厂后续调用
        QuickNFT newBook = new QuickNFT(
            bookName,
            symbol,
            authorName,
            msg.sender, // 出版社
            baseURI,
            relayer     // 新增参数
        ); [cite: 27]

        address bookAddress = address(newBook); [cite: 28]
        
        // 记录书籍信息
        deployedBooks.push(bookAddress); [cite: 29]
        publisherBooks[msg.sender].push(bookAddress); [cite: 30]
        bookInfo[bookAddress] = BookInfo({
            name: bookName,
            symbol: symbol,
            author: authorName,
            publisher: msg.sender,
            deployedAt: block.timestamp
        }); [cite: 30]

        // 转账给平台
        if (msg.value > 0) {
            (bool success, ) = payable(treasury).call{value: msg.value}(""); [cite: 31]
            require(success, "Transfer failed"); [cite: 32]
        }
        
        emit BookDeployed(bookAddress, msg.sender, bookName, symbol, authorName); [cite: 32]
        return bookAddress; [cite: 33]
    }

    function totalBooks() external view returns (uint256) {
        return deployedBooks.length; [cite: 33]
    }

    function getPublisherBooks(address publisher) external view returns (address[] memory) {
        return publisherBooks[publisher]; [cite: 34]
    }

    function getBookSales(address bookContract) external view returns (uint256) {
        return QuickNFT(bookContract).totalSales(); [cite: 35]
    }

    function updateDeployFee(uint256 newFee) external {
        require(msg.sender == treasury, "Only treasury"); [cite: 36]
        emit DeployFeeUpdated(deployFee, newFee); [cite: 37]
        deployFee = newFee; [cite: 37]
    }

    function updateTreasury(address newTreasury) external {
        require(msg.sender == treasury, "Only treasury"); [cite: 37]
        require(newTreasury != address(0), "Invalid address"); [cite: 38]
        emit TreasuryUpdated(treasury, newTreasury); [cite: 38]
        treasury = newTreasury; [cite: 39]
    }

    receive() external payable {} [cite: 39]
}
