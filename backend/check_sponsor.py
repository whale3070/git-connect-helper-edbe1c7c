import subprocess
import json

def get_sponsor_info(contract_addr):
    cmd = [
        'curl', '-s', '-X', 'POST', 'https://evmtestnet.confluxrpc.com',
        '-H', 'Content-Type: application/json',
        '--data', json.dumps({
            "jsonrpc": "2.0",
            "method": "cfx_getSponsorInfo",
            "params": [contract_addr],
            "id": 1
        })
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

print("🔍 检查存储代付状态")
print("=" * 50)

contracts = [
    ("工厂合约", "0xb3B0138007523f0F7c8eB3c7caAFAaAbd65fd312"),
    ("子合约", "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84"),
    ("旧的子合约", "0x829324e27a5f5f17a03dd15ff08685349f79d11d")
]

for name, addr in contracts:
    print(f"\n{name}: {addr}")
    result = get_sponsor_info(addr)
    
    if 'result' in result:
        sponsor_info = result['result']
        print(f"  ✅ 存储代付信息:")
        print(f"     存储代付者: {sponsor_info.get('sponsorForCollateral', '未设置')}")
        print(f"     存储代付余额: {sponsor_info.get('sponsorBalanceForCollateral', '0')}")
        print(f"     Gas代付者: {sponsor_info.get('sponsorForGas', '未设置')}")
        print(f"     Gas代付余额: {sponsor_info.get('sponsorBalanceForGas', '0')}")
    else:
        print(f"  ❌ 无法获取存储代付信息或未设置")
        if 'error' in result:
            print(f"     错误: {result['error']}")

print("\n" + "=" * 50)
