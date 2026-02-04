// Conflux Gas-Free Faucet Plugin - Embed with one line of code
(function() {
    'use strict';
    
    // 配置
    const CONFIG = {
        contractAddress: document.currentScript.getAttribute('data-contract') || '0x6CD9AFBCfC6cE793A4Ed3293127735B47DDD842B',
        serverUrl: document.currentScript.getAttribute('data-server') || 'http://localhost:3000',
        buttonPosition: document.currentScript.getAttribute('data-position') || 'bottom-right',
        buttonText: document.currentScript.getAttribute('data-text') || 'Get Free CFX',
        buttonColor: document.currentScript.getAttribute('data-color') || '#1a2980'
    };
    
    // 全局变量
    let isOpen = false;
    let userAddress = null;
    let signature = null;
    let nonce = null;
    let deadline = null;
    let adTimer = null;
    
    // 创建浮动按钮
    function createFloatingButton() {
        const button = document.createElement('button');
        button.id = 'conflux-faucet-button';
        button.innerHTML = `<i class="fa fa-water"></i> ${CONFIG.buttonText}`;
        button.style.position = 'fixed';
        button.style.zIndex = '999999';
        button.style.background = CONFIG.buttonColor;
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.borderRadius = '25px';
        button.style.padding = '12px 24px';
        button.style.fontSize = '16px';
        button.style.fontWeight = 'bold';
        button.style.cursor = 'pointer';
        button.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
        button.style.transition = 'all 0.3s ease';
        button.style.display = 'flex';
        button.style.alignItems = 'center';
        button.style.gap = '8px';
        
        // 设置位置
        switch(CONFIG.buttonPosition) {
            case 'top-left':
                button.style.top = '20px';
                button.style.left = '20px';
                break;
            case 'top-right':
                button.style.top = '20px';
                button.style.right = '20px';
                break;
            case 'bottom-left':
                button.style.bottom = '20px';
                button.style.left = '20px';
                break;
            case 'center-right':
                button.style.top = '50%';
                button.style.right = '20px';
                button.style.transform = 'translateY(-50%)';
                break;
            case 'center-left':
                button.style.top = '50%';
                button.style.left = '20px';
                button.style.transform = 'translateY(-50%)';
                break;
            default: // bottom-right
                button.style.bottom = '20px';
                button.style.right = '20px';
        }
        
        button.onmouseenter = () => {
            button.style.transform = 'translateY(-2px) scale(1.05)';
            button.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4)';
        };
        
        button.onmouseleave = () => {
            button.style.transform = '';
            button.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
        };
        
        button.onclick = () => {
            if (!isOpen) {
                openModal();
            } else {
                closeModal();
            }
        };
        
        document.body.appendChild(button);
        
        // 添加Font Awesome图标
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(faLink);
        }
    }
    
    // 创建模态框
    function createModal() {
        const modal = document.createElement('div');
        modal.id = 'conflux-faucet-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            z-index: 1000000;
            display: none;
            justify-content: center;
            align-items: center;
            backdrop-filter: blur(5px);
        `;
        
        modal.innerHTML = `
            <div id="conflux-faucet-container" style="
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                width: 95%;
                max-width: 500px;
                max-height: 90vh;
                overflow-y: auto;
                position: relative;
                animation: fadeIn 0.3s ease;
            ">
                <button id="close-modal" style="
                    position: absolute;
                    top: 15px;
                    right: 15px;
                    background: transparent;
                    border: none;
                    font-size: 24px;
                    color: #666;
                    cursor: pointer;
                    z-index: 10;
                ">×</button>
                
                <div style="
                    background: linear-gradient(135deg, ${CONFIG.buttonColor} 0%, #26d0ce 100%);
                    color: white;
                    padding: 25px;
                    text-align: center;
                    border-radius: 20px 20px 0 0;
                ">
                    <div style="font-size: 40px; margin-bottom: 10px; color: #00d4ff;">
                        <i class="fas fa-water"></i>
                    </div>
                    <h2 style="font-size: 24px; margin-bottom: 8px;">Conflux Gas-Free Faucet</h2>
                    <p style="opacity: 0.9; font-size: 14px;">Get 0.01 CFX test tokens - No gas fees!</p>
                    <span style="display: inline-block; background: rgba(255,255,255,0.2); color: white; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-top: 8px;">
                        Conflux eSpace Testnet
                    </span>
                </div>
                
                <div style="padding: 25px;">
                    <div id="status-message" style="
                        padding: 12px;
                        border-radius: 10px;
                        margin: 12px 0;
                        font-size: 13px;
                        display: none;
                    "></div>
                    
                    <div id="wallet-info" style="
                        display: none;
                        align-items: center;
                        justify-content: space-between;
                        padding: 12px;
                        background: #f8fafc;
                        border-radius: 10px;
                        margin-bottom: 15px;
                    ">
                        <div style="font-weight: bold;">Wallet:</div>
                        <div id="wallet-address" style="
                            font-family: monospace;
                            font-size: 13px;
                            color: #475569;
                            background: white;
                            padding: 6px 10px;
                            border-radius: 8px;
                            border: 1px solid #e2e8f0;
                            cursor: pointer;
                        "></div>
                    </div>
                    
                    <div style="text-align: center; font-size: 22px; font-weight: bold; color: ${CONFIG.buttonColor}; margin: 15px 0;">
                        0.01 CFX <span style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #34d399 100%); color: white; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; margin-left: 8px;">No Gas Fees</span>
                    </div>
                    
                    <div style="display: flex; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 12px; background: #f8fafc; border: 2px solid #e2e8f0;">
                        <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-weight: bold; color: #64748b;">1</div>
                        <div>
                            <h3 style="font-size: 15px; color: #334155; margin-bottom: 4px;">Connect Wallet</h3>
                            <p style="font-size: 13px; color: #64748b;">Connect MetaMask to Conflux eSpace Testnet</p>
                        </div>
                    </div>
                    
                    <button id="connect-wallet-btn" style="
                        display: block;
                        width: 100%;
                        padding: 14px;
                        border: none;
                        border-radius: 12px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s;
                        margin-bottom: 15px;
                        background: linear-gradient(135deg, ${CONFIG.buttonColor} 0%, #26d0ce 100%);
                        color: white;
                    ">
                        <i class="fas fa-wallet"></i> Connect MetaMask
                    </button>
                    
                    <div style="display: flex; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 12px; background: #f8fafc; border: 2px solid #e2e8f0;">
                        <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-weight: bold; color: #64748b;">2</div>
                        <div>
                            <h3 style="font-size: 15px; color: #334155; margin-bottom: 4px;">Verify Human</h3>
                            <p style="font-size: 13px; color: #64748b;">Watch a short ad to prove you're human</p>
                        </div>
                    </div>
                    
                    <button id="watch-ad-btn" disabled style="
                        display: block;
                        width: 100%;
                        padding: 14px;
                        border: none;
                        border-radius: 12px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s;
                        margin-bottom: 15px;
                        background: #f1f5f9;
                        color: #475569;
                    ">
                        <i class="fas fa-play-circle"></i> Watch Ad (5s)
                    </button>
                    
                    <div id="ad-container" style="
                        text-align: center;
                        padding: 20px;
                        background: #f8fafc;
                        border-radius: 12px;
                        margin: 15px 0;
                        border: 2px dashed #cbd5e1;
                        display: none;
                    ">
                        <h3><i class="fas fa-ad"></i> Advertisement</h3>
                        <p>Please watch this demo ad for 5 seconds</p>
                        <div id="ad-timer" style="font-size: 48px; font-weight: bold; color: ${CONFIG.buttonColor}; margin: 15px 0;">5</div>
                        <p>Ad verification in progress...</p>
                    </div>
                    
                    <div style="display: flex; align-items: center; margin-bottom: 20px; padding: 15px; border-radius: 12px; background: #f8fafc; border: 2px solid #e2e8f0;">
                        <div style="width: 32px; height: 32px; background: #e2e8f0; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-weight: bold; color: #64748b;">3</div>
                        <div>
                            <h3 style="font-size: 15px; color: #334155; margin-bottom: 4px;">Claim Tokens (Gas-Free)</h3>
                            <p style="font-size: 13px; color: #64748b;">Get 0.01 CFX test tokens - No gas fees!</p>
                        </div>
                    </div>
                    
                    <button id="claim-btn" disabled style="
                        display: block;
                        width: 100%;
                        padding: 14px;
                        border: none;
                        border-radius: 12px;
                        font-size: 15px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: all 0.3s;
                        margin-bottom: 15px;
                        background: linear-gradient(135deg, ${CONFIG.buttonColor} 0%, #26d0ce 100%);
                        color: white;
                    ">
                        <i class="fas fa-faucet"></i> Claim 0.01 CFX (Gas-Free)
                    </button>
                    
                    <div style="background: #f8fafc; padding: 12px; border-radius: 10px; margin-top: 15px; font-size: 13px; color: #64748b;">
                        <p><i class="fas fa-info-circle"></i> <strong>How it works:</strong> You watch an ad, we pay the gas! Each wallet can claim once every 24 hours.</p>
                        <p><i class="fas fa-bolt"></i> <strong>Contract:</strong> ${CONFIG.contractAddress.substring(0, 10)}...</p>
                    </div>
                </div>
            </div>
            
            <style>
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                #conflux-faucet-container button:hover:not(:disabled) {
                    transform: translateY(-2px);
                    box-shadow: 0 8px 20px rgba(0,0,0,0.2);
                }
                
                #conflux-faucet-container button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            </style>
        `;
        
        document.body.appendChild(modal);
        
        // 关闭按钮事件
        modal.querySelector('#close-modal').onclick = closeModal;
        
        // 点击模态框背景关闭
        modal.onclick = function(e) {
            if (e.target === modal) {
                closeModal();
            }
        };
    }
    
    // 打开模态框
    function openModal() {
        const modal = document.getElementById('conflux-faucet-modal');
        modal.style.display = 'flex';
        isOpen = true;
        
        // 初始化按钮事件
        initModalEvents();
        
        // 检查钱包连接状态
        checkWallet();
    }
    
    // 关闭模态框
    function closeModal() {
        const modal = document.getElementById('conflux-faucet-modal');
        modal.style.display = 'none';
        isOpen = false;
        
        // 清除广告计时器
        if (adTimer) {
            clearInterval(adTimer);
            adTimer = null;
        }
    }
    
    // 初始化模态框事件
    function initModalEvents() {
        // 连接钱包按钮
        document.getElementById('connect-wallet-btn').onclick = connectWallet;
        
        // 观看广告按钮
        document.getElementById('watch-ad-btn').onclick = startAd;
        
        // 领取按钮
        document.getElementById('claim-btn').onclick = claimTokens;
        
        // 复制钱包地址
        const walletAddressEl = document.getElementById('wallet-address');
        if (walletAddressEl) {
            walletAddressEl.onclick = copyToClipboard;
        }
    }
    
    // 检查钱包连接
    async function checkWallet() {
        if (!window.ethereum) {
            showStatus("Please install MetaMask", "error");
            return;
        }
        
        try {
            const accounts = await ethereum.request({ method: 'eth_accounts' });
            if (accounts.length > 0) {
                userAddress = accounts[0];
                updateWalletDisplay();
                checkStatus();
            }
        } catch (error) {
            console.error("Check wallet error:", error);
        }
    }
    
    // 连接钱包
    async function connectWallet() {
        if (!window.ethereum) {
            showStatus("Install MetaMask first", "error");
            return;
        }
        
        try {
            showStatus("Connecting...", "info");
            
            // 切换网络
            await switchNetwork();
            
            // 获取账户
            const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
            userAddress = accounts[0];
            
            updateWalletDisplay();
            checkStatus();
            
            showStatus("Connected!", "success");
            
        } catch (error) {
            console.error("Connect error:", error);
            if (error.code === 4001) {
                showStatus("Connection rejected", "error");
            } else {
                showStatus("Connection error: " + error.message, "error");
            }
        }
    }
    
    // 切换网络
    async function switchNetwork() {
        const confluxNetwork = {
            chainId: "0x47",
            chainName: "Conflux eSpace Testnet",
            nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
            rpcUrls: ["https://evmtestnet.confluxrpc.com"],
            blockExplorerUrls: ["https://evmtestnet.confluxscan.io"]
        };
        
        try {
            await ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: confluxNetwork.chainId }]
            });
        } catch (error) {
            if (error.code === 4902) {
                await ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [confluxNetwork]
                });
            } else {
                throw error;
            }
        }
    }
    
    // 更新钱包显示
    function updateWalletDisplay() {
        if (!userAddress) return;
        
        const shortAddr = userAddress.substring(0, 6) + "..." + userAddress.substring(38);
        document.getElementById('wallet-address').textContent = shortAddr;
        document.getElementById('wallet-info').style.display = 'flex';
        document.getElementById('watch-ad-btn').disabled = false;
        
        // 更新步骤样式
        const step1 = document.querySelector('#conflux-faucet-container div:nth-child(4)');
        if (step1) step1.style.borderColor = '#10b981';
    }
    
    // 复制地址到剪贴板
    function copyToClipboard() {
        if (!userAddress) return;
        
        navigator.clipboard.writeText(userAddress).then(() => {
            const originalText = document.getElementById('wallet-address').textContent;
            document.getElementById('wallet-address').textContent = "Copied!";
            document.getElementById('wallet-address').style.color = "#10b981";
            
            setTimeout(() => {
                document.getElementById('wallet-address').textContent = originalText;
                document.getElementById('wallet-address').style.color = "";
            }, 2000);
        });
    }
    
    // 检查状态
    async function checkStatus() {
        if (!userAddress) return;
        
        try {
            const response = await fetch(`${CONFIG.serverUrl}/claim-status/${userAddress}`);
            const data = await response.json();
            
            if (data.error) {
                console.warn("Status check error:", data.error);
            } else if (data.can_claim === false) {
                const hours = data.hours_left || (data.time_left / 3600).toFixed(1);
                document.getElementById('watch-ad-btn').disabled = true;
                document.getElementById('watch-ad-btn').innerHTML = `<i class="fas fa-clock"></i> Wait ${hours}h`;
                document.getElementById('claim-btn').disabled = true;
                document.getElementById('claim-btn').innerHTML = `<i class="fas fa-clock"></i> Available in ${hours}h`;
                showStatus(`Next claim in ${hours} hours`, "info");
                
                // 更新步骤样式
                const step2 = document.querySelector('#conflux-faucet-container div:nth-child(7)');
                if (step2) {
                    step2.style.borderColor = '#10b981';
                    step2.querySelector('div').style.background = '#10b981';
                    step2.querySelector('div').style.color = 'white';
                }
            }
        } catch (error) {
            console.error("Status check error:", error);
        }
    }
    
    // 开始广告
    function startAd() {
        document.getElementById('ad-container').style.display = 'block';
        document.getElementById('watch-ad-btn').disabled = true;
        document.getElementById('watch-ad-btn').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Watching...';
        
        let seconds = 5;
        document.getElementById('ad-timer').textContent = seconds;
        
        adTimer = setInterval(() => {
            seconds--;
            document.getElementById('ad-timer').textContent = seconds;
            
            if (seconds <= 0) {
                clearInterval(adTimer);
                finishAd();
            }
        }, 1000);
        
        showStatus("Watching ad...", "info");
    }
    
    // 完成广告
    async function finishAd() {
        try {
            showStatus("Getting signature...", "info");
            
            const response = await fetch(`${CONFIG.serverUrl}/verify-ad`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet: userAddress,
                    adToken: "demo_ad_ok"
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                signature = data.signature;
                nonce = data.nonce;
                deadline = data.deadline;
                
                // 确保签名有0x前缀
                if (!signature.startsWith('0x')) {
                    signature = '0x' + signature;
                }
                
                document.getElementById('ad-container').innerHTML = `
                    <div style="color:#10b981;">
                        <i class="fas fa-check-circle" style="font-size:40px;"></i>
                        <h3>Ready! (Gas-Free)</h3>
                        <p>Signature received - No gas fee required!</p>
                    </div>
                `;
                
                document.getElementById('watch-ad-btn').innerHTML = '<i class="fas fa-check"></i> Ad Completed';
                document.getElementById('claim-btn').disabled = false;
                
                // 更新步骤样式
                const step2 = document.querySelector('#conflux-faucet-container div:nth-child(7)');
                if (step2) {
                    step2.style.borderColor = '#10b981';
                    step2.querySelector('div').style.background = '#10b981';
                    step2.querySelector('div').style.color = 'white';
                }
                
                const step3 = document.querySelector('#conflux-faucet-container div:nth-child(10)');
                if (step3) {
                    step3.style.borderColor = CONFIG.buttonColor;
                    step3.querySelector('div').style.background = CONFIG.buttonColor;
                    step3.querySelector('div').style.color = 'white';
                }
                
                showStatus("Ready to claim! No gas fee required.", "success");
                
            } else {
                console.error("Server error:", data.error);
                showStatus("Error: " + data.error, "error");
                document.getElementById('watch-ad-btn').disabled = false;
                document.getElementById('watch-ad-btn').innerHTML = '<i class="fas fa-play-circle"></i> Try Again';
            }
            
        } catch (error) {
            console.error("Finish ad error:", error);
            showStatus("Server error: " + error.message, "error");
            document.getElementById('watch-ad-btn').disabled = false;
            document.getElementById('watch-ad-btn').innerHTML = '<i class="fas fa-play-circle"></i> Try Again';
        }
    }
    
    // 领取代币
    async function claimTokens() {
        if (!signature || nonce === null || deadline === null) {
            showStatus("No signature or missing data", "error");
            return;
        }
        
        const claimBtn = document.getElementById('claim-btn');
        claimBtn.disabled = true;
        claimBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        
        try {
            showStatus("Sending transaction via relay (gas-free)...", "info");
            
            const response = await fetch(`${CONFIG.serverUrl}/relay-claim`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    wallet: userAddress,
                    signature: signature,
                    nonce: nonce,
                    deadline: deadline
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // 成功
                claimBtn.innerHTML = '<i class="fas fa-check"></i> Success!';
                claimBtn.style.background = '#10b981';
                
                const explorerUrl = data.explorer_url || `https://evmtestnet.confluxscan.io/tx/${data.tx_hash}`;
                showStatus(`
                    <strong>Success!</strong> Gas-free transaction submitted.<br>
                    <a href="${explorerUrl}" target="_blank" style="color:${CONFIG.buttonColor};text-decoration:underline;">
                        View transaction on ConfluxScan
                    </a><br>
                    Transaction Hash: ${data.tx_hash.substring(0, 20)}...<br>
                    <small>It may take a few minutes to confirm.</small>
                `, "success");
                
                // 禁用按钮，24小时内不能再领取
                document.getElementById('watch-ad-btn').disabled = true;
                document.getElementById('watch-ad-btn').innerHTML = '<i class="fas fa-clock"></i> 24h Wait';
                document.getElementById('claim-btn').disabled = true;
                document.getElementById('claim-btn').innerHTML = '<i class="fas fa-check"></i> Claimed (24h Wait)';
                
                // 更新状态
                setTimeout(() => checkStatus(), 3000);
                
            } else {
                console.error("Relay server error:", data.error);
                claimBtn.disabled = false;
                claimBtn.innerHTML = '<i class="fas fa-faucet"></i> Claim 0.01 CFX (Gas-Free)';
                
                showStatus("Error: " + data.error, "error");
            }
            
        } catch (error) {
            console.error("Claim error details:", error);
            claimBtn.disabled = false;
            claimBtn.innerHTML = '<i class="fas fa-faucet"></i> Claim 0.01 CFX (Gas-Free)';
            
            showStatus("Server error: " + error.message, "error");
        }
    }
    
    // 显示状态
    function showStatus(message, type) {
        const element = document.getElementById('status-message');
        element.innerHTML = message;
        element.className = ''; // 清除之前的类
        element.style.display = 'block';
        
        switch(type) {
            case 'success':
                element.style.background = '#f0fdf4';
                element.style.color = '#065f46';
                element.style.border = '1px solid #a7f3d0';
                break;
            case 'error':
                element.style.background = '#fef2f2';
                element.style.color = '#991b1b';
                element.style.border = '1px solid #fecaca';
                break;
            case 'info':
                element.style.background = '#eff6ff';
                element.style.color = '#1e40af';
                element.style.border = '1px solid #bfdbfe';
                break;
        }
        
        if (type === 'success') {
            setTimeout(() => {
                element.style.display = 'none';
            }, 10000);
        } else if (type === 'info') {
            setTimeout(() => {
                element.style.display = 'none';
            }, 5000);
        }
    }
    
    // 监听钱包变化
    function initWalletListeners() {
        if (window.ethereum) {
            ethereum.on('accountsChanged', (accounts) => {
                if (accounts.length === 0) {
                    userAddress = null;
                    const walletInfo = document.getElementById('wallet-info');
                    if (walletInfo) walletInfo.style.display = 'none';
                    showStatus("Wallet disconnected", "info");
                } else {
                    userAddress = accounts[0];
                    updateWalletDisplay();
                    checkStatus();
                }
            });
            
            ethereum.on('chainChanged', () => {
                window.location.reload();
            });
        }
    }
    
    // 初始化
    function init() {
        // 创建浮动按钮
        createFloatingButton();
        
        // 创建模态框
        createModal();
        
        // 初始化钱包监听器
        initWalletListeners();
        
        // 添加键盘快捷键 (Esc键关闭模态框)
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isOpen) {
                closeModal();
            }
        });
        
        console.log('Conflux Gas-Free Faucet Plugin loaded!');
    }
    
    // 等待DOM加载完成
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    // 暴露公共API
    window.ConfluxFaucet = {
        open: openModal,
        close: closeModal,
        setConfig: function(config) {
            Object.assign(CONFIG, config);
        },
        getConfig: function() {
            return CONFIG;
        }
    };
    
})();
