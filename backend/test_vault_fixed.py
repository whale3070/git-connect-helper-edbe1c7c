import requests
import redis
import time
import subprocess
import json
import os

# --- 自动加载配置 (理智版) ---
def load_env_port():
    """尝试从环境变量或 .env 读取端口，默认为 9090"""
    port = os.getenv("PORT")
    if not port:
        try:
            with open("../env.txt", "r") as f:
                for line in f:
                    if line.startswith("PORT="):
                        return line.split("=")[1].strip()
        except:
            pass
    return port if port else "9090"

# --- 配置区 ---
PORT = load_env_port()
REDIS_CONF = {'host': '127.0.0.1', 'port': 6379, 'db': 0, 'decode_responses': True}
BACKEND_URL = f"http://127.0.0.1:{PORT}"
RPC_URL = "https://evmtestnet.confluxrpc.com"
NFT_CONTRACT = "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84"  # 新的子合约

def run_cast_command(cmd_list):
    try:
        result = subprocess.run(cmd_list, capture_output=True, text=True)
        return result.stdout.strip()
    except Exception as e:
        return f"Error: {str(e)}"

def find_valid_code_without_nft():
    r = redis.Redis(**REDIS_CONF)
    valid_hashes = r.smembers("vault:codes:valid")
    
    for code_hash in valid_hashes:
        bind_data = r.hgetall(f"vault:bind:{code_hash}")
        address = bind_data.get('address')
        if address:
            # 检查该地址的NFT余额
            balance = run_cast_command(["cast", "call", NFT_CONTRACT, "balanceOf(address)(uint256)", address, "--rpc-url", RPC_URL])
            if balance.isdigit() and int(balance) == 0:
                return code_hash, address
    return None, None

def auto_test_vault_protocol():
    r = redis.Redis(**REDIS_CONF)
    
    print(f"🚀 测试启动 | 目标后端: {BACKEND_URL}")
    print("🔍 正在查找有效且未铸造NFT的激活码...")
    
    code_hash, dest_address = find_valid_code_without_nft()
    
    if not code_hash or not dest_address:
        print("❌ 没有找到可用的激活码（所有绑定地址都已拥有NFT）。")
        return

    print(f"✅ 找到可用目标:\n   Hash: {code_hash}\n   Addr: {dest_address}")

    # --- 步骤 1: 获取绑定关系 ---
    print("\n📡 [步骤 1] 模拟 /secret/get-binding...")
    resp_bind = requests.get(f"{BACKEND_URL}/secret/get-binding", params={"codeHash": code_hash})
    print(f"   响应: {resp_bind.json()}")

    # --- 步骤 2: 提交代付铸造 ---
    print("\n⚡ [步骤 2] 发起代付 Gas 铸造请求...")
    start_time = time.time()
    resp_mint = requests.post(f"{BACKEND_URL}/relay/mint", json={
        "address": dest_address,
        "codeHash": code_hash 
    })
    
    if resp_mint.status_code == 200:
        tx_hash = resp_mint.json().get('txHash')
        print(f"   🚀 请求已提交! TXID: {tx_hash} | 耗时: {round(time.time()-start_time, 2)}s")
        
        print(f"   ⏳ 正在通过本地 cast 查询链上状态...")
        time.sleep(2) 
        
        # 1. 验证交易收据状态 (status: 1 代表成功)
        receipt = run_cast_command(["cast", "receipt", tx_hash, "--rpc-url", RPC_URL])
        if "status: 1" in receipt or "status: 0x1" in receipt:
            print("   ✅ 链上确认：Transaction Success! (代付已生效)")
        else:
            print("   ❌ 链上确认：Transaction Failed! 请检查后端 mint.go 的编码逻辑。")

        # 2. 验证 NFT 余额
        balance = run_cast_command(["cast", "call", NFT_CONTRACT, "balanceOf(address)(uint256)", dest_address, "--rpc-url", RPC_URL])
        print(f"   📊 读者 NFT 实时持仓: {balance}")
        
    else:
        print(f"   ❌ 后端拒绝请求: {resp_mint.text}")

    # --- 步骤 3: 最终身份核验 ---
    print("\n🛡️ [步骤 3] 模拟身份核验 (Status Verify)...")
    resp_verify = requests.get(f"{BACKEND_URL}/secret/verify", params={
        "codeHash": code_hash,
        "address": dest_address
    })
    print(f"   最终业务状态: {resp_verify.json()}")

if __name__ == "__main__":
    auto_test_vault_protocol()
