import redis
import time
from web3 import Web3

# Moonbase Alpha 节点
RPC_URL = "https://rpc.api.moonbase.moonbeam.network"
w3 = Web3(Web3.HTTPProvider(RPC_URL))

CONTRACT_ADDRESS = "0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
ZERO_ADDRESS_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000"

r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

def sync_mints():
    if not w3.is_connected():
        print("Error: 无法连接到 Moonbase 节点")
        return

    print(f"正在扫描合约: {CONTRACT_ADDRESS}")
    
    # 尝试分段查询或从一个最近的已知区块开始（Moonbase Alpha 当前区块很高）
    # 如果 0 不行，我们可以尝试获取最近的 10000 个区块，或者直接指定一个大概的起始块
    try:
        logs = w3.eth.get_logs({
            "fromBlock": 0, # 如果这里报错，可以试着改成 5000000
            "toBlock": 'latest',
            "address": Web3.to_checksum_address(CONTRACT_ADDRESS),
            "topics": [TRANSFER_TOPIC, ZERO_ADDRESS_TOPIC]
        })
    except Exception as e:
        print(f"查询日志失败: {e}")
        return

    print(f"抓取到的日志数量: {len(logs)}")

    daily_stats = {}
    for log in logs:
        block = w3.eth.get_block(log['blockNumber'])
        timestamp = block['timestamp']
        date_str = time.strftime('%Y-%m-%d', time.localtime(timestamp))
        daily_stats[date_str] = daily_stats.get(date_str, 0) + 1
        print(f"找到记录: {date_str}")

    # 写入 Redis
    if daily_stats:
        for date, count in daily_stats.items():
            r.hset("whale_vault:daily_mints", date, count)
        print("✅ Redis 数据已更新")
    else:
        print("❌ 未找到任何符合条件的 Mint 记录")

if __name__ == "__main__":
    sync_mints()
