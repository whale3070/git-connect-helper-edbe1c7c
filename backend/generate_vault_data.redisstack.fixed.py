import redis
import secrets
from eth_account import Account
import json

# 配置 Redis (支持 redis-stack)
import os
import argparse

def get_redis_client():
    host = os.getenv("REDIS_HOST", "127.0.0.1")
    port = int(os.getenv("REDIS_PORT", "6380"))  # redis-stack default (docker mapped)
    password = os.getenv("REDIS_PASSWORD", "")
    db = int(os.getenv("REDIS_DB", "0"))

    return redis.Redis(host=host, port=port, password=password or None, db=db, decode_responses=True)

r = get_redis_client()

def generate_vault_entry(role_type):
    """
    生成单组数据：包括一个 HashCode 和一个绑定的钱包
    role_type: 'reader', 'author', 'publisher'
    """
    # 1. 生成唯一码 (视觉无差别的 64 位十六进制字符串)
    code_hash = secrets.token_hex(32)
    
    # 2. 生成配套的临时钱包 (一书一码一钱包)
    # 启用未经审核的私钥生成警告消除
    Account.enable_unaudited_hdwallet_features()
    acct = Account.create()
    address = acct.address
    private_key = acct.key.hex()

    # 3. 建立物理映射 (Hash 结构)，用于后端 get-binding 接口反查地址
    # 显式存入 role 字段，解决 test_ok2.py 显示 Unknown 的问题
    r.hset(f"vault:bind:{code_hash}", mapping={
        "address": address,
        "private_key": private_key,
        "role": role_type
    })

    # 4. 根据角色分类存入不同的 Redis 集合 (用于后端身份校验)
    if role_type == 'reader':
        r.sadd("vault:codes:valid", code_hash)
    elif role_type == 'author':
        r.sadd("vault:roles:authors_codes", code_hash)
    elif role_type == 'publisher':
        r.sadd("vault:roles:publishers_codes", code_hash)

    return code_hash, address

def main():
    parser = argparse.ArgumentParser(description="Generate vault seed data into Redis / RedisStack")
    parser.add_argument("--host", default=os.getenv("REDIS_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("REDIS_PORT", "6380")))
    parser.add_argument("--password", default=os.getenv("REDIS_PASSWORD", ""))
    parser.add_argument("--db", type=int, default=int(os.getenv("REDIS_DB", "0")))
    args = parser.parse_args()

    global r
    r = redis.Redis(host=args.host, port=args.port, password=args.password or None, db=args.db, decode_responses=True)

    print("🚀 开始初始化 Whale Vault 多身份金库数据...")

    # 如果需要干净的环境，可以取消下面这一行的注释
    # r.flushdb() 
    # print("🧹 Redis 数据已清理")

    # --- 生成 10 组读者码 ---
    print("\n[读者码生成中...]")
    for _ in range(10):
        c, a = generate_vault_entry('reader')
        print(f"Reader    | Code: {c[:12]}... | Addr: {a}")

    # --- 生成 2 组作者码 ---
    print("\n[作者码生成中...]")
    for _ in range(2):
        c, a = generate_vault_entry('author')
        print(f"Author    | Code: {c[:12]}... | Addr: {a}")

    # --- 生成 1 组出版社码 ---
    print("\n[出版社码生成中...]")
    c, a = generate_vault_entry('publisher')
    print(f"Publisher | Code: {c[:12]}... | Addr: {a}")
    
    # 模拟白名单：将当前出版社测试地址加入白名单
    # 这里的地址可以换成你在 MetaMask 中实际控制的地址
    my_test_publisher_wallet = "0x7D1B42069d01269A95c29Cd5Eb7dA2787869A09B".lower()
    r.sadd("vault:roles:publishers", my_test_publisher_wallet)

    print("\n" + "="*50)
    print("✅ 所有身份码初始化完成！")
    print(f"📦 读者池 (Reader):    {r.scard('vault:codes:valid')} 个")
    print(f"✍️  作者池 (Author):    {r.scard('vault:roles:authors_codes')} 个")
    print(f"🏢 出版社 (Publisher): {r.scard('vault:roles:publishers_codes')} 个")
    print("="*50)
    print("提示: 现在运行 python3 test_ok2.py 即可看到对应的 ROLE。")

if __name__ == "__main__":
    main()
