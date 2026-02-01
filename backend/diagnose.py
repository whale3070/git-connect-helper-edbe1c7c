import redis
import subprocess
import json

REDIS_CONF = {'host': '127.0.0.1', 'port': 6379, 'db': 0, 'decode_responses': True}
RPC_URL = "https://evmtestnet.confluxrpc.com"
CONTRACT = "0x829324e27a5f5f17a03dd15ff08685349f79d11d"

def run_cast(cmd):
    try:
        result = subprocess.run(["cast"] + cmd, capture_output=True, text=True)
        return result.stdout.strip()
    except Exception as e:
        return str(e)

def diagnose():
    r = redis.Redis(**REDIS_CONF)
    
    print("🔍 诊断开始...")
    
    # 1. 检查有效池
    valid = r.smembers("vault:codes:valid")
    print(f"有效池数量: {len(valid)}")
    
    for code in list(valid)[:3]:
        bind = r.hgetall(f"vault:bind:{code}")
        print(f"  激活码 {code[:16]}... -> 地址: {bind.get('address')}")
        
        # 检查该地址是否已有NFT
        if addr := bind.get('address'):
            balance = run_cast(["call", CONTRACT, "balanceOf(address)(uint256)", addr, "--rpc-url", RPC_URL])
            print(f"     NFT余额: {balance}")
    
    # 2. 检查合约状态
    print(f"\n📊 合约 {CONTRACT} 状态:")
    
    # 检查合约所有者
    owner = run_cast(["call", CONTRACT, "owner()(address)", "--rpc-url", RPC_URL])
    print(f"  合约所有者: {owner}")
    
    # 检查总供应量
    total = run_cast(["call", CONTRACT, "totalSupply()(uint256)", "--rpc-url", RPC_URL])
    print(f"  总供应量: {total}")
    
    # 检查Relayer余额
    relayer = "0x5E8de2503881a49ed4db721E4fbAfc106C3782E6"
    balance = run_cast(["balance", relayer, "--rpc-url", RPC_URL])
    print(f"\n💰 Relayer余额: {balance} CFX")
    
    # 检查合约余额
    contract_balance = run_cast(["balance", CONTRACT, "--rpc-url", RPC_URL])
    print(f"📦 合约余额: {contract_balance} CFX (用于存储代付)")

if __name__ == "__main__":
    diagnose()	

