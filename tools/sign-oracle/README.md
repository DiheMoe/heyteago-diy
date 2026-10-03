# 喜茶杯贴签名 oracle（tools/sign-oracle）

喜茶GO 的杯贴上传接口要求 `hash` 参数——它是图片 sha256 的服务端可验签名。
小程序通道走微信云函数 `signVerify`（离开微信运行时不可用）；
**App 通道则完全在本地计算**：`libheyteago.so` 的 JNI 函数
`calDIYSign(String fileHash)`（前端插件 `CrashReportAndIosPush` 调的就是它）。

本项目用 [unidbg](https://github.com/zhkl0228/unidbg) 在普通 JVM 里模拟执行这个
arm64 .so，把官方 App 的本地签名变成一个命令行 oracle，不需要微信、不需要模拟器、
不需要联网。Node 服务（`server/heyteaSign.js`）以长驻进程 + stdin/stdout 行协议调用它。

## 构建

```bash
# 1) 从喜茶GO APK 提取 arm64 动态库（apktool d 或解压 APK 均可）
cp lib/arm64-v8a/libheyteago.so /path/to/workdir/

# 2) 构建 fat jar（需要 JDK 17+ 与 Maven）
mvn -q package

# 3) 部署到 server/bin/（server/heyteaSign.js 默认从这里加载）
mkdir -p ../../server/bin
cp target/sign-oracle-1.0.0-jar-with-dependencies.jar ../../server/bin/sign-oracle.jar
cp /path/to/libheyteago.so ../../server/bin/libheyteago.so
```

## 手动测试

```bash
echo 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' \
  | java -jar ../../server/bin/sign-oracle.jar ../../server/bin/libheyteago.so
# READY
# RESULT:{"data":"<签名hex>","errorCode":0,"message":"ok"}
```

## 实现要点（换 APK 版本后如失效请先看这里）

- `JNI_OnLoad` 内有防盗校验：它会 `FindClass(com/donut/wx1a13d6849c0100f0/common/SecurityUtil)`
  并回调静态方法 `getCurrentAppSignature()Ljava/lang/String;`，把返回值与 .so 内置的
  APK 签名证书 hex（`src/main/resources/heytea_cert_hex.txt`，提取自 .so rodata）做
  `strcmp`，不一致就拒绝 `RegisterNatives`。`SignOracle` 通过自定义 Jni 返回该期望证书，
  因此**不需要修改 .so 本身**。
- 换新版 .so 时：重新从 rodata 提取内置证书 hex 覆盖 `heytea_cert_hex.txt`
  （在 JNI_OnLoad 中 `strcmp` 调用的第二个操作数地址处；可用
  `gdb -batch -ex 'set architecture aarch64' -ex 'file libheyteago.so' -ex 'disassemble JNI_OnLoad'` 定位）。
- 注册的 5 个 native 方法（类 `com/donut/wx1a13d6849c0100f0/jni/HeyteagoJNI`）：
  `setEnv` / `calTradeAndMemberSign` / **`calDIYSign`** / `callNativeRequest` / `getHandshakeKey`。
- unidbg 的 `vm.loadLibrary(file, true)` 第二个参数是 forceCallInit，**不会**自动调用
  `JNI_OnLoad`，必须显式 `dm.callJNI_OnLoad(emulator)`。
- 输出签名格式：hex 字符串，尾部嵌入时间信息，因此每次签名结果不同；上传时必须用
  新鲜签名（server 端已按官方逻辑在 401/1002/401011 时重签重试一次）。
