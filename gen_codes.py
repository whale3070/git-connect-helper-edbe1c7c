import redis
import hashlib
import secrets
import os

# 配置 Redis 连接
r = redis.Redis(host='localhost', port=6379, decode_responses=True)

def generate_codes(count=100):
    codes_data = []
    
    print(f"正在生成 {count} 个兑换码...")
    
    for _ in range(count):
        # 生成一个随机的原始码（例如：WV-A7B2-9F3E）
        raw_code = f"WV-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
        
        # 计算 SHA-256 Hash (前端 MintConfirm 也会做同样的操作)
        code_hash = hashlib.sha256(raw_code.encode()).hexdigest()
        
        codes_data.append((raw_code, code_hash))
    
    # 1. 写入 Redis 集合 (对应你 main.go 中的 vault:codes:valid)
    pipe = r.pipeline()
    for _, h in codes_data:
        pipe.sadd("vault:codes:valid", h)
    pipe.execute()
    
    # 2. 保存为 TXT 文件方便测试
    with open("test_codes.txt", "w") as f:
        f.write("原始兑换码 (用于浏览器测试) | 对应的 SHA-256 Hash (已存入 Redis)\n")
        f.write("-" * 80 + "\n")
        for c, h in codes_data:
            f.write(f"{c} | {h}\n")
            
    print(f"成功！已将 100 个 Hash 写入 Redis 集合 'vault:codes:valid'")
    print(f"生成的测试清单已保存至: {os.path.abspath('test_codes.txt')}")

if __name__ == "__main__":
    generate_codes()
