#!/bin/bash
# tell_me_publisher.sh

echo "=== 查询出版社激活码 ==="
echo ""

# 获取所有出版社地址
echo "1. 所有出版社地址:"
redis-cli SMEMBERS vault:roles:publishers
echo ""

# 获取所有作者地址
echo "2. 所有作者地址:"
redis-cli SMEMBERS vault:roles:authors
echo ""

# 获取所有有效的激活码
echo "3. 所有有效激活码:"
redis-cli SMEMBERS vault:codes:valid
echo ""

# 检查每个激活码绑定
echo "4. 激活码绑定关系:"
echo "----------------------------------------"

# 使用更兼容的语法
redis-cli --raw KEYS "vault:bind:*" 2>/dev/null | while read -r key; do
  if [ -z "$key" ]; then
    continue
  fi
  
  # 提取激活码（去掉前缀）
  code=$(echo "$key" | sed 's/^vault:bind://')
  
  # 获取绑定的地址
  addr=$(redis-cli HGET "$key" address 2>/dev/null)
  
  if [ -n "$addr" ]; then
    # 检查是否是出版社地址
    is_publisher=$(redis-cli SISMEMBER vault:roles:publishers "$addr" 2>/dev/null)
    
    # 检查是否是作者地址
    is_author=$(redis-cli SISMEMBER vault:roles:authors "$addr" 2>/dev/null)
    
    role="读者"
    if [ "$is_publisher" = "1" ]; then
      role="出版社"
    elif [ "$is_author" = "1" ]; then
      role="作者"
    fi
    
    echo "激活码: $code"
    echo "绑定的地址: $addr"
    echo "角色: $role"
    echo "----------------------------------------"
  fi
done

echo ""
echo "=== 查询完成 ==="
