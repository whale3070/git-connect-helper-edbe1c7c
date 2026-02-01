import requests
import redis
import time
import subprocess
import json
import os

# --- 自动加载配置 (理智版) ---
def load_env_port():
    """尝试从环境变量或 .env 读取端口，默认为 9090"""
    # 优先读取系统环境变量
    port = os.getenv("PORT")
    if not port:
        # 如果没有系统变量，尝试读取上级目录的 env.txt 
        try:
            with open("../env.txt", "r") as f:
                for line in f:
                    if line.startswith("PORT="):
                        return line.split("=")[1].strip()
        except:
            pass
    return port if port else "9090" # 最终回退到 9090

# --- 配置区 ---
PORT = load_env_port()
REDIS_CONF = {'host': '127.0.0.1', 'port': 6379, 'db': 0, 'decode_responses': True}
BACKEND_URL = f"http://127.0.0.1:{PORT}" # 动态端口
RPC_URL = "https://evmtestnet.confluxrpc.com" 
NFT_CONTRACT = "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84"
#0x829324e27a5f5f17a03dd15ff08685349f79d11d" # 你的子合约 

def rpc_call(method, params):
    """直接调用RPC方法"""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }
    response = requests.post(RPC_URL, json=payload)
    return response.json()

def call_contract_function(to_address, data):
    """调用合约函数，使用eth_call"""
    params = [{
        "to": to_address,
        "data": data
    }, "latest"]
    result = rpc_call("eth_call", params)
    return result.get('result')

def get_transaction_receipt(tx_hash):
    """获取交易收据"""
    params = [tx_hash]
    result = rpc_call("eth_getTransactionReceipt", params)
    return result.get('result')

def wait_for_transaction(tx_hash, timeout=30):
    """等待交易确认"""
    start_time = time.time()
    while time.time() - start_time < timeout:
        receipt = get_transaction_receipt(tx_hash)
        if receipt is not None:
            return receipt
        time.sleep(3)
    return None

def check_receipt_status(receipt):
    """检查交易收据状态"""
    # Conflux eSpace 交易收据中，status 字段为 '0x1' 表示成功
    status = receipt.get('status', '0x0')
    return status == '0x1'

def get_balance_of(address):
    """获取指定地址的NFT余额"""
    # balanceOf(address) 的函数选择器为 0x70a08231
    # 参数为地址，需要左对齐补0到32字节
    data = "0x70a08231" + address[2:].rjust(64, '0')
    result = call_contract_function(NFT_CONTRACT, data)
    if result is None:
        return 0
    # 将十六进制结果转换为十进制整数
    return int(result, 16)

def auto_test_vault_protocol():
    r = redis.Redis(**REDIS_CONF)
    
    print(f"🚀 测试启动 | 目标后端: {BACKEND_URL}")
    print("🔍 正在从【有效读者池】提取可用码...")
    valid_hashes = r.smembers("vault:codes:valid") # 检查有效池
    
    if not valid_hashes:
        print("❌ 错误：有效池为空。请确认 Redis 数据已生成。")
        return

    # 获取一个待测试的有效码
    code_hash = list(valid_hashes)[0]
    bind_data = r.hgetall(f"vault:bind:{code_hash}")
    dest_address = bind_data.get('address')
    
    if not dest_address:
        print(f"❌ 错误：无法找到 Hash {code_hash} 绑定的地址。")
        return

    print(f"✅ 捕获有效目标:\n   Hash: {code_hash}\n   Addr: {dest_address}")

    # --- 步骤 1: 获取绑定关系 ---
    print("\n📡 [步骤 1] 模拟 /secret/get-binding...")
    resp_bind = requests.get(f"{BACKEND_URL}/secret/get-binding", params={"codeHash": code_hash})
    print(f"   响应: {resp_bind.json()}")

    # --- 步骤 2: 提交代付铸造 ---
    print("\n⚡ [步骤 2] 发起代付 Gas 铸造请求...")
    start_time = time.time()
    # 注意：这里会触发后端修改后的 mintToReader(address) 逻辑
    resp_mint = requests.post(f"{BACKEND_URL}/relay/mint", json={
        "address": dest_address,
        "codeHash": code_hash 
    })
    
    if resp_mint.status_code == 200:
        tx_hash = resp_mint.json().get('txHash')
        print(f"   🚀 请求已提交! TXID: {tx_hash} | 耗时: {round(time.time()-start_time, 2)}s")
        
        print(f"   ⏳ 正在等待链上确认...")
        
        # 等待交易确认
        receipt = wait_for_transaction(tx_hash)
        if receipt is None:
            print("   ⚠️  交易未确认，请稍后检查")
        else:
            if check_receipt_status(receipt):
                print("   ✅ 链上确认：Transaction Success! (代付已生效)")
            else:
                print("   ❌ 链上确认：Transaction Failed! 请检查后端 mint.go 的编码逻辑。")

        # 验证 NFT 余额
        balance = get_balance_of(dest_address)
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
