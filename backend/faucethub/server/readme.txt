先部署HumanVerifiedFaucet.sol，可以使用remix，修改conflux-faucet-plugin.js和index.html中的代码中的
部署插件代码示例
<script 
    src="https://your-domain.com/conflux-faucet-plugin.js"
    data-contract="0x6CD9AFBCfC6cE793A4Ed3293127735B47DDD842B"
    data-server="https://your-server.com"
    data-position="bottom-right"
    data-text="Get Free CFX"
    data-color="#1a2980">
</script>

.env中修改你的合约地址签名地址和私钥

app.py中需要生产环境时修改合约地址，但是我已经给部署好了，demo

运行说明 :
python3.10 app.py
将index.html，或者conflux-faucet-plugin.js,放到你的web目录，按照你的需求对conflux进行嵌入
前端文件中修改localhost的地址运行即可
合约和签名地址我都已经转账了1CFX 可以进行演示
