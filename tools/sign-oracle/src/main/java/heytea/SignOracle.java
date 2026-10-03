package heytea;

import com.github.unidbg.AndroidEmulator;
import com.github.unidbg.linux.android.AndroidEmulatorBuilder;
import com.github.unidbg.linux.android.AndroidResolver;
import com.github.unidbg.linux.android.dvm.AbstractJni;
import com.github.unidbg.linux.android.dvm.BaseVM;
import com.github.unidbg.linux.android.dvm.DalvikModule;
import com.github.unidbg.linux.android.dvm.DvmClass;
import com.github.unidbg.linux.android.dvm.DvmObject;
import com.github.unidbg.linux.android.dvm.StringObject;
import com.github.unidbg.linux.android.dvm.VM;
import com.github.unidbg.linux.android.dvm.VaList;
import com.github.unidbg.memory.Memory;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * 喜茶GO App 本地签名 oracle：
 * 用 unidbg 模拟执行 libheyteago.so 的 JNI 函数 calDIYSign(String fileHash)，
 * 与官方 App 内插件 "CrashReportAndIosPush" 的调用方式完全一致。
 *
 * JNI_OnLoad 里有防盗签名校验：回调 Java 层
 * SecurityUtil.getCurrentAppSignature() 并与内置证书 hex 比较。
 * 这里通过自定义 Jni 返回内置的期望证书 hex（提取自 .so 本身），
 * 与真实 App 环境行为一致，故使用未修改的原始 .so。
 *
 * 用法: java -jar sign-oracle.jar <libheyteago.so路径> [env]
 * 协议: stdin 每行一个 sha256 hex(64字符)，stdout 每行一个 JSON 结果（前缀 "RESULT:"）。
 */
public class SignOracle {

    private static final String JNI_CLASS = "com/donut/wx1a13d6849c0100f0/jni/HeyteagoJNI";
    private static final String SIGN_SIG = "calDIYSign(Ljava/lang/String;)Ljava/lang/String;";
    private static final String TRADE_SIG3 = "calTradeAndMemberSign(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;";
    private static final String TRADE_SIG1 = "calTradeAndMemberSign(Ljava/lang/String;)Ljava/lang/String;";
    private static final String SECURITY_UTIL = "com/donut/wx1a13d6849c0100f0/common/SecurityUtil";
    private static final String GET_SIG_METHOD = "getCurrentAppSignature";

    private static String loadExpectedCertHex() throws Exception {
        try (InputStream in = SignOracle.class.getResourceAsStream("/heytea_cert_hex.txt")) {
            if (in == null) {
                throw new IllegalStateException("missing heytea_cert_hex.txt resource");
            }
            byte[] buf = in.readAllBytes();
            return new String(buf, StandardCharsets.US_ASCII).trim();
        }
    }

    public static void main(String[] args) throws Exception {
        File soFile = new File(args.length > 0 ? args[0] : "libheyteago.so");
        String env = args.length > 1 ? args[1] : null;
        final String expectedCertHex = loadExpectedCertHex();

        AndroidEmulator emulator = AndroidEmulatorBuilder.for64Bit()
                .setProcessName("com.donut.app")
                .build();
        Memory memory = emulator.getMemory();
        memory.setLibraryResolver(new AndroidResolver(23));
        VM vm = emulator.createDalvikVM((File) null);
        vm.setVerbose(false);
        vm.setJni(new AbstractJni() {
            @Override
            public DvmObject<?> callStaticObjectMethodV(BaseVM vm, DvmClass dvmClass, String signature, VaList vaList) {
                System.err.println("[JNI] callStaticObjectMethodV " + signature);
                if ((SECURITY_UTIL + "->" + GET_SIG_METHOD + "()Ljava/lang/String;").equals(signature)) {
                    return new StringObject(vm, expectedCertHex);
                }
                return super.callStaticObjectMethodV(vm, dvmClass, signature, vaList);
            }
        });

        // RegisterNatives 发生在 JNI_OnLoad 内，需要先让类可解析；
        // JNI_OnLoad 还会 FindClass(SecurityUtil) 做签名校验，同样预解析
        vm.resolveClass(SECURITY_UTIL);
        DvmClass jniClass = vm.resolveClass(JNI_CLASS);
        DalvikModule dm = vm.loadLibrary(soFile, true);
        dm.callJNI_OnLoad(emulator);

        if (env != null && !env.isEmpty()) {
            jniClass.callStaticJniMethodObject(emulator, "setEnv(Ljava/lang/String;)V",
                    new StringObject(vm, env));
            System.out.println("READY env=" + env);
        } else {
            System.out.println("READY");
        }
        System.out.flush();

        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = in.readLine()) != null) {
            line = line.trim();
            if (line.isEmpty()) {
                continue;
            }
            try {
                if (line.startsWith("TRADE ")) {
                    // TRADE <biz>|<path>|<timestamp>
                    // 反滥用签名：与 App 内 handleAntiAbuseRequest 一致，
                    // JS 桥把 {biz,path,timestamp} 按位置传给 JNI（与 calDIYSign 单值直传同理）。
                    // 先试 3 字符串签名，失败再试单 JSON 字符串签名。
                    String payload = line.substring(6);
                    String[] parts = payload.split("\\|", -1);
                    if (parts.length != 3) {
                        System.out.println("RESULT:{\"errorCode\":-1,\"message\":\"bad TRADE line, want biz|path|ts\"}");
                        System.out.flush();
                        continue;
                    }
                    String biz = parts[0], path = parts[1], ts = parts[2];
                    Object value = null;
                    Throwable firstError = null;
                    try {
                        DvmObject<?> ret = jniClass.callStaticJniMethodObject(emulator, TRADE_SIG3,
                                new StringObject(vm, biz), new StringObject(vm, path), new StringObject(vm, ts));
                        value = ret == null ? null : ret.getValue();
                    } catch (Throwable t3) {
                        firstError = t3;
                    }
                    if (value == null) {
                        String json = "{\"biz\":\"" + biz + "\",\"path\":\"" + path + "\",\"timestamp\":\"" + ts + "\"}";
                        try {
                            DvmObject<?> ret = jniClass.callStaticJniMethodObject(emulator, TRADE_SIG1,
                                    new StringObject(vm, json));
                            value = ret == null ? null : ret.getValue();
                        } catch (Throwable t1) {
                            String msg = "sig3:" + firstError + " sig1:" + t1;
                            System.out.println("RESULT:{\"errorCode\":-1,\"message\":\"oracle exception: "
                                    + msg.replace("\"", "'") + "\"}");
                            System.out.flush();
                            continue;
                        }
                    }
                    System.out.println("RESULT:" + value);
                } else {
                    DvmObject<?> ret = jniClass.callStaticJniMethodObject(emulator, SIGN_SIG,
                            new StringObject(vm, line));
                    Object value = ret == null ? null : ret.getValue();
                    System.out.println("RESULT:" + (value == null ? "null" : value));
                }
            } catch (Throwable t) {
                System.out.println("RESULT:{\"errorCode\":-1,\"message\":\"oracle exception: "
                        + String.valueOf(t).replace("\"", "'") + "\"}");
            }
            System.out.flush();
        }

        emulator.close();
    }
}
