import requests
import redis
import datetime
import json

# 配置
CONTRACT_ADDRESS = "0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d"
SUBSCAN_API_URL = "https://moonbase.api.subscan.io/api/scan/evm/token/transfer"
# 注意：即使没有 Key，也要传一个空的或尝试申请。如果没 Key，尝试保持 headers 简单
API_KEY = "YOUR_API_KEY_HERE" 

r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

def fetch_daily_mint():
    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY
    }
    
    # 构造标准请求载荷
    payload = {
        "contract": CONTRACT_ADDRESS.lower(), # 尝试全小写以匹配 Subscan 索引
        "from": "0x0000000000000000000000000000000000000000",
        "page": 0,
        "row": 100
    }

    try:
        response = requests.post(SUBSCAN_API_URL, json=payload, headers=headers)
        
        # 即使报错，我们也打印出返回的详细信息
        if response.status_code != 200:
            print(f"Error Code: {response.status_code}")
            print(f"Server Message: {response.text}")
            return

        result = response.json()
        
        # 处理业务逻辑错误
        if result.get('code') != 0:
            print(f"Subscan Business Error: {result.get('message')}")
            return

        transfers = result['data'].get('list', [])
        if not transfers:
            print("No transfers found. (可能尚未产生 Mint 记录或参数过滤太严)")
            return

        # 统计逻辑
        daily_stats = {}
        for tx in transfers:
            date_str = datetime.datetime.fromtimestamp(tx['created_at']).strftime('%Y-%m-%d')
            daily_stats[date_str] = daily_stats.get(date_str, 0) + 1

        # 写入 Redis
        for date, count in daily_stats.items():
            r.hset("whale_vault:daily_mints", date, count)
            
        print(f"Done! 成功更新了 {len(daily_stats)} 天的数据。")

    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    fetch_daily_mint()
