import redis
import os
import argparse

# --- 配置区 ---
REDIS_CONF = {
    'host': '127.0.0.1',
    'port': 6379,
    'db': 0,
    'decode_responses': True
}

def get_redis_client():
    host = os.getenv("REDIS_HOST", "127.0.0.1")
    port = int(os.getenv("REDIS_PORT", "6379"))
    password = os.getenv("REDIS_PASSWORD", "")
    db = int(os.getenv("REDIS_DB", "0"))

    return redis.Redis(
        host=host,
        port=port,
        password=password or None,
        db=db,
        decode_responses=True
    )

def fetch_all_vault_codes():
    try:
        r = get_redis_client()
        r.ping()
    except Exception as e:
        print(f"❌ 无法连接到 Redis: {e}")
        return

    # 1. 🌟 定义所有角色集合及其展示标签
    role_sets = {
        "READER": "vault:codes:valid",
        "AUTHOR": "vault:roles:authors_codes",
        "PUBLISHER": "vault:roles:publishers_codes"
    }

    found_any = False
    print(f"✅ Whale Vault 金库全角色码查询结果：")
    print("=" * 85)
    print(f"{'ROLE':<12} | {'HASH (用于前端输入)':<45} | {'ADDRESS'}")
    print("-" * 85)

    for role_label, set_key in role_sets.items():
        # 获取该角色集合下的所有 Hash
        codes = r.smembers(set_key)
        
        if not codes:
            continue
        
        found_any = True
        for code_hash in codes:
            # 2. 联动查询 Hash 详情
            target_key = f"vault:bind:{code_hash}"
            bind_data = r.hgetall(target_key)
            
            # 优先从 hset 的 role 字段读取，如果旧数据没有则用集合标签
            current_role = bind_data.get('role', role_label).upper()
            address = bind_data.get('address', 'Unknown')
            
            print(f"{current_role:<12} | {code_hash:<45} | {address}")
    
    if not found_any:
        print("📭 Redis 中没有任何有效码。")
        print("💡 请运行 generate_vault_data01-27.py 重新初始化。")
    
    print("-" * 85)
    print("🚀 提示：复制对应角色的 Hash 到前端，即可模拟该身份进行【金库协议】交互。")

if __name__ == "__main__":
    fetch_all_vault_codes()
