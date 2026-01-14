import requests
import redis
import datetime

# 配置
CONTRACT_ADDRESS = "0x705A0890bFDcD30eaf06b25b9D31a6C5C099100d"
URL = "https://moonbase.api.subscan.io/api/scan/evm/token/transfer"
API_KEY = "7d1022261e604156b41bf5ad404fb437" 

r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

def fetch_data():
    headers = {"Content-Type": "application/json", "x-api-key": API_KEY}
    payload = {"contract": CONTRACT_ADDRESS, "row": 100, "page": 0}

    print(f"--- 开始请求 Subscan API ---")
    response = requests.post(URL, json=payload, headers=headers)
    data = response.json()
    transfers = data['data'].get('list', [])
    print(f"API 返回记录总数: {len(transfers)}")

    daily_stats = {}
    
    for tx in transfers:
        # 根据 DEBUG 结果，字段名是 'create_at'
        ts = tx.get('create_at')
        
        if ts:
            ts_int = int(ts)
            # 转换为日期
            date_str = datetime.datetime.fromtimestamp(ts_int).strftime('%Y-%m-%d')
            daily_stats[date_str] = daily_stats.get(date_str, 0) + 1

    print(f"统计后的每日字典: {daily_stats}")

    if daily_stats:
        # 写入 Redis
        r.delete("whale_vault:daily_mints") # 先清理，确保数据纯净
        for date, count in daily_stats.items():
            r.hset("whale_vault:daily_mints", date, count)
        print(f"✅ 大功告成！已同步 {sum(daily_stats.values())} 条数据到 Redis")
    else:
        print("❌ 逻辑错误：字段存在但解析失败")
if __name__ == "__main__":
    fetch_data()