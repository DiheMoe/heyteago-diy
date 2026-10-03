#!/bin/sh
# 正常路径夹具：ticket 取 HEYTEA_SDK_SO 环境变量值，顺带验证 env 透传；
# ENCRYPT 原样回显 body（透传加密器），DECRYPT 回显 blob；
# 回复前输出一行噪声，验证非 JSON 行被跳过。
echo READY
while IFS= read -r line; do
	case "$line" in
	TICKET)
		echo "some noise from helper"
		printf '{"ticket":"%s"}\n' "$HEYTEA_SDK_SO"
		;;
	ENCRYPT\ *)
		rest="${line#ENCRYPT }"
		printf '{"body":%s}\n' "${rest#* }"
		;;
	DECRYPT\ *)
		printf '{"data":{"plain":"%s"}}\n' "${line#DECRYPT }"
		;;
	esac
done
