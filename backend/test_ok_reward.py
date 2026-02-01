import redis
import random
import requests
import os
import json

# ---------------- 配置 ----------------
REDIS_CONF = {
    "host": "127.0.0.1",
    "port": 6379,
    "decode_responses": True,
}

PORT = os.getenv("PORT", "8080")
BACKEND_URL = f"http://127.0.0.1:{PORT}"

# 👉 指定一个“推荐奖励收货方钱包”（推荐人）
REFERRER_WALLET = "0x5E8de2503881a49ed4db721E4fbAfc106C3782E6".lower()

# 👉 被推荐的新用户钱包（可以是前端传进来的）
RECIPIENT_WALLET = "0x1111111111111111111111111111111111111111"

# -------------------------------------

r = redis.Redis(**REDIS_CONF)


def find_hashcodes_owned_by(address: str) -> set:
    """
    找出某个钱包地址自己绑定过的所有 hashcode
    """
    owned = set()
    for key in r.scan_iter("vault:bind:*"):
        data = r.hgetall(key)
        if data.get("address", "").lower() == address.lower():
            owned.add(key.split("vault:bind:")[1])
    return owned


def main():
    print("🚀 推荐奖励自动测试启动")
    print(f"🎯 推荐人钱包: {REFERRER_WALLET}")

    # 1️⃣ 全部有效 hashcode
    all_codes = set(r.smembers("vault:codes:valid"))
    if len(all_codes) < 5:
        print("❌ 有效 hashcode 数量不足 5 个")
        return

    # 2️⃣ 找出推荐人“自己的” hashcode
    self_codes = find_hashcodes_owned_by(REFERRER_WALLET)

    print(f"🔍 推荐人自己绑定的 hashcode 数: {len(self_codes)}")

    # 3️⃣ 可用 hashcode = 全部 - 自己的
    available_codes = list(all_codes - self_codes)

    if len(available_codes) < 5:
        print("❌ 排除自身后，可用 hashcode 不足 5 个")
        return

    # 4️⃣ 随机抽 5 个
    selected_codes = random.sample(available_codes, 5)

    print("✅ 本次选用的 5 个 hashcode:")
    for c in selected_codes:
        print("   -", c)

    # 5️⃣ 调用后端奖励接口
    payload = {
        "referrer": REFERRER_WALLET,
        "recipient": RECIPIENT_WALLET,
        "codes": selected_codes
    }

    print("\n📡 调用后端 /relay/reward ...")
    resp = requests.post(
        f"{BACKEND_URL}/relay/reward",
        json=payload,
        timeout=15
    )

    try:
        result = resp.json()
    except Exception:
        print("❌ 后端返回非 JSON:")
        print(resp.text)
        return

    print("\n📦 后端响应:")
    print(json.dumps(result, indent=2, ensure_ascii=False))

    if resp.status_code == 200:
        print("\n🎉 推荐奖励流程测试完成")
    else:
        print("\n⚠️ 推荐奖励失败，请检查后端日志")


if __name__ == "__main__":
    main()
