#!/bin/sh
# 读请求但永不回复，覆盖请求超时路径。
echo READY
while IFS= read -r line; do
	:
done
