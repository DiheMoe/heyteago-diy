"""喜茶 Secure-Transmission 安全传输协议 SDK(基于 Unicorn 模拟 libsdk_core.so)

协议流程(逆向自喜茶GO App 内嵌 libsdk_core.so):
1. handshakePrepare: 生成 P-256 临时密钥对 + client_random + HMAC 签名
   - 签名 = HMAC-SHA256(SHA256(内嵌服务器公钥), client_public_key || client_random)
2. POST /api/_secure-transmission/handshake -> server_random + ticket
3. handshakeFinish: session_key = HMAC-SHA256(ECDH(临时私钥, 内嵌服务器公钥),
                                               client_random || server_random)
4. encode: 请求体加密 = base64(IV(12) || AES-256-GCM(session_key, iv, 明文, AAD=tenant_ver))
   输出 {"secure_encrypted_c_data": "<b64>"}
5. decode: 响应解密(密钥从会话全局态读取)
"""
import base64
import json
import os
import struct
import threading

from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM64, UC_HOOK_CODE, UC_MODE_LITTLE_ENDIAN
from unicorn.arm64_const import (
    UC_ARM64_REG_LR,
    UC_ARM64_REG_PC,
    UC_ARM64_REG_SP,
    UC_ARM64_REG_TPIDR_EL0,
    UC_ARM64_REG_X0,
    UC_ARM64_REG_X1,
    UC_ARM64_REG_X2,
    UC_ARM64_REG_X3,
    UC_ARM64_REG_X4,
    UC_ARM64_REG_X5,
    UC_ARM64_REG_X6,
    UC_ARM64_REG_X7,
)

# 优先读环境变量, 方便把 .so 放在包外(它不属于本项目, 请自行从 APK 获取)
SO_PATH = os.environ.get('HEYTEA_SDK_SO') or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), 'libsdk_core.so')
BASE = 0x100000
STACK_BASE = 0x7F000000
STACK_SIZE = 0x400000
HEAP_BASE = 0x20000000
HEAP_SIZE = 0x2000000
ENV_BASE = 0x30000000
MAGIC_BASE = 0x31000000
MAGIC2_BASE = 0x35000000
ARR_BASE = 0x32000000
TLS_BASE = 0x34000000
RET_MAGIC = 0x39000000

TENANT = "heyteago-android"
VERSION = 2

# C 函数/JNI 地址(libsdk_core.so)
C_PREPARE = 0x4d38
C_FINISH = 0x5d54
C_ENCODE = 0x637c
C_DECODE = 0x6bd0
JNI_PREPARE = 0xba10
JNI_FINISH = 0xbdcc
JNI_ENCODE = 0xbf6c
JNI_DECODE = 0xc314
SNPRINTF_WRAPPER = 0x7368
SESSION_KEY_ADDR = 0x1def9  # 会话密钥全局变量

_lock = threading.Lock()
_sdk_instance = None


class Emu:
    """libsdk_core.so 的 Unicorn 模拟环境"""

    def __init__(self, random_pool):
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_LITTLE_ENDIAN)
        self.heap_ptr = HEAP_BASE
        self.objects = {}
        self.next_handle = ARR_BASE + 0x100
        self.random_pool = random_pool
        self.random_pos = 0
        self._load()
        self._hook_plt()
        self._make_env()

    def rd(self, addr, n):
        return bytes(self.uc.mem_read(addr, n))

    def wr(self, addr, data):
        self.uc.mem_write(addr, bytes(data))

    def cstr(self, addr, maxlen=8192):
        out = b''
        while len(out) < maxlen:
            c = self.rd(addr + len(out), 1)
            if c == b'\x00':
                break
            out += c
        return out

    def malloc(self, size):
        p = self.heap_ptr
        self.heap_ptr = (self.heap_ptr + size + 31) & ~15
        return p

    def _load(self):
        uc = self.uc
        uc.mem_map(BASE, 0x400000)
        self.import_names = {}
        with open(SO_PATH, 'rb') as f:
            elf = ELFFile(f)
            dynsym = elf.get_section_by_name('.dynsym')
            relaplt = elf.get_section_by_name('.rela.plt')
            for seg in elf.iter_segments():
                if seg['p_type'] == 'PT_LOAD':
                    uc.mem_write(BASE + seg['p_vaddr'], seg.data())
            mi = 0
            for i, rel in enumerate(relaplt.iter_relocations()):
                sym = dynsym.get_symbol(rel['r_info_sym'])
                magic = MAGIC2_BASE + mi * 16
                self.import_names[magic] = sym.name
                uc.mem_write(BASE + rel['r_offset'], struct.pack('<Q', magic))
                mi += 1
            reladyn = elf.get_section_by_name('.rela.dyn')
            if reladyn:
                for rel in reladyn.iter_relocations():
                    if rel['r_info_type'] == 1027:  # RELATIVE
                        uc.mem_write(BASE + rel['r_offset'],
                                     struct.pack('<Q', BASE + rel['r_addend']))
                    elif rel['r_info_type'] == 1025 and mi < 4000:  # GLOB_DAT
                        sym = dynsym.get_symbol(rel['r_info_sym'])
                        if sym['st_value'] == 0 and sym.name:
                            magic = MAGIC2_BASE + mi * 16
                            self.import_names[magic] = sym.name
                            uc.mem_write(BASE + rel['r_offset'], struct.pack('<Q', magic))
                            mi += 1
        uc.mem_map(STACK_BASE, STACK_SIZE)
        uc.mem_map(HEAP_BASE, HEAP_SIZE)
        uc.mem_map(ENV_BASE, 0x10000)
        uc.mem_map(MAGIC_BASE, 0x10000)
        uc.mem_map(MAGIC2_BASE, 0x10000)
        uc.mem_map(ARR_BASE, 0x10000)
        uc.mem_map(TLS_BASE, 0x10000)
        uc.mem_map(RET_MAGIC, 0x1000)
        uc.mem_write(RET_MAGIC, b'\x00' * 4)
        uc.mem_write(TLS_BASE + 0x28, b'\xde\xad\xbe\xef\xca\xfe\xba\xbe')

    def _hook_plt(self):
        uc = self.uc
        self.own_exports = {'handshakePrepare': C_PREPARE, 'handshakeFinish': C_FINISH,
                            'encode': C_ENCODE, 'decode': C_DECODE,
                            'sdk_free_out_buffer': 0x7220, 'sdk_ctx_free': 0x7224}

        def hook_code(uc, address, size, user_data):
            if address == BASE + SNPRINTF_WRAPPER:
                self._do_snprintf_call(uc)
                return
            name = self.import_names.get(address)
            if name is None:
                return
            if name in self.own_exports:
                uc.reg_write(UC_ARM64_REG_PC, BASE + self.own_exports[name])
                return
            lr = uc.reg_read(UC_ARM64_REG_LR)
            a = [uc.reg_read(r) for r in (UC_ARM64_REG_X0, UC_ARM64_REG_X1,
                UC_ARM64_REG_X2, UC_ARM64_REG_X3, UC_ARM64_REG_X4, UC_ARM64_REG_X5,
                UC_ARM64_REG_X6, UC_ARM64_REG_X7)]
            ret = self.do_import(name, a)
            if ret is not None:
                uc.reg_write(UC_ARM64_REG_X0, ret & 0xFFFFFFFFFFFFFFFF)
            uc.reg_write(UC_ARM64_REG_PC, lr)

        uc.hook_add(UC_HOOK_CODE, hook_code, begin=MAGIC2_BASE, end=MAGIC2_BASE + 0x10000)
        uc.hook_add(UC_HOOK_CODE, hook_code, begin=BASE + SNPRINTF_WRAPPER,
                    end=BASE + SNPRINTF_WRAPPER + 4)
        uc.hook_add(UC_HOOK_CODE, hook_code, begin=BASE + JNI_PREPARE, end=BASE + JNI_PREPARE + 4)
        uc.hook_add(UC_HOOK_CODE, hook_code, begin=BASE + JNI_FINISH, end=BASE + JNI_FINISH + 4)
        uc.hook_add(UC_HOOK_CODE, hook_code, begin=BASE + JNI_ENCODE, end=BASE + JNI_ENCODE + 4)
        uc.hook_add(UC_HOOK_CODE, hook_code, begin=BASE + JNI_DECODE, end=BASE + JNI_DECODE + 4)

    def _do_snprintf_call(self, uc):
        lr = uc.reg_read(UC_ARM64_REG_LR)
        dest = uc.reg_read(UC_ARM64_REG_X0)
        cap = uc.reg_read(UC_ARM64_REG_X1)
        fmt = self.cstr(uc.reg_read(UC_ARM64_REG_X3))
        va = [uc.reg_read(r) for r in (UC_ARM64_REG_X4, UC_ARM64_REG_X5,
             UC_ARM64_REG_X6, UC_ARM64_REG_X7)]
        out = self._format(fmt, va)
        self.wr(dest, out[:max(0, cap - 1)] + b'\x00')
        uc.reg_write(UC_ARM64_REG_X0, len(out))
        uc.reg_write(UC_ARM64_REG_PC, lr)

    def do_import(self, name, a):
        if name == 'memcpy' or name == 'memmove':
            if a[2] > 0:
                self.wr(a[0], self.rd(a[1], a[2]))
            return a[0]
        if name == 'memset':
            if a[2] > 0:
                self.wr(a[0], bytes([a[1] & 0xFF]) * a[2])
            return a[0]
        if name in ('malloc', '_Znwm'):
            return self.malloc(a[0])
        if name in ('free', '_ZdlPv', 'sdk_free_out_buffer', 'sdk_ctx_free'):
            return 0
        if name == 'strlen':
            return len(self.cstr(a[0]))
        if name == '__strlen_chk':
            return len(self.cstr(a[0]))
        if name == '__open_2':
            return 100
        if name == '__read_chk':
            n = min(a[2], len(self.random_pool) - self.random_pos)
            data = self.random_pool[self.random_pos:self.random_pos + n]
            self.random_pos += n
            self.wr(a[1], data)
            return n
        if name == 'close':
            return 0
        if name == 'memcmp':
            d1, d2 = self.rd(a[0], a[2]), self.rd(a[1], a[2])
            return (d1 > d2) - (d1 < d2)
        if name in ('fprintf', 'fflush', 'fwrite', 'abort'):
            return 0
        if name.startswith('pthread_rwlock'):
            return 0
        if name == 'dl_iterate_phdr':
            return 0
        if name.startswith('__cxa') or name == '_ZSt9terminatev':
            raise Exception(f"C++ 异常: {name}")
        if '__ndk1' in name:
            return self.do_cpp(name, a)
        raise Exception(f"未处理的导入: {name}")

    def _format(self, fmt, varargs):
        out = b''
        vi = 0
        i = 0
        while i < len(fmt):
            if fmt[i:i + 1] == b'%' and i + 1 < len(fmt):
                c = fmt[i + 1:i + 2]
                if c == b'd':
                    v = varargs[vi] & 0xFFFFFFFF
                    if v >= 2 ** 31:
                        v -= 2 ** 32
                    out += str(v).encode()
                    vi += 1; i += 2; continue
                if c == b'l' and fmt[i + 2:i + 3] == b'd':
                    out += str(varargs[vi]).encode()
                    vi += 1; i += 3; continue
                if c == b's':
                    out += self.cstr(varargs[vi])
                    vi += 1; i += 2; continue
                if c == b'%':
                    out += b'%'; i += 2; continue
            out += fmt[i:i + 1]
            i += 1
        return out

    def do_cpp(self, name, a):
        """libc++ std::string 操作"""
        this = a[0]
        if 'push_backEc' in name:
            ch = a[1] & 0xFF
            hdr = self.rd(this, 24)
            size = hdr[0] >> 1
            is_long = hdr[0] & 1
            if is_long:
                cap = struct.unpack('<Q', hdr[0:8])[0] & ~1
                slen = struct.unpack('<Q', hdr[8:16])[0]
                ptr = struct.unpack('<Q', hdr[16:24])[0]
                if slen + 1 > cap:
                    newcap = max(32, cap * 2)
                    np = self.malloc(newcap + 1)
                    self.wr(np, self.rd(ptr, slen))
                    ptr = np
                    cap = newcap
                self.wr(ptr + slen, bytes([ch]) + b'\x00')
                self.wr(this, struct.pack('<QQQ', cap | 1, slen + 1, ptr))
            else:
                if size + 1 > 22:
                    newcap = 32
                    np = self.malloc(newcap + 1)
                    old = self.rd(this + 1, size) + bytes([ch])
                    self.wr(np, old + b'\x00')
                    self.wr(this, struct.pack('<QQQ', newcap | 1, size + 1, np))
                else:
                    self.wr(this, bytes([(size + 1) << 1]) + self.rd(this + 1, size)
                            + bytes([ch]) + b'\x00' * (22 - size))
            return this
        if 'reserveEm' in name:
            n = a[1]
            hdr = self.rd(this, 24)
            is_long = hdr[0] & 1
            if is_long:
                cap = struct.unpack('<Q', hdr[0:8])[0] & ~1
                slen = struct.unpack('<Q', hdr[8:16])[0]
                ptr = struct.unpack('<Q', hdr[16:24])[0]
            else:
                slen = hdr[0] >> 1
                ptr = this + 1
                cap = 22
            if n > cap:
                newcap = max(32, n)
                np = self.malloc(newcap + 1)
                self.wr(np, self.rd(ptr, slen))
                self.wr(this, struct.pack('<QQQ', newcap | 1, slen, np))
            return this
        if 'compareEmmPKcm' in name:
            hdr = self.rd(this, 24)
            is_long = hdr[0] & 1
            if is_long:
                slen = struct.unpack('<Q', hdr[8:16])[0]
                ptr = struct.unpack('<Q', hdr[16:24])[0]
            else:
                slen = hdr[0] >> 1
                ptr = this + 1
            pos, n, other, olen = a[1], a[2], a[3], a[4]
            s1 = self.rd(ptr + pos, min(n, max(0, slen - pos)))
            s2 = self.rd(other, olen)
            return (s1 > s2) - (s1 < s2)
        return 0

    def _make_env(self):
        uc = self.uc
        self.jni_impl = {}
        table = ENV_BASE + 0x1000
        uc.mem_write(ENV_BASE, struct.pack('<Q', table))
        for idx in sorted(set(list(range(164, 215)) + [171, 176])):
            magic = MAGIC_BASE + idx * 16
            uc.mem_write(table + idx * 8, struct.pack('<Q', magic))
            self.jni_impl[magic] = idx

        def hook_env(uc, address, size, user_data):
            idx = self.jni_impl.get(address)
            if idx is None:
                return
            lr = uc.reg_read(UC_ARM64_REG_LR)
            a = [uc.reg_read(r) for r in (UC_ARM64_REG_X0, UC_ARM64_REG_X1,
                UC_ARM64_REG_X2, UC_ARM64_REG_X3, UC_ARM64_REG_X4, UC_ARM64_REG_X5)]
            ret = self.do_jni(idx, a)
            if ret is not None:
                uc.reg_write(UC_ARM64_REG_X0, ret & 0xFFFFFFFFFFFFFFFF)
            uc.reg_write(UC_ARM64_REG_PC, lr)

        uc.hook_add(UC_HOOK_CODE, hook_env, begin=MAGIC_BASE, end=MAGIC_BASE + 0x10000)

    def new_array(self, data):
        h = self.next_handle
        self.next_handle += 0x10
        ptr = self.malloc(len(data) + 64)
        self.wr(ptr, data)
        self.objects[h] = {'ptr': ptr, 'len': len(data)}
        return h

    def do_jni(self, idx, a):
        obj = a[1]
        info = self.objects.get(obj, {'ptr': 0, 'len': 0})
        if idx == 171:
            return info['len']
        if 183 <= idx <= 190 or idx == 169:
            return info['ptr']
        if 191 <= idx <= 198 or idx == 170:
            return 0
        if 175 <= idx <= 182:
            h = self.next_handle
            self.next_handle += 0x10
            ptr = self.malloc(a[1] + 64)
            self.wr(ptr, b'\x00' * a[1])
            self.objects[h] = {'ptr': ptr, 'len': a[1]}
            return h
        if 207 <= idx <= 214:
            data = self.rd(a[3], a[2])
            self.wr(info['ptr'] + a[1], data)
            info['len'] = max(info['len'], a[1] + a[2])
            return 0
        if idx in (164, 168):
            return info['len']
        return 0

    def call(self, func_addr, *args, stack_args=None):
        uc = self.uc
        stack = STACK_BASE + STACK_SIZE - 0x100000
        uc.reg_write(UC_ARM64_REG_SP, stack)
        uc.reg_write(UC_ARM64_REG_TPIDR_EL0, TLS_BASE)
        for i, v in enumerate(args):
            uc.reg_write(UC_ARM64_REG_X0 + i, v & 0xFFFFFFFFFFFFFFFF)
        if stack_args:
            uc.mem_write(stack, stack_args)
        uc.reg_write(UC_ARM64_REG_LR, RET_MAGIC)
        uc.emu_start(BASE + func_addr, RET_MAGIC)
        return uc.reg_read(UC_ARM64_REG_X0)


class HeyTeaSecureSDK:
    """喜茶安全传输会话(单实例,线程安全)"""

    def __init__(self, api_base, base_headers, tenant=None, version=None, client=None):
        self.api_base = api_base
        self.base_headers = base_headers
        # 租户必须与后续业务请求一致, 否则服务端解不开票据
        # (invalid_ticket: cipher:final EVP_CipherFinal_ex failed)
        self.tenant = tenant or TENANT
        self.version = version if version is not None else VERSION
        self.client = client or "app"
        self.session_ready = False
        self.ticket = None
        self.expires_at = 0
        emu_pool = os.urandom(4096)
        self.emu = Emu(emu_pool)

    def _jni_prepare(self, config_json: bytes):
        out_arr = self.emu.new_array(b'\x00' * 1024)
        outlen_arr = self.emu.new_array(b'\x00' * 4)
        config_arr = self.emu.new_array(config_json)
        self.emu.call(JNI_PREPARE, ENV_BASE, 0, out_arr, outlen_arr, config_arr)
        outlen = struct.unpack('<i', self.emu.rd(self.emu.objects[outlen_arr]['ptr'], 4))[0]
        data = self.emu.rd(self.emu.objects[out_arr]['ptr'], 1024)
        nz = data.find(b'client_public_key')
        start = data.rfind(b'{', 0, nz) if nz >= 0 else data.find(b'{')
        if start < 0 or outlen <= 0:
            raise Exception("handshakePrepare 输出为空")
        s = data[start:start + outlen].decode('utf-8', 'replace')
        end = s.rfind('}')
        return json.loads(s[:end + 1])

    def init_session(self):
        """建立安全传输会话: 拉取tenant-config -> prepare -> handshake -> finish"""
        import requests
        h = self.base_headers.copy()
        h.update({"Heytea-Secure-Transmission-Tenant": self.tenant,
                  "Heytea-Secure-Transmission-Version": str(self.version)})
        rc = requests.get(f"{self.api_base}/api/_secure-transmission/tenant-config",
                          headers=h, timeout=15)
        global_config = rc.json()

        config_json = json.dumps(global_config, separators=(',', ':')).encode()
        post = self._jni_prepare(config_json)

        h2 = self.base_headers.copy()
        h2.update({"Heytea-Secure-Transmission-Tenant": self.tenant,
                   "Heytea-Secure-Transmission-Version": str(self.version),
                   "Content-Type": "application/json", "X-client": self.client})
        r = requests.post(f"{self.api_base}/api/_secure-transmission/handshake",
                          headers=h2, json=post, timeout=15)
        d = r.json()
        if r.status_code != 200:
            raise Exception(f"握手失败: HTTP {r.status_code} {d}")
        sr = base64.b64decode(d["server_random"].replace('-', '+').replace('_', '/')
                              + '=' * (-len(d["server_random"]) % 4))
        self.ticket = d["ticket"]
        self.expires_at = d.get("expires_at", 0)
        route_json = json.dumps(d.get("route_rules", []), separators=(',', ':')).encode()

        sr_arr = self.emu.new_array(sr)
        route_arr = self.emu.new_array(route_json)
        ret = self.emu.call(JNI_FINISH, ENV_BASE, 0, sr_arr, route_arr)
        if ret != 0:
            raise Exception(f"handshakeFinish 失败: {ret}")
        self.session_ready = True
        return True

    def ensure_session(self, force=False):
        import time
        if self.session_ready and not force and time.time() < self.expires_at - 60:
            return True
        return self.init_session()

    def encrypt_request(self, body: dict, url_path: str, domain="app-go.heytea.com"):
        """加密请求体,返回可直接 POST 的 dict"""
        payload = json.dumps(body, separators=(',', ':')).encode()
        emu = self.emu
        pl = emu.malloc(len(payload) + 1); emu.wr(pl, payload + b'\x00')
        d = domain.encode() + b'\x00'; dp = emu.malloc(len(d)); emu.wr(dp, d)
        u = url_path.encode() + b'\x00'; up = emu.malloc(len(u)); emu.wr(up, u)
        t = (self.tenant + '\x00').encode(); tp = emu.malloc(len(t)); emu.wr(tp, t)
        outptr = emu.malloc(8); emu.wr(outptr, b'\x00' * 8)
        outlen = emu.malloc(8); emu.wr(outlen, b'\x00' * 8)
        stack_args = struct.pack('<I4xQQ', self.version, outptr, outlen)
        ret = emu.call(C_ENCODE, pl, len(payload), dp, len(domain), up, len(url_path),
                       tp, len(self.tenant), stack_args=stack_args)
        if ret != 0:
            raise Exception(f"encode 失败: {ret}")
        optr = struct.unpack('<Q', emu.rd(outptr, 8))[0]
        olen = struct.unpack('<Q', emu.rd(outlen, 8))[0]
        if not optr or not olen:
            raise Exception("encode 输出为空")
        return json.loads(emu.rd(optr, olen).decode())

    def decrypt_response(self, blob_b64: str):
        # 小程序行为: 解密输入是整个响应对象的JSON字符串(含secure_encrypted_s_data字段)
        input_json = json.dumps({"secure_encrypted_s_data": blob_b64},
                                separators=(',', ':')).encode()
        emu = self.emu
        darr = emu.new_array(input_json)
        dout = emu.malloc(8); emu.wr(dout, b'\x00' * 8)
        dlen = emu.malloc(8); emu.wr(dlen, b'\x00' * 8)
        # C decode: (data, dlen, tenant, tenant_len, version, &out_ptr, &out_len)
        tenant = (TENANT + '\x00').encode(); tp = emu.malloc(len(tenant)); emu.wr(tp, tenant)
        ret = emu.call(C_DECODE, emu.objects[darr]['ptr'], len(input_json),
                       tp, len(TENANT), VERSION, dout, dlen)
        if ret != 0:
            raise Exception(f"decode 失败: {ret}")
        dp = struct.unpack('<Q', emu.rd(dout, 8))[0]
        dl = struct.unpack('<Q', emu.rd(dlen, 8))[0]
        if not dp or not dl:
            raise Exception("decode 输出为空")
        return json.loads(emu.rd(dp, dl).decode())

    def secure_headers(self):
        h = self.base_headers.copy()
        h.update({"Heytea-Secure-Transmission-Tenant": self.tenant,
                  "Heytea-Secure-Transmission-Version": str(self.version),
                  "X-client": self.client,
                  "Cookie": f"HeyteaSecureTransmissionTicket={self.ticket}"})
        return h


def get_secure_sdk(api_base, base_headers, tenant=None, version=None, client=None):
    """获取/创建全局 SDK 单例(线程安全)"""
    global _sdk_instance
    with _lock:
        if _sdk_instance is None:
            _sdk_instance = HeyTeaSecureSDK(api_base, base_headers, tenant, version, client)
        _sdk_instance.ensure_session()
        return _sdk_instance
