from web3 import Web3

# Moonbase Alpha RPC
w3 = Web3(Web3.HTTPProvider('https://rpc.api.moonbase.moonbeam.network'))

# 你的 NFT 合约地址
contract_address = "0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d"

# ERC-721 Transfer 事件的 Topic0
# keccak256("Transfer(address,address,uint256)")
transfer_topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

def fetch_mints_via_rpc():
    # 过滤从零地址发出的 Transfer 事件 (即 Mint)
    logs = w3.eth.get_logs({
        "fromBlock": 0,
        "toBlock": 'latest',
        "address": contract_address,
        "topics": [
            transfer_topic,
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        ]
    })
    
    print(f"Total Mints found: {len(logs)}")
    # 然后根据区块时间统计每日数量...
