import subprocess
import json

def run_cast(cmd):
    try:
        result = subprocess.run(["cast"] + cmd, capture_output=True, text=True)
        return result.stdout.strip()
    except Exception as e:
        return str(e)

# 存储代付合约的 ABI 片段
# function getPrivilege(address) public view returns (uint8)
print("🔍 检查合约存储代付状态")
print("=" * 50)

contracts = [
    ("工厂合约", "0xb3B0138007523f0F7c8eB3c7caAFAaAbd65fd312"),
    ("新子合约", "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84"),
    ("旧子合约", "0x829324e27a5f5f17a03dd15ff08685349f79d11d")
]

sponsor_contract = "0x0000000000000000000000000000000000000001"

for name, addr in contracts:
    print(f"\n{name}: {addr}")
    
    # 检查是否在白名单中
    result = run_cast(["call", sponsor_contract, "getPrivilege(address)(uint8)", addr, "--rpc-url", "https://evmtestnet.confluxrpc.com"])
    
    if result.isdigit():
        privilege = int(result)
        if privilege > 0:
            print(f"  ✅ 存储代付已设置 (权限级别: {privilege})")
        else:
            print(f"  ❌ 不在存储代付白名单中")
    else:
        print(f"  ❌ 查询失败: {result}")

print("\n" + "=" * 50)
