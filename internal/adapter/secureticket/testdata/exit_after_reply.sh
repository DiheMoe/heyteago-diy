#!/bin/sh
# 回复一次后立即退出，覆盖进程终结后惰性重启的路径。
echo READY
while IFS= read -r line; do
	if [ "$line" = "TICKET" ]; then
		echo '{"ticket":"once"}'
		exit 0
	fi
done
