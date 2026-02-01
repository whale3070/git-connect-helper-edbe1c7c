import redis
import random

# 模拟一些城市及经纬度数据
CITIES = [
    ("New York", "USA", 40.7128, -74.0060),
    ("Los Angeles", "USA", 34.0522, -118.2437),
    ("London", "UK", 51.5074, -0.1278),
    ("Paris", "FR", 48.8566, 2.3522),
    ("Berlin", "DE", 52.5200, 13.4050),
    ("Tokyo", "JP", 35.6895, 139.6917),
    ("Beijing", "CN", 39.9042, 116.4074),
    ("Sydney", "AU", -33.8688, 151.2093),
    ("Moscow", "RU", 55.7558, 37.6173),
    ("Toronto", "CA", 43.6511, -79.3831),
    ("Singapore", "SG", 1.3521, 103.8198),
]

def main():
    try:
        r = redis.Redis(host='127.0.0.1', port=6379, decode_responses=True)

        key_name = "vault:heatmap:locations"
        print(f"正在向 {key_name} 写入模拟扫码数据...")

        # 模拟每个城市 1~50 次扫码
        for city, country, lat, lon in CITIES:
            count = random.randint(1, 50)
            field = f"{city}_{country}"
            value = f"{lon},{lat},{count}"  # Golang 期望 "经度,纬度,计数"
            r.hset(key_name, field, value)

        total_cities = r.hlen(key_name)
        print(f"✅ 模拟扫码数据写入完成，Hash 中共有 {total_cities} 个城市记录。")

    except Exception as e:
        print(f"连接 Redis 失败: {e}")

if __name__ == "__main__":
    main()
