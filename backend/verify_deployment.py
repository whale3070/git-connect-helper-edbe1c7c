import subprocess
import json

def run_cast(cmd):
    try:
        result = subprocess.run(["cast"] + cmd, capture_output=True, text=True)
        return result.stdout.strip()
    except Exception as e:
        return str(e)

# 合约地址
factory_addr = "0xb3B0138007523f0F7c8eB3c7caAFAaAbd65fd312"
book_addr = "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84"
reader_addr = "0x5ad82ceb0a10153c06f1215b70d0a5db97ad9240"
rpc_url = "https://evmtestnet.confluxrpc.com"

print("🔍 验证合约部署状态")
print("=" * 50)

# 1. 检查工厂合约
print("1. 工厂合约检查:")
print(f"   地址: {factory_addr}")
code = run_cast(["code", factory_addr, "--rpc-url", rpc_url])
print(f"   代码长度: {len(code)} 字符")

# 2. 检查子合约
print("\n2. 子合约检查:")
print(f"   地址: {book_addr}")
code = run_cast(["code", book_addr, "--rpc-url", rpc_url])
print(f"   代码长度: {len(code)} 字符")

# 3. 检查合约信息
print("\n3. 合约信息:")
author = run_cast(["call", book_addr, "authorName()(string)", "--rpc-url", rpc_url])
symbol = run_cast(["call", book_addr, "symbol()(string)", "--rpc-url", rpc_url])
owner = run_cast(["call", book_addr, "owner()(address)", "--rpc-url", rpc_url])
print(f"   作者: {author}")
print(f"   符号: {symbol}")
print(f"   所有者: {owner}")

# 4. 测试铸造
print("\n4. 铸造测试:")
balance = run_cast(["call", book_addr, "balanceOf(address)(uint256)", reader_addr, "--rpc-url", rpc_url])
print(f"   读者 {reader_addr[:10]}... 当前余额: {balance}")

# 5. 存储代付检查
print("\n5. 存储代付状态:")
try:
    result = subprocess.run([
        "curl", "-s", "-X", "POST", rpc_url,
        "-H", "Content-Type: application/json",
        "--data", '{"jsonrpc":"2.0","method":"cfx_getSponsorInfo","params":["' + book_addr + '"],"id":1}'
    ], capture_output=True, text=True)
    sponsor_info = json.loads(result.stdout)
    if "result" in sponsor_info:
        print("   ✅ 存储代付已设置")
    else:
        print("   ⚠️  存储代付未设置或检查失败")
except:
    print("   ⚠️  无法检查存储代付状态")

print("\n" + "=" * 50)
print("✅ 验证完成!")
