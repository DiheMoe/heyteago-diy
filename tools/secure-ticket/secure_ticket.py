#!/usr/bin/env python3
"""Secure-Transmission 长驻助手（stdin/stdout 行协议）。

启动打印 READY；stdin 每行一条命令，stdout 回一行 JSON（失败 {"error":"..."}）：
  TICKET                     -> {"ticket":"..."}
  ENCRYPT <path> <json-body> -> {"body":{...}}，按握手路由规则加密请求体；
                                路由不要求加密时 libsdk_core 原样返回明文
  DECRYPT <blob>             -> {"data":{...}}，解密响应里的 secure_encrypted_s_data
会话复用进程内状态：ensure_session 在 ticket 到期前 60 秒自动重新握手，
握手网络往返只发生在首次请求与续期时。error 行不代表进程死亡。
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

from heytea_secure_sdk import HeyTeaSecureSDK

HOST = os.environ.get("HEYTEA_APP_HOST", "https://app-go.heytea.com")
DOMAIN = HOST.split("://")[-1].split("/")[0]


def handle(sdk, line):
    if line == "TICKET":
        return {"ticket": sdk.ticket}
    if line.startswith("ENCRYPT "):
        path, _, body = line[len("ENCRYPT "):].partition(" ")
        return {"body": sdk.encrypt_request(json.loads(body), path, domain=DOMAIN)}
    if line.startswith("DECRYPT "):
        return {"data": sdk.decrypt_response(line[len("DECRYPT "):].strip())}
    return None


def main() -> int:
    sdk = HeyTeaSecureSDK(HOST, {}, tenant="heyteago-android", version=2, client="app")
    print("READY", flush=True)
    for line in sys.stdin:
        line = line.strip()
        try:
            if not sdk.ensure_session():
                raise RuntimeError("握手失败（ensure_session 返回 False）")
            out = handle(sdk, line)
        except Exception as e:  # 网络抖动/远端拒绝都以 error 行上报，进程保持可用
            out = {"error": str(e)}
        if out is not None:
            print(json.dumps(out), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
