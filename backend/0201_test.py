import subprocess

RPC = "https://evmtestnet.confluxrpc.com"
BOOK_ADDR = "0xe250ae653190f2edf3ac79fd9bdf2687a90cde84"
SPONSOR_PK = "56e42b3674b7ea354677867d4045163f78bf7d16962199d22f6cf1a0df8ec52f"

def mint_to_reader(reader_addr):
    cmd = [
        "cast", "send",
        BOOK_ADDR,
        "mintToReader(address)",
        reader_addr,
        "--private-key", SPONSOR_PK,
        "--rpc-url", RPC,
        "--legacy"
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.stdout, res.stderr

if __name__ == "__main__":
    out, err = mint_to_reader("0x5ad82ceb0a10153c06f1215b70d0a5db97ad9240")
    print(out)
    print(err)
