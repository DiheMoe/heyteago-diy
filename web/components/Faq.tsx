// 常见问题（静态内容）。
const ITEMS: Array<{ q: string; a: string[] }> = [
  {
    q: "1. 为什么突然要求滑块验证？",
    a: [
      "这是喜茶的风控机制：短时间内频繁发送短信或反复登录时会触发，平时不会出现。",
      "按提示完成滑块后原操作会自动继续；若提示“人机验证未通过或已失效”，放缓操作频率，稍后再试。",
    ],
  },
  {
    q: "2. 「存为草稿」和「上传杯贴」有什么区别？",
    a: [
      "「存为草稿」上传到账号后，可在喜茶小程序/App 的画布里继续编辑再发布，日常使用推荐。",
      "「上传杯贴」直接发布到账号，立即生效不可撤回。",
    ],
  },
  {
    q: "3. 上传失败，提示“文件格式不允许上传”/“文件大小不符合要求”。",
    a: ["工具会自动压缩到 200KB 内，但不排除失败可能，可更换 PNG 文件或更小的图片后重试。"],
  },
  {
    q: "4. 上传成功后小程序不显示",
    a: ["确认上传工具使用的账号和喜茶登录账号保持一致，随后刷新喜茶小程序。"],
  },
  {
    q: "5. 其他上传失败",
    a: [
      "确认今日内上传未超过 10 张，并检查喜茶小程序是否能正常打开上传界面并制作喜贴。",
      "部分浏览器不支持现代 Web API，可更换 Chrome 或 Safari 后重试上传。",
    ],
  },
  {
    q: "6. token 保存在哪里，安全吗？",
    a: [
      "token 只保存在你自己的浏览器里（勾选“记住”后以明文存 localStorage），服务端不存储、不落日志。",
      "token 等同于登录态，不要分享给他人。",
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
