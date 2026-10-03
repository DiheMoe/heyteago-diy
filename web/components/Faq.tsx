// 常见问题（静态内容）。
const ITEMS: Array<{ q: string; a: string[] }> = [
  {
    q: "1. 怎么获取 token？",
    a: [
      "本工具不做登录（App 登录走原生反滥用通道，无法在本机复现）。用手机抓包提取：手机 WiFi 代理指向本机 mitmproxy（默认 :8898），在喜茶 App 退出登录后重新短信登录，抓包请求头里的 Authorization 即为 token，有效期约 15 天。",
    ],
  },
  {
    q: "2. 上传失败，提示“文件格式不允许上传”/“文件大小不符合要求”。",
    a: ["工具会自动压缩到 200KB 内，但不排除失败可能，可更换 PNG 文件或更小的图片后重试。"],
  },
  {
    q: "3. 上传成功后小程序不显示",
    a: ["确认上传工具使用的账号和喜茶登录账号保持一致，随后刷新喜茶小程序。"],
  },
  {
    q: "4. 其他上传失败",
    a: [
      "确认今日内上传未超过 10 张，并检查喜茶小程序是否能正常打开上传界面并制作喜贴。",
      "部分浏览器不支持现代 Web API，可更换 Chrome 或 Safari 后重试上传。",
    ],
  },
];

export function Faq() {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-neutral-800">常见问题</h2>
      <div className="space-y-3 text-xs">
        {ITEMS.map((item) => (
          <div key={item.q}>
            <p className="font-medium text-neutral-800">{item.q}</p>
            {item.a.map((line) => (
              <p key={line} className="mt-0.5 leading-relaxed text-neutral-500">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
