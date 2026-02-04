from flask import Flask, request, jsonify
from flask_cors import CORS
from web3 import Web3
from eth_account.messages import encode_defunct
import sqlite3
import os
import time
from datetime import datetime
from dotenv import load_dotenv
import logging
import traceback
import ssl
import urllib3

# 禁用SSL警告（可选，如果网络有问题）
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 加载环境变量
load_dotenv()

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('faucet_server.log')
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

# 配置 - Conflux eSpace Testnet
CONTRACT_ADDRESS = "0x6CD9AFBCfC6cE793A4Ed3293127735B47DDD842B"  # 新部署的合约地址
RELAY_SIGNER_PRIVATE_KEY = os.getenv('PRIVATE_KEY')
RELAY_SIGNER_ADDRESS = os.getenv('SIGNER_ADDRESS', '0xA6de493773af05e800753904E02262880B3186c9')
RELAYER_ADDRESS = os.getenv('RELAYER_ADDRESS', RELAY_SIGNER_ADDRESS)  # 中继者地址
AD_TOKEN = "demo_ad_ok"
CHAIN_ID = 71

# 验证私钥
if not RELAY_SIGNER_PRIVATE_KEY:
    logger.error("❌ PRIVATE_KEY not found!")
    raise ValueError("Please set PRIVATE_KEY in .env file")

# 初始化 Web3
w3 = Web3()

# 连接到Conflux eSpace Testnet
CONFLUX_RPC_URL = "https://evmtestnet.confluxrpc.com"

# 创建自定义HTTP适配器以跳过SSL验证
from web3.providers import HTTPProvider
import requests

class NoVerifyHTTPAdapter(requests.adapters.HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        # 跳过SSL验证
        kwargs['ssl_context'] = ssl.create_default_context()
        kwargs['ssl_context'].check_hostname = False
        kwargs['ssl_context'].verify_mode = ssl.CERT_NONE
        return super().init_poolmanager(*args, **kwargs)

# 创建自定义会话
session = requests.Session()
session.mount('https://', NoVerifyHTTPAdapter())

# 创建Web3提供者
w3_provider = Web3(HTTPProvider(CONFLUX_RPC_URL, session=session))

# 检查连接
try:
    if w3_provider.is_connected():
        chain_id = w3_provider.eth.chain_id
        logger.info(f"✅ Connected to Conflux eSpace Testnet (Chain ID: {chain_id})")
    else:
        logger.error("❌ Failed to connect to Conflux eSpace Testnet")
except Exception as e:
    logger.warning(f"⚠️ Connection check error (may be temporary): {e}")

# 合约ABI
FAUCET_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "_signer", "type": "address"},
            {"internalType": "address", "name": "_relayer", "type": "address"}
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "timestamp", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "nonce", "type": "uint256"}
        ],
        "name": "Claimed",
        "type": "event"
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": False, "internalType": "uint256", "name": "timestamp", "type": "uint256"},
            {"indexed": False, "internalType": "uint256", "name": "nonce", "type": "uint256"},
            {"indexed": True, "internalType": "address", "name": "relayer", "type": "address"}
        ],
        "name": "ClaimedViaRelay",
        "type": "event"
    },
    {
        "inputs": [],
        "name": "AMOUNT",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
        "name": "canClaim",
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "bytes", "name": "signature", "type": "bytes"},
            {"internalType": "uint256", "name": "nonce", "type": "uint256"},
            {"internalType": "uint256", "name": "deadline", "type": "uint256"}
        ],
        "name": "claim",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "user", "type": "address"},
            {"internalType": "bytes", "name": "signature", "type": "bytes"},
            {"internalType": "uint256", "name": "nonce", "type": "uint256"},
            {"internalType": "uint256", "name": "deadline", "type": "uint256"}
        ],
        "name": "claimViaRelay",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getBalance",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address", "name": "user", "type": "address"},
            {"internalType": "uint256", "name": "nonce", "type": "uint256"},
            {"internalType": "uint256", "name": "deadline", "type": "uint256"}
        ],
        "name": "getMessageHash",
        "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}],
        "stateMutability": "pure",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "lastClaim",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
        "name": "nextClaimTime",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{"internalType": "address", "name": "", "type": "address"}],
        "name": "nonces",
        "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "relayer",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "signer",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            {"internalType": "address payable", "name": "to", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"}
        ],
        "name": "withdraw",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "stateMutability": "payable",
        "type": "receive"
    }
]

# 数据库
def init_db():
    try:
        conn = sqlite3.connect('faucet.db', check_same_thread=False)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS claims (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                wallet_address TEXT NOT NULL UNIQUE,
                last_claim_timestamp INTEGER NOT NULL,
                claim_count INTEGER DEFAULT 1,
                tx_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        conn.commit()
        conn.close()
        logger.info("✅ Database initialized")
    except Exception as e:
        logger.error(f"❌ Database error: {e}")

init_db()

def get_connection():
    return sqlite3.connect('faucet.db', check_same_thread=False)

@app.route('/')
def home():
    return jsonify({
        "name": "Conflux eSpace Faucet API",
        "version": "1.0",
        "status": "running",
        "contract": CONTRACT_ADDRESS,
        "signer": RELAY_SIGNER_ADDRESS,
        "relayer": RELAYER_ADDRESS,
        "contract_balance_url": f"https://evmtestnet.confluxscan.io/address/{CONTRACT_ADDRESS}"
    })

@app.route('/health', methods=['GET'])
def health_check():
    # 检查合约余额
    contract_balance = 0
    contract_balance_cfx = "Unknown"
    
    try:
        if w3_provider.is_connected():
            contract = w3_provider.eth.contract(address=CONTRACT_ADDRESS, abi=FAUCET_ABI)
            contract_balance = contract.functions.getBalance().call()
            contract_balance_cfx = w3_provider.from_wei(contract_balance, 'ether')
    except Exception as e:
        logger.warning(f"Could not get contract balance: {e}")
    
    return jsonify({
        "status": "healthy",
        "timestamp": int(time.time()),
        "contract": CONTRACT_ADDRESS,
        "signer": RELAY_SIGNER_ADDRESS,
        "relayer": RELAYER_ADDRESS,
        "chain": "Conflux eSpace Testnet",
        "chain_id": CHAIN_ID,
        "contract_balance": str(contract_balance_cfx) + " CFX",
        "note": "Relay faucet - users pay no gas"
    })

@app.route('/verify-ad', methods=['POST', 'OPTIONS'])
def verify_ad():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
    
    logger.info(f"🔍 Verify-ad request from {request.remote_addr}")
    
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No data"}), 400
        
        wallet_address = data.get('wallet')
        ad_token = data.get('adToken')
        
        logger.info(f"Raw wallet address received: '{wallet_address}'")
        
        if not wallet_address:
            return jsonify({"success": False, "error": "No wallet address"}), 400
        
        if not ad_token:
            return jsonify({"success": False, "error": "No ad token"}), 400
        
        if ad_token != AD_TOKEN:
            return jsonify({"success": False, "error": "Invalid ad token"}), 400
        
        # 验证地址格式
        try:
            wallet_address = w3.to_checksum_address(wallet_address)
        except:
            # 手动验证
            if not wallet_address.startswith('0x') or len(wallet_address) != 42:
                return jsonify({"success": False, "error": "Invalid wallet address format"}), 400
            wallet_address = wallet_address.lower()
        
        logger.info(f"Processing address: {wallet_address}")
        
        # 检查24小时限制 - 首先从数据库检查
        conn = get_connection()
        c = conn.cursor()
        c.execute('SELECT last_claim_timestamp FROM claims WHERE wallet_address = ?', 
                 (wallet_address.lower(),))
        result = c.fetchone()
        conn.close()
        
        current_time = int(time.time())
        
        if result:
            last_claim = result[0]
            time_since_last_claim = current_time - last_claim
            
            if time_since_last_claim < 86400:
                hours_left = round((86400 - time_since_last_claim) / 3600, 2)
                return jsonify({
                    "success": False,
                    "error": f"Please wait {hours_left} hours",
                    "wait_time": 86400 - time_since_last_claim,
                    "next_claim": last_claim + 86400
                }), 429
        
        # 获取用户的nonce - 从数据库或默认0
        nonce = 0
        
        # 尝试从合约获取（如果连接正常）
        try:
            if w3_provider.is_connected():
                contract = w3_provider.eth.contract(address=CONTRACT_ADDRESS, abi=FAUCET_ABI)
                contract_nonce = contract.functions.nonces(wallet_address).call()
                nonce = contract_nonce
                logger.info(f"Got nonce from contract: {nonce}")
        except Exception as e:
            logger.warning(f"Could not get nonce from contract, using 0: {e}")
        
        # 设置deadline（1小时后过期）
        deadline = int(time.time()) + 3600
        
        # 生成签名消息: keccak256(abi.encodePacked(user, nonce, deadline))
        from eth_account import Account
        
        # 修复：使用solidityKeccak代替encode_abi
        # 在web3.py中，使用solidityKeccak来模拟Solidity的keccak256(abi.encodePacked(...))
        message_hash = w3.solidity_keccak(
            ['address', 'uint256', 'uint256'],
            [w3.to_checksum_address(wallet_address), nonce, deadline]
        )
        
        logger.info(f"Step 1 - Generated message hash: {message_hash.hex()}")
        logger.info(f"Parameters - Address: {wallet_address}, Nonce: {nonce}, Deadline: {deadline}")
        
        # 添加 Ethereum 签名前缀：\x19Ethereum Signed Message:\n32 + message_hash
        message = encode_defunct(message_hash)
        
        logger.info(f"Step 2 - Message to sign (with prefix): {message.body.hex()}")
        
        # 使用私钥签名
        account = Account.from_key(RELAY_SIGNER_PRIVATE_KEY)
        signed_message = account.sign_message(message)
        
        # 获取签名
        signature = signed_message.signature.hex()
        if not signature.startswith('0x'):
            signature = '0x' + signature
        
        logger.info(f"Step 3 - Generated signature (65 bytes): {signature}")
        logger.info(f"Signature length: {len(signature)} characters")
        logger.info(f"Nonce: {nonce}, Deadline: {deadline}")
        
        # 验证签名是否可以恢复
        recovered_address = account.address
        logger.info(f"Recovered address: {recovered_address}, Expected: {RELAY_SIGNER_ADDRESS}")
        
        # 保存记录到数据库（只保存时间戳，不标记为已领取）
        conn = get_connection()
        c = conn.cursor()
        
        c.execute('SELECT last_claim_timestamp FROM claims WHERE wallet_address = ?',
                 (wallet_address.lower(),))
        result = c.fetchone()
        
        if result:
            # 只更新时间戳但不增加claim_count，因为用户还没真正领取
            c.execute('UPDATE claims SET last_claim_timestamp = ? WHERE wallet_address = ?',
                     (current_time, wallet_address.lower()))
        else:
            c.execute('INSERT INTO claims (wallet_address, last_claim_timestamp, claim_count) VALUES (?, ?, 0)',
                     (wallet_address.lower(), current_time))
        
        conn.commit()
        conn.close()
        
        logger.info(f"✅ Signature generated for {wallet_address}")
        
        return jsonify({
            "success": True,
            "signature": signature,
            "wallet": wallet_address,
            "nonce": nonce,
            "deadline": deadline,
            "signer": RELAY_SIGNER_ADDRESS,
            "relayer": RELAYER_ADDRESS,
            "contract": CONTRACT_ADDRESS,
            "amount": "0.01",
            "currency": "CFX",
            "timestamp": current_time,
            "next_claim": current_time + 86400,
            "debug_info": {
                "message_hash": message_hash.hex(),
                "signature_length": len(signature),
                "signature_prefix": signature[:20] + "...",
                "nonce": nonce,
                "deadline": deadline
            }
        })
        
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/relay-claim', methods=['POST', 'OPTIONS'])
def relay_claim():
    if request.method == 'OPTIONS':
        return jsonify({"status": "ok"}), 200
    
    logger.info(f"🚀 Relay claim request from {request.remote_addr}")
    
    try:
        data = request.json
        if not data:
            return jsonify({"success": False, "error": "No data"}), 400
        
        wallet_address = data.get('wallet')
        signature = data.get('signature')
        nonce = data.get('nonce')
        deadline = data.get('deadline')
        
        if not all([wallet_address, signature, nonce is not None, deadline is not None]):
            return jsonify({"success": False, "error": "Missing required fields"}), 400
        
        # 验证地址格式
        try:
            wallet_address = w3.to_checksum_address(wallet_address)
        except:
            return jsonify({"success": False, "error": "Invalid wallet address"}), 400
        
        # 确保签名以0x开头
        if not signature.startswith('0x'):
            signature = '0x' + signature
        
        # 检查deadline是否过期
        current_time = int(time.time())
        if current_time > deadline:
            return jsonify({"success": False, "error": "Signature expired"}), 400
        
        # 检查nonce是否正确（从数据库或合约）
        try:
            # 从数据库检查
            conn = get_connection()
            c = conn.cursor()
            c.execute('SELECT claim_count FROM claims WHERE wallet_address = ?',
                     (wallet_address.lower(),))
            result = c.fetchone()
            conn.close()
            
            # 如果数据库中的claim_count > 0，说明已经领取过
            if result and result[0] > 0:
                # 检查是否在24小时内
                c.execute('SELECT last_claim_timestamp FROM claims WHERE wallet_address = ?',
                         (wallet_address.lower(),))
                timestamp_result = c.fetchone()
                if timestamp_result:
                    last_claim = timestamp_result[0]
                    if current_time - last_claim < 86400:
                        hours_left = round((86400 - (current_time - last_claim)) / 3600, 2)
                        return jsonify({
                            "success": False,
                            "error": f"Already claimed within 24 hours. Wait {hours_left} hours"
                        }), 429
        except Exception as e:
            logger.warning(f"Could not check database for nonce: {e}")
        
        # 构建交易 - 首先检查RPC连接
        if not w3_provider.is_connected():
            # 如果RPC连接失败，返回错误
            return jsonify({
                "success": False,
                "error": "Blockchain RPC connection failed. Please try again later."
            }), 503
        
        try:
            contract = w3_provider.eth.contract(address=CONTRACT_ADDRESS, abi=FAUCET_ABI)
            
            # 获取中继者的nonce
            nonce_tx = w3_provider.eth.get_transaction_count(RELAYER_ADDRESS, 'pending')
            
            # 估算gas
            try:
                gas_estimate = contract.functions.claimViaRelay(
                    wallet_address, 
                    signature, 
                    nonce, 
                    deadline
                ).estimate_gas({'from': RELAYER_ADDRESS})
                gas_limit = int(gas_estimate * 1.5)  # 增加50%安全边际
                logger.info(f"Gas estimate: {gas_estimate}, Using gas limit: {gas_limit}")
            except Exception as e:
                logger.error(f"Gas estimation failed: {e}")
                gas_limit = 200000  # 默认值
            
            # 获取当前gas价格
            try:
                gas_price = w3_provider.eth.gas_price
                logger.info(f"Current gas price: {gas_price}")
            except:
                gas_price = w3_provider.to_wei('10', 'gwei')  # 默认值
            
            # 构建交易
            tx = contract.functions.claimViaRelay(
                wallet_address, 
                signature, 
                nonce, 
                deadline
            ).build_transaction({
                'from': RELAYER_ADDRESS,
                'nonce': nonce_tx,
                'gas': gas_limit,
                'gasPrice': gas_price,
                'chainId': CHAIN_ID
            })
            
            logger.info(f"Transaction built")
            
            # 签名交易
            signed_tx = w3_provider.eth.account.sign_transaction(tx, RELAY_SIGNER_PRIVATE_KEY)
            
            # 发送交易
            tx_hash = w3_provider.eth.send_raw_transaction(signed_tx.raw_transaction)
            tx_hash_hex = tx_hash.hex()
            
            logger.info(f"✅ Transaction sent: {tx_hash_hex}")
            
            # 更新数据库记录
            conn = get_connection()
            c = conn.cursor()
            
            c.execute('SELECT claim_count FROM claims WHERE wallet_address = ?',
                     (wallet_address.lower(),))
            result = c.fetchone()
            
            if result:
                c.execute('UPDATE claims SET last_claim_timestamp = ?, tx_hash = ?, claim_count = claim_count + 1 WHERE wallet_address = ?',
                         (current_time, tx_hash_hex, wallet_address.lower()))
            else:
                c.execute('INSERT INTO claims (wallet_address, last_claim_timestamp, tx_hash, claim_count) VALUES (?, ?, ?, 1)',
                         (wallet_address.lower(), current_time, tx_hash_hex))
            
            conn.commit()
            conn.close()
            
            return jsonify({
                "success": True,
                "tx_hash": tx_hash_hex,
                "explorer_url": f"https://evmtestnet.confluxscan.io/tx/{tx_hash_hex}",
                "message": "Transaction sent successfully",
                "timestamp": current_time,
                "note": "Transaction is being processed on the blockchain"
            })
                
        except Exception as tx_error:
            logger.error(f"❌ Transaction error: {tx_error}")
            
            # 提取错误信息
            error_msg = str(tx_error)
            if "insufficient funds" in error_msg.lower():
                error_msg = "Relayer has insufficient funds for gas. Please fund the relayer address."
            elif "execution reverted" in error_msg:
                if "Already claimed" in error_msg:
                    error_msg = "Already claimed within 24 hours"
                elif "Invalid signature" in error_msg:
                    error_msg = "Invalid signature - please try again from the beginning"
                elif "Signature expired" in error_msg:
                    error_msg = "Signature expired - please try again"
                else:
                    error_msg = "Contract execution failed"
            elif "nonce too low" in error_msg:
                error_msg = "Transaction nonce error - please try again"
            
            return jsonify({"success": False, "error": error_msg}), 500
            
    except Exception as e:
        logger.error(f"❌ Relay claim error: {e}")
        logger.error(traceback.format_exc())
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/claim-status/<wallet_address>', methods=['GET'])
def claim_status(wallet_address):
    logger.info(f"📊 Status check: {wallet_address}")
    
    try:
        wallet_address = w3.to_checksum_address(wallet_address)
    except:
        return jsonify({"error": "Invalid address"}), 400
    
    # 从数据库获取记录
    conn = get_connection()
    c = conn.cursor()
    c.execute('SELECT last_claim_timestamp, claim_count, tx_hash FROM claims WHERE wallet_address = ?',
             (wallet_address.lower(),))
    result = c.fetchone()
    conn.close()
    
    current_time = int(time.time())
    
    if result:
        last_claim = result[0]
        claim_count = result[1]
        tx_hash = result[2]
        time_since = current_time - last_claim
        can_claim = time_since >= 86400
        
        return jsonify({
            "has_claimed": claim_count > 0,
            "last_claim": last_claim,
            "last_claim_date": datetime.fromtimestamp(last_claim).strftime('%Y-%m-%d %H:%M:%S'),
            "claim_count": claim_count,
            "can_claim": can_claim,
            "time_left": max(0, 86400 - time_since),
            "hours_left": round(max(0, 86400 - time_since) / 3600, 2),
            "next_claim": last_claim + 86400,
            "tx_hash": tx_hash
        })
    else:
        return jsonify({
            "has_claimed": False,
            "can_claim": True,
            "claim_count": 0
        })

@app.route('/check-contract', methods=['GET'])
def check_contract():
    """检查合约状态"""
    try:
        # 获取合约余额
        contract_balance = 0
        contract_balance_cfx = "Unknown"
        approx_claims = 0
        
        try:
            if w3_provider.is_connected():
                contract = w3_provider.eth.contract(address=CONTRACT_ADDRESS, abi=FAUCET_ABI)
                contract_balance = contract.functions.getBalance().call()
                contract_balance_cfx = w3_provider.from_wei(contract_balance, 'ether')
                
                # 计算大约可以领取多少次 (0.01 CFX = 0.01 * 10^18 wei)
                claim_amount = 0.01 * 10**18
                approx_claims = int(contract_balance / claim_amount) if claim_amount > 0 else 0
        except Exception as e:
            logger.warning(f"Could not get contract balance: {e}")
        
        return jsonify({
            "contract_address": CONTRACT_ADDRESS,
            "signer_address": RELAY_SIGNER_ADDRESS,
            "relayer_address": RELAYER_ADDRESS,
            "network": "Conflux eSpace Testnet",
            "explorer_url": f"https://evmtestnet.confluxscan.io/address/{CONTRACT_ADDRESS}",
            "contract_balance": str(contract_balance_cfx) + " CFX",
            "approx_remaining_claims": approx_claims,
            "claim_amount": "0.01 CFX",
            "note": "This is a relay faucet - users pay no gas. Server pays gas fees.",
            "server_status": "online",
            "rpc_connected": w3_provider.is_connected() if 'w3_provider' in locals() else False
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/check-tx/<tx_hash>', methods=['GET'])
def check_tx_status(tx_hash):
    """检查交易状态"""
    try:
        if not w3_provider.is_connected():
            return jsonify({
                "status": "pending",
                "message": "RPC connection not available, cannot check transaction status"
            })
        
        # 获取交易收据
        tx_receipt = w3_provider.eth.get_transaction_receipt(tx_hash)
        
        if tx_receipt is None:
            return jsonify({
                "status": "pending",
                "message": "Transaction is pending or not found"
            })
        
        if tx_receipt.status == 1:
            return jsonify({
                "status": "success",
                "block_number": tx_receipt.blockNumber,
                "gas_used": tx_receipt.gasUsed,
                "confirmations": w3_provider.eth.block_number - tx_receipt.blockNumber,
                "message": "Transaction confirmed successfully"
            })
        else:
            return jsonify({
                "status": "failed",
                "block_number": tx_receipt.blockNumber,
                "message": "Transaction failed"
            })
            
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/server-status', methods=['GET'])
def server_status():
    """服务器状态检查"""
    try:
        # 检查数据库连接
        db_ok = False
        try:
            conn = get_connection()
            c = conn.cursor()
            c.execute('SELECT 1')
            db_ok = True
            conn.close()
        except:
            db_ok = False
        
        # 检查RPC连接
        rpc_ok = w3_provider.is_connected() if 'w3_provider' in locals() else False
        
        return jsonify({
            "server": "online",
            "timestamp": int(time.time()),
            "database": "online" if db_ok else "offline",
            "rpc_connection": "connected" if rpc_ok else "disconnected",
            "contract_address": CONTRACT_ADDRESS,
            "signer_address": RELAY_SIGNER_ADDRESS,
            "relayer_address": RELAYER_ADDRESS
        })
    except Exception as e:
        return jsonify({"server": "error", "error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3000))
    host = os.getenv('HOST', '0.0.0.0')
    
    print("=" * 60)
    print("🚀 CONFLUX ESPACE RELAY FAUCET SERVER")
    print("=" * 60)
    print(f"📡 Server: http://{host}:{port}")
    print(f"🔗 Contract: {CONTRACT_ADDRESS}")
    print(f"✍️  Signer: {RELAY_SIGNER_ADDRESS}")
    print(f"🚀 Relayer: {RELAYER_ADDRESS}")
    print(f"🌐 Network: Conflux eSpace Testnet (Chain ID: {CHAIN_ID})")
    print(f"💰 Amount: 0.01 CFX per claim (GAS-FREE)")
    print("=" * 60)
    print("⚠️  IMPORTANT: Check if contract has enough CFX!")
    print(f"   Explorer: https://evmtestnet.confluxscan.io/address/{CONTRACT_ADDRESS}")
    print("=" * 60)
    print("📋 Endpoints:")
    print("  GET  /                   - API info")
    print("  GET  /health             - Health check")
    print("  POST /verify-ad          - Get signature")
    print("  POST /relay-claim        - Relay claim (gas-free)")
    print("  GET  /claim-status/:addr - Check status")
    print("  GET  /check-contract     - Check contract info")
    print("  GET  /check-tx/:tx_hash  - Check transaction status")
    print("  GET  /server-status      - Check server status")
    print("=" * 60)
    
    app.run(host=host, port=port, debug=True, threaded=True)
