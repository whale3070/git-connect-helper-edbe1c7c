// 在 QuickNFT.sol 中修改构造函数如下：
    constructor(
        string memory name_,
        string memory symbol_,
        string memory author_,
        address publisher_,
        string memory baseURI_,
        address relayer_ // 新增 Relayer 参数
    ) ERC721A(name_, symbol_) {
        author = author_; 
        publisher = publisher_; [cite: 9]
        _baseTokenURI = baseURI_; [cite: 9]
        
        // 在构造阶段直接完成初始授权，避开 onlyPublisher 检查
        if (relayer_ != address(0)) {
            authorizedRelayers[relayer_] = true;
            emit RelayerAuthorizationChanged(relayer_, true); [cite: 10]
        }
    }
