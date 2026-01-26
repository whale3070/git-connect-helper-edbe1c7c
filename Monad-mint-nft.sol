// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "erc721a/contracts/ERC721A.sol";

contract MonadSimpleMint is ERC721A {
    uint256 public constant MAX_SUPPLY = 10000;
    uint256 public constant MINT_PRICE = 0 ether; // 设置为免费，方便测试

    constructor() ERC721A("Monad Simple NFT", "MSN") {}

    // 极简 Mint 函数
    function mint(uint256 quantity) external payable {
        require(_totalMinted() + quantity <= MAX_SUPPLY, "Exceeds max supply");
        _safeMint(msg.sender, quantity);
    }

    // 覆盖 baseURI，返回空字符串表示不需要外部图片资料
    function _baseURI() internal view virtual override returns (string memory) {
        return "";
    }
}
