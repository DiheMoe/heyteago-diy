#!/bin/sh
# 第一次请求回 error 行（不代表进程死亡），之后回正常 ticket。
echo READY
n=0
while IFS= read -r line; do
	if [ "$line" = "TICKET" ]; then
		n=$((n + 1))
		if [ "$n" -eq 1 ]; then
			echo '{"error":"boom"}'
		else
			echo '{"ticket":"recovered-ticket"}'
		fi
	fi
done
