import redis

REDIS_HOST = "127.0.0.1"
REDIS_PORT = 6379   # 你的 redis-stack
REDIS_DB = 0

r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    decode_responses=True
)

def main():
    try:
        # 如果索引已存在会报错，我们捕获即可
        r.execute_command(
            "FT.CREATE", "idx:books",
            "ON", "HASH",
            "PREFIX", "1", "vault:book:meta:",
            "SCHEMA",
            "publisher", "TAG", "SEPARATOR", ",",
            "symbol", "TAG", "SEPARATOR", ",",
            "serial", "TAG", "SEPARATOR", ",",
            "name", "TEXT", "WEIGHT", "5.0",
            "author", "TEXT", "WEIGHT", "2.0",
            "createdAt", "NUMERIC", "SORTABLE"
        )
        print("✅ RediSearch 索引 idx:books 创建成功")
    except Exception as e:
        if "Index already exists" in str(e):
            print("ℹ️ 索引 idx:books 已存在，无需重复创建")
        else:
            print("❌ 创建索引失败：", e)

if __name__ == "__main__":
    main()
